import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { localSigner, verifySignature } from '../src/integrity/kms.js';
import { verifyLedger } from '../src/integrity/ledger.js';
import { verifyManifest } from '../src/integrity/manifest.js';
import { fixtureReport, fixturesEnabled, varyFixture } from '../src/report/fixture.js';
import { receiptGap, validBox, webUrl } from '../src/report/model.js';

const signer = localSigner();
const base = fixtureReport(signer);
const setup = (reportLoader: NonNullable<Parameters<typeof createApp>[0]>['reportLoader']) =>
  createApp({ reportLoader, signer, logSink: () => {} });

describe('Evidence Report', () => {
  it('fails closed without a share resolver and keeps fixtures emulator-only', async () => {
    const app = createApp({ signer, logSink: () => {} });
    expect((await app.request('/r/unknown')).status).toBe(404);
    expect((await app.request('/r/fixture')).status).toBe(404);
    expect((await app.request('/r/fixture/photos/kitchen')).status).toBe(404);
    expect(fixturesEnabled({ REPORT_FIXTURES: '1' })).toBe(false);
    expect(fixturesEnabled({ FIRESTORE_EMULATOR_HOST: 'localhost' })).toBe(false);
    expect(
      fixturesEnabled({
        REPORT_FIXTURES: '1',
        FIRESTORE_EMULATOR_HOST: 'localhost',
      }),
    ).toBe(true);
  });
  it('renders SSR with only the self-hosted verifier, escapes data, rejects unsafe URLs and excludes rejected annotations', async () => {
    const report = structuredClone(await base);
    report.fixture = false;
    report.city = '<script>alert("city")</script>';
    report.findings[0]!.sourceUrl = 'javascript:alert(1)';
    report.findings[0]!.leaseQuote = '</blockquote><script>alert("quote")</script>';
    report.exhibits[0]!.imageUrl = 'data:image/svg+xml,<svg onload="alert(1)" />';
    const res = await setup(async () => report).request('/r/secret-token');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html).toContain('&lt;script&gt;');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script src="/r/verify.js" defer');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('Rejected suggestion');
    expect(html).not.toContain('aria-label="Fixture data"');
  });
  it('retains hashes and signed history after deletion', async () => {
    const report = await base;
    const keys = await signer.publicKeys();
    expect(verifyLedger(report.ledger, keys)).toEqual({ ok: true });
    expect(verifyManifest(report.manifests[0]!, keys)).toEqual({ ok: true });
    expect(
      verifySignature(keys[0]!, Buffer.from(report.manifests[0]!.canonicalJson), report.manifests[0]!.signatureB64),
    ).toBe(true);
    const html = await (await setup(async () => report).request('/r/ok')).text();
    expect(html).toContain('Photo 3 deleted by tenant');
    expect(html).toContain('Original bytes are no longer available');
  });
  it('returns a private HTML error without leaking tokens or storage messages', async () => {
    const logs: string[] = [];
    const app = createApp({
      signer,
      reportLoader: async () => {
        throw new Error('private content');
      },
      logSink: (line) => logs.push(line),
    });
    const res = await app.request('/r/private-token');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.text()).not.toContain('private content');
    expect(logs.join('')).not.toContain('private-token');
    expect(logs.join('')).not.toContain('private content');
    expect(logs.join('')).toContain('/r/:token');
  });
  it('marks only receipt delays strictly over 24h and validates overlay geometry', async () => {
    const item = (await base).exhibits[0]!;
    expect(
      receiptGap({
        ...item,
        receivedAtServer: new Date(Date.parse(item.capturedAtDevice) + 86400000),
      }),
    ).toBe(24);
    expect(receiptGap({ ...item, receivedAtServer: null })).toBeNull();
    expect(validBox({ x: 0.9, y: 0, width: 0.2, height: 1 })).toBe(false);
    expect(validBox({ x: 0, y: 0, width: NaN, height: 1 })).toBe(false);
    expect(validBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(webUrl('javascript:alert(1)')).toBeUndefined();
  });
  it('uses authorized originals without previews, rejects unsafe URLs and omits deleted URLs', async () => {
    const report = varyFixture(await base, 'demo', 'https://report.example');
    const original = 'https://storage.example/original?signature=test';
    report.exhibits[0]!.imageUrl = null;
    report.exhibits[0]!.originalUrl = original;
    report.exhibits[1]!.originalUrl = 'javascript:alert(1)';
    report.exhibits[2]!.originalUrl = 'https://storage.example/deleted';
    const html = await (await setup(async () => report).request('/r/ok')).text();
    expect(html).toContain('data-original="' + original + '"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('storage.example/deleted');
    const script = await setup(async () => null).request('/r/verify.js');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(script.headers.get('x-content-type-options')).toBe('nosniff');
    expect(script.headers.get('content-security-policy')).toContain("connect-src 'self' https:;");
  });
  it('handles absent lease, pending and HEIC exhibits without inventing seal times', async () => {
    const report = varyFixture(await base, 'empty', 'http://localhost');
    report.exhibits = [
      {
        ...(await base).exhibits[0]!,
        mime: 'image/heic',
        receivedAtServer: null,
        sealedManifestId: null,
        imageUrl: null,
      },
    ];
    const html = await (await setup(async () => report).request('/r/ok')).text();
    expect(html).toContain('No lease findings are included');
    expect(html).toContain('HEIC original');
    expect(html).toContain('Waiting to seal');
    expect(html).toContain('Not recorded');
  });
});
