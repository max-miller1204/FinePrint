import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'e2e';

// Operator-facing eval CLI. HTTP lease behavior is covered by leases.e2e.ts
// in the same gating run. No fake model is presented as live parity evidence.
const evalDir = join(import.meta.dirname, '../../../eval');
const tsx = join(evalDir, 'node_modules/.bin/tsx');
test('parity dataset validates without model credentials', { platforms: ['web'] }, async () => {
  const { stdout } = await promisify(execFile)(tsx, ['runners/eval.ts', '--only', 'parity', '--check'], { cwd: evalDir });
  expect(stdout).toContain('20 cases x EN/ES/FR = 60 analyses');
  expect(stdout).toContain('live model NOT run');
});

test('live parity fails with setup exit 2 when the API key is missing', { platforms: ['web'] }, async () => {
  const env = { ...process.env, GEMINI_API_KEY: '', GEMMA_PROVIDER: 'gemini' };
  const result = await promisify(execFile)(tsx, ['runners/eval.ts', '--only', 'parity'], { cwd: evalDir, env }).then(
    () => ({ code: 0, stderr: '' }),
    (error: { code: number; stderr: string }) => error,
  );
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('GEMINI_API_KEY');
});
