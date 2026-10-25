import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { firebaseIdTokenVerifier, type VerifyIdToken } from './auth.js';
import { ApiError } from './errors.js';
import { runChecks, stubbedChecks, type HealthChecks } from './health.js';
import { createLogger, type LogSink, type Logger } from './log.js';
import { createV1 } from './routes/v1.js';
import { firestoreStore, type Store } from './storage/firestore.js';
import { gcsObjects, type EvidenceObjects } from './storage/gcs.js';
import { clientConfigFromEnv, createWellKnown, type ClientConfig } from './routes/wellknown.js';

export type AppEnv = {
  Variables: { requestId: string; log: Logger };
};

export interface AppDeps {
  checks?: HealthChecks;
  logSink?: LogSink;
  verifyIdToken?: VerifyIdToken;
  clientConfig?: ClientConfig | null;
  store?: Store;
  objects?: EvidenceObjects;
}

export function createApp({
  checks = stubbedChecks,
  logSink,
  verifyIdToken = firebaseIdTokenVerifier(),
  clientConfig = clientConfigFromEnv(),
  store = firestoreStore(),
  objects = gcsObjects(),
}: AppDeps = {}) {
  const app = new Hono<AppEnv>();

  // Honors a client's `X-Request-Id` (up to 255 safe characters) or mints a
  // UUID, and echoes it on the response.
  app.use(requestId());

  // One access line per request. Logs the matched route pattern, not the raw
  // path, so ids and share tokens in the URL stay out of the logs.
  app.use(async (c, next) => {
    const log = createLogger(c.get('requestId'), logSink);
    c.set('log', log);
    const start = performance.now();
    await next();
    log.info('request', {
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - start),
    });
  });

  // /health is the same check: Cloud Run reserves paths ending in `z` on its
  // *.run.app URLs, so /healthz never reaches the server there.
  app.on('GET', ['/healthz', '/health'], async (c) => {
    const results = await runChecks(checks);
    const down = Object.entries(results).filter(([, status]) => status === 'unreachable').map(([name]) => name);
    if (down.length > 0) {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', `Unreachable: ${down.join(', ')}`);
    }
    return c.json({ status: 'ok', checks: results });
  });

  // Public: /healthz and /health above, /.well-known/*, and later /r/* and /impact.
  app.route('/.well-known', createWellKnown(clientConfig));
  app.route('/v1', createV1(verifyIdToken, store, objects));

  // Returned, not thrown: a throw here skips the access line above.
  app.notFound((c) => c.json(new ApiError(404, 'NOT_FOUND', 'No route matches this request').toEnvelope(), 404));

  app.onError((err, c) => {
    const log = c.get('log') ?? createLogger(c.get('requestId') ?? null, logSink);
    if (err instanceof ApiError) {
      if (err.status >= 500) log.error('api error', { code: err.code, status: err.status });
      return c.json(err.toEnvelope(), err.status);
    }
    // Unknown errors may carry user content in their message, so log only
    // the error class and send a generic message.
    log.error('unhandled error', { errorName: err.name });
    return c.json(new ApiError(500, 'INTERNAL', 'Something went wrong').toEnvelope(), 500);
  });

  return app;
}
