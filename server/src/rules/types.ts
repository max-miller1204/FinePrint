// The rule pack's shape (spec §7.4). jurisdictions/schema/rule.schema.json
// is the source of truth; the loader validates every file against it, and
// these types describe what passes.

// ISO calendar date, YYYY-MM-DD.
export type IsoDate = string;

export type CheckType = 'deterministic' | 'semantic' | 'informational';
export type Severity = 'unenforceable' | 'ask' | 'info';

export interface RuleVersion {
  effectiveFrom: IsoDate;
  // Exclusive: the day the next version takes over. null: no end date.
  effectiveUntil: IsoDate | null;
  statuteQuote: string;
  // Relative to the pack folder, such as `snapshots/55.1-1204@2026-10-25.txt`.
  snapshotFile: string;
}

export interface Rule {
  id: string;
  jurisdiction: string;
  citation: string;
  sourceUrl: string;
  versions: RuleVersion[];
  checkType: CheckType;
  deterministic?: { fn: string; inputs: string[] };
  summaryForModel: string;
  paraphraseExamples: string[];
  tenantExplanation: string;
  action: string;
  severityIfViolated: Severity;
  // Both or neither; set by a human who checked every quote.
  verifiedBy?: string;
  verifiedAt?: IsoDate;
}

export interface RulePack {
  jurisdiction: string;
  rules: Rule[];
  byId: ReadonlyMap<string, Rule>;
  // The oldest verifiedAt, for the README's "last verified" line; null
  // while any rule is unverified.
  verifiedThrough: IsoDate | null;
}
