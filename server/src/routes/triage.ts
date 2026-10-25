import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { TRIAGE_SOURCES, type Triage } from '../ai/triage/index.js';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { readBody } from './rentals.js';

// About 60 pages of lease text; a summons is one or two.
const MAX_TEXT = 200_000;

const TriageBody = z.strictObject({
  source: z.enum(TRIAGE_SOURCES),
  text: z.string().trim().min(1).max(MAX_TEXT),
  imageCaptions: z.array(z.string().max(1_000)).max(20).optional(),
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
    .default('en'),
});

// POST /v1/triage (spec §7.9). The app sends a tenant input here before it
// starts a model-backed flow, and shows the handoff sheet (#38) when
// `escalate` is true. The lease, Ask, repair, and landlord report routes run
// the same `triage.check` on their own input when they land (#16, #41, #31,
// #28). Nothing is stored; the log line holds the decision, never the text.
export function createTriageRoute(triage: Triage) {
  const route = new Hono<AuthEnv>();

  route.use(
    bodyLimit({
      // UTF-8 Spanish text runs a little over a byte per character.
      maxSize: 1024 * 1024,
      onError: () => {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      },
    }),
  );

  route.post('/', async (c) => {
    const { source, text, imageCaptions, locale } = await readBody(c, TriageBody);
    const decision = await triage.check(
      { source, text, locale, ...(imageCaptions ? { imageCaptions } : {}) },
      { log: c.get('log'), signal: c.req.raw.signal },
    );
    return c.json(decision);
  });

  return route;
}
