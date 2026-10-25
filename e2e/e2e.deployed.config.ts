import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// Checks a server that deploy.sh put on Cloud Run. Nothing is started here:
// the target attaches to E2E_DEPLOYED_URL (the service URL deploy.sh prints).
//
//   E2E_DEPLOYED_URL=https://fineprint-....run.app npx e2e run --config e2e.deployed.config.ts
//
// The tests sign up a real anonymous user in the project's Identity Platform.
process.env.E2E_TELEMETRY_DISABLED ??= '1';

const url = process.env.E2E_DEPLOYED_URL;
if (!url) throw new Error('Set E2E_DEPLOYED_URL to the Cloud Run service URL deploy.sh printed.');

export default {
  tests: 'tests/deployed/**/*.e2e.ts',
  targets: [{ name: 'deployed', engine: web(), app: { url, readyUrl: new URL('/health', url).href } }],
} satisfies E2EConfig;
