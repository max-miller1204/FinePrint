import { describe, expect, test } from 'e2e';

describe('error envelope and request ids', { platforms: ['web'] }, () => {
  test('an unknown route answers 404 in the envelope', async ({ app }) => {
    const res = await fetch(new URL('/does-not-exist', app.baseUrl));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route matches this request' },
    });
  });

  test('every response carries a fresh request id', async ({ app }) => {
    const first = await fetch(new URL('/healthz', app.baseUrl));
    const second = await fetch(new URL('/nope', app.baseUrl));
    const a = first.headers.get('x-request-id');
    const b = second.headers.get('x-request-id');
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).not.toBe(a);
  });

  test('a client-sent request id is echoed back', async ({ app }) => {
    const res = await fetch(new URL('/healthz', app.baseUrl), { headers: { 'X-Request-Id': 'ios-e2e-42' } });
    expect(res.headers.get('x-request-id')).toBe('ios-e2e-42');
  });
});
