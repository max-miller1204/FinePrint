// S3 (spec §7.3): clause starts and key term quotes from S2, located in the
// lease text by code. What is not found is dropped.

import type { Segmentation } from '../schemas/lease.js';
import { KEY_TERM_UNITS, parseValue, toAmount, type KeyTermName, type ParsedValue } from './key-terms.js';
import { containsText, locateQuote } from './quotes.js';
import type { Clause, Drop, KeyTerm } from './types.js';

// `from`: the offset of the chunk the claim came from, so a start from a
// later chunk is never matched in an earlier one.
type ClauseClaim = Segmentation['clauses'][number] & { from?: number };
type KeyTermClaim = Segmentation['keyTerms'][number];

// A clause start can be short ("1. RENT."), but not a lone word.
const MIN_START_CHARS = 4;

// Each clause runs from its start to the next clause's start, so clauses
// cover the lease with no gaps and no model-written text. Starts are found in
// order: each search begins after the previous clause's start.
export function resolveClauses(text: string, claims: readonly ClauseClaim[], drops: Drop[]): Clause[] {
  const starts: { at: number; heading: string }[] = [];
  let cursor = 0;
  for (const claim of claims) {
    const span = locateQuote(text, claim.start, { from: Math.max(cursor, claim.from ?? 0), minChars: MIN_START_CHARS });
    if (!span) {
      drops.push({ stage: 'S3', reason: 'clause_start_not_found' });
      continue;
    }
    const at = withHeading(text, span.start, claim.heading, cursor);
    starts.push({ at, heading: claim.heading.trim() });
    cursor = span.start + 1;
  }

  const bounds: { start: number; heading: string | null; preamble: boolean }[] = [];
  const first = starts[0]?.at ?? text.length;
  if (text.slice(0, first).trim().length > 0) bounds.push({ start: 0, heading: null, preamble: true });
  for (const s of starts) bounds.push({ start: s.at, heading: s.heading || null, preamble: false });

  const clauses: Clause[] = [];
  let n = 0;
  bounds.forEach((bound, i) => {
    const next = bounds[i + 1]?.start ?? text.length;
    const slice = text.slice(bound.start, next);
    const start = bound.start + (slice.length - slice.trimStart().length);
    const end = bound.start + slice.trimEnd().length;
    if (end <= start) return;
    const id = bound.preamble ? 'c0' : `c${++n}`;
    clauses.push({ id, heading: bound.heading, start, end, verbatim: text.slice(start, end) });
  });
  return clauses;
}

// Models often put "4. LATE CHARGES." in `heading` and start `start` after
// it. The clause then begins at its heading, when the heading sits right
// before the start, and at its number ("4.", "Section 4", "(a)") when one
// opens the line.
function withHeading(text: string, at: number, heading: string, floor: number): number {
  const lo = Math.max(floor, at - heading.length - 40);
  const before = text.slice(lo, at);
  let found: { start: number; end: number } | null = null;
  for (let from = 0, hit = locateQuote(before, heading, { minChars: 2 }); hit; hit = locateQuote(before, heading, { from, minChars: 2 })) {
    found = hit;
    from = hit.start + 1;
  }
  // Only spaces and the heading's own punctuation may sit between them.
  if (found && /^[\s.:)-]*$/.test(before.slice(found.end))) at = lo + found.start;
  const lineStart = Math.max(floor, text.lastIndexOf('\n', at - 1) + 1);
  const number = /^\s*((?:section|article|§)\s*)?(\d{1,3}(?:\.\d{1,3})*|\(?[a-z]\)|[ivx]{1,4})[.)]?\s*$/i.exec(text.slice(lineStart, at));
  if (number && number[0].trim() !== '') at = lineStart + (number[0].length - number[0].trimStart().length);
  return at;
}

export function clauseAt(clauses: readonly Clause[], offset: number): Clause | undefined {
  return clauses.find((c) => offset >= c.start && offset < c.end);
}

// Key terms whose quote is in the lease and whose value is in the quote and
// reads as the term's unit. The first verified value of a term wins; a
// percent or months of rent becomes dollars only with a verified rent.
export function resolveKeyTerms(text: string, clauses: readonly Clause[], claims: readonly KeyTermClaim[], drops: Drop[]): KeyTerm[] {
  const found = new Map<KeyTermName, { claim: KeyTermClaim; parsed: ParsedValue; start: number; end: number }>();
  for (const claim of claims) {
    const span = locateQuote(text, claim.quote);
    if (!span) {
      drops.push({ stage: 'S3', reason: 'key_term_quote_not_found', ref: claim.name });
      continue;
    }
    const quote = text.slice(span.start, span.end);
    if (!containsText(quote, claim.value)) {
      drops.push({ stage: 'S3', reason: 'key_term_value_not_in_quote', ref: claim.name });
      continue;
    }
    const parsed = parseValue(claim.name, claim.value);
    if (!parsed) {
      drops.push({ stage: 'S3', reason: 'key_term_unreadable', ref: claim.name });
      continue;
    }
    if (found.has(claim.name)) {
      drops.push({ stage: 'S3', reason: 'key_term_duplicate', ref: claim.name });
      continue;
    }
    found.set(claim.name, { claim, parsed, ...span });
  }

  const rent = found.get('monthlyRent');
  const rentUsd = rent?.parsed.kind === 'usd' ? rent.parsed.usd : undefined;
  const terms: KeyTerm[] = [];
  for (const [name, { claim, parsed, start, end }] of found) {
    const clause = clauseAt(clauses, start);
    if (!clause) continue;
    terms.push({
      name,
      value: claim.value.trim(),
      unit: KEY_TERM_UNITS[name],
      amount: toAmount(parsed, rentUsd),
      date: parsed.kind === 'date' ? parsed.date : null,
      quote: text.slice(start, end),
      quoteSpan: { start, end },
      clauseId: clause.id,
    });
  }
  return terms;
}
