import { join } from 'node:path';
import type { E2EConfig } from 'e2e';
import base from './e2e.config';
process.env.E2E_FIRESTORE_PORT ??= '18090';
process.env.E2E_AUTH_PORT ??= '19099';
const target = base.targets[0]!;
const command = target.app!.command as { executable: string; args: string[]; cwd: string; env: Record<string, string>; log: string; startupTimeout: number };
export default {
  ...base,
  tests: ['tests/web/smoke.e2e.ts', 'tests/web/ask.e2e.ts', 'tests/web/auth.e2e.ts', 'tests/web/rentals.e2e.ts', 'tests/web/triage.e2e.ts'],
  targets: [{ ...target, app: { ...target.app, command: { ...command, args: [...command.args.slice(0, -1).map(arg => arg.endsWith('/firebase.json') ? join(import.meta.dirname, '..', 'firebase.ask.json') : arg), `node --import tsx ${join(import.meta.dirname, 'ask-fixture-server.ts')}`], inheritEnv: [] } } }],
} satisfies E2EConfig;
