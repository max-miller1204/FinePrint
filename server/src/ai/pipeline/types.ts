// What the lease pipeline produces (spec §7.3, §6.1). Every quote here is a
// slice of the lease text with its offsets; nothing a model wrote survives
// unless code found it in the lease.

import type { CheckOutcome } from '../../rules/checks.js';
import type { ApplicableVersion, LeaseTerm, RuleChange } from '../../rules/resolve.js';
import type { CheckType, IsoDate, Severity } from '../../rules/types.js';
import type { Assessment, VerifierAssessment } from '../schemas/lease.js';
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
  // The model that answered, so a fallback answer can be labeled.
  model: string;
  fallback: boolean;
}

// S7's answer for one clause and rule. `agree`: the verifier also found a
// violation; `disagree`: it found none; `unclear`: it could not tell;
// `unverified`: no model answered, or it skipped this check.
export type VerifierVerdict = 'agree' | 'disagree' | 'unclear' | 'unverified';

export interface VerifierResult {
  verdict: VerifierVerdict;
  // The verifier's own reading, made without S5's answer. null when unverified.
  assessment: VerifierAssessment | null;
  reasoning: string | null;
  // `gemma-4-31b-it` unless it was down and a fallback answered.
  model: string | null;
  fallback: boolean;
}

// Where a finding comes from: an S4 check, a code search for wording the
// lease must have (`absence`), or an S5 mapping that S6 kept.
export type FindingBasis = 'check' | 'absence' | 'mapping';

// Where the English explanation came from. S8's model answer when it passed
// the grade check, its one regeneration, the rule's own tenant explanation,
// or a fixed sentence for the severity.
export type ExplanationSource = 'model' | 'model_retry' | 'rule' | 'template';

export interface FindingTranslation {
  title: string;
  explanation: string;
  action: string;
  model: string;
  fallback: boolean;
}

// One finding for the tenant (spec §6.1 `findings`, §4.3 F1): one rule on
// one clause, or a clause no rule covers (`ruleId` null, no legal claim).
export interface Finding {
  // `f1`, `f2`, ... in display order: severity, then position in the lease.
  id: string;
  severity: Severity;
  basis: FindingBasis;
  ruleId: string | null;
  citation: string | null;
  sourceUrl: string | null;
  checkType: CheckType | null;
  // Every rule version in force during the term; statuteQuote is the first one's.
  versions: ApplicableVersion[];
  changes: RuleChange[];
  statuteQuote: string | null;
  // null only for an `absence` finding: there is no lease text to quote.
  clauseId: string | null;
  leaseQuote: string | null;
  quoteSpan: Span | null;
  // S5's assessment, or `violates` for a code finding.
  primaryAssessment: Assessment;
  // The S5 model; null for a code finding.
  primaryModel: string | null;
  primaryFallback: boolean;
  // S7, only for an S5 `violates`; null where the table needs no verifier.
  verifier: VerifierResult | null;
  // An S4 finding's numbers.
  check: { limit: number; actual: number; unit: 'usd' | 'hours' } | null;
  titleEn: string;
  explanationEn: string;
  // The rule's verified "what you can do" text, never model text.
  actionEn: string;
  readability: { grade: number; target: number; source: ExplanationSource };
  // S9, keyed by locale. A finding whose translation failed a check has none,
  // and the app shows the English.
  translations: Record<string, FindingTranslation>;
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
  | 'duplicate_mapping'
  | 'verifier_no_answer'
  | 'explanation_over_grade'
  | 'explanation_missing'
  | 'translation_missing'
  | 'translation_rejected'
  | 'translation_quote_changed';

export interface Drop {
  stage: 'S3' | 'S6' | 'S7' | 'S8' | 'S9';
  reason: DropReason;
  // A clause id, key term name, rule id, or finding id; never lease text.
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
