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
