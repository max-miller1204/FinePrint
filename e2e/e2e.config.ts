import { join } from 'node:path';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const server = join(import.meta.dirname, '..', 'server');

export default {
  tests: 'tests/web/**/*.e2e.ts',
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        // Port 0: every run gets its own free port, so runs never collide
        // with a dev server you started by hand.
        url: 'http://127.0.0.1:0',
        readyUrl: 'http://127.0.0.1:{port}/healthz',
        command: {
          executable: 'node',
          args: ['--import', 'tsx', 'src/index.ts'],
          cwd: server,
          env: { PORT: '{port}' },
          log: '.e2e/logs/server.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
