import { expect } from 'e2e';
import { test } from './fixtures';

// Doctor: the app launches into the tab shell.
test('the app opens on the tab shell', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  for (const name of ['Lease', 'Evidence', 'Repairs', 'Letters', 'Ask']) {
    await expect(screen.getByRole('tab', { name })).toBeVisible();
  }
  await expect(screen.getByText('No lease yet')).toBeVisible();
});
