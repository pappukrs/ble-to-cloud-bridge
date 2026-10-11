import { loadConfig } from './config';
import { startServer } from './server';

const config = loadConfig();
const server = await startServer(config);
console.log(`ble-bridge relay listening on :${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
