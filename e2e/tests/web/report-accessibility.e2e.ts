import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { chromium, firefox, webkit, type Page } from 'playwright-core';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const output = process.env.AXE_OUTPUT_DIR ?? '.e2e/proof/axe';

function assertAccessible(results: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  expect(results.violations.map(({ id, impact, nodes }) => ({
    id, impact, targets: nodes.map(node => node.target),
  }))).toEqual([]);
}

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/${name}.json`, JSON.stringify(results, null, 2));
  // Keep every violation actionable, including moderate/minor findings. No
  // exclusions or disabled rules; incomplete checks remain in the artifact.
  assertAccessible(results);
}

describe('Report accessibility', { platforms: ['web'] }, () => {
  for (const engine of [chromium, firefox, webkit]) {
    test(`${engine.name()} WCAG 2.2 AA scans all fixture states and unavailable reports`, { timeout: 240_000 }, async ({ app }) => {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          for (const state of ['demo', 'worst', 'empty', 'one', 'unavailable']) {
            await page.goto(new URL(state === 'unavailable' ? '/r/unknown' : `/r/fixture?data=${state}`, app.baseUrl).href);
            await page.locator('main').waitFor();
            await audit(page, `${engine.name()}-${colorScheme}-${state}`);
          }
        }
        await page.goto(new URL('/r/fixture?data=one', app.baseUrl).href);
        await page.getByRole('button', { name: 'Verify report', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Verified. Originals verified: 1;' }).waitFor();
        await audit(page, `${engine.name()}-verified`);
        await page.route('**/photos/kitchen', route => route.fulfill({ contentType: 'image/jpeg', body: 'tampered' }));
        await page.getByRole('button', { name: 'Verify report', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Verification failed.' }).waitFor();
        await audit(page, `${engine.name()}-failed`);
      } finally {
        await browser.close();
      }
    });

    test(`${engine.name()} keyboard focus, disclosures, reduced motion and narrow reflow`, async ({ app }) => {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({ viewport: { width: 320, height: 720 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(new URL('/r/fixture', app.baseUrl).href);
        expect(await page.getByRole('banner').count()).toBe(1);
        expect(await page.getByRole('main').count()).toBe(1);
        expect(await page.getByRole('contentinfo').count()).toBe(1);
        await page.keyboard.press('Tab');
        expect(await page.locator(':focus').textContent()).toBe('Skip to report');
        expect(await page.locator(':focus').evaluate(el => getComputedStyle(el).outlineWidth)).toBe('3px');
        await page.keyboard.press('Enter');
        expect(await page.locator(':focus').getAttribute('id')).toBe('report');
        // Tab through the real document, including both directions, without
        // moving focus via script. Every control must be visible and unobscured.
        let verified = false;
        let disclosed = false;
        for (let i = 0; i < 45; i++) {
          await page.keyboard.press('Tab');
          const focused = page.locator(':focus');
          if (await focused.count() === 0) break;
          expect(await focused.evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight &&
              el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          })).toBe(true);
          expect(await focused.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
          if (await focused.getAttribute('aria-label') === 'Verify exhibit 1') {
            await page.keyboard.press('Enter');
            await page.getByRole('status').filter({ hasText: 'Verified: original SHA-256' }).waitFor();
            expect(await focused.getAttribute('aria-label')).toBe('Verify exhibit 1');
            verified = true;
          }
          if (await focused.evaluate(el => el.tagName === 'SUMMARY')) {
            await page.keyboard.press('Space');
            expect(await focused.evaluate(el => el.parentElement?.hasAttribute('open'))).toBe(false);
            await page.keyboard.press('Enter');
            expect(await focused.evaluate(el => el.parentElement?.hasAttribute('open'))).toBe(true);
            disclosed = true;
          }
          if (await focused.textContent() === 'One') break;
        }
        expect(verified).toBe(true);
        expect(disclosed).toBe(true);
        await page.keyboard.press('Shift+Tab');
        expect(await page.locator(':focus').textContent()).toBe('Empty');
        for (const state of ['demo', 'worst', 'empty', 'one']) {
          await page.goto(new URL(`/r/fixture?data=${state}`, app.baseUrl).href);
          await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
          expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
        }
      } finally {
        await browser.close();
      }
    });
  }

  test('axe gate rejects injected serious and critical violations', async ({ app }) => {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(new URL('/r/fixture?data=empty', app.baseUrl).href);
      // Mutation exists only in this isolated browser, never in served HTML.
      await page.evaluate(() => {
        const text = document.createElement('p');
        text.textContent = 'Deliberately low contrast negative control';
        text.style.cssText = 'color:#aaa;background:#fff';
        document.querySelector('main')?.prepend(document.createElement('button'), text);
      });
      const results = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(results.violations.some(v => v.id === 'color-contrast' && v.impact === 'serious')).toBe(true);
      expect(results.violations.some(v => v.id === 'button-name' && v.impact === 'critical')).toBe(true);
      let rejected = false;
      try {
        assertAccessible(results);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
