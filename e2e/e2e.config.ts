import { join } from 'node:path';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { mobile } from '@e2e-dev/mobile';
import { mobileTools } from '@e2e-dev/mobile/tools';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Privacy stance (spec §12.1): no anonymous usage data from the e2e CLI.
// The package scripts set it too; this covers a bare `npx e2e`.
process.env.E2E_TELEMETRY_DISABLED ??= '1';

// The key comes from the environment: run with `op run --env-file ../.env --`
// or `../scripts/with-gemini-key.sh` (macOS Keychain).
// Tests without agent steps never call the model and need no key.
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

const server = join(import.meta.dirname, '..', 'server');

// The server process both targets boot, run inside the Firebase Auth
// emulator so /v1 accepts the app's anonymous tokens. emulators:exec sets
// FIREBASE_AUTH_EMULATOR_HOST and GCLOUD_PROJECT for the server, and the
// runner's SIGTERM stops both. Port, log, and emulator config differ per
// target: each target gets its own emulator port, so a run that starts both
// never collides (web 9099 in ../firebase.json, ios 9199 in firebase.ios.json).
const serverCommand = (port: string, log: string, firebaseConfig: string) => ({
  executable: join(server, 'node_modules', '.bin', 'firebase'),
  args: [
    'emulators:exec',
    '--config', firebaseConfig,
    '--only', 'auth',
    '--project', 'demo-fineprint',
    'node --import tsx src/index.ts',
  ],
  cwd: server,
  env: { PORT: port },
  log,
});

// A mobile target has no `url`, so its server gets a fixed port that the app
// learns from a launch argument. Override it when 18080 is taken.
const iosServerPort = process.env.E2E_IOS_SERVER_PORT ?? '18080';
const iosServerURL = `http://127.0.0.1:${iosServerPort}`;

// Two sessions on one simulator fight over it. A parallel session picks
// another with E2E_IOS_DEVICE (and E2E_IOS_SERVER_PORT above).
const iphone = mobile({ platform: 'ios', device: process.env.E2E_IOS_DEVICE ?? 'iPhone 17 Pro' });

export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        // Port 0: every run gets its own free port, so runs never collide
        // with a dev server you started by hand.
        url: 'http://127.0.0.1:0',
        readyUrl: 'http://127.0.0.1:{port}/healthz',
        command: serverCommand('{port}', '.e2e/logs/server.log', join(import.meta.dirname, '..', 'firebase.json')),
      },
    },
    {
      name: 'ios',
      engine: iphone,
      app: {
        bundleId: 'org.fineprint.FinePrint',
        // Built by `pnpm build:ios` (xcodebuild, Debug, simulator).
        appPath: join(import.meta.dirname, '..', 'ios', 'DerivedData', 'Build', 'Products', 'Debug-iphonesimulator', 'FinePrint.app'),
        // -FinePrintDeveloperMenu (DEBUG) skips the five-tap unlock, which
        // scripted taps are too slow for.
        launchArguments: ['-FinePrintServerURL', iosServerURL, '-FinePrintInMemoryStore', '-FinePrintDeveloperMenu'],
        readyUrl: `${iosServerURL}/healthz`,
        command: serverCommand(iosServerPort, '.e2e/logs/server-ios.log', join(import.meta.dirname, 'firebase.ios.json')),
      },
    },
  ],
  agents: {
    default: {
      model: google('gemini-flash-latest'),
      system: 'You are a thorough QA agent for FinePrint, a renter-rights app and its API. Verify every outcome against the screen or the response.',
      tools: mobileTools(iphone),
    },
  },
} satisfies E2EConfig;
