import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from './fixtures';

// Lease scan, on-device OCR, and redaction review (#17, spec §4.3 F1, §9.2).
// The config passes -FinePrintFixtureLease <e2e/fixtures/lease/fixture-lease.pdf>
// (DEBUG), so Import PDF and Scan Lease read that file in place of the file
// picker and the document camera. Page 1 has a text layer; page 2 is an image,
// so an import reads one page from the PDF's text and OCRs the other with
// Vision. Scan renders both pages and OCRs them, like document camera images.
// ios/FinePrintTests/LeaseRedactionTests.swift covers the patterns, near
// misses, the redaction map, and the upload body built from the same fixture.

type PersonalDetails = { details: string[]; kept: string[] };
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'lease', 'personal-details.json'), 'utf8'),
) as PersonalDetails;

const flatten = (text: string | null) => (text ?? '').replace(/\s+/g, ' ');
const hiddenCount = async (screen: { getByTestId(id: string): { textContent(): Promise<string | null> } }) =>
  Number(/\d+/.exec((await screen.getByTestId('lease.review.hiddenCount').textContent()) ?? '')?.[0] ?? NaN);

// Reading and OCR run on the simulator, which is slow on a loaded machine.
const readTimeout = { timeout: 150_000 };

type Tappable = { or(other: Tappable): Tappable; first(): Tappable; isVisible(): Promise<boolean>; tap(): Promise<void> };
type Screen = { getByTestId(id: string): Tappable };

/**
 * Taps Scan Lease or Import PDF until reading starts. On a freshly installed build the first tap
 * can land while the tab bar and accessory are still settling, and nothing happens.
 */
async function startReading(screen: Screen, id: 'lease.scan' | 'lease.importPDF') {
  const started = screen.getByTestId('lease.progress').or(screen.getByTestId('lease.redaction.TENANT_1')).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const button = screen.getByTestId(id);
    if (!(await button.isVisible())) return;
    await button.tap();
    try {
      await expect(started).toBeVisible({ timeout: 10_000 });
      return;
    } catch {
      // Not started yet: tap again.
    }
  }
}

test('an imported lease is read on the phone and sent only with personal details hidden', { platforms: ['ios'], timeout: 360_000 }, async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByText('No lease yet')).toBeVisible();
  await startReading(screen, 'lease.importPDF');

  // The review opens by itself once the lease is read. Details from both pages are listed:
  // the tenant's name from the text layer, the SSN from the OCR'd page.
  const tenant = screen.getByTestId('lease.redaction.TENANT_1');
  await expect(tenant).toBeVisible(readTimeout);
  await expect(tenant).toContainText('Jordan Lee');
  // The engine cannot scroll this list back up, so the top of it comes first.
  const detected = await hiddenCount(screen);
  expect(detected).toBeGreaterThanOrEqual(15);

  // Hide more text: something not in the lease is refused, then a phrase that is.
  await screen.getByTestId('lease.review.add').tap();
  await screen.getByTestId('lease.hide.field').fill('Norfolk');
  await screen.getByTestId('lease.hide.confirm').tap();
  await expect(screen.getByTestId('lease.hide.notFound')).toBeVisible();
  await screen.getByTestId('lease.hide.field').fill('grace period');
  await screen.getByTestId('lease.hide.confirm').tap();
  await expect(screen.getByTestId('lease.hide.field')).not.toBeVisible();
  await expect.poll(() => hiddenCount(screen)).toBe(detected + 1);

  // Turn one detection off: the payment portal link is sent as written.
  const link = screen.getByTestId('lease.redaction.LINK_1');
  await screen.scrollUntilVisible(link);
  await link.tap();
  await expect(link).toContainText('Sent as written');

  // The SSN comes from the OCR'd page.
  const ssn = screen.getByTestId('lease.redaction.SSN_1');
  await screen.scrollUntilVisible(ssn);
  await expect(ssn).toContainText('987-65-4321');

  // The lease text view marks each hidden detail for VoiceOver.
  await screen.getByRole('tab', { name: 'Lease Text' }).tap();
  await expect(screen.getByText(/Jordan Lee, hidden,/).first()).toBeVisible();

  await screen.getByRole('button', { name: 'Done' }).tap();
  await expect(screen.getByTestId('lease.status')).toContainText('Personal details hidden');
  // Detected details, plus "grace period", minus the portal link.
  await expect(screen.getByTestId('lease.hiddenCount')).toContainText(String(detected));

  // What gets sent is the upload body's redacted text, built from the reviewed lease.
  await screen.getByTestId('lease.sentPreview').tap();
  const sent = flatten(await screen.getByTestId('lease.sentText').textContent());
  for (const placeholder of ['[TENANT_1]', '[LANDLORD_1]', '[SSN_1]', '[DOB_1]', '[HIDDEN_1]']) {
    expect(sent).toContain(placeholder);
  }
  // The detection the tenant turned off is the only detail sent as written.
  expect(sent).toContain('portal.harborpoint-example.com');
  for (const detail of fixture.details.filter((value) => value !== 'harborpoint-example.com')) {
    expect(sent, `${detail} is in the upload`).not.toContain(detail);
  }
  expect(sent).not.toContain('grace period');
  for (const term of fixture.kept) {
    expect(sent, `${term} was hidden`).toContain(term);
  }
});

test('a scanned lease belongs to the rental it was scanned for', { platforms: ['ios'], timeout: 360_000 }, async ({ app, screen }) => {
  await app.open();
  await startReading(screen, 'lease.scan');
  await expect(screen.getByTestId('lease.redaction.TENANT_1')).toBeVisible(readTimeout);
  await screen.getByRole('button', { name: 'Done' }).tap();
  await expect(screen.getByTestId('lease.status')).toContainText('Personal details hidden');
  await expect(screen.getByText('Scanned pages')).toBeVisible();

  // A second rental starts with no lease.
  await screen.getByRole('button', { name: 'Rentals' }).tap();
  await screen.getByTestId('rentalSwitcher.add').tap();
  await screen.getByTestId('onboarding.place.search').fill('norfolk');
  await screen.getByTestId('onboarding.place.norfolk-city').tap();
  await screen.getByTestId('onboarding.continue').tap();
  await screen.getByTestId('onboarding.phase.living').tap();
  await screen.getByTestId('onboarding.finish').tap();
  await expect(screen.getByText('Norfolk')).toBeVisible();
  await expect(screen.getByText('No lease yet')).toBeVisible();

  // Back on Richmond, its lease is still there. Removing it deletes it from the phone.
  await screen.getByRole('button', { name: 'Rentals' }).tap();
  await screen.getByText('Richmond').tap();
  await expect(screen.getByTestId('lease.status')).toBeVisible();
  const remove = screen.getByTestId('lease.remove');
  await screen.scrollUntilVisible(remove);
  await remove.tap();
  await screen.getByTestId('lease.remove.confirm').tap();
  await expect(screen.getByText('No lease yet')).toBeVisible();
});
