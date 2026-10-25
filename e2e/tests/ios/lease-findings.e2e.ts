import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { iosBundleId, iosLaunchArguments } from '../../ios-launch';
import { test } from './fixtures';

// The findings half of F1 Lease Explainer (#18, spec §4.3 F1, §7.3, §10.1).
// The app sends the reviewed, redacted lease (POST /v1/rentals/:id/leases),
// streams the check (GET .../stream, SSE), and shows the key terms card, the
// findings list, a finding's detail, and the clause explorer, each in place of
// the summary (#99).
//
// Three ways in:
// - `-FinePrintStubFindings <n>` (DEBUG) plays a made-up check of the sent text
//   with n findings, no server or model: the screens at 25 and 0 findings.
// - With no model on the server (no GEMINI_API_KEY), the real stream stops at
//   S2 with DEPENDENCY_UNAVAILABLE, so the upload and the stream are checked
//   end to end and the app shows Try Again.
// - With GEMINI_API_KEY (`op run --env-file ../.env --`), the real check of
//   the fixture lease finds its 15% late fee.
// ios/FinePrintTests/LeaseFindingsTests.swift covers the SSE parser, event
// decoding, ordering, the clause explorer's offsets, and announcement throttling.

const MODEL = Boolean(process.env.GEMINI_API_KEY);
const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const logLines = (message: string) => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes(`"message":"${message}"`)).length;
  } catch {
    return 0;
  }
};

// Reading and OCR run on the simulator, which is slow on a loaded machine.
const readTimeout = { timeout: 150_000 };

type Tappable = { or(other: Tappable): Tappable; first(): Tappable; isVisible(): Promise<boolean>; tap(): Promise<void> };
type Screen = { getByTestId(id: string): Tappable; getByRole(role: string, options: { name: string }): Tappable };

/** Imports the fixture lease and finishes the review, tapping again if the first tap lands too early. */
async function importAndReview(screen: Screen) {
  const started = screen.getByTestId('lease.progress').or(screen.getByTestId('lease.redaction.TENANT_1')).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const button = screen.getByTestId('lease.importPDF');
    if (!(await button.isVisible())) break;
    await button.tap();
    try {
      await expect(started).toBeVisible({ timeout: 10_000 });
      break;
    } catch {
      // Not started yet: tap again.
    }
  }
  await expect(screen.getByTestId('lease.redaction.TENANT_1')).toBeVisible(readTimeout);
  await screen.getByRole('button', { name: 'Done' }).tap();
  await expect(screen.getByTestId('lease.status')).toBeVisible();
}

test('the findings stream in, open in place, and point at the lease (stub, 25 findings)', { platforms: ['ios'], timeout: 360_000 }, async ({ app, screen, device }) => {
  await app.open();
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: [...iosLaunchArguments(), '-FinePrintStubFindings', '25'] });
  await importAndReview(screen);

  const analyze = screen.getByTestId('lease.analyze');
  await screen.scrollUntilVisible(analyze);
  await analyze.tap();
  await expect(screen.getByTestId('lease.analysis.done')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByTestId('lease.analysis.done')).toContainText('25 findings');

  // The key terms card shows the lease's own words for a term in place.
  const lateFeeTerm = screen.getByTestId('lease.keyTerm.lateFee');
  await screen.scrollUntilVisible(lateFeeTerm);
  await expect(lateFeeTerm).toHaveValue('15%');
  await lateFeeTerm.tap();
  await expect(screen.getByTestId('lease.keyTerm.lateFee.quote')).toContainText(/late fee of\s+15%/);

  // Most serious first: the late fee finding leads, with its severity word.
  const lateFee = screen.getByTestId('lease.finding.f1');
  await screen.scrollUntilVisible(lateFee);
  await expect(lateFee).toContainText('Likely unenforceable');
  await expect(lateFee).toContainText(/late fee/i);
  await lateFee.tap();

  // The detail: explanation, both quotes, citation, and what to do.
  await expect(screen.getByTestId('lease.finding.title')).toContainText(/late fee/i);
  await expect(screen.getByTestId('lease.finding.leaseQuote')).toContainText(/late fee of\s+15%/);
  await expect(screen.getByTestId('lease.finding.statuteQuote')).toContainText('10 percent');
  await expect(screen.getByTestId('lease.finding.citation')).toContainText('55.1-1204');
  const action = screen.getByTestId('lease.finding.action');
  await screen.scrollUntilVisible(action);
  await expect(action).toBeVisible();

  // Show in Lease opens the clause explorer at the highlighted clause.
  const showInLease = screen.getByTestId('lease.finding.showInLease');
  await screen.scrollUntilVisible(showInLease);
  await showInLease.tap();
  await expect(screen.getByTestId('lease.explorer.finding.f1')).toBeVisible();
  await screen.getByTestId('lease.explorer.close').tap();
  // Back goes to the finding it came from, then to the list.
  await expect(screen.getByTestId('lease.finding.title')).toBeVisible();
  await screen.getByTestId('lease.finding.close').tap();
  await expect(screen.getByTestId('lease.finding.f1')).toBeVisible();
});

test('a check with no findings says so (stub, 0 findings)', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen, device }) => {
  await app.open();
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: [...iosLaunchArguments(), '-FinePrintStubFindings', '0'] });
  await importAndReview(screen);
  const analyze = screen.getByTestId('lease.analyze');
  await screen.scrollUntilVisible(analyze);
  await analyze.tap();
  await expect(screen.getByTestId('lease.analysis.done')).toBeVisible({ timeout: 60_000 });
  const empty = screen.getByTestId('lease.findings.empty');
  await screen.scrollUntilVisible(empty);
  await expect(empty).toContainText('Nothing in your lease matched');
});

test('without a model, the lease is sent, streamed, and the app offers Try Again', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen }) => {
  test.skip(MODEL, 'the server has a model: the live test covers this lease');
  await app.open();
  const created = logLines('lease created');
  await importAndReview(screen);
  const analyze = screen.getByTestId('lease.analyze');
  await screen.scrollUntilVisible(analyze);
  await analyze.tap();
  // The stream reaches S2, then stops with DEPENDENCY_UNAVAILABLE.
  await expect(screen.getByTestId('lease.analysis.error')).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByTestId('lease.analysis.error')).toContainText('busy');
  await expect(screen.getByTestId('lease.analysis.retry')).toBeVisible();
  expect(logLines('lease created')).toBe(created + 1);
});

test('live: the fixture lease is checked on the dev server and its late fee finding is shown', { platforms: ['ios'], timeout: 900_000 }, async ({ app, screen }) => {
  test.skip(!MODEL, 'needs GEMINI_API_KEY: run under op run');
  await app.open();
  await importAndReview(screen);
  const analyze = screen.getByTestId('lease.analyze');
  await screen.scrollUntilVisible(analyze);
  await analyze.tap();
  // Findings appear while the check runs; the whole check can take minutes on a rate limit.
  await expect(screen.getByTestId('lease.analysis.done')).toBeVisible({ timeout: 840_000 });
  const lateFee = screen.getByTestId(/^lease\.finding\.f\d+$/).filter({ hasText: 'late fee' }).first();
  await screen.scrollUntilVisible(lateFee);
  await expect(lateFee).toContainText('Likely unenforceable');
  await lateFee.tap();
  await expect(screen.getByTestId('lease.finding.leaseQuote')).toContainText('15%');
  await expect(screen.getByTestId('lease.finding.citation')).toContainText('55.1-1204');
});
