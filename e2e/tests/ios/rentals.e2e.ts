import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { iosBundleId, iosLaunchArguments } from '../../ios-launch';
import { test } from './fixtures';

// Two rentals (spec §4.1): the default Richmond rental from -FinePrintSkipOnboarding ("Living
// there", no deadline, so DEBUG shows the sample in the accessory) and a Norfolk rental added from
// the Lease tab's switcher ("Just moved in", which starts the landlord's move-in report clock).
// Selection rules and deadline scoping are covered by ios/FinePrintTests/DeadlineStoreTests.swift.

const tabs = ['Lease', 'Evidence', 'Repairs', 'Letters', 'Ask'];

const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const rentalsCreated = () => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes('rental created')).length;
  } catch {
    return 0;
  }
};

test('adding a second rental and switching between them switches every tab', { platforms: ['ios'] }, async ({ app, device, screen }) => {
  await app.open();
  // A fresh launch starts with only the default Richmond rental.
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: iosLaunchArguments() });
  await expect(screen.getByText('No lease yet')).toBeVisible();

  // Add Norfolk from the switcher: onboarding's place and phase steps, in a sheet.
  await screen.getByRole('button', { name: 'Rentals' }).tap();
  await screen.getByTestId('rentalSwitcher.add').tap();
  await screen.getByTestId('onboarding.place.search').fill('norfolk');
  await screen.getByTestId('onboarding.place.norfolk-city').tap();
  await screen.getByTestId('onboarding.continue').tap();
  await screen.getByTestId('onboarding.phase.move_in').tap();
  // Richmond was created on the server long before this point, so only Norfolk's create is counted.
  const created = rentalsCreated();
  await screen.getByTestId('onboarding.finish').tap();

  // Norfolk is now current: its clock drives the accessory and every tab names it.
  const accessory = screen.getByTestId('deadlineAccessory');
  await expect(accessory).toContainText("Landlord's move-in report due");
  for (const name of tabs) {
    await screen.getByRole('tab', { name }).tap();
    await expect(screen.getByText('Norfolk')).toBeVisible();
  }
  await screen.getByRole('tab', { name: 'Evidence' }).tap();
  await expect(screen.getByTestId('deadline.card.move_in_report')).toBeVisible();
  // Norfolk was created on the server (the server logs "rental created").
  await expect.poll(rentalsCreated, { timeout: 15_000 }).toBe(created + 1);

  // Switch back to Richmond: its tabs return, and Norfolk's clock leaves with Norfolk.
  await screen.getByRole('tab', { name: 'Lease' }).tap();
  await screen.getByRole('button', { name: 'Rentals' }).tap();
  await screen.getByText('Richmond').tap();
  await expect(accessory).toContainText('Object to move-in report');
  for (const name of tabs) {
    await screen.getByRole('tab', { name }).tap();
    await expect(screen.getByText('Richmond')).toBeVisible();
    await expect(screen.getByText('Norfolk')).not.toBeVisible();
  }
  await screen.getByRole('tab', { name: 'Evidence' }).tap();
  await expect(screen.getByTestId('deadline.card.move_in_report')).not.toBeVisible();
  await expect(screen.getByText('No move-in photos yet')).toBeVisible();
});

test('cancelling Add Rental keeps the one rental', { platforms: ['ios'] }, async ({ app, device, screen }) => {
  await app.open();
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: iosLaunchArguments() });
  await screen.getByRole('button', { name: 'Rentals' }).tap();
  await screen.getByTestId('rentalSwitcher.add').tap();
  await expect(screen.getByText('Where do you rent?')).toBeVisible();
  await screen.getByRole('button', { name: 'Cancel' }).tap();
  await expect(screen.getByText('No lease yet')).toBeVisible();
  // With one rental there is no subtitle to name it.
  await expect(screen.getByText('Richmond')).not.toBeVisible();
});
