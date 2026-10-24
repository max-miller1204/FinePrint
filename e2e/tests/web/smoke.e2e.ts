import { expect, test } from 'e2e';

// Doctor: the server boots and answers its health route.
test('the server is up', { platforms: ['web'] }, async ({ app }) => {
  const res = await fetch(new URL('/healthz', app.baseUrl));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok' });
});
