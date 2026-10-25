import { expect, test } from 'e2e';

test('/healthz reports Firestore, GCS, and KMS', { platforms: ['web'] }, async ({ app }) => {
  const res = await fetch(new URL('/healthz', app.baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  // Stubbed until M6 wires the real reachability checks.
  expect(await res.json()).toEqual({
    status: 'ok',
    checks: { firestore: 'stubbed', gcs: 'stubbed', kms: 'stubbed' },
  });
});

// Cloud Run reserves /healthz on *.run.app URLs, so deployments use /health.
test('/health is the same check', { platforms: ['web'] }, async ({ app }) => {
  const [z, plain] = await Promise.all(['/healthz', '/health'].map((path) => fetch(new URL(path, app.baseUrl))));
  expect(plain.status).toBe(200);
  expect(await plain.json()).toEqual(await z.json());
});
