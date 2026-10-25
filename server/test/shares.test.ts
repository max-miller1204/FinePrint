import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { capability, hashPin, reportOrigin, tokenHash } from '../src/shares/security.js';
import type { Share, Shares } from '../src/shares/store.js';

// Model Cloud Run's HTTP socket behind TLS without a real deployment.
describe('share transport security', () => {
  it('requires HTTPS outside the emulator lane', () => {
    expect(reportOrigin('http://service.run.app/r/token', false)).toBe('https://service.run.app');
    expect(reportOrigin('http://127.0.0.1:8080/r/token', true)).toBe('http://127.0.0.1:8080');
  });
  it('sets a Secure cookie behind TLS termination and rejects a foreign Origin', async () => {
    const token = capability();
    const share: Share = { id: tokenHash(token), rentalId: 'rental', scope: ['evidence'], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), revokedAt: null, pinHash: await hashPin('123456') };
    const grants: string[] = [];
    const shares = {
      get: async () => share,
      attempt: async () => true,
      grant: async (_id: string, hash: string) => { grants.push(hash); },
    } as unknown as Shares;
    const app = createApp({ shares, logSink: () => {} });
    const post = (origin: string) => app.request(`http://service.run.app/r/${token}`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'pin=123456',
    });
    expect((await post('https://foreign.example')).status).toBe(403);
    const res = await post('https://service.run.app');
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toContain('; Secure');
    expect(res.headers.get('set-cookie')).toContain('; HttpOnly');
    expect(res.headers.get('location')).toBe(`/r/${token}`);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});
