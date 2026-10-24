import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { z } from 'zod';
import type { AuthEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { CreateRentalInput, datesInOrder, newRental, PatchRentalInput, patchRental, rentalJson } from '../models/rental.js';
import { isDocumentId, isUnavailable, type Store } from '../storage/firestore.js';

// POST /v1/rentals and PATCH /v1/rentals/:id (spec §13). Mounted under /v1,
// so every request here already has a verified user.
export function createRentals(store: Store, now: () => Date = () => new Date()) {
  const rentals = new Hono<AuthEnv>();

  // A rental is a few small fields.
  rentals.use(
    bodyLimit({
      maxSize: 16 * 1024,
      onError: () => {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      },
    }),
  );

  rentals.post('/', async (c) => {
    const input = await readBody(c, CreateRentalInput);
    if (!datesInOrder({ occupancyDate: input.occupancyDate ?? null, tenancyEndDate: input.tenancyEndDate ?? null })) {
      throw new ApiError(400, 'BAD_REQUEST', 'tenancyEndDate is before occupancyDate');
    }
    const rental = await guard(store.createRental(c.get('user'), (id) => newRental(id, c.get('user').uid, input, now())));
    c.get('log').info('rental created', { rentalId: rental.id });
    c.header('Location', `/v1/rentals/${rental.id}`);
    return c.json(rentalJson(rental), 201);
  });

  rentals.patch('/:id', async (c) => {
    const id = c.req.param('id');
    // Checked before the body, so a bad id is 404 whatever is sent.
    if (!isDocumentId(id)) throw notFound();
    const patch = await readBody(c, PatchRentalInput);
    const { uid } = c.get('user');
    const rental = await guard(
      store.updateRental(id, (current) => {
        if (current.ownerUid !== uid) {
          c.get('log').info('rental forbidden', { rentalId: id });
          throw new ApiError(403, 'FORBIDDEN', 'This rental belongs to another user');
        }
        const next = patchRental(current, patch, now());
        if (!datesInOrder(next)) throw new ApiError(400, 'BAD_REQUEST', 'tenancyEndDate is before occupancyDate');
        return next;
      }),
    );
    if (rental === null) throw notFound();
    return c.json(rentalJson(rental));
  });

  return rentals;
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'No such rental');

// The message names fields, never values: a body is user content.
async function readBody<T extends z.ZodType>(c: Context<AuthEnv>, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Body must be JSON');
  }
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields = new Set<string>();
  for (const issue of result.error.issues) {
    // Unknown keys are the client's text, so they are not echoed.
    if (issue.code === 'unrecognized_keys') fields.add('unknown fields');
    else fields.add(issue.path.length > 0 ? issue.path.join('.') : 'body');
  }
  throw new ApiError(400, 'BAD_REQUEST', `Invalid ${[...fields].join(', ')}`);
}

// Firestore not answering is a 503 the client can retry, not a 500.
async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (isUnavailable(err)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Storage is unavailable');
    throw err;
  }
}
