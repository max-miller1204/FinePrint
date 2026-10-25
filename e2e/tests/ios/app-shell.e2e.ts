import { expect } from 'e2e';
import { test } from './fixtures';

// DEBUG builds show the sample deadline unless `-FinePrintDeadlineStub empty`.
test('the deadline accessory opens Evidence', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  const accessory = screen.getByTestId('deadlineAccessory');
  await expect(accessory).toContainText('Object to move-in report');
  // A tap right after launch can be lost while the tabs settle: tap again until Evidence opens.
  const evidence = screen.getByRole('tab', { name: 'Evidence' });
  for (let attempt = 0; attempt < 3; attempt++) {
    await accessory.tap();
    try {
      await expect(evidence).toBeSelected({ timeout: 4_000 });
      break;
    } catch {
      // Still on Lease: tap again.
    }
  }
  await expect(evidence).toBeSelected();
  await expect(screen.getByText('No move-in photos yet')).toBeVisible();
});

test('Settings opens from the gear and closes', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('settingsButton').tap();
  await expect(screen.getByTestId('settings.version')).toBeVisible();
  await screen.getByTestId('settings.close').tap();
  await expect(screen.getByTestId('settings.version')).not.toBeVisible();
  await expect(screen.getByRole('tab', { name: 'Lease' })).toBeVisible();
});
