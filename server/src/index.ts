import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createLogger } from './log.js';

const log = createLogger(null);
const port = Number(process.env.PORT ?? 8080);

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  log.warn('auth emulator mode: ID token signatures are not checked', { host: process.env.FIREBASE_AUTH_EMULATOR_HOST });
}

const server = serve({ fetch: createApp().fetch, port }, (info) => {
  log.info('listening', { port: info.port });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info('shutting down', { signal });
    server.close(() => process.exit(0));
  });
}
