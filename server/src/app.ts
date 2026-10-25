import { shareStore, type Shares } from './shares/store.js';
import { getFirestore } from 'firebase-admin/firestore';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { gemmaFromEnv, type GemmaClient } from './ai/gemma.js';
import { triageFromEnv, triageModelConfigured } from './ai/triage/from-env.js';
import type { Triage } from './ai/triage/index.js';
import { firebaseAccounts, type Accounts } from './accounts.js';
import { firebaseIdTokenVerifier, type VerifyIdToken } from './auth.js';
import { firebaseApp } from './firebase.js';
import { ApiError } from './errors.js';
import { runChecks, stubbedChecks, type HealthChecks } from './health.js';
import { signerFromEnv, type Signer } from './integrity/kms.js';
import { createLogger, type LogSink, type Logger } from './log.js';
import { createInternal, googleSchedulerVerifier, type VerifyScheduler } from './routes/internal.js';
import type { LeaseAnalyzer } from './routes/leases.js';
import { createReport } from './routes/report.js';
import type { ReportLoader } from './report/model.js';
import { createV1 } from './routes/v1.js';
import { firestoreStore, type Store } from './storage/firestore.js';
import { gcsObjects, type EvidenceObjects } from './storage/gcs.js';
import { clientConfigFromEnv, createWellKnown, type ClientConfig } from './routes/wellknown.js';
import { JURISDICTIONS_ROOT, loadRulePacks } from './rules/loader.js';
import type { RulePack } from './rules/types.js';
import { firestoreUsageSink } from './usage.js';

export type AppEnv = {
  Variables: { requestId: string; log: Logger };
};

export interface AppDeps {
  // Optional renderer-test seam; production uses the sharing authorization route.
  reportLoader?: ReportLoader;
  shares?: Shares;
  checks?: HealthChecks;
  logSink?: LogSink;
  verifyIdToken?: VerifyIdToken;
  clientConfig?: ClientConfig | null;
  store?: Store;
  objects?: EvidenceObjects;
  // Null: sealing and the key set answer 503.
  signer?: Signer | null;
  // The one model client, so triage, the lease pipeline, and the
  // responsibility check share its rate limiter. Null without a key: the lease
  // stream stops after S1 and the responsibility check answers 503.
  gemma?: GemmaClient | null;
  // Gemma plus the keyword backstop, or the backstop alone without a key.
  triage?: Triage;
  // The rule packs the lease pipeline and the responsibility check use;
  // loaded on first use.
  packs?: () => ReadonlyMap<string, RulePack>;
  accounts?: Accounts;
  // Null: /internal/purge answers 404.
  verifyScheduler?: VerifyScheduler | null;
  // The URL the purge job's token is minted for; default PURGE_AUDIENCE, else the Host header.
  purgeAudience?: string;
}

export function createApp({
  reportLoader,
  shares = shareStore(),
  checks = stubbedChecks,
  logSink,
  verifyIdToken = firebaseIdTokenVerifier(),
  clientConfig = clientConfigFromEnv(),
  store = firestoreStore(),
  objects = gcsObjects(),
  signer = signerFromEnv(),
  gemma = triageModelConfigured() ? gemmaFromEnv({ usage: firestoreUsageSink(getFirestore(firebaseApp())), log: createLogger(null, logSink) }) : null,
  triage = triageFromEnv(createLogger(null, logSink), process.env, () => gemma!),
  packs = lazyRulePacks(),
  accounts = firebaseAccounts(),
  verifyScheduler = googleSchedulerVerifier(),
  purgeAudience,
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

  // Public: /healthz and /health above, /.well-known/*, /r/*, and later /impact.
  app.route('/r', createReport(reportLoader ?? (async () => null), signer, undefined, reportLoader ? undefined : { store, shares, objects }));
  app.route('/.well-known', createWellKnown(clientConfig, signer));
  const analyzer: LeaseAnalyzer = { gemma, triage, packs };
  app.route('/v1', createV1(verifyIdToken, store, objects, signer, triage, accounts, analyzer, shares));
  // Cloud Scheduler only; it checks its own Google token, not a Firebase one.
  app.route('/internal', createInternal(store, objects, verifyScheduler, undefined, purgeAudience ?? process.env.PURGE_AUDIENCE));

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

// Every verified pack, read once. A pack that fails to load throws on each
// use (the lease routes answer 503) rather than stopping the server.
function lazyRulePacks(): () => ReadonlyMap<string, RulePack> {
  let packs: ReadonlyMap<string, RulePack> | undefined;
  return () => (packs ??= loadRulePacks(JURISDICTIONS_ROOT, { requireVerified: true }));
}
