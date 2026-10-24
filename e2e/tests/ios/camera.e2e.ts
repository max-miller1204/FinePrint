import { expect } from 'e2e';
import { iosBundleId, iosLaunchArguments } from '../../ios-launch';
import { test } from './fixtures';

// Simulators have no camera, so this drives the entry point and the
// no-camera state. That state exists only without the DEBUG fixture camera
// (#22), so the test relaunches without -FinePrintFixtureCamera.
// capture.e2e.ts drives a real capture through the fixture camera, and
// ios/FinePrintTests/CaptureTests.swift covers hashing, the capture record,
// GPS removal, and the quality gate.

test('the camera opens from Developer Options and explains a missing camera', { platforms: ['ios'] }, async ({ app, screen, device }) => {
  await app.open();
  await device.openApp(iosBundleId, { relaunch: true, launchArguments: iosLaunchArguments({ without: ['-FinePrintFixtureCamera'] }) });
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
