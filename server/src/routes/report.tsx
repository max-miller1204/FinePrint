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
import { ReportPage, Unavailable } from '../report/page.js';

export function createReport(load: ReportLoader, signer: Signer | null, fixtureMode = fixturesEnabled()) {
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
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    await next();
  });
  if (fixtureMode)
    route.get(`/${FIXTURE_TOKEN}/photos/kitchen`, async (c) =>
      c.body(new Uint8Array(await fixturePhoto()), 200, {
        'Content-Type': 'image/jpeg',
      }),
    );
  route.get('/:token', async (c) => {
    try {
      const token = c.req.param('token');
      const variant = fixtureVariant(c.req.query('data'));
      let report: EvidenceReport | null = null;
      if (fixtureMode && token === FIXTURE_TOKEN && signer) {
        fixture ??= fixtureReport(signer);
        report = varyFixture(await fixture, variant, new URL(c.req.url).origin);
      } else if (/^[A-Za-z0-9_-]{1,256}$/.test(token)) {
        report = await load(token);
      }
      return report ? c.html(<ReportPage report={report} variant={variant} />) : c.html(<Unavailable />, 404);
    } catch (error) {
      // Token resolvers and storage failures can contain private data.
      c.get('log').error('report unavailable', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return c.html(<Unavailable temporary />, 503);
    }
  });
  return route;
}
