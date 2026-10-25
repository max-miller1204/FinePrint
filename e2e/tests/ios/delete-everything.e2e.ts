import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from './fixtures';

// Settings > Delete Everything (#44, spec §9.2). The ios target runs its
// server inside the Auth, Firestore, and Storage emulators (firebase.ios.json),
// so the test reads what is left on the server straight from them, with the
// emulators' admin token. Server-side coverage with exact data is in
// server/test/emulator/delete-purge.test.ts.

const project = 'demo-fineprint';
const admin = { Authorization: 'Bearer owner' };
const firestore = `http://127.0.0.1:8190/v1/projects/${project}/databases/(default)/documents`;
const accounts = `http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=500`;
const photos = `http://127.0.0.1:9290/storage/v1/b/${project}-evidence/o?prefix=rentals/`;

const rentalDocs = async () => ((await (await fetch(`${firestore}/rentals?pageSize=300`, { headers: admin })).json()) as { documents?: unknown[] }).documents?.length ?? 0;
const userDocs = async () => ((await (await fetch(`${firestore}/users?pageSize=300`, { headers: admin })).json()) as { documents?: unknown[] }).documents?.length ?? 0;
const authUsers = async () => ((await (await fetch(accounts, { headers: admin })).json()) as { users?: unknown[] }).users?.length ?? 0;
const photoObjects = async () => ((await (await fetch(photos)).json()) as { items?: unknown[] }).items?.length ?? 0;

const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const logLines = (message: string) => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes(`"message":"${message}"`));
  } catch {
    return [];
  }
};

test('Delete Everything shows a receipt and leaves nothing on the server', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  // The default Richmond rental is created on the server right after launch.
  await expect.poll(rentalDocs, { timeout: 30_000 }).toBeGreaterThan(0);
  const rentals = await rentalDocs();
  const users = await userDocs();
  const signedUp = await authUsers();
  const deleted = logLines('deleted everything').length;

  const deleteRow = screen.getByTestId('settings.deleteEverything');
  // The first tap right after launch can land before the sheet is ready to open; tap again if it did.
  for (const attempt of [1, 2, 3]) {
    await screen.getByTestId('settingsButton').tap();
    try {
      await expect(deleteRow).toBeVisible({ timeout: 6_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await deleteRow.tap();
  // Nothing is deleted until the tenant confirms.
  await expect(screen.getByText('Delete everything?')).toBeVisible();
  expect(await rentalDocs()).toBe(rentals);
  await screen.getByTestId('settings.deleteEverything.confirm').first().tap();

  // The receipt replaces the tabs: what the server and this device removed.
  await expect(screen.getByTestId('deletion.receipt.title')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('Everything deleted')).toBeVisible();
  await expect(screen.getByTestId('deletion.receipt.server')).toBeVisible();
  await expect(screen.getByTestId('deletion.receipt.device')).toBeVisible();
  await expect(screen.getByRole('tab', { name: 'Lease' })).not.toBeVisible();

  // The server removed this user's rental, user record, and Firebase account, and logged it once.
  await expect.poll(rentalDocs).toBe(rentals - 1);
  expect(await userDocs()).toBe(users - 1);
  expect(await authUsers()).toBe(signedUp - 1);
  const lines = logLines('deleted everything');
  expect(lines).toHaveLength(deleted + 1);
  expect(lines.at(-1)).toContain('"rentals":1');

  // Start Over leaves the receipt behind.
  await screen.getByTestId('deletion.receipt.done').tap();
  await expect(screen.getByTestId('deletion.receipt.title')).not.toBeVisible();
});

test('Delete Everything removes an uploaded photo from the server and the device', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await expect.poll(rentalDocs, { timeout: 30_000 }).toBeGreaterThan(0);
  const received = logLines('evidence received').length;
  const stored = await photoObjects();

  // Keep one fixture photo; the queue uploads it and the server checks its hash.
  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();
  const openCamera = screen.getByTestId('developer.openCamera');
  await screen.scrollUntilVisible(openCamera);
  await openCamera.tap();
  await screen.getByTestId('camera.shutter').tap();
  await expect(screen.getByTestId('camera.hash')).toBeVisible();
  const use = screen.getByTestId('camera.use');
  if (await use.isVisible()) {
    await use.tap();
  } else {
    await screen.getByTestId('camera.keep').tap();
  }
  await expect.poll(() => logLines('evidence received').length, { timeout: 30_000 }).toBe(received + 1);
  await expect.poll(photoObjects, { timeout: 15_000 }).toBe(stored + 1);

  // Back to Settings, then delete.
  await screen.getByRole('button', { name: 'Settings' }).first().tap();
  const deleteRow = screen.getByTestId('settings.deleteEverything');
  await expect(deleteRow).toBeVisible({ timeout: 15_000 });
  await deleteRow.tap();
  await screen.getByTestId('settings.deleteEverything.confirm').first().tap();
  await expect(screen.getByTestId('deletion.receipt.title')).toBeVisible({ timeout: 30_000 });

  // The photo's bytes are gone from Cloud Storage, and the receipt counted it.
  await expect.poll(photoObjects).toBe(stored);
  expect(logLines('deleted everything').at(-1)).toContain('"evidenceItems":1');
});
