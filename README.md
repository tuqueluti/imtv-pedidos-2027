# Portal de Pedidos de Vídeo IMTV 2027

Portal unificado para solicitação de vídeos pelas unidades do Instituto Mix e condução interna de produção pela equipe da IMTV em quadro estilo Pipefy.

## Links de acesso

- Link público online (GitHub Pages) em https://tuqueluti.github.io/imtv-pedidos-2027/
- Quadro interno online (equipe IMTV) em https://tuqueluti.github.io/imtv-pedidos-2027/#/quadro
- Código-fonte no GitHub em https://github.com/tuqueluti/imtv-pedidos-2027

## Execução local com Node 22 e banco SQLite

No diretório do projeto:

```powershell
npm install
npm run build
npm start
```

O servidor sobe em `http://127.0.0.1:3270` usando o banco SQLite local em `data/imtv-pedidos-2027.sqlite`. As unidades acessam `http://127.0.0.1:3270/` e a equipe interna acessa `http://127.0.0.1:3270/quadro` (ou `http://127.0.0.1:3270/#/quadro`).

Em hospedagem estática (como GitHub Pages), o cliente aciona automaticamente a camada persistente local no navegador para demonstração e testes completos de ponta a ponta. Ao rodar `npm start`, todas as rotas operam pela API REST em Node 22 e `node:sqlite`.

## Contas iniciais da equipe

Criadas na primeira inicialização do banco (senha inicial `imtv2027`, alterável na janela Configurações ou pela variável de ambiente `IMTV_INITIAL_PASSWORD` antes do primeiro uso):

- `luti` (Administrador, fila `Luti`)
- `monica` (Administradora)
- `tati` (Equipe, fila `Tati`)
- `marcio` (Equipe, fila `Marcio`)

## Arquitetura funcional

Na abertura 3D em Three.js (`r187`), o visitante encontra o estúdio de gravação com câmera sobre tripé em primeiro plano, TV de retroprojeção de 50 polegadas com gabinete profundo e botões físicos, reflexo no piso, placa luminosa `NO AR`, identificação oficial da IMTV e player do YouTube (`iTKp3kyNw4c`) alinhado em perspectiva. A câmera acompanha a rolagem nativa, para quando a rolagem para, recua ao subir e só pausa o vídeo e revela o formulário quando a moldura sai pelas quatro bordas da janela. Aparelhos leves ou com preferência por movimento reduzido recebem a vista leve da TV com acesso direto ao pedido.

O formulário público reúne a faixa iluminada do estúdio (`Portal de pedidos`) e as três etapas numeradas (`01 Identificação`, `02 Briefing` e `03 Materiais e revisão`). As fichas escuras `Quem solicita` e `Quem recebe` aparecem lado a lado no computador e empilhadas no celular, com o logo oficial da IMTV centralizado na ficha destinatária. O WhatsApp aceita espaços, parênteses e hífen, valida código de país editável (`+55` inicial) e DDD, e aparece no resumo antes de `Enviar pedido`. Cliques duplos ou novas tentativas do mesmo envio geram um único cartão.

No quadro interno estilo Pipefy (`Área da equipe`), os pedidos percorrem seis colunas na ordem `Recebido`, `Luti`, `Tati`, `Marcio`, `Aguardando` e `Finalizados`, com contagem por coluna, filtros por unidade, responsável e prazo, movimentação por arraste ou pelo seletor `Mover para`, preservação do responsável em `Aguardando` e registro do que falta.

Abaixo das colunas, o painel duplo exibe à esquerda os detalhes completos do pedido selecionado e à direita o bloco `Entrega ao solicitante`, com campo próprio `Link do vídeo final` (separado do link de materiais do Google Drive), botão `Enviar pelo WhatsApp` com mensagem pré-preenchida e status `Envio pendente` até confirmação explícita em `Confirmar envio`. Na janela administrativa, é possível atualizar o logo oficial em um único lugar, editar o nome da equipe destinatária, gerenciar integrantes e configurar avisos por e-mail com repetição isolada em caso de falha.

## Testes automatizados

```powershell
npm test
npm run test:e2e
```
