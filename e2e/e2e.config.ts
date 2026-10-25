import { join } from 'node:path';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { mobile } from '@e2e-dev/mobile';
import { mobileTools } from '@e2e-dev/mobile/tools';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { iosLaunchArguments, iosServerPort, iosServerURL } from './ios-launch';

// Privacy stance (spec §12.1): no anonymous usage data from the e2e CLI.
// The package scripts set it too; this covers a bare `npx e2e`.
process.env.E2E_TELEMETRY_DISABLED ??= '1';

// The key comes from the environment: run with `op run --env-file ../.env --`
// or `../scripts/with-gemini-key.sh` (macOS Keychain).
// Tests without agent steps never call the model and need no key.
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

const server = join(import.meta.dirname, '..', 'server');

// The server process both targets boot, run inside the Firebase emulators
// so /v1 accepts the app's anonymous tokens. emulators:exec sets
// FIREBASE_AUTH_EMULATOR_HOST (and the Firestore and Storage hosts when it
// runs those) and GCLOUD_PROJECT for the server, and the runner's SIGTERM
// stops both. Port, log, and emulator config differ per target: each target
// gets its own emulator ports, so a run that starts both never collides (web
// in ../firebase.json; ios in ../firebase.ios.json: auth 9199, Firestore 8190,
// Storage 9290). Both run Firestore and Storage, since the app uploads
// evidence. Under the Storage emulator the server hands out emulator upload
// URLs on 127.0.0.1, which the simulator reaches directly (server/src/storage/gcs.ts).
const serverCommand = (port: string, log: string, firebaseConfig: string, emulators: string) => ({
  executable: join(server, 'node_modules', '.bin', 'firebase'),
  args: [
    'emulators:exec',
    '--config', firebaseConfig,
    '--only', emulators,
    '--project', 'demo-fineprint',
    'node --import tsx src/index.ts',
  ],
  cwd: server,
  env: { PORT: port },
  // Only set under `op run`: then triage asks Gemma as well as the keyword
  // backstop. Without a key the server runs the backstop alone.
  inheritEnv: ['GEMINI_API_KEY', 'GEMMA_*'],
  log,
  // The Firestore and Storage emulators are JVMs; on an 8 GB Mac they can
  // take over a minute to start, past the 60 s default.
  startupTimeout: 180_000,
});

// Two sessions on one simulator fight over it. A parallel session picks
// another with E2E_IOS_DEVICE (and E2E_IOS_SERVER_PORT above).
const iphone = mobile({ platform: 'ios', device: process.env.E2E_IOS_DEVICE ?? 'iPhone 17 Pro' });

export default {
  // tests/deployed runs against Cloud Run through e2e.deployed.config.ts.
  tests: ['tests/**/*.e2e.ts', '!tests/deployed/**', '!tests/web/ask.e2e.ts'],
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        // Port 0: every run gets its own free port, so runs never collide
        // with a dev server you started by hand.
        url: 'http://127.0.0.1:0',
        readyUrl: 'http://127.0.0.1:{port}/healthz',
        command: serverCommand('{port}', '.e2e/logs/server.log', join(import.meta.dirname, '..', 'firebase.json'), 'auth,firestore,storage'),
      },
    },
    {
      name: 'ios',
      engine: iphone,
      app: {
        bundleId: 'org.fineprint.FinePrint',
        // Built by `pnpm build:ios` (xcodebuild, Debug, simulator).
        appPath: join(import.meta.dirname, '..', 'ios', 'DerivedData', 'Build', 'Products', 'Debug-iphonesimulator', 'FinePrint.app'),
        // See ios-launch.ts for what each argument does.
        launchArguments: iosLaunchArguments(),
        readyUrl: `${iosServerURL}/healthz`,
        command: serverCommand(iosServerPort, '.e2e/logs/server-ios.log', join(import.meta.dirname, '..', 'firebase.ios.json'), 'auth,firestore,storage'),
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
