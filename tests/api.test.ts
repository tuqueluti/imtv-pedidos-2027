import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PortalStore } from '../server/db.ts';
import { createPortalApp } from '../server/app.ts';
import {
  BOARD_COLUMNS,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  parseAndValidateWhatsApp,
} from '../shared/domain.ts';

async function startTestServer(options?: {
  failEmailTimes?: { count: number };
}) {
  const store = new PortalStore(':memory:');
  let sentEmails = 0;

  const handler = createPortalApp(store, {
    simulateOrderWriteFailureHeader: true,
    mailTransport: async ({ to, subject }) => {
      if (options?.failEmailTimes && options.failEmailTimes.count > 0) {
        options.failEmailTimes.count -= 1;
        return { sent: false, error: 'Falha simulada de conexão SMTP' };
      }
      sentEmails += 1;
      assert.ok(to.includes('@'));
      assert.ok(subject.includes('IMTV 2027'));
      return { sent: true };
    },
  });

  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    store,
    baseUrl,
    getSentEmails: () => sentEmails,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

test('Validação de WhatsApp aceita espaços, parênteses, hífen e código de país editável', () => {
  const br = parseAndValidateWhatsApp({
    countryCode: '+55',
    ddd: '48',
    number: '(48) 99988-7766',
  });
  assert.equal(br.valid, true);
  assert.equal(br.e164, '+5548999887766');
  assert.equal(br.display, '+55 (48) 99988-7766');

  const pt = parseAndValidateWhatsApp({
    countryCode: '+351',
    ddd: '91',
    number: '234 5678',
  });
  assert.equal(pt.valid, true);
  assert.equal(pt.e164, '+351912345678');

  const bad = parseAndValidateWhatsApp({
    countryCode: '+55',
    ddd: '00',
    number: '123',
  });
  assert.equal(bad.valid, false);
});

test('Isolamento público, idempotência contra clique duplo e repetição isolada de e-mail', async () => {
  const failTracker = { count: 1 };
  const env = await startTestServer({ failEmailTimes: failTracker });

  try {
    // 1. Quadro interno e admin exigem autenticação
    const unauthBoard = await fetch(`${env.baseUrl}/api/board/orders`);
    assert.equal(unauthBoard.status, 401);

    // 2. Config pública expõe apenas nome da equipe e logoUrl, sem vazar contatos internos
    const pubCfgRes = await fetch(`${env.baseUrl}/api/public/config`);
    const pubCfg = (await pubCfgRes.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(pubCfg).sort(), ['logoUrl', 'recipientTeamName']);
    assert.equal(pubCfg.recipientTeamName, 'Equipe de Produção da IMTV');

    // 3. Admin autentica e ativa notificação real por e-mail
    const loginRes = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'luti', password: process.env.IMTV_INITIAL_PASSWORD || 'imtv2027' }),
    });
    assert.equal(loginRes.status, 200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(adminCookie.startsWith('imtv_session_2027='));

    const saveCfgRes = await fetch(`${env.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        recipientTeamName: 'Equipe de Produção da IMTV',
        notificationEmailEnabled: true,
        notificationEmailTo: 'notificacoes-teste@imtv.com.br',
      }),
    });
    assert.equal(saveCfgRes.status, 200);

    // 4. Envio público com clique duplo (mesma idempotencyKey) cria UM ÚNICO cartão
    const payload = {
      idempotencyKey: 'idem_test_unico_2027_001',
      unitName: 'Instituto Mix Criciúma Centro',
      city: 'Criciúma',
      uf: 'SC',
      requesterName: 'Camila Teste',
      requesterEmail: 'camila.teste@unidade.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '48',
      whatsappNumber: '(48) 99123-4567',
      title: 'Campanha Matrículas 2027',
      objective: 'Gerar matrículas nas turmas presenciais',
      targetAudience: 'Jovens de 17 a 35 anos',
      distributionChannel: 'Instagram (Reels / Stories / Feed)',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-02-15',
      mainMessage: 'Garanta sua vaga com aulas práticas desde a primeira semana.',
      mandatoryInfo: 'Unidade Criciúma Centro',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploMateriaisBrutos?usp=sharing',
      materialsPending: false,
    };

    const [firstSubmit, duplicateSubmit] = await Promise.all([
      fetch(`${env.baseUrl}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      fetch(`${env.baseUrl}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);

    const firstJson = await firstSubmit.json();
    const dupJson = await duplicateSubmit.json();

    assert.equal(firstJson.ok, true);
    assert.equal(dupJson.ok, true);
    assert.equal(firstJson.protocol, dupJson.protocol);

    // Como failEmailTimes começou em 1, o pedido foi gravado mas o e-mail falhou na 1ª tentativa
    const retryToken = firstJson.emailNotification?.retryToken || dupJson.emailNotification?.retryToken;
    assert.ok(retryToken, 'Deve retornar token para repetir apenas a notificação de e-mail');
    assert.equal(env.getSentEmails(), 0);

    // Repete apenas a notificação de e-mail sem duplicar o cartão
    const retryRes = await fetch(
      `${env.baseUrl}/api/public/orders/${encodeURIComponent(firstJson.protocol)}/retry-notification`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryToken }),
      }
    );
    const retryJson = await retryRes.json();
    assert.equal(retryJson.ok, true);
    assert.equal(retryJson.emailNotification.status, 'sent');
    assert.equal(env.getSentEmails(), 1);

    // Confere no quadro autenticado que existe EXATAMENTE 1 cartão em Recebido
    const boardRes = await fetch(`${env.baseUrl}/api/board/orders`, {
      headers: { Cookie: adminCookie },
    });
    const boardJson = await boardRes.json();
    assert.deepEqual(boardJson.columns, BOARD_COLUMNS);
    assert.equal(boardJson.orders.length, 1);

    const card = boardJson.orders[0];
    assert.equal(card.boardColumn, 'Recebido');
    assert.equal(card.whatsappE164, '+5548991234567');

    // 5. Move para Tati -> Aguardando (preserva Tati) -> Finalizados -> Salva link final separado do Drive -> WhatsApp pendente até confirmar
    const moveTati = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ targetColumn: 'Tati' }),
    }).then((r) => r.json());
    assert.equal(moveTati.order.boardColumn, 'Tati');
    assert.equal(moveTati.order.assignee, 'Tati');

    const moveWait = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        targetColumn: 'Aguardando',
        waitingReason: 'Aguardando logo local da fachada',
      }),
    }).then((r) => r.json());
    assert.equal(moveWait.order.boardColumn, 'Aguardando');
    assert.equal(moveWait.order.assignee, 'Tati');
    assert.equal(moveWait.order.waitingReason, 'Aguardando logo local da fachada');

    const moveFinal = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ targetColumn: 'Finalizados' }),
    }).then((r) => r.json());
    assert.equal(moveFinal.order.boardColumn, 'Finalizados');
    assert.equal(moveFinal.order.assignee, 'Tati');

    const finalVideoUrl =
      'https://drive.google.com/file/d/9VideoFinalRenderizado2027/view?usp=sharing&resourcekey=0-xyz123';
    const saveFinal = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/final-video`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ finalVideoUrl }),
    }).then((r) => r.json());

    assert.equal(saveFinal.order.finalVideoUrl, finalVideoUrl);
    assert.notEqual(saveFinal.order.finalVideoUrl, saveFinal.order.materialsDriveUrl);

    // Abrir conversa no WhatsApp NÃO confirma envio (continua pending)
    const openedWa = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/whatsapp-opened`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    }).then((r) => r.json());
    assert.equal(openedWa.order.whatsappDeliveryStatus, 'pending');

    // Confere formato exato da mensagem do WhatsApp
    const msg = buildWhatsAppMessage({
      requesterName: saveFinal.order.requesterName,
      title: saveFinal.order.title,
      unitName: saveFinal.order.unitName,
      finalVideoUrl: saveFinal.order.finalVideoUrl,
      protocol: saveFinal.order.protocol,
    });
    assert.equal(
      msg,
      `Olá, Camila Teste! O vídeo “Campanha Matrículas 2027”, que você pediu para a unidade Instituto Mix Criciúma Centro, está pronto.\n${finalVideoUrl}\nProtocolo ${saveFinal.order.protocol}. Equipe IMTV`
    );

    const waUrl = buildWhatsAppUrl({
      whatsappE164: saveFinal.order.whatsappE164,
      requesterName: saveFinal.order.requesterName,
      title: saveFinal.order.title,
      unitName: saveFinal.order.unitName,
      finalVideoUrl: saveFinal.order.finalVideoUrl,
      protocol: saveFinal.order.protocol,
    });
    assert.ok(waUrl.startsWith('https://wa.me/5548991234567?text='));
    const decodedText = new URL(waUrl).searchParams.get('text');
    assert.equal(decodedText, msg);

    // Confirmar envio registra quem confirmou e a data
    const confirmedWa = await fetch(`${env.baseUrl}/api/board/orders/${card.id}/confirm-whatsapp`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    }).then((r) => r.json());
    assert.equal(confirmedWa.order.whatsappDeliveryStatus, 'confirmed');
    assert.equal(confirmedWa.order.whatsappConfirmedBy, 'Luti');
    assert.ok(confirmedWa.order.whatsappConfirmedAt);
  } finally {
    await env.close();
  }
});
