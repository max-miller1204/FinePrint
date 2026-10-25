import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { renderImpact } from '../../../server/src/routes/impact.js';
async function signup(base: string) {
  const config = await (await fetch(new URL('/.well-known/fineprint-client.json', base))).json();
  const res = await fetch(`http://${config.firebase.authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.firebase.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  expect(res.status).toBe(200);
  return res.json();
}
function call(base: string, token: string, path: string, body?: unknown, method = 'POST') {
  return fetch(new URL(path, base), { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function totals(base: string) {
  const res = await fetch(new URL('/impact', base));
  expect(res.status).toBe(200);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  const text = await res.text();
  return Object.fromEntries([...text.matchAll(/data-counter="([^"]+)">\$?([\d,]+)</g)].map((m) => [m[1], Number(m[2].replaceAll(',', ''))]));
}
test('consent defaults off and repeated seals count once', { platforms: ['web'] }, async ({ app, screen }) => {
  const base = app.baseUrl!;
  const before = await totals(base);
  const { idToken, localId } = await signup(base);
  expect((await call(base, '', '/v1/me/impact', { impactOptIn: true }, 'PATCH')).status).toBe(401);
  for (const body of [{ impactOptIn: 'true' }, { impactOptIn: true, uid: 'other' }, {}]) expect((await call(base, idToken, '/v1/me/impact', body, 'PATCH')).status).toBe(400);
  const preference = (enabled: boolean) => call(base, idToken, '/v1/me/impact', { impactOptIn: enabled }, 'PATCH');
  expect((await preference(false)).status).toBe(200);
  expect(await totals(base)).toEqual(before);
  for (const response of await Promise.all([preference(true), preference(true), preference(true)])) expect(response.status).toBe(200);
  expect((await totals(base)).tenantsHelped).toBe(before.tenantsHelped + 1);
  expect((await preference(false)).status).toBe(200);
  async function sealRental() {
    const created = await call(base, idToken, '/v1/rentals', { jurisdiction: 'VA', city: 'Richmond', occupancyDate: new Date().toISOString().slice(0, 10), depositAmount: 1499.99 });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const itemId = randomUUID();
    const bytes = Buffer.from(`impact photo ${itemId}`);
    const photo = await call(base, idToken, `/v1/rentals/${id}/evidence`, { items: [{ itemId, room: 'Kitchen', checklistItem: 'Wall', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: 'image/jpeg', capturedAtDevice: new Date().toISOString(), deviceUptimeMs: 1000, source: 'in_app_camera', appVersion: '1.0' }] });
    expect(photo.status).toBe(201);
    const { upload } = (await photo.json()).items[0];
    expect((await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes })).status).toBe(200);
    expect((await call(base, idToken, `/v1/rentals/${id}/evidence/${itemId}/complete`)).status).toBe(200);
    expect((await call(base, idToken, `/v1/rentals/${id}/seal`, {})).status).toBe(201);
    return id;
  }
  const uncounted = await sealRental();
  expect((await totals(base)).depositDollarsCovered).toBe(before.depositDollarsCovered);
  expect((await preference(true)).status).toBe(200);
  expect((await call(base, idToken, `/v1/rentals/${uncounted}/seal`, {})).status).toBe(201);
  expect((await totals(base)).depositDollarsCovered).toBe(before.depositDollarsCovered);
  const counted = await sealRental();
  expect((await call(base, idToken, `/v1/rentals/${counted}/seal`, {})).status).toBe(201);
  const after = await totals(base);
  expect(after).toMatchObject({ tenantsHelped: before.tenantsHelped + 1, moveInReportsWithin5Days: before.moveInReportsWithin5Days + 1, depositDollarsCovered: before.depositDollarsCovered + 1000 });
  const storage = await (await fetch(`http://${process.env.E2E_FIRESTORE_HOST ?? '127.0.0.1:8090'}/v1/projects/demo-fineprint/databases/(default)/documents/impact`, { headers: { Authorization: 'Bearer owner' } })).json();
  for (const doc of storage.documents) expect(Object.keys(doc.fields)).toEqual(['value']);
  expect(JSON.stringify(storage)).not.toContain(localId);
  await app.open('/impact');
  await expect(screen.getByRole('heading', 'Small steps. Shared impact.')).toBeVisible();
  await expect(screen.getByRole('heading', 'Not tracked yet')).toBeVisible();
  expect((await call(base, idToken, '/v1/me', undefined, 'DELETE')).status).toBe(200);
  expect(await totals(base)).toEqual(after);
});
test('zero and extreme totals fit a narrow page', { platforms: ['web'] }, async ({ app, screen, browser }) => {
  const demo = String(renderImpact({ tenantsHelped: 0, verifiedClausesFlagged: 0, moveInReportsWithin5Days: 0, depositDollarsCovered: 0 }));
  const worst = String(renderImpact({ tenantsHelped: Number.MAX_SAFE_INTEGER, verifiedClausesFlagged: Number.MAX_SAFE_INTEGER, moveInReportsWithin5Days: Number.MAX_SAFE_INTEGER, depositDollarsCovered: Number.MAX_SAFE_INTEGER }));
  await browser.route('**/impact-demo', (route) => route.fulfill({ contentType: 'text/html', body: demo.replace('<main>', '<button id="cases">Worst case</button><main>') }));
  await browser.setViewport({ width: 320, height: 740 });
  await app.open('/impact-demo');
  // Test-only demo switch; no synthetic counts are exposed in production.
  await browser.evaluate(({ demoHTML, worstHTML }) => {
    let extreme = false;
    const button = document.querySelector('#cases')!;
    button.addEventListener('click', () => {
      extreme = !extreme;
      document.querySelector('main')!.outerHTML = new DOMParser().parseFromString(extreme ? worstHTML : demoHTML, 'text/html').querySelector('main')!.outerHTML;
      button.textContent = extreme ? 'Demo data' : 'Worst case';
    });
  }, { demoHTML: demo, worstHTML: worst });
  await screen.getByRole('button', 'Worst case').tap();
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(screen.getByRole('heading', 'Deposit dollars covered')).toBeVisible();
  await app.screenshot('impact-worst-320');
  await browser.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screen.getByRole('button', 'Demo data').tap();
  await expect(screen.getByRole('button', 'Worst case')).toBeVisible();
  await browser.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await app.open('/impact');
  await expect(screen.getByRole('heading', 'Small steps. Shared impact.')).toBeVisible();
  await app.screenshot('impact-dark-320');
  await browser.setViewport({ width: 1280, height: 1000 });
  await browser.emulateMedia({ colorScheme: 'light' });
  if (process.env.IMPACT_BEFORE_URL) {
    await browser.goto(process.env.IMPACT_BEFORE_URL);
    mkdirSync('.e2e/impact-evidence', { recursive: true });
    copyFileSync(await app.screenshot('impact-before'), '.e2e/impact-evidence/before.png');
  }
  await app.open('/impact');
  mkdirSync('.e2e/impact-evidence', { recursive: true });
  copyFileSync(await app.screenshot('impact-desktop'), '.e2e/impact-evidence/after.png');
});
