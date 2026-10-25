import { serve } from '@hono/node-server';
import { triageModelConfigured } from './ai/triage/from-env.js';
import { createApp } from './app.js';
import { createLogger } from './log.js';

const log = createLogger(null);
const port = Number(process.env.PORT ?? 8080);

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  log.warn('auth emulator mode: ID token signatures are not checked', { host: process.env.FIREBASE_AUTH_EMULATOR_HOST });
}
if (!process.env.KMS_SIGNING_KEY) {
  log.warn(process.env.FIRESTORE_EMULATOR_HOST ? 'signing with a local key that lasts until the server stops' : 'KMS_SIGNING_KEY is not set: sealing is off');
}

if (!triageModelConfigured()) {
  log.warn('no model configured (GEMINI_API_KEY or GEMMA_PROVIDER=openai_compatible): triage runs on the keyword backstop alone');
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
