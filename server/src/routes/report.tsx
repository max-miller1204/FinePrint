import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import type { Store } from '../storage/firestore.js';
import { isDocumentId } from '../storage/firestore.js';
import type { EvidenceObjects } from '../storage/gcs.js';
import { active, type Shares } from '../shares/store.js';
import { browserFamily, capability, checkPin, reportOrigin, tokenHash } from '../shares/security.js';
import { SharePage } from '../shares/page.js';
import { projectReport } from '../shares/projection.js';
import { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import type { Signer } from '../integrity/kms.js';
import {
  fixturePhoto,
  fixtureReport,
  fixtureVariant,
  fixturesEnabled,
  FIXTURE_TOKEN,
  varyFixture,
} from '../report/fixture.js';
import type { EvidenceReport, ReportLoader } from '../report/model.js';
import { verifyScript } from '../report/verify-script.js';
import { ReportPage, Unavailable } from '../report/page.js';

export function createReport(load: ReportLoader, signer: Signer | null, fixtureMode = fixturesEnabled(), sharing?: { store: Store; shares: Shares; objects: EvidenceObjects }) {
  const route = new Hono<AppEnv>();
  let fixture: Promise<EvidenceReport> | undefined;
  route.use('*', async (c, next) => {
    // Reports and signed photo URLs must not survive in a shared cache or
    // leak a token as a Referer to a statute link or image host.
    c.header('Cache-Control', 'private, no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; script-src 'self'; connect-src 'self' https:${fixtureMode ? ' http:' : ''}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    await next();
  });
  route.get('/verify.js', (c) => c.body(verifyScript, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
  if (fixtureMode)
    route.get(`/${FIXTURE_TOKEN}/photos/kitchen`, async (c) =>
      c.body(new Uint8Array(await fixturePhoto()), 200, {
        'Content-Type': 'image/jpeg',
      }),
    );
  route.use('*', bodyLimit({ maxSize: 1024, onError: c => c.html(<Unavailable />, 413) }));
  route.on(['GET', 'POST'], ['/:token', '/:token/photos/:itemId'], async (c) => {
    try {
      const token = c.req.param('token')!;
      const variant = fixtureVariant(c.req.query('data'));
      if (fixtureMode && token === FIXTURE_TOKEN && signer) {
        fixture ??= fixtureReport(signer);
        return c.html(<ReportPage report={varyFixture(await fixture, variant, new URL(c.req.url).origin)} variant={variant} />);
      }
      if (!sharing) {
        const report = /^[A-Za-z0-9_-]{1,256}$/.test(token) ? await load(token) : null;
        return report ? c.html(<ReportPage report={report} variant={variant} />) : c.html(<Unavailable />, 404);
      }
      const { shares, store, objects } = sharing;
      const share = /^[A-Za-z0-9_-]{43}$/.test(token) ? await shares.get(tokenHash(token)) : null;
      if (!share) return c.html(<Unavailable />, 404);
      if (share.revokedAt) return c.html(<SharePage state="revoked" />, 410);
      if (!active(share)) return c.html(<SharePage state="expired" />, 410);
      if (share.pinHash) {
        if (c.req.method === 'POST') {
          // no-referrer can make a form's Origin opaque. Only accept that
          // browser case with Sec-Fetch-Site confirming the same origin.
          const origin = c.req.header('Origin');
          if (origin && origin !== reportOrigin(c.req.url) && !(origin === 'null' && c.req.header('Sec-Fetch-Site') === 'same-origin')) return c.html(<Unavailable />, 403);
          if (!await shares.attempt(share.id)) {
            c.header('Retry-After', '900');
            return c.html(<SharePage state="limited" />, 429);
          }
          const body = await c.req.parseBody();
          const pin = typeof body.pin === 'string' ? body.pin : '';
          if (!/^[0-9]{6,12}$/.test(pin) || !await checkPin(pin, share.pinHash)) return c.html(<SharePage state="pin" wrong />, 403);
          const session = capability();
          await shares.grant(share.id, tokenHash(session));
          setCookie(c, 'fp_share', session, { path: `/r/${token}`, httpOnly: true, sameSite: 'Strict', secure: reportOrigin(c.req.url).startsWith('https:'), maxAge: 900 });
          return c.redirect(`/r/${token}`, 303);
        } else {
          const session = getCookie(c, 'fp_share');
          if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session) || !await shares.granted(share.id, tokenHash(session))) return c.html(<SharePage state="pin" />, 401);
        }
      }
      const itemId = c.req.param('itemId');
      if (itemId) {
        if (c.req.method !== 'GET' || !share.scope.includes('evidence') || !isDocumentId(itemId)) return c.html(<Unavailable />, 404);
        const [item] = await store.getEvidence(share.rentalId, [itemId]);
        if (!item || item.deletedAt || !item.receivedAtServer || !objects.read) return c.html(<Unavailable />, 404);
        const bytes = await objects.read(item.gcsPath);
        const current = await shares.get(share.id);
        if (!current || !active(current)) return c.html(<Unavailable />, 410);
        return c.body(new Uint8Array(bytes), 200, { 'Content-Type': item.mime });
      }
      const report = await projectReport(share, store, shares, token, reportOrigin(c.req.url));
      // Recheck after slow storage reads. Never serve a cached authorization.
      const current = await shares.get(share.id);
      if (!current || !active(current)) return c.html(<Unavailable />, 410);
      if (!report) return c.html(<Unavailable />, 404);
      await shares.log(share.id, browserFamily(c.req.header('User-Agent')));
      return c.html(<ReportPage report={report} variant={variant} />);
    } catch (error) {
      c.get('log').error('report unavailable', { errorName: error instanceof Error ? error.name : 'unknown' });
      return c.html(<Unavailable temporary />, 503);
    }
  });
  return route;
}
