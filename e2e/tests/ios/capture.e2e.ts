import { expect } from 'e2e';
import { test } from './fixtures';

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
  const shown = (await hash.textContent())?.trim() ?? '';
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
  const first = (await screen.getByTestId('camera.hash').textContent())?.trim() ?? '';
  await screen.getByTestId('camera.retake').tap();

  // Retake returns to the viewfinder; the next shutter gives the next photo.
  await screen.getByTestId('camera.shutter').tap();
  const second = (await screen.getByTestId('camera.hash').textContent())?.trim() ?? '';

  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).toMatch(/^[0-9a-f]{64}$/);
  expect(second).not.toBe(first);
});
