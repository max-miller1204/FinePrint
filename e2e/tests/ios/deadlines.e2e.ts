import { expect } from 'e2e';
import { iosBundleId, iosLaunchArguments } from '../../ios-launch';
import { acceptAlertIfShown, reinstall, test } from './fixtures';

// Real deadlines, seeded at launch by the DEBUG-only
// `-FinePrintSeedDeadline move_in_report|objection|deposit_itemization`,
// which starts that clock today on a new rental, the way onboarding seeds
// one: it never asks for notification permission. The sample deadline is
// covered by app-shell.e2e.ts. Day math, DST, reminder times, and seeding
// per phase are covered by ios/FinePrintTests/DeadlineStoreTests.swift.

// A relaunch's arguments replace the target's, so start from the defaults.
const baseArguments = iosLaunchArguments();

const seeded = (kind: string) => [...baseArguments, '-FinePrintSeedDeadline', kind];

test('a seeded deadline shows in the accessory without asking for permission', { platforms: ['ios'] }, async ({ device, screen }) => {
  // A fresh install has never been asked, so a prompt from seeding would show here.
  await reinstall(device);
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: seeded('move_in_report') });

  const accessory = screen.getByTestId('deadlineAccessory');
  await expect(accessory).toContainText("Landlord's move-in report due");
  await expect(accessory).toContainText('5 days left');

  await accessory.tap();
  await expect(screen.getByRole('tab', { name: 'Evidence' })).toBeSelected();
  await expect(screen.getByTestId('deadline.card.move_in_report')).toBeVisible();
  // Not asked yet: Remind Me is offered, so seeding did not show the prompt.
  await expect(screen.getByTestId('deadline.remindMe')).toBeVisible();
});

test('Remind Me asks in context, and once allowed the card lists the 9 a.m. reminders', { platforms: ['ios'] }, async ({ device, screen }) => {
  await reinstall(device);
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: seeded('move_in_report') });
  await screen.getByTestId('deadlineAccessory').tap();
  await screen.getByTestId('deadline.remindMe').tap();
  await device.alert('accept');
  await expect(screen.getByTestId('deadline.remindersOn')).toContainText('9 a.m.');
  await expect(screen.getByTestId('deadline.remindMe')).not.toBeVisible();
});

test("recording the landlord's report starts the 5-day objection clock", { platforms: ['ios'] }, async ({ device, screen }) => {
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: seeded('move_in_report') });
  await screen.getByTestId('deadlineAccessory').tap();
  await screen.getByTestId('deadline.reportReceived').tap();
  await screen.getByTestId('dayEntry.save').tap();
  // Starting a clock from an in-app action may ask for notifications, in context.
  await acceptAlertIfShown(device);

  await expect(screen.getByTestId('deadline.card.objection')).toBeVisible();
  await expect(screen.getByTestId('deadline.card.move_in_report')).not.toBeVisible();
  const accessory = screen.getByTestId('deadlineAccessory');
  await expect(accessory).toContainText('Object to move-in report');
  await expect(accessory).toContainText('5 days left');
});

test('the deposit tracker reminds about the forwarding address and the inspection', { platforms: ['ios'] }, async ({ device, screen }) => {
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: seeded('deposit_itemization') });

  const accessory = screen.getByTestId('deadlineAccessory');
  await expect(accessory).toContainText('Deposit itemization due');
  await expect(accessory).toContainText('45 days left');

  await accessory.tap();
  await expect(screen.getByRole('tab', { name: 'Evidence' })).toBeSelected();
  await expect(screen.getByTestId('deadline.card.deposit_itemization')).toBeVisible();
  await expect(screen.getByTestId('deposit.forwardingAddress')).toContainText('forwarding address in writing');
  await expect(screen.getByTestId('deposit.inspection')).toContainText('move-out inspection');
});

test('the accessory hides when nothing is due', { platforms: ['ios'] }, async ({ device, screen }) => {
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: [...baseArguments, '-FinePrintDeadlineStub', 'empty'] });
  await expect(screen.getByRole('tab', { name: 'Lease' })).toBeVisible();
  await expect(screen.getByTestId('deadlineAccessory')).not.toBeVisible();
});
