import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { PortalStore } from './db.ts';
import { createPortalApp } from './app.ts';

const PORT = Number(process.env.PORT || 3270);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH =
  process.env.IMTV_DB_PATH ||
  path.resolve(process.cwd(), 'data', 'imtv-pedidos-2027.sqlite');

const store = new PortalStore(DB_PATH);
const handler = createPortalApp(store, {
  publicDir: path.resolve(process.cwd(), 'public'),
  distDir: path.resolve(process.cwd(), 'dist'),
  simulateOrderWriteFailureHeader: process.env.IMTV_ALLOW_TEST_HEADERS === '1',
});

const server = http.createServer(handler);

server.listen(PORT, HOST, () => {
  console.log(`[IMTV 2027] Portal ativo localmente em http://127.0.0.1:${PORT}`);
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`[IMTV 2027] Acesso na rede IMTV: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`[IMTV 2027] Banco SQLite: ${DB_PATH}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
