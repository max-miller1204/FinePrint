// The responsibility check (spec §4.3 F4, §7.7). Gemma interprets; code
// verifies.
//
//   checkResponsibility({ description, lease, moveIn, today, locale }, { gemma, pack, triage })
//     R1 triage.check(repair)                -> stop with the handoff on danger, self-harm, or abuse;
//        any other escalation (a lockout, no heat) still gets an answer, with the triage attached
//     R2 gemma `responsibility` (26B)        -> verdict, category, confidence, reasons with citations
//     R3 code: each citation must be a rule in force, a quote found in a lease clause that was
//        sent, or a move-in record that was sent; anything else is dropped
//        no reason left -> not_sure; pre_existing with no move-in record cited -> unknown
//     R4 gemma `responsibility_verify` (31B), only on `high`: its own verdict from the cited
//        text alone; anything but the same verdict, or no answer, makes it `medium`
//
// The move-in photos themselves are not compared yet: the compare stage is
// #27. The model sees what was photographed and when, and code only lets it
// call damage pre-existing when it cites one of those records.

import { createLogger, type Logger } from '../../log.js';
import type { Evidence } from '../../models/evidence.js';
import type { Citation, Reason, VerificationStatus } from '../../models/issue.js';
import type { AnalyzedLease, LeaseClause } from '../../models/lease.js';
import { versionOn } from '../../rules/resolve.js';
import type { IsoDate, RulePack } from '../../rules/types.js';
import type { TextDocument } from '../documents.js';
import { GemmaOutputError, GemmaUnavailableError, type GemmaClient, type GemmaEvent, type GenerateResult } from '../gemma.js';
import { responsibilityInstruction, responsibilityTask, verifyInstruction, VERIFY_TASK, type RuleForPrompt } from '../prompts/responsibility.js';
import { responsibilitySchema, ResponsibilityVerifySchema, type Category, type Confidence, type Verdict } from '../schemas/responsibility.js';
import type { Triage, TriageCategory, TriageDecision } from '../triage/index.js';
import { locateQuote } from './quotes.js';
import type { PipelineUsage } from './types.js';

// Spec §7.7: the maintenance duty, wear and tear, repair fees (allowed only
// for the tenant's own violation), and rent escrow. The pack has no
// tenant-obligation rule (§ 55.1-1227) yet.
export const RESPONSIBILITY_RULES = ['VA_LANDLORD_MAINTAIN_FIT', 'VA_DEPOSIT_WEAR_AND_TEAR', 'VA_NO_REPAIR_FEES', 'VA_RENT_ESCROW_PROCESS'] as const;
export const ESCROW_RULE = 'VA_RENT_ESCROW_PROCESS';

// About 6K tokens of lease, so a request stays inside a minute of Gemma's
// 16K input tokens with the rules and the description.
export const MAX_LEASE_CHARS = 24_000;
export const MAX_MOVE_IN_RECORDS = 8;
// Thinking counts toward the cap on a `json` stage. Measured 26B answers were
// about 550 tokens without thinking; the cap ends a looping answer.
export const OUTPUT_CAP = 8_192;
export const VERIFY_OUTPUT_CAP = 1_024;

// Escalations that end the check: the tenant needs help now, and "who pays"
// is beside the point. Gemma's triage flags a broken heater in winter as
// `utility_shutoff` (recall over precision), and a lockout is still a
// question of who fixes the lock, so those get an answer with the handoff.
export const STOP_CATEGORIES: ReadonlySet<TriageCategory> = new Set(['immediate_danger', 'self_harm', 'domestic_violence']);

// Clauses about who fixes or pays for what. A lease's other clauses (rent,
// parking, pets) do not bear on responsibility and would crowd the budget.
const RELEVANT_CLAUSE =
  /repair|maint|damage|condition|wear and tear|appliance|heat|hvac|furnace|air.?condition|plumb|electric|pest|mold|alteration|smoke (alarm|detector)|utilit|surrender|move.?out|inspection/i;

export function relevantClauses(clauses: readonly LeaseClause[], maxChars = MAX_LEASE_CHARS): LeaseClause[] {
  const picked: LeaseClause[] = [];
  let used = 0;
  for (const clause of clauses) {
    if (!RELEVANT_CLAUSE.test(`${clause.heading ?? ''}\n${clause.verbatim}`)) continue;
    if (used + clause.verbatim.length > maxChars) continue;
    picked.push(clause);
    used += clause.verbatim.length;
  }
  return picked;
}

const label = (text: string) => text.trim().toLowerCase();

// The rental's move-in photos of the same room: received, not deleted; the
// same item first, then sealed ones, then oldest first.
export function moveInRecords(items: readonly Evidence[], room: string | null, checklistItem: string | null, max = MAX_MOVE_IN_RECORDS): Evidence[] {
  if (room === null) return [];
  const score = (item: Evidence) => (checklistItem !== null && label(item.checklistItem) === label(checklistItem) ? 2 : 0) + (item.sealedManifestId !== null ? 1 : 0);
  return items
    .filter((item) => item.session === 'move_in' && item.deletedAt === null && item.receivedAtServer !== null && label(item.room) === label(room))
    .sort((a, b) => score(b) - score(a) || a.capturedAtDevice.localeCompare(b.capturedAtDevice))
    .slice(0, max);
}

export interface ResponsibilityInput {
  description: string;
  locale: string;
  // The day of the check, for the rule versions in force.
  today: IsoDate;
  lease: AnalyzedLease | null;
  // From moveInRecords().
  moveIn: readonly Evidence[];
}

export interface ResponsibilityDeps {
  // Null: no model is configured, so only triage runs.
  gemma: GemmaClient | null;
  // Null: no rule pack for the rental's jurisdiction.
  pack: RulePack | null;
  triage: Triage;
  log?: Logger;
}

export interface CheckOptions {
  signal?: AbortSignal;
  onEvent?: (event: GemmaEvent) => void;
}

// Why code threw a reason away. Ids we sent and reasons only, never text.
export type CitationDropReason =
  | 'unknown_rule'
  | 'unknown_clause'
  | 'missing_lease_quote'
  | 'lease_quote_not_in_clause'
  | 'unknown_evidence'
  | 'duplicate_citation';

export interface CitationDrop {
  reason: CitationDropReason;
  // Only when it names something we sent.
  ref?: string;
}

export interface Verification {
  status: VerificationStatus;
  model: string | null;
  verdict: Verdict | null;
}

export type ResponsibilityResult =
  | { status: 'escalated'; triage: TriageDecision }
  | {
      status: 'checked';
      verdict: Verdict;
      category: Category;
      confidence: Confidence;
      reasons: Reason[];
      whatWouldChange: string[];
      escrowEligible: boolean;
      verification: Verification;
      downgraded: boolean;
      // The app opens the handoff sheet when `triage.escalate` is true.
      triage: TriageDecision;
      drops: CitationDrop[];
      // `primary` is null when there was nothing to cite, so no model was asked.
      models: { primary: string | null; verifier: string | null };
      usage: PipelineUsage;
    };

const leaseDocId = (clauseId: string) => `lease.${clauseId}`;
const evidenceDocId = (itemId: string) => `evidence.${itemId}`;

function moveInText(item: Evidence): string {
  const sealed = item.sealedManifestId === null ? 'not sealed' : 'sealed';
  return `Move-in photo. Room: ${item.room}. Item: ${item.checklistItem}. Taken: ${item.capturedAtDevice}. ${sealed}.`;
}

export async function checkResponsibility(input: ResponsibilityInput, deps: ResponsibilityDeps, { signal, onEvent }: CheckOptions = {}): Promise<ResponsibilityResult> {
  const log = deps.log ?? createLogger(null);
  const usage: PipelineUsage = { calls: 0, promptTokens: 0, outputTokens: 0, models: [], fallback: false };
  const track = <T>(result: GenerateResult<T>) => {
    usage.calls++;
    usage.promptTokens += result.promptTokens;
    usage.outputTokens += result.outputTokens;
    if (!usage.models.includes(result.model)) usage.models.push(result.model);
    usage.fallback ||= result.fallback;
    return result;
  };
  const common = { ...(signal ? { signal } : {}), ...(onEvent ? { onEvent } : {}), log };

  // R1. The backstop runs with no model too, so a gas leak gets the handoff
  // even on a server that cannot answer the question.
  const decision = await deps.triage.check({ source: 'repair', text: input.description, locale: input.locale }, { ...(signal ? { signal } : {}), log });
  if (decision.model.status !== 'off') usage.calls++;
  if (decision.escalate && STOP_CATEGORIES.has(decision.category)) {
    log.info('responsibility check', { status: 'escalated', category: decision.category, calls: usage.calls });
    return { status: 'escalated', triage: decision };
  }
  if (!deps.gemma) throw new GemmaUnavailableError('responsibility', []);

  // R2.
  const rules: RuleForPrompt[] = RESPONSIBILITY_RULES.flatMap((id) => {
    const rule = deps.pack?.byId.get(id);
    const version = rule && versionOn(rule, input.today);
    return rule && version ? [{ rule, version }] : [];
  });
  const clauses = input.lease ? relevantClauses(input.lease.clauses) : [];
  const citable: TextDocument[] = [
    ...clauses.map((c) => ({ id: leaseDocId(c.id), text: c.heading ? `${c.heading}\n${c.verbatim}` : c.verbatim })),
    ...input.moveIn.map((item) => ({ id: evidenceDocId(item.id), text: moveInText(item) })),
  ];
  const refs = [...rules.map((r) => r.rule.id), ...citable.map((d) => d.id)];
  const [firstRef, ...otherRefs] = refs;
  // Nothing to cite (no rule pack, lease, or photos): no reason could
  // survive R3, so the model is not asked.
  if (firstRef === undefined) {
    log.info('responsibility check', { status: 'checked', verdict: 'not_sure', reasons: 0, citable: 0, calls: usage.calls });
    return {
      status: 'checked',
      verdict: 'not_sure',
      category: 'unknown',
      confidence: 'low',
      reasons: [],
      whatWouldChange: [],
      escrowEligible: false,
      verification: { status: 'not_needed', model: null, verdict: null },
      downgraded: false,
      triage: decision,
      drops: [],
      models: { primary: null, verifier: null },
      usage,
    };
  }
  const docs: TextDocument[] = [{ id: 'description', text: input.description }, ...citable];
  const primary = track(
    await deps.gemma.generate('responsibility', responsibilitySchema([firstRef, ...otherRefs]), docs, {
      task: responsibilityTask(input.locale),
      instruction: responsibilityInstruction(rules),
      maxOutputTokens: OUTPUT_CAP,
      ...common,
    }),
  );
  const answer = primary.data;

  // R3.
  const drops: CitationDrop[] = [];
  const ruleById = new Map(rules.map((r) => [r.rule.id, r]));
  const clauseByDoc = new Map(clauses.map((c) => [leaseDocId(c.id), c]));
  const evidenceByDoc = new Map(input.moveIn.map((item) => [evidenceDocId(item.id), item]));
  const seen = new Set<string>();
  const reasons: Reason[] = [];
  for (const reason of answer.reasons) {
    const text = reason.text.trim();
    const { kind, ref, quote } = reason.citation;
    let citation: Citation | null = null;
    if (kind === 'rule') {
      const found = ruleById.get(ref);
      if (!found) drops.push({ reason: 'unknown_rule' });
      else {
        citation = {
          kind,
          ref,
          citation: found.rule.citation,
          quote: found.version.statuteQuote,
          sourceUrl: found.rule.sourceUrl,
          effectiveFrom: found.version.effectiveFrom,
        };
      }
    } else if (kind === 'lease') {
      // The enum holds every id sent, so a ref of the wrong kind lands here too.
      const clause = clauseByDoc.get(ref);
      if (!clause) drops.push({ reason: 'unknown_clause' });
      else if (!quote) drops.push({ reason: 'missing_lease_quote', ref: clause.id });
      else {
        const span = locateQuote(clause.verbatim, quote);
        if (!span) drops.push({ reason: 'lease_quote_not_in_clause', ref: clause.id });
        else {
          citation = {
            kind,
            ref: clause.id,
            leaseId: input.lease!.id,
            heading: clause.heading,
            quote: clause.verbatim.slice(span.start, span.end),
            quoteSpan: { start: clause.charStart + span.start, end: clause.charStart + span.end },
          };
        }
      }
    } else {
      const item = evidenceByDoc.get(ref);
      if (!item) drops.push({ reason: 'unknown_evidence' });
      else {
        citation = {
          kind,
          ref: item.id,
          session: item.session,
          room: item.room,
          checklistItem: item.checklistItem,
          capturedAtDevice: item.capturedAtDevice,
          sealedManifestId: item.sealedManifestId,
        };
      }
    }
    if (!citation || text.length === 0) continue;
    const key = `${citation.kind}:${citation.ref}:${'quote' in citation ? citation.quote : ''}`;
    if (seen.has(key)) {
      drops.push({ reason: 'duplicate_citation', ref: citation.ref });
      continue;
    }
    seen.add(key);
    reasons.push({ text, citation });
  }

  let { verdict, category, confidence } = answer;
  const whatWouldChange = answer.whatWouldChange.map((s) => s.trim()).filter((s) => s.length > 0);
  if (reasons.length === 0) {
    verdict = 'not_sure';
    category = 'unknown';
    confidence = 'low';
  } else if (category === 'pre_existing' && !reasons.some((r) => r.citation.kind === 'evidence')) {
    category = 'unknown';
  }

  // R4.
  let verification: Verification = { status: 'not_needed', model: null, verdict: null };
  let downgraded = false;
  if (confidence === 'high') {
    verification = await verify(deps.gemma, { description: input.description, verdict, reasons }, ruleById, track, common);
    if (verification.status !== 'agreed') {
      confidence = 'medium';
      downgraded = true;
    }
  }

  const escrowEligible = answer.escrowEligibleCondition && verdict === 'likely_landlord' && ruleById.has(ESCROW_RULE);
  log.info('responsibility check', {
    status: 'checked',
    verdict,
    category,
    confidence,
    verification: verification.status,
    downgraded,
    escalate: decision.escalate,
    reasons: reasons.length,
    drops: drops.length,
    leaseClauses: clauses.length,
    moveInRecords: input.moveIn.length,
    descriptionChars: input.description.length,
    calls: usage.calls,
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
  });
  return {
    status: 'checked',
    verdict,
    category,
    confidence,
    reasons,
    whatWouldChange,
    escrowEligible,
    verification,
    downgraded,
    triage: decision,
    drops,
    models: { primary: primary.model, verifier: verification.model },
    usage,
  };
}

// 31B sees the description and only the text the reasons cite: the statute
// quotes, the lease quotes, and the move-in records. Not 26B's verdict.
async function verify(
  gemma: GemmaClient,
  { description, verdict, reasons }: { description: string; verdict: Verdict; reasons: readonly Reason[] },
  ruleById: ReadonlyMap<string, RuleForPrompt>,
  track: <T>(result: GenerateResult<T>) => GenerateResult<T>,
  common: { signal?: AbortSignal; onEvent?: (event: GemmaEvent) => void; log: Logger },
): Promise<Verification> {
  const cited = reasons.map((r) => r.citation);
  const rules = [...new Set(cited.filter((c) => c.kind === 'rule').map((c) => c.ref))].map((id) => ruleById.get(id)!);
  const docs: TextDocument[] = [{ id: 'description', text: description }];
  cited.forEach((c, i) => {
    if (c.kind === 'lease') docs.push({ id: `lease.quote${i + 1}`, text: c.quote });
    if (c.kind === 'evidence') docs.push({ id: `evidence.record${i + 1}`, text: `Move-in photo. Room: ${c.room}. Item: ${c.checklistItem}. Taken: ${c.capturedAtDevice}.` });
  });
  try {
    const result = track(
      await gemma.generate('responsibility_verify', ResponsibilityVerifySchema, docs, {
        task: VERIFY_TASK,
        instruction: verifyInstruction(rules),
        maxOutputTokens: VERIFY_OUTPUT_CAP,
        ...common,
      }),
    );
    return { status: result.data.verdict === verdict ? 'agreed' : 'disagreed', model: result.model, verdict: result.data.verdict };
  } catch (err) {
    if (common.signal?.aborted) throw err;
    if (!(err instanceof GemmaUnavailableError || err instanceof GemmaOutputError)) throw err;
    common.log.warn('responsibility verifier unavailable', { errorName: err.name });
    return { status: 'unavailable', model: null, verdict: null };
  }
}
