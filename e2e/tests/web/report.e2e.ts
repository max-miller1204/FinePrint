import { createHash } from 'node:crypto';
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

describe('Web Evidence Report', { platforms: ['web'] }, () => {
  test('SSR includes every section, honest timestamps, deletion history and valid signed bytes', async ({
    app,
    screen,
    browser,
  }) => {
    const res = await fetch(new URL('/r/fixture', app.baseUrl));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    const html = await res.text();
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).not.toContain('<script');
    await app.open('/r/fixture');
    for (const name of [
      '01 / Timeline',
      '02 / Lease findings',
      '03 / Exhibits',
      '04 / Ledger',
      '05 / Integrity and limits',
    ]) {
      await expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    await expect(screen.getByText('Imported photo: capture time unverified.')).toBeVisible();
    await expect(screen.getByText('Offline gap over 24h:', { exact: false })).toBeVisible();
    await expect(screen.getByRole('cell', { name: /Photo 3 deleted by tenant/ })).toBeVisible();
    expect(await browser.evaluate(() => document.querySelectorAll('.exhibit').length)).toBe(3);
    expect(await browser.evaluate(() => document.querySelectorAll('.exhibit img').length)).toBe(2);
    expect(await browser.evaluate(() => document.querySelectorAll('.overlay rect').length)).toBe(1);
    expect(await browser.evaluate(() => document.body.innerText.includes('Rejected suggestion'))).toBe(false);
    const manifest = await browser.evaluate(() => ({
      canonicalJson: document.querySelector('[data-manifest] pre')!.textContent!,
      signatureB64: document.querySelector('[data-manifest] dd:last-child code')!.textContent!,
      keyId: document.querySelector('[data-manifest] dd:nth-of-type(2) code')!.textContent!,
      sha256: document.querySelector('[data-manifest] dd:first-of-type code')!.textContent!,
    }));
    expect(hash(manifest.canonicalJson)).toBe(manifest.sha256);
    const { keys } = await (await fetch(new URL('/.well-known/fineprint-keys.json', app.baseUrl))).json();
    const jwk = keys.find((key: { kid: string }) => key.kid === manifest.keyId);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        Buffer.from(manifest.signatureB64, 'base64'),
        new TextEncoder().encode(manifest.canonicalJson),
      ),
    ).toBe(true);
    const image = await fetch(new URL('/r/fixture/photos/kitchen', app.baseUrl));
    expect(image.status).toBe(200);
    expect(hash(new Uint8Array(await image.arrayBuffer()))).toBe(JSON.parse(manifest.canonicalJson).items[0].sha256);
    expect(
      await browser.evaluate(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0)),
    ).toBe(true);
    await app.screenshot('report-desktop');
  });

  test('phone layouts wrap long text and hashes at 320px, dark mode and 200 percent text', async ({
    app,
    browser,
    screen,
  }) => {
    await browser.setViewport({ width: 320, height: 720 });
    await browser.emulateMedia({
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await app.open('/r/fixture?data=worst');
    await expect(screen.getByRole('heading', { name: '03 / Exhibits' })).toBeVisible();
    expect(await browser.evaluate(() => document.querySelectorAll('.exhibit').length)).toBe(120);
    expect(await browser.evaluate(() => document.querySelectorAll('.card').length)).toBe(25);
    expect(await browser.evaluate(() => document.querySelectorAll('[lang="es"]').length)).toBe(25);
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await browser.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 24, 19)');
    await app.screenshot('report-phone-worst-dark');
    await browser.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      await browser.evaluate(() =>
        [...document.querySelectorAll('blockquote')].every((el) => el.scrollWidth <= el.clientWidth),
      ),
    ).toBe(true);
    await app.screenshot('report-phone-worst-large-text');
    await browser.setViewport({ width: 1440, height: 900 });
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('keyboard navigation, empty and one-exhibit reports stay usable', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/r/fixture');
    await browser.keyboard.press('Tab');
    expect(await browser.evaluate(() => document.activeElement?.textContent)).toBe('Skip to report');
    expect(await browser.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth)).toBe('3px');
    await browser.keyboard.press('Enter');
    expect(await browser.evaluate(() => document.activeElement?.id)).toBe('report');
    await screen.getByRole('link', { name: 'Exhibits', exact: true }).tap();
    expect(await browser.url()).toContain('#exhibits');
    await screen.getByRole('link', { name: 'Empty', exact: true }).tap();
    await expect(screen.getByText('No exhibits are included.')).toBeVisible();
    await expect(screen.getByText('No timeline events recorded.')).toBeVisible();
    await expect(screen.getByText('No signed ledger events recorded.')).toBeVisible();
    await app.screenshot('report-phone-empty');
    await screen.getByRole('link', { name: 'One', exact: true }).tap();
    await expect(screen.getByText('1 finding • 1 exhibit', { exact: true })).toBeVisible();
    expect(await browser.evaluate(() => document.querySelectorAll('.exhibit').length)).toBe(1);
  });

  test('print produces a black-on-white PDF with separate exhibit pages and signed records', async ({ app }) => {
    // e2e's portable browser fixture has no print/PDF method. Use the same
    // Chromium dependency for this print-only check, against the running app.
    const printBrowser = await chromium.launch({ headless: true });
    try {
      const page = await printBrowser.newPage({ viewport: { width: 695, height: 935 } });
      await page.goto(new URL('/r/fixture', app.baseUrl).href);
      await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
      expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(0, 0, 0)');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('nav')!).display)).toBe('none');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.exhibit')!).breakBefore)).toBe('page');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.exhibits')!).display)).toBe('block');
      expect(
        await page.evaluate(() => document.querySelector('.exhibit')!.getBoundingClientRect().height),
      ).toBeLessThan(935);
      // A user can collapse these before printing. Signed bytes must still print.
      await page.locator('details').evaluateAll((details) =>
        details.forEach((detail) => {
          detail.removeAttribute('open');
        }),
      );
      expect(await page.locator('[data-manifest] pre').isVisible()).toBe(true);
      expect(await page.locator('[data-ledger-entry]').first().isVisible()).toBe(true);
      await mkdir('.e2e/proof/report-print', { recursive: true });
      const pdf = await page.pdf({
        path: '.e2e/proof/report-print/report.pdf',
        format: 'Letter',
        printBackground: true,
        displayHeaderFooter: false,
        tagged: true,
      });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(10000);
    } finally {
      await printBrowser.close();
    }
  });

  test('unknown tokens have a private, accessible HTML error', async ({ app, screen }) => {
    const res = await fetch(new URL('/r/does-not-exist', app.baseUrl));
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toContain('no-store');
    await app.open('/r/does-not-exist');
    await expect(screen.getByRole('heading', { name: 'Report unavailable' })).toBeVisible();
  });
});
