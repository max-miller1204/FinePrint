import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'e2e';
import { test } from './fixtures';

// `camera.hash` is one accessibility element, "SHA-256 fingerprint, <hash>".
const hashIn = (text: string | null | undefined) => /[0-9a-f]{64}/.exec(text ?? '')?.[0] ?? '';

// The DEBUG fixture camera (#22) stands in for the camera hardware: the
// config passes -FinePrintFixtureCamera <e2e/fixtures/photos/move-in>, so the
// shutter returns the next fixture photo and everything after it (GPS removal,
// SHA-256, capture record, quality gate, review) is the real pipeline.
// ios/FinePrintTests/FixtureCameraTests.swift covers the same pipeline in unit
// tests. camera.e2e.ts relaunches without the argument for the no-camera state.

test('a fixture photo is captured, hashed, and kept', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();

  const openCamera = screen.getByTestId('developer.openCamera');
  await screen.scrollUntilVisible(openCamera);
  await openCamera.tap();

  // The fixture camera is ready at once; there is no "Camera not available".
  await expect(screen.getByTestId('camera.shutter')).toBeVisible();
  await screen.getByTestId('camera.shutter').tap();

  // Review shows the SHA-256 of the stored file: 64 lowercase hex characters.
  const hash = screen.getByTestId('camera.hash');
  await expect(hash).toBeVisible();
  const shown = hashIn(await hash.textContent());
  expect(shown).toMatch(/^[0-9a-f]{64}$/);

  // The quality gate may ask for a retake of a fixture; the tenant can keep it.
  const use = screen.getByTestId('camera.use');
  if (await use.isVisible()) {
    await use.tap();
  } else {
    await screen.getByTestId('camera.keep').tap();
  }

  // Back in Developer Options, the last kept photo has the same hash.
  const last = screen.getByTestId('developer.lastCaptureHash');
  await screen.scrollUntilVisible(last);
  await expect(last).toContainText(shown);
});

test('the shutter takes the fixture photos in order', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();

  const openCamera = screen.getByTestId('developer.openCamera');
  await screen.scrollUntilVisible(openCamera);
  await openCamera.tap();

  await screen.getByTestId('camera.shutter').tap();
  const first = hashIn(await screen.getByTestId('camera.hash').textContent());
  await screen.getByTestId('camera.retake').tap();

  // Retake returns to the viewfinder; the next shutter gives the next photo.
  await screen.getByTestId('camera.shutter').tap();
  const second = hashIn(await screen.getByTestId('camera.hash').textContent());

  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).toMatch(/^[0-9a-f]{64}$/);
  expect(second).not.toBe(first);
});

// The upload queue (#23): a photo kept offline waits on the device, then
// uploads once the app is back online, and the server checks its SHA-256
// before recording it. The simulator has no airplane mode, so the DEBUG
// Simulate Offline toggle in Developer Options stands in for it.
const serverLog = join(import.meta.dirname, '..', '..', '.e2e', 'logs', 'server-ios.log');
const logLines = (message: string) => {
  try {
    return readFileSync(serverLog, 'utf8').split('\n').filter((line) => line.includes(`"message":"${message}"`)).length;
  } catch {
    return 0;
  }
};

test('a photo kept offline uploads after reconnect and the server checks its hash', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  const issued = logLines('evidence upload urls issued');
  const received = logLines('evidence received');

  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();
  const offline = screen.getByTestId('developer.simulateOfflineToggle');
  await screen.scrollUntilVisible(offline);
  await offline.tap();
  await expect(offline).toBeChecked();

  const openCamera = screen.getByTestId('developer.openCamera');
  await screen.scrollUntilVisible(openCamera);
  await openCamera.tap();
  await screen.getByTestId('camera.shutter').tap();
  await expect(screen.getByTestId('camera.sealStatus')).toContainText('Waiting to seal');
  const use = screen.getByTestId('camera.use');
  if (await use.isVisible()) {
    await use.tap();
  } else {
    await screen.getByTestId('camera.keep').tap();
  }

  // Offline: the photo waits on the device and the server has not been asked.
  const status = screen.getByTestId('developer.sealStatus');
  const waiting = screen.getByTestId('developer.uploadQueueCount');
  await screen.scrollUntilVisible(status);
  await expect(status).toContainText('Waiting to seal');
  await screen.scrollUntilVisible(waiting);
  await expect(waiting).toContainText('1');
  expect(logLines('evidence upload urls issued')).toBe(issued);

  // Back online counts as a reconnect: the queue uploads and the server checks the hash.
  await screen.scrollUntilVisible(offline);
  await offline.tap();
  await expect(offline).toBeChecked({ checked: false });
  await screen.scrollUntilVisible(status);
  await expect(status).toContainText('Uploaded, waiting to seal', { timeout: 30_000 });
  await screen.scrollUntilVisible(waiting);
  await expect(waiting).toContainText('0');
  await expect.poll(() => logLines('evidence received'), { timeout: 15_000 }).toBe(received + 1);
  expect(logLines('evidence upload urls issued')).toBe(issued + 1);
});
