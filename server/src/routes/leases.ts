import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { GemmaOutputError, GemmaRequestError, GemmaUnavailableError, type GemmaClient, type GemmaEvent } from '../ai/gemma.js';
import { analyzeLease, type LeaseAnalysis, type LeaseEvent } from '../ai/pipeline/lease.js';
import type { Finding, KeyTerm } from '../ai/pipeline/types.js';
import type { Triage } from '../ai/triage/index.js';
import type { AuthEnv } from '../auth.js';
import { ApiError, type ErrorCode } from '../errors.js';
import type { Logger } from '../log.js';
import { CreateLeaseInput, FINISHED, leaseJson, newLease, STALE_CLAIM_MS, type Lease } from '../models/lease.js';
import type { Rental } from '../models/rental.js';
import type { RulePack } from '../rules/types.js';
import { isDocumentId, type Store } from '../storage/firestore.js';
import { ownedRental, rentalNotFound } from './evidence.js';
import { guard, readBody } from './rentals.js';

// The lease routes (spec §7.3, §13; #16):
//
//   POST /v1/rentals/:id/leases                    redacted text -> 201 { leaseId }, status pending
//   GET  /v1/rentals/:id/leases/:leaseId/stream    claims the lease, runs S1 to S9, streams:
//          stage     { stage, label, progress }
//          keyterms  { keyTerms }                  after S3
//          finding   one Finding per event         after S8 (and S9), in display order
//          error     { code, message, retryInMs }  a rate limit or busy-model wait; the stream goes on
//          done      { status, findings, tokens, calls, ms, ... }   after the lease, clauses, and findings are stored
//          error     { code, message }             no retryInMs: the analysis stopped; the stream ends
//   GET  /v1/rentals/:id/leases/:leaseId           the stored lease, clauses, and findings
//
// The stream runs the analysis, so the work happens inside a request (Cloud
// Run gives CPU only then). A stream on a finished lease replays its key
// terms, findings, and done. Closing the stream cancels the analysis and
// frees the lease for the next stream.

export interface LeaseAnalyzer {
  // Null without a configured model: S1's keyword backstop still runs, and
  // the stream ends with DEPENDENCY_UNAVAILABLE at S2.
  gemma: GemmaClient | null;
  triage: Triage;
  // Loaded on first use. Keyed by jurisdiction ("VA").
  packs: () => ReadonlyMap<string, RulePack>;
}

// The SSE stream sends a comment this often, so proxies and Cloud Run keep
// it open through a long rate limit wait.
export const KEEPALIVE_MS = 15_000;

// UTF-8 Spanish text runs a little over a byte per character.
const MAX_BODY = 1024 * 1024;

export function createLeases(store: Store, analyzer: LeaseAnalyzer, now: () => Date = () => new Date(), keepaliveMs = KEEPALIVE_MS) {
  const leases = new Hono<AuthEnv>();

  leases.post(
    '/:id/leases',
    bodyLimit({
      maxSize: MAX_BODY,
      onError: () => {
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      },
    }),
    async (c) => {
      const rentalId = c.req.param('id');
      if (!isDocumentId(rentalId)) throw rentalNotFound();
      const input = await readBody(c, CreateLeaseInput);
      const rental = await ownedRental(c, store, rentalId);
      packFor(analyzer, rental, c.get('log'));
      const lease = await guard(store.createLease(rentalId, (id) => newLease(id, rental.jurisdiction, input, now())));
      c.get('log').info('lease created', { rentalId, leaseId: lease.id, textChars: input.text.length, locale: input.locale, pageCount: lease.pageCount });
      const path = `/v1/rentals/${rentalId}/leases/${lease.id}`;
      c.header('Location', path);
      return c.json({ leaseId: lease.id, status: lease.status, stream: `${path}/stream` }, 201);
    },
  );

  leases.get('/:id/leases/:leaseId', async (c) => {
    const { rentalId, lease } = await ownedLease(c, store);
    const { clauses, findings } = FINISHED.has(lease.status) ? await guard(store.getLeaseResults(rentalId, lease.id)) : { clauses: [], findings: [] };
    return c.json(leaseJson(lease, clauses, findings));
  });

  leases.get('/:id/leases/:leaseId/stream', async (c) => {
    const log = c.get('log');
    const { rentalId, rental, lease } = await ownedLease(c, store);

    if (FINISHED.has(lease.status)) {
      const { findings } = await guard(store.getLeaseResults(rentalId, lease.id));
      return streamSSE(c, async (stream) => {
        const send = sender(stream);
        if (lease.status === 'analyzed') {
          await send('keyterms', { keyTerms: lease.keyTerms });
          for (const finding of findings) await send('finding', finding);
        }
        await send('done', { ...donePayload(lease, findings.length, 0), replay: true });
      });
    }

    const pack = packFor(analyzer, rental, log);
    const started = now();
    // A second stream on a running lease would run it twice.
    const claimed = await guard(
      store.updateLease(rentalId, lease.id, (current) => {
        if (FINISHED.has(current.status)) throw new ApiError(409, 'CONFLICT', 'This lease is already analyzed; open the stream again to replay it');
        if (current.status === 'running' && current.startedAt && started.getTime() - current.startedAt.getTime() < STALE_CLAIM_MS) {
          throw new ApiError(409, 'CONFLICT', 'Another stream is analyzing this lease');
        }
        return { ...current, status: 'running', startedAt: started, errorCode: null, updatedAt: started };
      }),
    );
    if (claimed === null) throw leaseNotFound();

    return streamSSE(c, async (stream) => {
      const send = sender(stream);
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const keepalive = setInterval(() => void send.comment('keepalive'), keepaliveMs);
      const findings: Finding[] = [];
      let keyTerms: KeyTerm[] = [];

      const onEvent = (event: LeaseEvent) => {
        switch (event.type) {
          case 'stage':
            void send('stage', { stage: event.stage, label: event.label, progress: event.progress });
            break;
          case 'keyterms':
            keyTerms = event.keyTerms;
            void send('keyterms', { keyTerms: event.keyTerms });
            break;
          case 'finding':
            findings.push(event.finding);
            void send('finding', event.finding);
            break;
          case 'model': {
            const wait = waitEvent(event.event);
            if (wait) void send('error', wait);
            break;
          }
        }
      };

      try {
        const analysis = await analyzeLease(
          {
            leaseId: claimed.id,
            text: claimed.redactedText,
            locale: claimed.locale,
            readingLevel: claimed.readingLevel,
            ...(rental.occupancyDate ? { term: { start: rental.occupancyDate, end: rental.tenancyEndDate } } : {}),
            today: started.toISOString().slice(0, 10),
          },
          { gemma: analyzer.gemma ?? noModel, pack, triage: analyzer.triage, log },
          { signal: controller.signal, onEvent },
        );
        const finished = finishedLease(claimed, analysis, pack, now());
        await guard(
          store.saveLeaseAnalysis(rentalId, finished, analysis.status === 'analyzed' ? analysis.clauses : [], analysis.status === 'analyzed' ? analysis.findings : []),
        );
        log.info('lease analyzed', { rentalId, leaseId: claimed.id, status: finished.status, findings: findings.length, keyTerms: keyTerms.length });
        await send('done', donePayload(finished, findings.length, now().getTime() - started.getTime()));
      } catch (err) {
        if (controller.signal.aborted) {
          log.info('lease stream closed', { rentalId, leaseId: claimed.id });
          await release(store, rentalId, claimed.id, { status: 'pending', errorCode: null }, now, log);
          return;
        }
        const failure = failureFor(err, analyzer.gemma === null);
        log[failure.code === 'INTERNAL' ? 'error' : 'warn']('lease analysis failed', {
          rentalId,
          leaseId: claimed.id,
          code: failure.code,
          errorName: err instanceof Error ? err.name : 'unknown',
        });
        await release(store, rentalId, claimed.id, { status: 'failed', errorCode: failure.code }, now, log);
        await send('error', failure);
      } finally {
        clearInterval(keepalive);
        await send.flush();
      }
    });
  });

  return leases;
}

const leaseNotFound = () => new ApiError(404, 'NOT_FOUND', 'No such lease');

async function ownedLease(c: Context<AuthEnv>, store: Store): Promise<{ rentalId: string; rental: Rental; lease: Lease }> {
  const rentalId = c.req.param('id') ?? '';
  const leaseId = c.req.param('leaseId') ?? '';
  // Checked before the rental, so a bad id is 404 whoever asks.
  if (!isDocumentId(rentalId)) throw rentalNotFound();
  if (!isDocumentId(leaseId)) throw leaseNotFound();
  const rental = await ownedRental(c, store, rentalId);
  const lease = await guard(store.getLease(rentalId, leaseId));
  if (lease === null) throw leaseNotFound();
  return { rentalId, rental, lease };
}

// Legal checks come only from a rule pack (spec §4.2): Virginia today.
function packFor(analyzer: LeaseAnalyzer, rental: Rental, log: Logger): RulePack {
  let packs: ReadonlyMap<string, RulePack>;
  try {
    packs = analyzer.packs();
  } catch (err) {
    log.error('rule packs failed to load', { errorName: err instanceof Error ? err.name : 'unknown' });
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Lease analysis is unavailable');
  }
  const pack = packs.get(rental.jurisdiction);
  if (!pack) throw new ApiError(422, 'UNSUPPORTED_JURISDICTION', `Lease analysis covers ${[...packs.keys()].join(', ') || 'no state'} only`);
  return pack;
}

// Events go out in the order they happen: each write waits for the one before.
function sender(stream: SSEStreamingApi) {
  let id = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    tail = tail.then(() => (stream.closed || stream.aborted ? undefined : write())).catch(() => undefined);
    return tail;
  };
  const send = (event: string, data: unknown) => enqueue(() => stream.writeSSE({ event, id: String(++id), data: JSON.stringify(data) }));
  send.comment = (text: string) => enqueue(async () => {
    await stream.write(`: ${text}\n\n`);
  });
  send.flush = () => tail;
  return send;
}

// The client's waits, as the `error` events spec §7.3 shows. The analysis
// goes on after each one; fallbacks and invalid output are only logged.
function waitEvent(event: GemmaEvent): { code: ErrorCode; message: string; retryInMs: number; model: string } | null {
  if (event.type === 'waiting') return { code: 'RATE_LIMITED', message: 'Waiting for the model rate limit', retryInMs: event.waitMs, model: event.model };
  if (event.type === 'retry') {
    return event.httpStatus === 429
      ? { code: 'RATE_LIMITED', message: 'The model is rate limited; retrying', retryInMs: event.delayMs, model: event.model }
      : { code: 'DEPENDENCY_UNAVAILABLE', message: 'The model is busy; retrying', retryInMs: event.delayMs, model: event.model };
  }
  return null;
}

function failureFor(err: unknown, noModelConfigured: boolean): { code: ErrorCode; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof GemmaUnavailableError) {
    return { code: 'DEPENDENCY_UNAVAILABLE', message: noModelConfigured ? 'No model is configured' : 'No model answered; try again later' };
  }
  if (err instanceof GemmaOutputError || err instanceof GemmaRequestError) return { code: 'DEPENDENCY_UNAVAILABLE', message: 'The model could not read this lease; try again' };
  return { code: 'INTERNAL', message: 'Something went wrong' };
}

// Used when no model is configured: every stage after S1 has no model to ask.
const noModel: GemmaClient = {
  async generate(stage) {
    throw new GemmaUnavailableError(stage, []);
  },
};

async function release(store: Store, rentalId: string, leaseId: string, fields: Pick<Lease, 'status' | 'errorCode'>, now: () => Date, log: Logger) {
  try {
    await store.updateLease(rentalId, leaseId, (current) => ({ ...current, ...fields, startedAt: null, updatedAt: now() }));
  } catch (err) {
    // The claim goes stale after STALE_CLAIM_MS, so the lease is not stuck.
    log.warn('lease release failed', { rentalId, leaseId, errorName: err instanceof Error ? err.name : 'unknown' });
  }
}

function finishedLease(lease: Lease, analysis: LeaseAnalysis, pack: RulePack, at: Date): Lease {
  const base: Lease = {
    ...lease,
    status: analysis.status,
    startedAt: null,
    analyzedAt: at,
    rulePackVersion: pack.verifiedThrough,
    models: analysis.usage.models,
    usage: analysis.usage,
    errorCode: null,
    updatedAt: at,
  };
  switch (analysis.status) {
    case 'analyzed':
      return { ...base, documentType: analysis.documentType, term: analysis.term, keyTerms: analysis.keyTerms, injection: analysis.injection, drops: analysis.drops };
    case 'escalated':
      return { ...base, escalation: { by: analysis.by, category: analysis.category, triage: analysis.triage } };
    case 'not_a_lease':
      return { ...base, documentType: analysis.documentType, message: analysis.message, injection: analysis.injection };
  }
}

function donePayload(lease: Lease, findings: number, ms: number) {
  return {
    status: lease.status,
    findings,
    tokens: { in: lease.usage?.promptTokens ?? 0, out: lease.usage?.outputTokens ?? 0 },
    calls: lease.usage?.calls ?? 0,
    ms,
    models: lease.models,
    ...(lease.status === 'analyzed' ? { injection: lease.injection?.finding ?? null } : {}),
    ...(lease.status === 'escalated' && lease.escalation ? { escalation: { by: lease.escalation.by, category: lease.escalation.category } } : {}),
    ...(lease.status === 'not_a_lease' ? { documentType: lease.documentType, message: lease.message } : {}),
  };
}
