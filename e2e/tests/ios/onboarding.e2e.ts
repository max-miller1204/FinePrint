import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from './fixtures';

// The ios target launches with -FinePrintSkipOnboarding so every other test starts at the tabs.
// These tests relaunch the app without it, so the first launch shows onboarding. A launch's
// arguments replace the target's, so the rest are repeated here.
const bundleId = 'org.fineprint.FinePrint';
const serverURL = `http://127.0.0.1:${process.env.E2E_IOS_SERVER_PORT ?? '18080'}`;
const freshLaunch = {
  relaunch: true,
  launchArguments: ['-FinePrintServerURL', serverURL, '-FinePrintInMemoryStore', '-FinePrintDeveloperMenu'],
  // Reset so a notification prompt, if the app asked for one, would be shown.
  permissions: { notifications: 'reset' },
} as const;

const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const rentalsCreated = () => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes('rental created')).length;
  } catch {
    return 0;
  }
};

test('onboarding finishes in under 30 seconds, creates the rental, and opens the right tab', { platforms: ['ios'] }, async ({ app, screen, device }) => {
  await app.open();
  const created = rentalsCreated();
  await device.openApp(bundleId, freshLaunch);

  const started = Date.now();
  await expect(screen.getByTestId('onboarding.disclosure')).toContainText('Not a lawyer. Built on Virginia law.');
  await screen.getByTestId('onboarding.continue').tap();

  // The language defaults to the device language; the simulator's is English.
  await expect(screen.getByTestId('onboarding.language.en')).toBeSelected();
  await screen.getByTestId('onboarding.continue').tap();

  await expect(screen.getByText('Where do you rent?')).toBeVisible();
  await screen.getByTestId('onboarding.place.search').fill('richmond');
  await screen.getByTestId('onboarding.place.richmond-city').tap();
  await screen.getByTestId('onboarding.continue').tap();

  await expect(screen.getByText('Where are you in your rental?')).toBeVisible();
  await screen.getByTestId('onboarding.phase.move_in').tap();
  await screen.getByTestId('onboarding.finish').tap();

  // Just moved in lands on Evidence.
  await expect(screen.getByRole('tab', { name: 'Evidence' })).toBeSelected();
  const seconds = (Date.now() - started) / 1000;
  expect(seconds).toBeLessThan(30);

  // No notification prompt at any point (spec §4.2 step 5).
  let alertShown = true;
  try {
    await device.alert('dismiss');
  } catch {
    alertShown = false;
  }
  expect(alertShown).toBe(false);

  // The local rental was created on the server (the server logs "rental created").
  await expect.poll(rentalsCreated, { timeout: 15_000 }).toBe(created + 1);
});

test('outside Virginia shows the evidence-only message and still continues', { platforms: ['ios'] }, async ({ app, screen, device }) => {
  await app.open();
  await device.openApp(bundleId, freshLaunch);

  await screen.getByTestId('onboarding.continue').tap();
  await screen.getByTestId('onboarding.continue').tap();

  await expect(screen.getByTestId('onboarding.outsideVirginia')).not.toBeVisible();
  await screen.getByTestId('onboarding.state').tap();
  await screen.getByText('Maryland').tap();
  await expect(screen.getByTestId('onboarding.outsideVirginia')).toContainText(
    "FinePrint's legal checks only cover Virginia. Evidence tools still work.",
  );

  // A city is still needed before Continue.
  await expect(screen.getByTestId('onboarding.continue')).toBeDisabled();
  await screen.getByTestId('onboarding.place.city').fill('Baltimore');
  await screen.getByTestId('onboarding.continue').tap();

  await screen.getByTestId('onboarding.phase.living').tap();
  await screen.getByTestId('onboarding.finish').tap();
  await expect(screen.getByRole('tab', { name: 'Repairs' })).toBeSelected();
});

test('skipping onboarding starts at the tabs', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByRole('tab', { name: 'Lease' })).toBeSelected();
  await expect(screen.getByTestId('onboarding.continue')).not.toBeVisible();
});
