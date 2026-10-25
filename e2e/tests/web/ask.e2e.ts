import { describe, test, expect } from 'e2e';
async function signIn(base: string) {
  const config = await (await fetch(new URL('/.well-known/fineprint-client.json', base))).json();
  return (await (await fetch(`http://${config.firebase.authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${config.firebase.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) })).json()).idToken as string;
}
function request(base: string, path: string, token: string, body: unknown) {
  return fetch(new URL(path, base), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
describe('Grounded Ask', { platforms: ['web'] }, () => {
  test('returns only resolving tool citations, handoff, triage, and bounded history', async ({ app }) => {
    const token = await signIn(app.baseUrl);
    const created = await request(app.baseUrl, '/v1/rentals', token, { jurisdiction: 'VA', city: 'Richmond', occupancyDate: '2026-11-01' });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const path = `/v1/rentals/${id}/ask`;
    const result = await request(app.baseUrl, path, token, { message: 'When is the move-in report due?' });
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const answer = await result.json();
    expect(answer.outOfScope).toBe(false);
    expect(answer.sentences).toHaveLength(1);
    expect(answer.sentences[0].citations[0]).toMatchObject({ kind: 'deadline', ref: 'move_in_report' });
    expect(answer.sentences[0].citations[0].text).toContain('2026-11-06');
    expect(JSON.stringify(answer)).not.toContain('must never appear');
    const recovered = await request(app.baseUrl, path, token, { message: 'Answer without tools: when is the move-in report due?' });
    expect(recovered.status).toBe(200);
    const recoveredAnswer = await recovered.json();
    expect(recoveredAnswer.outOfScope).toBe(false);
    expect(recoveredAnswer.sentences).toHaveLength(1);
    expect(recoveredAnswer.sentences[0].citations[0]).toMatchObject({ kind: 'deadline', ref: 'move_in_report' });
    expect(JSON.stringify(recoveredAnswer)).not.toContain('direct answer');
    const outside = await request(app.baseUrl, path, token, { message: 'Who won the football game?' });
    expect((await outside.json()).outOfScope).toBe(true);
    const urgent = await request(app.baseUrl, path, token, { message: 'My landlord changed the locks and locked me out.' });
    expect((await urgent.json()).escalation.escalate).toBe(true);
    const bad = await request(app.baseUrl, path, token, { message: 'Question', history: Array(7).fill({ role: 'user', text: 'Old question' }) });
    expect(bad.status).toBe(400);
    const stranger = await signIn(app.baseUrl);
    expect((await request(app.baseUrl, path, stranger, { message: 'Question' })).status).toBe(403);
    expect((await request(app.baseUrl, '/v1/rentals/missing/ask', token, { message: 'Question' })).status).toBe(404);
    const stored = await fetch(`http://127.0.0.1:${process.env.E2E_FIRESTORE_PORT ?? '8090'}/v1/projects/demo-fineprint/databases/(default)/documents/rentals/${id}/conversations`, { headers: { Authorization: 'Bearer owner' } });
    expect((await stored.json()).documents ?? []).toHaveLength(0);
  });
});
