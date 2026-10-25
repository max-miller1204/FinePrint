import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'e2e';

// A real HTTP server with a scripted model and in-memory storage. The rest of
// the web suite covers the deployed entry point with Firebase emulators.
test('packed S5 maps the synthetic lease once and persists its verified finding', { platforms: ['web'] }, async ({ app }) => {
  expect((await fetch(new URL('/healthz', app.baseUrl))).status).toBe(200);
  const serverDir = join(import.meta.dirname, '../../../server');
  const child = fork(join(serverDir, 'test/fixtures/packed-server.ts'), [], {
    cwd: serverDir, execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  try {
    const ready = await Promise.race([
      once(child, 'message').then(([message]) => message as { port: number }),
      once(child, 'exit').then(([code]) => { throw new Error(`batching fixture exited ${code}`); }),
    ]);
    const baseUrl = `http://127.0.0.1:${ready.port}`;
    const call = (method: string, path: string, body?: unknown) => fetch(new URL(path, baseUrl), {
      method, headers: { Authorization: 'Bearer batch-proof', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const rental = await call('POST', '/v1/rentals', { jurisdiction: 'VA', city: 'Richmond', occupancyDate: '2026-11-01', tenancyEndDate: '2027-10-31' });
    expect(rental.status).toBe(201);
    const { id } = await rental.json();
    const text = readFileSync(join(serverDir, 'test/fixtures/lease-synthetic.txt'), 'utf8');
    const uploaded = await call('POST', `/v1/rentals/${id}/leases`, { text, locale: 'en' });
    expect(uploaded.status).toBe(201);
    const { leaseId, stream } = await uploaded.json();
    const response = await call('GET', stream);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    const events = (await response.text()).split('\n\n').filter((block) => block.startsWith('event:')).map((block) => {
      const lines = block.split('\n');
      return { event: lines.find((s) => s.startsWith('event: '))!.slice(7), data: JSON.parse(lines.find((s) => s.startsWith('data: '))!.slice(6)) };
    });
    expect(events.filter((e) => e.event === 'error')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'analyzed' } });
    const stored = await call('GET', `/v1/rentals/${id}/leases/${leaseId}`);
    expect(stored.status).toBe(200);
    const lease = await stored.json();
    expect(lease.clauses).toHaveLength(31);
    expect(lease.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'VA_NO_CONFESSION_OF_JUDGMENT', severity: 'unenforceable', verifier: expect.objectContaining({ model: 'gemma-4-31b-it', verdict: 'agree' }) })]));
    const requests = await (await fetch(new URL('/batch-proof/requests', baseUrl))).json();
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('gemma-4-26b-a4b-it');
    expect(requests[0].ids).toHaveLength(lease.clauses.length);
    expect(new Set(requests[0].ids).size).toBe(lease.clauses.length);
    expect(requests[0].ids.every((id: string) => /^mapping_[A-Z]{2}$/.test(id))).toBe(true);
    expect(lease.clauses.every((c: { id: string }) => /^c[0-9]+$/.test(c.id))).toBe(true);
    expect(requests[0].inputTokens).toBeLessThanOrEqual(12_000);
    expect(requests[0].outputCap).toBe(31 * 400);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  }
});
