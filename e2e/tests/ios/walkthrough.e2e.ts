import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { iosBundleId, iosLaunchArguments } from '../../ios-launch';
import { test } from './fixtures';

// The move-in walkthrough (spec §4.3 F2, #25): Evidence > Start Move-In Walkthrough > rooms >
// checklist > camera (the DEBUG fixture camera, #22) > Seal Move-In Report. Sealing calls
// POST /v1/rentals/:id/seal on the e2e server (a local key signs under the emulators) and starts the
// landlord's report clock. Model rules, the sealer, and the clock are covered by
// ios/FinePrintTests/WalkthroughTests.swift.

const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const logLines = (message: string) => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes(`"message":"${message}"`)).length;
  } catch {
    return 0;
  }
};

// The part of the screen these helpers use.
type Screen = {
  getByText(text: string, options?: { exact?: boolean }): Parameters<typeof expect>[0];
  getByRole(role: string, options: { name: string }): { tap(): Promise<void> };
  getByTestId(id: string): { tap(): Promise<void>; isVisible(): Promise<boolean> };
};

/** Goes back one screen with the navigation bar's back button (labelled with the previous title). */
async function goBack(screen: Screen, previousTitle: string) {
  await screen.getByRole('button', { name: previousTitle }).tap();
}

/** Waits for the tabs to settle, then opens Evidence. A tab tapped while the app is still launching is lost. */
async function openEvidence(screen: Screen) {
  await expect(screen.getByText('No lease yet')).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    // At the largest text sizes Evidence can take longer than one wait to draw, and the tab bar then
    // lists its tabs as buttons: check before tapping again.
    if (attempt > 0 && (await screen.getByTestId('walkthrough.start').isVisible())) return;
    await screen.getByRole('tab', { name: 'Evidence' }).tap();
    try {
      await expect(screen.getByTestId('walkthrough.start')).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      // The tap was lost while the tabs were still settling: tap again.
    }
  }
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

test('the empty state teaches the 5-day rule, and choosing rooms needs at least one', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen }) => {
  await app.open();
  await openEvidence(screen);
  await expect(screen.getByText('No move-in photos yet')).toBeVisible();
  await expect(screen.getByText('5 days after you move in', { exact: false })).toBeVisible();

  await screen.getByTestId('walkthrough.start').tap();
  await expect(screen.getByTestId('walkthrough.rooms.confirm')).toBeDisabled();

  // A room name that is already a preset is refused, in words.
  await screen.getByTestId('walkthrough.customRoomField').fill('kitchen');
  await expect(screen.getByTestId('walkthrough.customRoomError')).toContainText('already have a room called kitchen');
  await expect(screen.getByTestId('walkthrough.addCustomRoom')).toBeDisabled();

  // Cancel discards the sheet. (Adding a typed room is covered by the unit tests: typing is slow and
  // unreliable on the simulator.)
  await screen.getByRole('button', { name: 'Cancel' }).tap();
  await expect(screen.getByTestId('walkthrough.start')).toBeVisible();
});

test('a walkthrough is completed with the fixture camera and sealed, which starts the landlord report clock', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen }) => {
  await app.open();
  await openEvidence(screen);
  const sealed = logLines('manifest sealed');
  const received = logLines('evidence received');

  // Choose two preset rooms.
  await screen.getByTestId('walkthrough.start').tap();
  await screen.getByTestId('walkthrough.room.hallway').tap();
  await screen.getByTestId('walkthrough.room.exterior').tap();
  await screen.getByTestId('walkthrough.rooms.confirm').tap();
  await screen.getByTestId('walkthrough.open').tap();

  // Hallway has 6 items and Exterior 4: 10 in all, none done. Sealing needs a photo first.
  await expect(screen.getByTestId('walkthrough.progress')).toContainText('0 of 10 done');
  await expect(screen.getByTestId('walkthrough.seal')).toBeDisabled();

  // Photograph the walls with the fixture camera.
  await screen.getByTestId('walkthrough.roomRow.hallway').tap();
  await screen.getByTestId('walkthrough.item.walls').tap();
  await expect(screen.getByTestId('camera.item')).toContainText('Walls');
  await expect(screen.getByTestId('camera.progress')).toContainText('0 of 10 done');
  await takeAndKeepPhoto(screen);
  await expect(screen.getByTestId('walkthrough.item.walls')).toContainText('Photographed');

  // Mark the floor "no damage" from the camera's quick action: no photo.
  await screen.getByTestId('walkthrough.item.floor').tap();
  await screen.getByTestId('camera.markNoDamage').tap();
  await expect(screen.getByTestId('walkthrough.item.floor')).toContainText('No damage');
  await expect(screen.getByTestId('walkthrough.roomProgress')).toContainText('2 of 6 done');

  // Back at the rooms, with the first photo counted.
  await goBack(screen, 'Move-In Walkthrough');
  await expect(screen.getByTestId('walkthrough.progress')).toContainText('2 of 10 done');
  await expect(screen.getByTestId('walkthrough.seal')).toBeEnabled();

  // Eight items are still unchecked, so sealing asks first (in the list, not a system dialog).
  await screen.getByTestId('walkthrough.seal').tap();
  await screen.scrollUntilVisible(screen.getByTestId('walkthrough.seal.confirm'));
  await screen.getByTestId('walkthrough.seal.confirm').tap();

  // The photo uploads, the server signs the manifest, and the report is sealed.
  await expect(screen.getByTestId('walkthrough.sealed')).toContainText('Sealed', { timeout: 60_000 });
  await expect.poll(() => logLines('evidence received'), { timeout: 15_000 }).toBe(received + 1);
  await expect.poll(() => logLines('manifest sealed'), { timeout: 15_000 }).toBe(sealed + 1);
  await expect(screen.getByTestId('walkthrough.seal')).not.toBeVisible();

  // The landlord's report clock started on seal: a card on Evidence and the accessory.
  await goBack(screen, 'Evidence');
  await expect(screen.getByTestId('deadline.card.move_in_report')).toBeVisible();
  await expect(screen.getByTestId('deadlineAccessory')).toContainText("Landlord's move-in report due");
  await expect(screen.getByTestId('walkthrough.open')).toContainText('View Walkthrough');
});

// Largest accessibility Dynamic Type. The setting applies to the running simulator, so the test
// restores it. Screenshots go to the run's artifacts for a look at truncation and overlap.
const largest = 'accessibility-extra-extra-extra-large';
const setTextSize = (size: string) => {
  execFileSync('xcrun', ['simctl', 'ui', 'booted', 'content_size', size], { stdio: 'ignore' });
};

test('the walkthrough works at the largest accessibility text size', { platforms: ['ios'], timeout: 300_000 }, async ({ app, screen, device }) => {
  await app.open();
  setTextSize(largest);
  try {
    await device.openApp(iosBundleId, { relaunch: true, launchArguments: iosLaunchArguments() });
    await openEvidence(screen);
    const start = screen.getByTestId('walkthrough.start');
    await screen.scrollUntilVisible(start);
    await expect(start).toBeVisible();
    await app.screenshot('ax5-empty-state');
    await start.tap();

    // The presets are reachable.
    await expect(screen.getByTestId('walkthrough.room.kitchen')).toBeVisible();
    await app.screenshot('ax5-room-picker');
    await screen.getByTestId('walkthrough.room.kitchen').tap();
    // At this size the Start button is below the list: scroll to it.
    await screen.scrollUntilVisible(screen.getByTestId('walkthrough.rooms.confirm'));
    await app.screenshot('ax5-room-picker-start');
    await screen.getByTestId('walkthrough.rooms.confirm').tap();
    await screen.getByTestId('walkthrough.open').tap();

    await expect(screen.getByTestId('walkthrough.progress')).toContainText('0 of 8 done');
    await app.screenshot('ax5-rooms');
    await screen.getByTestId('walkthrough.roomRow.kitchen').tap();
    await expect(screen.getByTestId('walkthrough.item.walls')).toBeVisible();
    await app.screenshot('ax5-checklist');

    // The camera keeps the shutter and Mark No Damage on screen.
    await screen.getByTestId('walkthrough.item.walls').tap();
    await expect(screen.getByTestId('camera.shutter')).toBeVisible();
    await expect(screen.getByTestId('camera.markNoDamage')).toBeVisible();
    await expect(screen.getByTestId('camera.close')).toBeVisible();
    await app.screenshot('ax5-camera');
  } finally {
    setTextSize('large');
  }
});
