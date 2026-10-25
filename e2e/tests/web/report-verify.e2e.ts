import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Browser evidence verification', { platforms: ['web'] }, () => {
  test('keyboard verifies an original and report discloses deleted originals', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/r/fixture');
    for (let i = 0; i < 30; i++) {
      await browser.keyboard.press('Tab');
      if (await browser.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Verify exhibit 1')) break;
    }
    expect(await browser.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Verify exhibit 1');
    await app.screenshot('verify-before');
    await browser.keyboard.press('Enter');
    await expect(screen.getByRole('status').nth(0)).toHaveText('Verified: original SHA-256 and manifest signature match.');
    await app.screenshot('verify-after');
    expect(await browser.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Verify exhibit 1');
    await browser.keyboard.press('Space');
    await expect(screen.getByRole('status').nth(0)).toContainText('Verified:');
    for (let i = 0; i < 20; i++) {
      await browser.keyboard.press('Tab');
      if (await browser.evaluate(() => document.activeElement?.textContent === 'Verify report')) break;
    }
    expect(await browser.evaluate(() => document.activeElement?.textContent)).toBe('Verify report');
    await browser.keyboard.press('Enter');
    await expect(screen.getByRole('status').nth(3)).toContainText('Verification incomplete. Originals verified: 2; originals not checked: 1; checks failed: 0.');
    await expect(screen.getByRole('status').nth(2)).toContainText('Original deleted; signed record verified');
  });

  test('untouched report passes, tampered original fails and retry downloads again', async ({ app, browser, screen }) => {
    await app.open('/r/fixture?data=one');
    await screen.getByRole('button', { name: 'Verify report', exact: true }).tap();
    await expect(screen.getByRole('status').nth(1)).toContainText('Verified. Originals verified: 1; originals not checked: 0; checks failed: 0.');
    await browser.route('**/photos/kitchen', route => route.fulfill({ contentType: 'image/jpeg', body: 'tampered original' }));
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Original SHA-256 or byte length does not match');
    await expect(screen.getByRole('status').nth(1)).toContainText('Report not checked in this run.');
    await screen.getByRole('button', { name: 'Verify report', exact: true }).tap();
    await expect(screen.getByRole('status').nth(1)).toContainText('Verification failed.');
    await browser.unroute('**/photos/kitchen');
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Verified:');
  });

  test('tampered signature, canonical bytes, exhibit binding and unknown keys fail closed', async ({ app, browser, screen }) => {
    for (const mutation of ['signature', 'canonical', 'hash', 'binding', 'missing', 'duplicate']) {
      await app.open('/r/fixture?data=one');
      await browser.evaluate((mutation) => {
        const block = document.querySelector<HTMLElement>('[data-manifest]')!;
        const exhibit = document.querySelector<HTMLElement>('[data-verify-exhibit]')!;
        if (mutation === 'signature') block.dataset.signature = btoa('\0'.repeat(64));
        if (mutation === 'canonical') block.querySelector('pre')!.textContent += ' ';
        if (mutation === 'hash') block.dataset.sha256 = '0'.repeat(64);
        if (mutation === 'binding') exhibit.dataset.verifyExhibit = 'unrelated-id';
        if (mutation === 'missing') block.dataset.keyId = 'unknown-key';
        if (mutation === 'duplicate') block.after(block.cloneNode(true));
      }, mutation);
      await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
      await expect(screen.getByRole('status').nth(0)).toContainText('Could not verify:');
      await screen.getByRole('button', { name: 'Verify report', exact: true }).tap();
      await expect(screen.getByRole('status').nth(1)).toContainText('Verification failed.');
    }
  });

  test('network, expired URLs, unsupported browsers and empty reports have actionable results', async ({ app, browser, screen }) => {
    await app.open('/r/fixture?data=one');
    await browser.route('**/fineprint-keys.json', route => route.fulfill({ status: 503, body: '' }));
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Reload the report and retry.');
    await browser.unroute('**/fineprint-keys.json');
    await browser.route('**/photos/kitchen', route => route.fulfill({ status: 403, body: '' }));
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('link may have expired');
    await browser.unroute('**/photos/kitchen');
    await browser.route('**/photos/kitchen', route => route.abort());
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Check your connection');
    await browser.unroute('**/photos/kitchen');
    await browser.evaluate(() => { Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true }); });
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('WebCrypto is unavailable');
    await app.open('/r/fixture?data=empty');
    await screen.getByRole('button', { name: 'Verify report', exact: true }).tap();
    await expect(screen.getByRole('status')).toContainText('Nothing to verify');
  });

  test('missing originals stay incomplete and a separate original GET works without a preview', async ({ app, browser, screen }) => {
    await app.open('/r/fixture?data=one');
    await browser.evaluate(() => { document.querySelector<HTMLElement>('[data-verify-exhibit]')!.dataset.original = ''; });
    await screen.getByRole('button', { name: 'Verify report', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Original unavailable; signed record verified');
    await expect(screen.getByRole('status').nth(1)).toContainText('Verification incomplete.');
    await app.open('/r/fixture?data=one');
    await browser.evaluate(() => { document.querySelector('.exhibit img')?.remove(); });
    await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).tap();
    await expect(screen.getByRole('status').nth(0)).toContainText('Verified:');
    await browser.route('**/verify.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await app.open('/r/fixture');
    await expect(screen.getByRole('heading', { name: '03 / Exhibits' })).toBeVisible();
    expect(await screen.getByRole('button', { name: 'Verify exhibit 1', exact: true }).isVisible()).toBe(false);
    await browser.unroute('**/verify.js');
  });

  test('worst case fits phone width with large dark text and pending records cannot pass', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 320, height: 720 });
    await browser.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await app.open('/r/fixture?data=worst');
    await browser.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await screen.getByRole('button', { name: 'Verify exhibit 4', exact: true }).tap();
    await expect(screen.getByRole('status').nth(3)).toContainText('Signed manifest unavailable');
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await browser.evaluate(() => [...document.querySelectorAll('.verification button')].every(button => button.getBoundingClientRect().height >= 44))).toBe(true);
    await app.screenshot('verify-phone-worst-dark-large-text');
  });
});
