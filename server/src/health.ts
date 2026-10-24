// Dependency reachability for /healthz. Each check resolves when the
// dependency answers and throws when it does not. Real checks land in M6;
// until then every check reports `stubbed`.

export type CheckName = 'firestore' | 'gcs' | 'kms';
export type CheckStatus = 'ok' | 'stubbed' | 'unreachable';
export type HealthCheck = () => Promise<Exclude<CheckStatus, 'unreachable'>>;
export type HealthChecks = Record<CheckName, HealthCheck>;

const stub: HealthCheck = async () => 'stubbed';

export const stubbedChecks: HealthChecks = { firestore: stub, gcs: stub, kms: stub };

export const CHECK_TIMEOUT_MS = 2000;

export async function runChecks(checks: HealthChecks, timeoutMs = CHECK_TIMEOUT_MS): Promise<Record<CheckName, CheckStatus>> {
  const names = Object.keys(checks) as CheckName[];
  const results = await Promise.all(
    names.map(async (name): Promise<CheckStatus> => {
      try {
        return await Promise.race([
          checks[name](),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs).unref()),
        ]);
      } catch {
        return 'unreachable';
      }
    }),
  );
  return Object.fromEntries(names.map((name, i) => [name, results[i]])) as Record<CheckName, CheckStatus>;
}
