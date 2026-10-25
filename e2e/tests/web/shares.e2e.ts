import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, test } from '@e2e-dev/web';
import { expect, secrets } from 'e2e';
const pin = '483927'; // Synthetic fixture PIN, registered for browser fill.
async function tenant(base: string) {
  const config = await (await fetch(new URL('/.well-known/fineprint-client.json', base))).json();
  const res = await fetch(`http://${config.firebase.authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.firebase.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  expect(res.status).toBe(200);
  const { idToken } = await res.json();
  const api = (method: string, path: string, body?: unknown) => fetch(new URL(path, base), { method, headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const resRental = await api('POST', '/v1/rentals', { jurisdiction: 'VA', city: 'Richmond' });
  expect(resRental.status).toBe(201);
  const { id } = await resRental.json();
  const create = async (body = {}) => {
    const res = await api('POST', `/v1/rentals/${id}/shares`, body);
    expect(res.status).toBe(201);
    return res.json();
  };
  return { api, rentalId: id as string, create };
}
const docPath = (path: string) => `http://${process.env.E2E_WEB_FIRESTORE_HOST ?? '127.0.0.1:8090'}/v1/projects/demo-fineprint/databases/(default)/documents/${path}`;
const stored = async (path: string) => (await fetch(docPath(path), { headers: { Authorization: 'Bearer owner' } })).json();
async function expire(id: string) {
  const res = await fetch(`${docPath(`shares/${id}`)}?updateMask.fieldPaths=expiresAt`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { expiresAt: { stringValue: '2020-01-01T00:00:00.000Z' } } }) });
  expect(res.status).toBe(200);
}
const guess = (path: string, base: string, value = '000000') => fetch(new URL(path, base), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `pin=${value}` });

describe('Share links', { platforms: ['web'] }, () => {
  test('create, ownership, scoped report, revoke, ledger and private access records', async ({ app }) => {
    const base = app.baseUrl!;
    const owner = await tenant(base);
    const other = await tenant(base);
    const share = await owner.create();
    const token = share.path.split('/').at(-1);
    expect(share.path).toMatch(/^\/r\/[A-Za-z0-9_-]{43}$/);
    expect(share.id).toBe(createHash('sha256').update(token).digest('hex'));
    expect(Date.parse(share.expiresAt) - Date.parse(share.createdAt)).toBe(30 * 86400_000);
    const listRes = await owner.api('GET', `/v1/rentals/${owner.rentalId}/shares`);
    expect(listRes.headers.get('cache-control')).toContain('no-store');
    const list = await listRes.json();
    expect(list.shares).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(token);
    for (const [method, path] of [['POST', `/v1/rentals/${owner.rentalId}/shares`], ['GET', `/v1/rentals/${owner.rentalId}/shares`], ['DELETE', `/v1/shares/${share.id}`], ['GET', `/v1/shares/${share.id}/access`]]) {
      expect((await other.api(method!, path!, method === 'POST' ? {} : undefined)).status).toBe(404);
    }
    const page = await fetch(new URL(share.path, base), { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/123.0 private-text', 'X-Forwarded-For': '203.0.113.35' } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Richmond');
    const access = await (await owner.api('GET', `/v1/shares/${share.id}/access`)).json();
    expect(access.access).toHaveLength(1);
    expect(Object.keys(access.access[0]).sort()).toEqual(['at', 'userAgentFamily']);
    expect(access.access[0].userAgentFamily).toBe('Chrome');
    expect(JSON.stringify(await stored(`shares/${share.id}`))).not.toContain(token);
    const accessDocs = await stored(`shares/${share.id}/access`);
    expect(Object.keys(accessDocs.documents[0].fields).sort()).toEqual(['at', 'userAgentFamily']);
    expect(JSON.stringify(accessDocs)).not.toContain('203.0.113.35');
    expect((await owner.api('DELETE', `/v1/shares/${share.id}`)).status).toBe(200);
    expect((await owner.api('DELETE', `/v1/shares/${share.id}`)).status).toBe(200);
    const revoked = await fetch(new URL(share.path, base));
    expect(revoked.status).toBe(410);
    expect(await revoked.text()).toContain('This link was revoked');
    const ledger = await (await owner.api('GET', `/v1/rentals/${owner.rentalId}/ledger`)).json();
    expect(ledger.entries.map((e: { type: string }) => e.type)).toEqual(['share_created', 'share_revoked']);
    const log = await readFile('.e2e/logs/server.log', 'utf8');
    for (const privateValue of [token, '203.0.113.35', 'private-text']) expect(log).not.toContain(privateValue);
  });

  test('PIN form accepts PIN, authorizes reload, and revokes the session immediately', async ({ app, browser, screen }) => {
    const owner = await tenant(app.baseUrl!);
    const share = await owner.create({ pin });
    const fields = (await stored(`shares/${share.id}`)).fields;
    expect(fields.pinHash.stringValue).not.toBe(pin);
    expect(fields.pinHash.stringValue).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}$/);
    expect(share).not.toHaveProperty('pinHash');
    await browser.setViewport({ width: 320, height: 720 });
    await browser.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await app.open(share.path);
    await expect(screen.getByRole('heading', { name: 'Enter the PIN' })).toBeVisible();
    await app.screenshot('share-pin-before');
    await screen.getByLabel('PIN', { exact: true }).fill(secrets.get('shareWrongPin'));
    await screen.getByRole('button', { name: 'Open report' }).tap();
    await expect(screen.getByRole('alert')).toContainText('did not match');
    await browser.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await browser.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await app.screenshot('share-pin-wrong-phone-large-dark');
    await screen.getByLabel('PIN', { exact: true }).fill(secrets.get('sharePin'));
    await screen.getByRole('button', { name: 'Open report' }).tap();
    await expect(screen.getByRole('heading', { name: '01 / Timeline' })).toBeVisible();
    await app.screenshot('share-pin-accepted-after');
    await browser.reload();
    await expect(screen.getByRole('heading', { name: '01 / Timeline' })).toBeVisible();
    expect((await browser.cookies()).find(c => c.name === 'fp_share')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    await owner.api('DELETE', `/v1/shares/${share.id}`);
    await browser.reload();
    await expect(screen.getByRole('heading', { name: 'This link was revoked' })).toBeVisible();
    await app.screenshot('share-revoked-after');
    expect((await (await owner.api('GET', `/v1/shares/${share.id}/access`)).json()).access).toHaveLength(2);
  });

  test('concurrent PIN guesses share one budget, and invalid input is rejected', async ({ app }) => {
    const owner = await tenant(app.baseUrl!);
    for (const input of [{ pin: '12' }, { scope: [] }, { scope: ['letters'] }, { ownerUid: 'other' }, { expiresAt: '2020-01-01T00:00:00Z' }, { expiresAt: '2099-01-01T00:00:00Z' }]) {
      expect((await owner.api('POST', `/v1/rentals/${owner.rentalId}/shares`, input)).status).toBe(400);
    }
    const share = await owner.create({ pin });
    const guesses = await Promise.all(Array.from({ length: 8 }, () => guess(share.path, app.baseUrl!)));
    expect(guesses.filter(r => r.status === 403)).toHaveLength(5);
    expect(guesses.filter(r => r.status === 429)).toHaveLength(3);
    const blocked = await guess(share.path, app.baseUrl!, pin);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('900');
    expect(await blocked.text()).toContain('Too many PIN attempts');
    expect((await (await owner.api('GET', `/v1/shares/${share.id}/access`)).json()).access).toHaveLength(0);
    expect((await fetch(new URL(share.path, app.baseUrl), { method: 'POST', body: 'x'.repeat(2000) })).status).toBe(413);
  });

  test('expired and limited pages at phone widths with large text', async ({ app, browser, screen }) => {
    const owner = await tenant(app.baseUrl!);
    const share = await owner.create();
    await expire(share.id);
    const expired = await fetch(new URL(share.path, app.baseUrl));
    expect(expired.status).toBe(410);
    expect(expired.headers.get('cache-control')).toContain('no-store');
    expect(await expired.text()).not.toContain('Richmond');
    await browser.setViewport({ width: 320, height: 720 });
    await app.open(share.path);
    await expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await browser.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await app.screenshot('share-expired-phone');
    const protectedShare = await owner.create({ pin });
    for (let i = 0; i < 5; i++) await guess(protectedShare.path, app.baseUrl!);
    await app.open(protectedShare.path);
    await screen.getByLabel('PIN', { exact: true }).fill(secrets.get('sharePin'));
    await screen.getByRole('button', { name: 'Open report' }).tap();
    await expect(screen.getByRole('heading', { name: 'Too many PIN attempts' })).toBeVisible();
    await app.screenshot('share-rate-limited-phone');
  });

  test('lease projection preserves quote language and excludes full text and unshared findings', async ({ app, browser }) => {
    const owner = await tenant(app.baseUrl!);
    const leaseRes = await owner.api('POST', `/v1/rentals/${owner.rentalId}/leases`, { text: 'Full private lease text not for sharing', locale: 'es' });
    expect(leaseRes.status).toBe(201);
    const lease = await leaseRes.json();
    const fields = {
      order: { integerValue: '1' }, severity: { stringValue: 'info' }, titleEn: { stringValue: 'Shared finding' },
      explanationEn: { stringValue: 'A redacted finding.' }, actionEn: { stringValue: 'Review the clause.' },
      leaseQuote: { stringValue: 'El contrato establece un plazo.' }, statuteQuote: { nullValue: null },
      citation: { nullValue: null }, sourceUrl: { nullValue: null }, translations: { mapValue: { fields: {} } },
    };
    const seeded = await fetch(docPath(`rentals/${owner.rentalId}/leases/${lease.leaseId}/findings/test-finding`), {
      method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
    });
    expect(seeded.status).toBe(200);
    const shared = await owner.create({ scope: ['lease'] });
    const html = await (await fetch(new URL(shared.path, app.baseUrl))).text();
    expect(html).toContain('Shared finding');
    expect(html).not.toContain('Full private lease text');
    expect(html).not.toContain('ownerUid');
    await app.open(shared.path);
    expect(await browser.evaluate(() => document.querySelector('blockquote')?.getAttribute('lang'))).toBe('es');
    const evidenceOnly = await owner.create({ scope: ['evidence'] });
    expect(await (await fetch(new URL(evidenceOnly.path, app.baseUrl))).text()).not.toContain('Shared finding');
  });

  test('access pagination preserves views sharing the same timestamp', async ({ app }) => {
    const owner = await tenant(app.baseUrl!);
    const share = await owner.create();
    const timestamp = '2026-10-25T10:00:00.000Z';
    const writes = Array.from({ length: 105 }, (_, i) => ({ update: {
      name: `projects/demo-fineprint/databases/(default)/documents/shares/${share.id}/access/view${String(i).padStart(4, '0')}`,
      fields: { at: { stringValue: timestamp }, userAgentFamily: { stringValue: 'Other' } },
    } }));
    const seeded = await fetch(`http://${process.env.E2E_WEB_FIRESTORE_HOST ?? '127.0.0.1:8090'}/v1/projects/demo-fineprint/databases/(default)/documents:commit`, {
      method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }),
    });
    expect(seeded.status).toBe(200);
    const first = await (await owner.api('GET', `/v1/shares/${share.id}/access`)).json();
    expect(first.access).toHaveLength(100);
    expect(first.nextBefore).toBeTruthy();
    const second = await (await owner.api('GET', `/v1/shares/${share.id}/access?before=${encodeURIComponent(first.nextBefore)}`)).json();
    expect(second.access).toHaveLength(5);
    expect(second.nextBefore).toBeNull();
    expect((await owner.api('GET', `/v1/shares/${share.id}/access?before=invalid`)).status).toBe(400);
  });

  test('photos check PIN, scope, expiry, deletion, rental and revocation', async ({ app, browser, screen }) => {
    const owner = await tenant(app.baseUrl!);
    const itemId = randomUUID();
    const bytes = await readFile('fixtures/photos/move-in/01-kitchen-wall.jpg');
    const created = await owner.api('POST', `/v1/rentals/${owner.rentalId}/evidence`, { items: [{ itemId, room: 'Kitchen', checklistItem: 'Wall', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: 'image/jpeg', capturedAtDevice: '2026-08-14T15:12:00-04:00', deviceUptimeMs: 81233411, source: 'in_app_camera', appVersion: '1.0' }] });
    expect(created.status).toBe(201);
    const { upload } = (await created.json()).items[0];
    expect((await fetch(upload.url, { method: upload.method, headers: upload.headers, body: bytes })).status).toBe(200);
    expect((await owner.api('POST', `/v1/rentals/${owner.rentalId}/evidence/${itemId}/complete`)).status).toBe(200);
    const sealed = await owner.api('POST', `/v1/rentals/${owner.rentalId}/seal`, { session: 'move_in' });
    expect(sealed.status).toBe(201);
    const share = await owner.create({ pin, scope: ['evidence'] });
    const url = new URL(`${share.path}/photos/${itemId}`, app.baseUrl);
    expect((await fetch(url)).status).toBe(401);
    const unlock = await guess(share.path, app.baseUrl!, pin);
    expect(unlock.status).toBe(303);
    const cookie = unlock.headers.get('set-cookie')!.split(';')[0]!;
    const photo = await fetch(url, { headers: { cookie } });
    expect(photo.status).toBe(200);
    expect(Buffer.from(await photo.arrayBuffer()).equals(bytes)).toBe(true);
    const lease = await owner.create({ scope: ['lease'] });
    expect((await fetch(new URL(`${lease.path}/photos/${itemId}`, app.baseUrl))).status).toBe(404);
    expect(await (await fetch(new URL(lease.path, app.baseUrl))).text()).not.toContain(itemId);
    const other = await tenant(app.baseUrl!);
    const unrelated = await other.create();
    expect((await fetch(new URL(`${unrelated.path}/photos/${itemId}`, app.baseUrl))).status).toBe(404);
    await owner.api('DELETE', `/v1/shares/${share.id}`);
    expect((await fetch(url, { headers: { cookie } })).status).toBe(410);
    const expires = await owner.create();
    await expire(expires.id);
    expect((await fetch(new URL(`${expires.path}/photos/${itemId}`, app.baseUrl))).status).toBe(410);
    const live = await owner.create();
    await app.open(live.path);
    await expect(screen.getByRole('heading', { name: '03 / Exhibits' })).toBeVisible();
    expect(await browser.evaluate(() => [...document.images].every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    expect(await browser.evaluate(() => document.querySelectorAll('[data-manifest]').length)).toBe(1);
    await app.screenshot('share-live-sealed-photo');
    await owner.api('DELETE', `/v1/rentals/${owner.rentalId}/evidence/${itemId}`);
    expect((await fetch(new URL(`${live.path}/photos/${itemId}`, app.baseUrl))).status).toBe(404);
  });
});
