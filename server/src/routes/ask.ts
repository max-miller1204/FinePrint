import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AskInput, citationGate, groundedAsk, rentalTools, resources } from '../ai/ask.js';
import { GemmaOutputError, GemmaRequestError, GemmaUnavailableError } from '../ai/gemma.js';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import type { LeaseAnalyzer } from './leases.js';
import { guard, readBody } from './rentals.js';

export function createAsk(store: Store, { gemma, triage, packs }: LeaseAnalyzer) {
  const route = new Hono<AuthEnv>();
  route.use('/:id/ask', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'); } }));
  route.post('/:id/ask', async c => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isDocumentId(id)) throw new ApiError(404, 'NOT_FOUND', 'No such rental');
    const rental = await guard(store.getRental(id));
    if (!rental) throw new ApiError(404, 'NOT_FOUND', 'No such rental');
    if (rental.ownerUid !== c.get('user').uid) throw new ApiError(403, 'FORBIDDEN', 'This rental belongs to another user');
    const input = await readBody(c, AskInput);
    const decision = await triage.check({ source: 'ask', text: [...input.history.filter(t => t.role === 'user').map(t => t.text), input.message].join('\n'), locale: input.locale }, { signal: c.req.raw.signal, log: c.get('log') });
    if (decision.escalate) return c.json({ ...citationGate({ sentences: [], outOfScope: true }, []), message: 'This situation needs help from a legal professional. Contact Virginia Legal Aid. If you are in immediate danger, call 911.', escalation: decision, resources });
    if (!gemma) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Ask is temporarily unavailable');
    try {
      const pack = packs().get(rental.jurisdiction);
      const answer = await groundedAsk(gemma, input, rentalTools(store, rental, pack), pack?.rules.map(r => r.id) ?? [], c.req.raw.signal, c.get('log'));
      return c.json({ ...answer, escalation: null });
    } catch (error) {
      if (error instanceof GemmaOutputError) return c.json({ ...citationGate({ sentences: [], outOfScope: true }, []), escalation: null });
      if (error instanceof GemmaUnavailableError || error instanceof GemmaRequestError) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Ask is temporarily unavailable');
      throw error;
    }
  });
  return route;
}
