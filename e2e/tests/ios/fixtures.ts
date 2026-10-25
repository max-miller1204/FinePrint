import { test as base } from '@e2e-dev/mobile';

// The engine installs nothing on its own. Each worker drives one simulator,
// so installing once per worker puts this run's Debug build on every device
// before its first test, and a stale copy never answers for the branch.
let installed: Promise<unknown> | undefined;

/**
 * Removes and reinstalls the build, so notification permission is back to "not asked". This
 * simulator runtime cannot reset or grant it through `permissions` (simctl privacy).
 */
export async function reinstall(device: { installApp(appPath?: string, options?: { reinstall?: boolean }): Promise<unknown> }) {
  await device.installApp(undefined, { reinstall: true });
}

/** Accepts the system alert if one is up, such as the notification prompt. */
export async function acceptAlertIfShown(device: { alert(action: 'accept' | 'dismiss'): Promise<void> }) {
  try {
    await device.alert('accept');
  } catch {
    // No alert.
  }
}

/** `test` for iOS files: installs the build, then runs on the ios target only. */
export const test = base.extend<{ build: void }>({
  build: async ({ device }, use) => {
    installed ??= device.installApp().catch((error: unknown) => {
      installed = undefined;
      throw error;
    });
    await installed;
    await use();
  },
});
