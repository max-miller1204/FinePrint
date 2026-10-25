import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test as base } from '@e2e-dev/mobile';
import { iosHangLog } from '../../ios-launch';

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

const crashReports = join(homedir(), 'Library', 'Logs', 'DiagnosticReports');

/** The hang log's lines written since `offset`, the file's size before the test. */
function hangLinesSince(offset: number): string[] {
  if (!existsSync(iosHangLog)) return [];
  return readFileSync(iosHangLog).subarray(offset).toString('utf8').split('\n').filter(Boolean);
}

/** The newest FinePrint crash report written at or after `since`, if any. */
function crashReportSince(since: number): string | undefined {
  if (!existsSync(crashReports)) return undefined;
  return readdirSync(crashReports)
    .filter((name) => name.startsWith('FinePrint') && name.endsWith('.ips'))
    .map((name) => join(crashReports, name))
    .filter((path) => statSync(path).mtimeMs >= since)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** `test` for iOS files: installs the build, then runs on the ios target only. */
export const test = base.extend<{ build: void; hangs: void }>({
  build: async ({ device }, use) => {
    installed ??= device.installApp().catch((error: unknown) => {
      installed = undefined;
      throw error;
    });
    await installed;
    await use();
  },
  // A frozen main thread used to show up only as driver timeouts ("snapshot
  // failed: Daemon request timed out"), which look like flaky tooling and got
  // rerun. The app's watchdog records the stall, so name it here instead.
  hangs: async (_fixtures, use) => {
    const offset = existsSync(iosHangLog) ? statSync(iosHangLog).size : 0;
    const startedAt = Date.now();
    await use();
    const lines = hangLinesSince(offset);
    const abort = lines.find((line) => line.includes(' abort '));
    if (abort) {
      const report = crashReportSince(startedAt) ?? `${crashReports}/FinePrint-*.ips`;
      throw new Error(`APP_HANG: ${abort}. The app stopped itself; the main thread's stack is in ${report}. Do not rerun: find what blocks the main thread on this screen.`);
    }
    const stall = lines.find((line) => line.includes(' hang '));
    if (stall) console.warn(`app stalled during this test (recovered): ${stall}`);
  },
});
