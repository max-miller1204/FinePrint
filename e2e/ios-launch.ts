import { join } from 'node:path';

// The iOS app's launch arguments, shared by e2e.config.ts (every fresh launch)
// and by tests that relaunch with a different set through `device.openApp`,
// whose `launchArguments` replace the target's for that launch.

// A mobile target has no `url`, so its server gets a fixed port that the app
// learns from a launch argument. Override it when 18080 is taken.
export const iosServerPort = process.env.E2E_IOS_SERVER_PORT ?? '18080';
export const iosServerURL = `http://127.0.0.1:${iosServerPort}`;
export const iosBundleId = 'org.fineprint.FinePrint';

const defaults: string[][] = [
  ['-FinePrintServerURL', iosServerURL],
  ['-FinePrintInMemoryStore'],
  // DEBUG: skips the five-tap unlock, which scripted taps are too slow for.
  ['-FinePrintDeveloperMenu'],
  // DEBUG: starts at the tabs with a default Virginia rental.
  // onboarding.e2e.ts relaunches without it.
  ['-FinePrintSkipOnboarding'],
  // DEBUG: feeds these photos through the capture pipeline in place of the
  // camera, which simulators lack (spec §12.1). The simulator reads the host
  // path directly, so nothing is copied into the app. camera.e2e.ts relaunches
  // without it to reach the no-camera state.
  ['-FinePrintFixtureCamera', join(import.meta.dirname, 'fixtures', 'photos', 'move-in')],
];

/** The default launch arguments, minus each flag in `without` and its value. */
export function iosLaunchArguments({ without = [] }: { without?: string[] } = {}): string[] {
  return defaults.filter(([flag]) => !without.includes(flag)).flat();
}
