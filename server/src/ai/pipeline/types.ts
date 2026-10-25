// What the lease pipeline produces (spec §7.3 S1 to S6, §6.1). Every quote
// here is a slice of the lease text with its offsets; nothing a model wrote
// survives unless code found it in the lease.

import type { CheckOutcome } from '../../rules/checks.js';
import type { ApplicableVersion, LeaseTerm, RuleChange } from '../../rules/resolve.js';
import type { IsoDate } from '../../rules/types.js';
import type { Assessment } from '../schemas/lease.js';
import type { KeyTermName, KeyTermUnit } from './key-terms.js';
import type { Span } from './quotes.js';

export interface Clause extends Span {
  // `c1`, `c2`, ... in lease order; `c0` is any text before the first clause.
  id: string;
  heading: string | null;
  verbatim: string;
}

export interface KeyTerm {
  name: KeyTermName;
  // As written in the lease ("15%", "three months' rent").
  value: string;
  unit: KeyTermUnit;
  // Dollars or hours, read by code from `value`. A percent or months of rent
  // is turned into dollars with the verified monthly rent.
  amount: number | null;
  date: IsoDate | null;
  quote: string;
  quoteSpan: Span;
  clauseId: string;
}

export interface TermUsed {
  start: IsoDate;
  end: IsoDate | null;
  // Where the dates came from: the lease's own key terms, the caller (the
  // rental's dates), or the day of the analysis when neither has them.
  source: 'lease' | 'input' | 'assumed';
}

export interface RuleInForce {
  ruleId: string;
  versions: ApplicableVersion[];
  changes: RuleChange[];
}

// S4: one result per deterministic rule in force during the term.
export interface CheckResultForLease extends RuleInForce {
  fn: string;
  outcome: CheckOutcome;
  unit: 'usd' | 'hours';
  limit?: number;
  actual?: number;
  // The key terms the check read, with their quotes.
  keyTerms: KeyTermName[];
  clauseIds: string[];
}

// S5 after S6: a clause the model tied to rules, with each claim checked.
export interface VerifiedMapping {
  clauseId: string;
  assessment: Assessment;
  leaseQuote: string;
  quoteSpan: Span;
  reasoning: string;
  rules: RuleInForce[];
  // The model that answered, so a fallback answer can be labeled (#15).
  model: string;
  fallback: boolean;
}

// Why the pipeline threw something away. Ids and reasons only, never text.
export type DropReason =
  | 'clause_start_not_found'
  | 'key_term_quote_not_found'
  | 'key_term_value_not_in_quote'
  | 'key_term_unreadable'
  | 'key_term_duplicate'
  | 'lease_end_before_start'
  | 'unknown_clause'
  | 'lease_quote_not_in_clause'
  | 'unknown_rule'
  | 'rule_not_in_force'
  | 'superseded_by_check'
  | 'no_rule_left'
  | 'duplicate_mapping';

export interface Drop {
  stage: 'S3' | 'S6';
  reason: DropReason;
  // A clause id, key term name, or rule id; never lease text.
  ref?: string;
}

export interface PipelineUsage {
  // generate() calls, triage included. Retries inside the client are not
  // counted here; they are in the usage records.
  calls: number;
  promptTokens: number;
  outputTokens: number;
  models: string[];
  fallback: boolean;
}

export type { LeaseTerm };
