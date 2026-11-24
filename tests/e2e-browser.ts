import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { PortalStore } from '../server/db.ts';
import { createPortalApp } from '../server/app.ts';

function findChromeExecutable(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Executável do Chrome/Edge não encontrado para verificação E2E.');
}

async function launchChromeViaCDP() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imtv-e2e-chrome-'));
  const portFile = path.join(profileDir, 'DevToolsActivePort');

  const child = spawn(
    findChromeExecutable(),
    [
      '--headless=new',
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--mute-audio',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let cdpPort: number | null = null;
  for (let i = 0; i < 120 && !cdpPort; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const content = fs.readFileSync(portFile, 'utf8');
      cdpPort = parseInt(content.split('\n')[0] || '', 10) || null;
    } catch {
      // aguarda inicialização
    }
  }

  if (!cdpPort) {
    try {
      child.kill();
    } catch {
      // ignore
    }
    throw new Error('Chrome headless não expôs DevToolsActivePort.');
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

  const cleanup = async () => {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    if (child.exitCode === null && child.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
      } catch {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    }
    await new Promise((r) => setTimeout(r, 250));
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // ignore Crashpad lock
    }
  };

  return { browser, cleanup };
}

async function runE2E() {
  const shotsDir = path.resolve(process.cwd(), 'qa-shots');
  fs.rmSync(shotsDir, { recursive: true, force: true });
  fs.mkdirSync(shotsDir, { recursive: true });

  const testDbPath = path.resolve(process.cwd(), 'data', 'e2e-verification.sqlite');
  fs.rmSync(testDbPath, { force: true });

  const store = new PortalStore(testDbPath);
  const app = createPortalApp(store, {
    publicDir: path.resolve(process.cwd(), 'public'),
    distDir: path.resolve(process.cwd(), 'dist'),
    simulateOrderWriteFailureHeader: true,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E] Servidor iniciado em ${baseUrl}`);

  const { browser, cleanup } = await launchChromeViaCDP();

  try {
    // =========================================================================
    // PARTE 1: COMPUTADOR (1440x900) — ABERTURA 3D + NOVO FORMULÁRIO 01/02/03
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await desktopCtx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(950);

    // 1a. Som já deve iniciar ativado ao entrar no link
    const soundBtn = page.getByTestId('toggle-sound-btn');
    await soundBtn.waitFor({ state: 'visible' });
    assert.equal(await soundBtn.getAttribute('aria-pressed'), 'true');
    assert.equal((await soundBtn.textContent())?.trim(), 'Silenciar som');

    await page.getByRole('button', { name: 'Ir direto ao pedido' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(shotsDir, '01-desktop-estudio-3d-frame0.png') });

    // 1b. Valida cursor de claquete (aberta em repouso, fechada no clique curto ~80ms e longo, nativo preservado)
    const jumpBtn = page.getByRole('button', { name: 'Ir direto ao pedido' });
    const jumpBox = await jumpBtn.boundingBox();
    assert.ok(jumpBox);
    const cx = jumpBox.x + jumpBox.width / 2;
    const cy = jumpBox.y + jumpBox.height / 2;

    await page.mouse.move(cx, cy);
    assert.equal(await jumpBtn.getAttribute('data-imtv-claquete'), 'aberta');
    const computedCursor = await jumpBtn.evaluate((el) => getComputedStyle(el).cursor);
    assert.ok(computedCursor.includes('claquete-aberta'), `Cursor inesperado: ${computedCursor}`);

    // Clique longo na área livre do estúdio (sem disparar navegação)
    await page.mouse.move(220, 220);
    const getStageClaquete = () =>
      page.evaluate(() => document.elementFromPoint(220, 220)?.getAttribute('data-imtv-claquete') ?? null);

    assert.equal(await getStageClaquete(), 'aberta');
    await page.mouse.down();
    assert.equal(await getStageClaquete(), 'fechada');
    await page.waitForTimeout(150);
    assert.equal(await getStageClaquete(), 'fechada');
    await page.mouse.up();
    await page.waitForTimeout(40);
    assert.equal(await getStageClaquete(), 'aberta');

    // Clique curto (< 80ms): permanece fechada ~80ms e reabre
    await page.mouse.click(220, 220, { delay: 5 });
    assert.equal(await getStageClaquete(), 'fechada');
    await page.waitForTimeout(105);
    assert.equal(await getStageClaquete(), 'aberta');

    // Controle de som possui data-imtv-cursor-nativo -> não recebe atributo da claquete
    const soundBox = await soundBtn.boundingBox();
    assert.ok(soundBox);
    await page.mouse.move(soundBox.x + soundBox.width / 2, soundBox.y + soundBox.height / 2);
    assert.equal(await soundBtn.getAttribute('data-imtv-claquete'), null);

    // Testa alternar mudo e reativar som
    await soundBtn.click();
    assert.equal(await soundBtn.getAttribute('aria-pressed'), 'false');
    await soundBtn.click();
    assert.equal(await soundBtn.getAttribute('aria-pressed'), 'true');

    await page.evaluate(() => window.scrollTo(0, 650));
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.studio-scroll-track').getAttribute('data-handed-off'), 'false');

    // Avança até a moldura sair pelas quatro bordas (200vh = 1800px)
    await page.evaluate(() => window.scrollTo(0, 1820));
    await page.waitForTimeout(450);
    assert.equal(await page.locator('.studio-scroll-track').getAttribute('data-handed-off'), 'true');
    assert.equal(
      (await page.locator('#pedido-main-heading').textContent())?.trim(),
      'Qual vídeo sua unidade precisa?'
    );

    // Verifica que dentro de "Quem recebe" está o logo oficial da IMTV (substituindo o ícone de câmera)
    await page.locator('.recipient-logo-img').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(shotsDir, '03-desktop-formulario-novo-layout.png') });

    // Verifica isolamento público
    const publicHtml = await page.content();
    assert.ok(!publicHtml.includes('luti@imtv.com.br'));
    const unauthStatus = await page.evaluate(async () => (await fetch('/api/board/orders')).status);
    assert.equal(unauthStatus, 401);

    // Verifica lado a lado das fichas "Quem solicita" e "Quem recebe" no computador
    const boxesLayout = await page.evaluate(() => {
      const sheets = document.querySelectorAll('#pedido .pipefy-cards-pair > .pipefy-sheet');
      if (sheets.length < 2) return null;
      const r1 = sheets[0].getBoundingClientRect();
      const r2 = sheets[1].getBoundingClientRect();
      return { topDiff: Math.abs(r1.top - r2.top), leftDiff: r2.left - r1.left };
    });
    assert.ok(boxesLayout && boxesLayout.topDiff < 10 && boxesLayout.leftDiff > 200);

    // Preenche 01 Identificação, 02 Briefing e 03 Materiais e revisão
    const unitInput = page.locator('#f-unitName');
    const unitInputBox = await unitInput.boundingBox();
    assert.ok(unitInputBox);
    await page.mouse.move(unitInputBox.x + 24, unitInputBox.y + 18);
    assert.equal(await unitInput.getAttribute('data-imtv-claquete'), null);

    await page.fill('#f-unitName', 'Instituto Mix Florianópolis Centro');
    await page.fill('#f-city', 'Florianópolis');
    await page.selectOption('#f-uf', 'SC');
    await page.fill('#f-requesterName', 'Mariana Contato Teste');
    await page.fill('#f-requesterEmail', 'mariana.teste@unidade.example');
    assert.equal(await page.inputValue('#f-waCc'), '+55');
    await page.fill('#f-waDdd', '48');
    await page.fill('#f-waNumber', '(48) 99876-5432');

    await page.fill('#f-title', 'Semana da Beleza 2027');
    await page.fill('#f-desiredDate', '2027-03-09');
    await page.fill('#f-objective', 'Divulgar as oficinas práticas gratuitas');
    await page.fill('#f-audience', 'Interessados nos cursos da área da beleza');
    await page.fill('#f-mainMessage', 'Divulgar as oficinas da Semana da Beleza.');
    await page.fill('#f-mandatoryInfo', 'Unidade Centro · Vagas limitadas');

    const driveMaterialsLink =
      'https://drive.google.com/drive/folders/1BrutosSemanaBeleza2027?usp=sharing';
    await page.fill('#f-driveUrl', driveMaterialsLink);

    const reviewPhone = await page.getByTestId('review-whatsapp-display').textContent();
    assert.equal(reviewPhone?.trim(), '+55 (48) 99876-5432');
    await page.screenshot({ path: path.join(shotsDir, '04-desktop-formulario-completo.png'), fullPage: false });

    // Simula falha de gravação e verifica preservação dos dados na tela
    await page.evaluate(() => {
      (window as unknown as { __IMTV_SIMULATE_WRITE_FAIL__?: boolean }).__IMTV_SIMULATE_WRITE_FAIL__ = true;
    });
    await page.getByTestId('submit-order-btn').click();
    await page.getByTestId('submit-error-banner').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('order-confirmation-box').count(), 0);
    assert.equal(await page.inputValue('#f-driveUrl'), driveMaterialsLink);

    // Envia com clique duplo: deve gerar UM ÚNICO cartão
    await page.evaluate(() => {
      (window as unknown as { __IMTV_SIMULATE_WRITE_FAIL__?: boolean }).__IMTV_SIMULATE_WRITE_FAIL__ = false;
    });
    await page.getByTestId('submit-order-btn').dblclick();
    await page.getByTestId('order-confirmation-box').waitFor({ state: 'visible' });

    const protocol1 = (await page.getByTestId('confirmed-protocol').textContent())?.trim() || '';
    assert.equal(protocol1, 'IMTV-2027-0001');

    // =========================================================================
    // PARTE 2: NOVO QUADRO DE PRODUÇÃO + PAINEL DUPLO INFERIOR + WHATSAPP
    // =========================================================================
    await page.goto(`${baseUrl}/quadro`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('team-login-form').waitFor({ state: 'visible' });

    await page.fill('#login-username', 'luti');
    await page.fill('#login-password', process.env.IMTV_INITIAL_PASSWORD || 'imtv2027');
    await page.getByTestId('login-submit-btn').click();
    await page.getByTestId('pipefy-board-view').waitFor({ state: 'visible' });

    const renderedColumns = await page.$$eval(
      'section[data-column]',
      (els) => els.map((el) => el.getAttribute('data-column'))
    );
    assert.deepEqual(renderedColumns, [
      'Recebido',
      'Luti',
      'Tati',
      'Marcio',
      'Aguardando',
      'Finalizados',
    ]);

    assert.equal(await page.getByTestId('col-count-Recebido').textContent(), '1');
    const receivedCard = page.getByTestId(`order-card-${protocol1}`);
    assert.equal(await receivedCard.count(), 1);
    const cardBox = await receivedCard.boundingBox();
    assert.ok(cardBox);
    await page.mouse.move(cardBox.x + 20, cardBox.y + 20);
    assert.equal(await receivedCard.getAttribute('data-imtv-claquete'), null);

    // Move diretamente para "Tati" -> depois "Aguardando" -> registra pendência -> recarrega página
    await page.getByTestId(`move-select-${protocol1}`).selectOption('Tati');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="col-count-Tati"]')?.textContent === '1'
    );

    await page.getByTestId(`move-select-${protocol1}`).selectOption('Aguardando');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="col-count-Aguardando"]')?.textContent === '1'
    );

    await page.fill(
      'input[placeholder*="Registrar o que falta"]',
      'falta aprovação'
    );
    await page.getByRole('button', { name: 'Salvar pendência' }).click();
    await page.waitForTimeout(200);

    // Recarrega e confere coluna "Aguardando" e responsável "Tati" preservada
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('pipefy-board-view').waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="col-count-Aguardando"]')?.textContent === '1'
    );
    assert.ok(
      (await page.getByTestId(`card-assignee-${protocol1}`).textContent())?.includes('Com Tati')
    );

    // Move para "Finalizados", salva link final separado do Drive, testa WhatsApp e verifica Envio pendente
    await page.getByTestId(`move-select-${protocol1}`).selectOption('Finalizados');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="col-count-Finalizados"]')?.textContent === '1'
    );

    const finalDeliveryUrl =
      'https://drive.google.com/file/d/9EntregaSemanaBeleza2027/view?usp=sharing&token=imtv27';
    const sendWaBtn = page.getByTestId('send-whatsapp-btn-card-1');
    assert.equal(await sendWaBtn.isDisabled(), true);

    await page.fill('#final-link-card-1', finalDeliveryUrl);
    await page.getByTestId('save-final-link-card-1').click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector('[data-testid="send-whatsapp-btn-card-1"]')
          ?.hasAttribute('disabled')
    );

    // Verifica que o botão mostra "✓ Salvo"
    assert.ok((await page.getByTestId('save-final-link-card-1').textContent())?.includes('Salvo'));

    // Verifica que o link dos materiais do Drive continua separado e intacto no painel esquerdo
    assert.equal(
      await page.getByTestId('open-drive-materials-btn').getAttribute('href'),
      driveMaterialsLink
    );

    await page.evaluate(() => {
      (window as unknown as { __LAST_OPENED_WA_URL__?: string }).__LAST_OPENED_WA_URL__ = '';
      window.open = (url?: string | URL) => {
        (window as unknown as { __LAST_OPENED_WA_URL__?: string }).__LAST_OPENED_WA_URL__ =
          String(url || '');
        return null;
      };
    });

    await sendWaBtn.click();
    await page.waitForTimeout(250);

    const openedWaUrl = await page.evaluate(
      () => (window as unknown as { __LAST_OPENED_WA_URL__?: string }).__LAST_OPENED_WA_URL__ || ''
    );
    assert.ok(openedWaUrl.startsWith('https://wa.me/5548998765432?text='));
    const decodedWaMessage = new URL(openedWaUrl).searchParams.get('text') || '';
    assert.equal(
      decodedWaMessage,
      `Olá, Mariana Contato Teste! O vídeo “Semana da Beleza 2027”, que você pediu para a unidade Instituto Mix Florianópolis Centro, está pronto.\n${finalDeliveryUrl}\nProtocolo ${protocol1}. Equipe IMTV`
    );

    // Recarrega sem confirmar envio -> continua "Envio pendente"
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('pipefy-board-view').waitFor({ state: 'visible' });
    await page.waitForSelector('[data-testid="delivery-status-1"]');
    assert.equal((await page.getByTestId('delivery-status-1').textContent())?.trim(), 'Envio pendente');
    await page.screenshot({ path: path.join(shotsDir, '09-desktop-quadro-producao-novo.png') });

    assert.equal(pageErrors.length, 0, `Erros JS no desktop: ${pageErrors.join('; ')}`);
    await desktopCtx.close();

    // =========================================================================
    // PARTE 3: CELULAR (390x844)
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mPage = await mobileCtx.newPage();
    const mobileErrors: string[] = [];
    mPage.on('pageerror', (err) => mobileErrors.push(err.message));

    await mPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await mPage.waitForTimeout(1000);

    // Verifica no celular (390x844) que o estúdio vertical está ativo, com som ligado e TV 100% dentro e centralizada!
    assert.equal(await mPage.locator('.studio-scroll-track').getAttribute('data-stage-mode'), 'mobile');
    assert.equal(await mPage.getByTestId('toggle-sound-btn').getAttribute('aria-pressed'), 'true');

    const mobileTvRect = await mPage.evaluate(() => {
      const el = document.querySelector('.tv-screen-dom');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        width: r.width,
        centerX: (r.left + r.right) / 2,
        viewportCenter: window.innerWidth / 2,
      };
    });
    assert.ok(mobileTvRect, 'Elemento .tv-screen-dom ausente no celular');
    assert.ok(
      mobileTvRect.left >= 25 && mobileTvRect.right <= 365,
      `TV cortada no celular: left=${mobileTvRect.left}, right=${mobileTvRect.right}`
    );
    assert.ok(
      Math.abs(mobileTvRect.centerX - mobileTvRect.viewportCenter) <= 22,
      `TV descentralizada no celular: centerX=${mobileTvRect.centerX} vs ${mobileTvRect.viewportCenter}`
    );

    await mPage.screenshot({ path: path.join(shotsDir, '00-mobile-estudio-3d-centralizado.png') });

    await mPage.getByRole('button', { name: 'Ir direto ao pedido' }).click();
    await mPage.waitForTimeout(700);

    const mobileStackCheck = await mPage.evaluate(() => {
      const sheets = document.querySelectorAll('#pedido .pipefy-cards-pair > .pipefy-sheet');
      if (sheets.length < 2) return null;
      const r1 = sheets[0].getBoundingClientRect();
      const r2 = sheets[1].getBoundingClientRect();
      const horizOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { stacked: r2.top >= r1.bottom - 2, horizOverflow };
    });
    assert.ok(mobileStackCheck && mobileStackCheck.stacked && !mobileStackCheck.horizOverflow);
    await mPage.screenshot({ path: path.join(shotsDir, '11-mobile-formulario-novo.png') });

    await mPage.goto(`${baseUrl}/quadro`, { waitUntil: 'domcontentloaded' });
    await mPage.fill('#login-username', 'tati');
    await mPage.fill('#login-password', process.env.IMTV_INITIAL_PASSWORD || 'imtv2027');
    await mPage.getByTestId('login-submit-btn').click();
    await mPage.getByTestId('pipefy-board-view').waitFor({ state: 'visible' });

    await mPage.getByTestId('confirm-whatsapp-btn-card-1').click();
    await mPage.waitForFunction(() =>
      document
        .querySelector('[data-testid="delivery-status-1"]')
        ?.textContent?.includes('Envio confirmado por Tati')
    );
    await mPage.screenshot({ path: path.join(shotsDir, '12-mobile-quadro-novo.png') });

    assert.equal(mobileErrors.length, 0, `Erros JS no celular: ${mobileErrors.join('; ')}`);
    await mobileCtx.close();

    console.log('[E2E] SUCESSO COMPLETO! Novos layouts validados em computador e celular.');
  } finally {
    await cleanup();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    fs.rmSync(testDbPath, { force: true });
  }
  process.exit(0);
}

runE2E().catch((err) => {
  console.error('[E2E FALHOU]', err);
  process.exit(1);
});
