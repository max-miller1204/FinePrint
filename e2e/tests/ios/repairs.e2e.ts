import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from './fixtures';

// The Repairs tab (spec §4.3 F4, #31): New Issue > description, room, item, a photo from the DEBUG
// fixture camera > Check Who's Responsible > the result card. The check calls
// POST /v1/rentals/:id/issues on the e2e server. With GEMINI_API_KEY (inherited by the server) it
// asks Gemma; without one the server answers 503 and the app says the check isn't available.
// Decoding, the checker, and the form rules are covered by ios/FinePrintTests/RepairsTests.swift.

const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const logLines = (message: string, extra = '') => {
  try {
    return readFileSync(serverLog, 'utf8')
      .split('\n')
      .filter((line) => line.includes(`"message":"${message}"`) && line.includes(extra)).length;
  } catch {
    return 0;
  }
};

const modelOn = Boolean(process.env.GEMINI_API_KEY || process.env.GEMMA_PROVIDER === 'openai_compatible');
const HEATER = 'The heater in my bedroom stopped working on January 3. It is 50 degrees inside. I told my landlord in writing on January 4 and nobody has come.';

type Screen = {
  getByText(text: string, options?: { exact?: boolean }): Parameters<typeof expect>[0] & { tap(): Promise<void> };
  getByRole(role: string, options: { name: string }): { tap(): Promise<void> };
  getByTestId(id: string): Parameters<typeof expect>[0] & {
    tap(): Promise<void>;
    fill(text: string): Promise<void>;
    isVisible(): Promise<boolean>;
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  };
  scrollUntilVisible(locator: unknown): Promise<void>;
  swipe(options: { direction: 'up' | 'down' | 'left' | 'right' }): Promise<void>;
};

/** Waits for the tabs to settle, then opens Repairs. A tab tapped while the app is still launching is lost. */
async function openRepairs(screen: Screen) {
  await expect(screen.getByText('No lease yet')).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    await screen.getByRole('tab', { name: 'Repairs' }).tap();
    try {
      await expect(screen.getByTestId('repairs.newIssue')).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      // The tap was lost while the tabs were still settling: tap again.
    }
  }
}

/**
 * Brings Check Who's Responsible clear of the floating tab bar and deadline accessory. In the tree is
 * not enough: under the accessory a tap opens Evidence. The form has bottom clearance, so swiping to
 * its end lifts the button above the accessory.
 */
async function scrollToCheck(screen: Screen) {
  const check = screen.getByTestId('issue.check');
  const accessory = screen.getByTestId('deadlineAccessory');
  for (let attempt = 0; attempt < 4; attempt++) {
    const button = await check.boundingBox();
    const bar = (await accessory.isVisible()) ? await accessory.boundingBox() : null;
    if (button && (!bar || button.y + button.height <= bar.y)) return;
    // e2e directions are scroll directions: 'down' moves the content up, toward the form's end.
    await screen.swipe({ direction: 'down' });
  }
  throw new Error('Check Who\'s Responsible stayed under the deadline accessory');
}

/** Takes the next fixture photo and keeps it, even if the quality gate asks for a retake. */
async function takeAndKeepPhoto(screen: Screen) {
  await screen.getByTestId('camera.shutter').tap();
  await expect(screen.getByTestId('camera.hash')).toBeVisible();
  const use = screen.getByTestId('camera.use');
  if (await use.isVisible()) {
    await use.tap();
  } else {
    await screen.getByTestId('camera.keep').tap();
  }
}

test('a broken heater in January gets a cited answer, with a photo of it', { platforms: ['ios'], timeout: 420_000 }, async ({ app, screen }) => {
  await app.open();
  await openRepairs(screen);
  await expect(screen.getByText('No repairs yet')).toBeVisible();
  await expect(screen.getByText('Legal information, not legal advice.')).toBeVisible();
  const received = logLines('evidence received');
  const created = logLines('issue created');
  const createdWithPhoto = logLines('issue created', '"photos":1');

  await screen.getByTestId('repairs.newIssue').tap();
  // Nothing to check yet, and photos need a room.
  await expect(screen.getByTestId('issue.check')).toBeDisabled();
  await expect(screen.getByTestId('issue.addPhoto')).toBeDisabled();

  await screen.getByTestId('issue.description').fill(HEATER);
  // iOS 26 lists a toolbar button twice, so it goes by role and name.
  await screen.getByRole('button', { name: 'Done' }).tap();
  await screen.getByTestId('issue.room').tap();
  await screen.getByText('Bedroom', { exact: true }).tap();
  await screen.getByTestId('issue.item').tap();
  await screen.getByText('Fixtures', { exact: true }).tap();

  // A photo of the heater, through the same pipeline as move-in photos, as an incident photo.
  await screen.scrollUntilVisible(screen.getByTestId('issue.addPhoto'));
  await screen.getByTestId('issue.addPhoto').tap();
  await expect(screen.getByTestId('camera.item')).toContainText('Fixtures');
  await takeAndKeepPhoto(screen);
  await expect(screen.getByTestId('issue.photo.0')).toContainText('Uploaded', { timeout: 60_000 });
  await expect.poll(() => logLines('evidence received'), { timeout: 15_000 }).toBe(received + 1);

  await scrollToCheck(screen);
  await screen.getByTestId('issue.check').tap();

  if (!modelOn) {
    // No model on the server: nothing to answer with, the words stay, and nothing is stored.
    await expect(screen.getByTestId('issue.error')).toContainText("isn't available", { timeout: 60_000 });
    await expect(screen.getByTestId('issue.check')).toBeEnabled();
    expect(logLines('issue created')).toBe(created);
    return;
  }

  // Triage, Gemma 26B, and 31B take about a minute.
  await expect(screen.getByTestId('issue.verdict')).toContainText("Likely landlord's responsibility", { timeout: 240_000 });
  await expect(screen.getByTestId('issue.confidence')).toContainText('confidence');
  // Every reason the card shows rests on a citation; the heater case rests on Virginia law.
  await expect(screen.getByTestId('issue.reason.0')).toBeVisible();
  await expect(screen.getByText('Virginia law', { exact: false })).toBeVisible();
  await screen.scrollUntilVisible(screen.getByTestId('issue.change.0'));
  await expect(screen.getByTestId('issue.change.0')).toBeVisible();
  await expect.poll(() => logLines('issue created', '"photos":1'), { timeout: 15_000 }).toBe(createdWithPhoto + 1);
  expect(logLines('issue created')).toBe(created + 1);

  // Saved on the rental: Done goes back to the list, which shows it.
  await screen.getByRole('button', { name: 'Done' }).tap();
  await expect(screen.getByTestId('issue.row')).toContainText("Likely landlord's responsibility");
});

test('a gas smell skips straight to safety steps and saves nothing', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen }) => {
  await app.open();
  await openRepairs(screen);
  const escalated = logLines('responsibility check', '"status":"escalated"');
  const created = logLines('issue created');

  await screen.getByTestId('repairs.newIssue').tap();
  await screen.getByTestId('issue.description').fill('I smell gas in the kitchen.');
  // Return adds a line in the description: the keyboard's Done closes it.
  // iOS 26 lists a toolbar button twice, so it goes by role and name.
  await screen.getByRole('button', { name: 'Done' }).tap();
  await scrollToCheck(screen);
  await screen.getByTestId('issue.check').tap();

  // The keyword backstop catches it with or without a model.
  await expect(screen.getByTestId('issue.safety.title')).toContainText('Get safe first', { timeout: 120_000 });
  await expect(screen.getByTestId('issue.safety.guidance')).toContainText('call 911');
  await expect(screen.getByText('Call 911')).toBeVisible();
  await expect.poll(() => logLines('responsibility check', '"status":"escalated"'), { timeout: 15_000 }).toBe(escalated + 1);
  expect(logLines('issue created')).toBe(created);

  await screen.getByRole('button', { name: 'Done' }).tap();
  await expect(screen.getByText('No repairs yet')).toBeVisible();
});
