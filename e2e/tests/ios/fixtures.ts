import { test as base } from '@e2e-dev/mobile';

// The engine installs nothing on its own. Each worker drives one simulator,
// so installing once per worker puts this run's Debug build on every device
// before its first test, and a stale copy never answers for the branch.
let installed: Promise<unknown> | undefined;

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
