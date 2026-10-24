import { expect } from 'e2e';
import { test } from './fixtures';

// The ios target runs its server under the Auth emulator and launches with
// -FinePrintInMemoryStore, so every launch is a first launch: the app signs
// up a new anonymous account with no input. -FinePrintDeveloperMenu shows the
// Developer section, where the sign-in is visible and can be checked.

test('the app signs in anonymously and the server accepts the token', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();

  await expect(screen.getByTestId('developer.authStatus')).toContainText('Signed in anonymously', { timeout: 15_000 });
  await expect(screen.getByTestId('developer.userID')).toBeVisible();

  const check = screen.getByTestId('developer.checkServer');
  await screen.scrollUntilVisible(check);
  await check.tap();
  await expect(screen.getByTestId('developer.serverCheckResult')).toContainText('The server accepted this sign-in.', { timeout: 15_000 });
});
