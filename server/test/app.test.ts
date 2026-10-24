import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { stubbedChecks } from '../src/health.js';

function setup(deps: Parameters<typeof createApp>[0] = {}) {
  const lines: Record<string, unknown>[] = [];
  const app = createApp({ logSink: (line) => lines.push(JSON.parse(line)), ...deps });
  return { app, lines };
}

describe('/healthz', () => {
  it('reports every dependency as stubbed', async () => {
    const { app } = setup();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      checks: { firestore: 'stubbed', gcs: 'stubbed', kms: 'stubbed' },
    });
  });

  it('returns 503 in the envelope when a dependency is unreachable', async () => {
    const { app } = setup({
      checks: { ...stubbedChecks, kms: async () => Promise.reject(new Error('down')) },
    });
    const res = await app.request('/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Unreachable: kms' },
    });
  });
});

describe('error envelope', () => {
  it('wraps unknown routes', async () => {
    const { app } = setup();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No route matches this request' } });
  });

  it('carries retryInMs from an ApiError', async () => {
    const { app } = setup();
    app.get('/limited', () => {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryInMs: 4000 });
    });
    const res = await app.request('/limited');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests', retryInMs: 4000 },
    });
  });

  it('hides the message of an unknown error from the client and the logs', async () => {
    const { app, lines } = setup();
    app.get('/boom', () => {
      throw new Error('tenant lease text');
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(JSON.stringify(lines)).not.toContain('tenant lease text');
  });
});

describe('request ids', () => {
  it('mints one per request and echoes it', async () => {
    const { app } = setup();
    const a = (await app.request('/healthz')).headers.get('x-request-id');
    const b = (await app.request('/healthz')).headers.get('x-request-id');
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).not.toBe(a);
  });

  it('honors a client-sent id', async () => {
    const { app } = setup();
    const res = await app.request('/healthz', { headers: { 'X-Request-Id': 'ios-abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('ios-abc-123');
  });

  it('puts the request id on every log line, errors included', async () => {
    const { app, lines } = setup();
    app.get('/limited', () => {
      throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Unreachable: gcs');
    });
    await app.request('/healthz', { headers: { 'X-Request-Id': 'req-1' } });
    await app.request('/nope', { headers: { 'X-Request-Id': 'req-2' } });
    await app.request('/limited', { headers: { 'X-Request-Id': 'req-3' } });
    expect(lines.length).toBe(4);
    expect(lines.map((l) => l.requestId)).toEqual(['req-1', 'req-2', 'req-3', 'req-3']);
    expect(lines[0]).toMatchObject({ severity: 'INFO', message: 'request', method: 'GET', route: '/healthz', status: 200 });
  });

  it('logs the route pattern, not the raw path', async () => {
    const { app, lines } = setup();
    app.get('/r/:token', (c) => c.text('ok'));
    await app.request('/r/secret-share-token?q=private');
    expect(lines[0]).toMatchObject({ route: '/r/:token' });
    expect(JSON.stringify(lines)).not.toContain('secret-share-token');
  });
});
