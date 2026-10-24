import { expect } from 'e2e';
import { test } from './fixtures';

// Simulators have no camera, so this drives the entry point and the
// no-camera state. Capture, hashing, the capture record, GPS removal, and the
// quality gate are covered by ios/FinePrintTests/CaptureTests.swift; the
// DEBUG fixture camera (#22) will drive a real capture here.

test('the camera opens from Developer Options and explains a missing camera', { platforms: ['ios'] }, async ({ app, screen }) => {
  await app.open();
  await screen.getByTestId('settingsButton').tap();
  await screen.getByTestId('settings.developerOptions').tap();

  const openCamera = screen.getByTestId('developer.openCamera');
  await screen.scrollUntilVisible(openCamera);
  await openCamera.tap();

  await expect(screen.getByText('Camera not available')).toBeVisible();
  await expect(screen.getByTestId('camera.close')).toBeVisible();

  await screen.getByTestId('camera.close').tap();
  await expect(screen.getByTestId('developer.openCamera')).toBeVisible();
});
