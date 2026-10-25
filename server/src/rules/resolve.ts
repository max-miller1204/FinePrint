// The effective-date resolver (spec §7.4). A lease is checked against every
// rule version in force at any point of its term, not only the version in
// force on the day it is signed: § 55.1-1204 changes on July 1, 2027, so a
// lease from October 2026 to October 2027 is checked against both versions,
// and the tenant is told the rule changes mid-lease.

import type { IsoDate, Rule, RuleVersion } from './types.js';

export interface LeaseTerm {
  start: IsoDate;
  // Inclusive last day. null: a periodic tenancy with no end date.
  end: IsoDate | null;
}

export interface ApplicableVersion {
  version: RuleVersion;
  // The part of the lease term this version covers, both days inclusive;
  // `until` is null when it runs to the end of an open-ended term.
  from: IsoDate;
  until: IsoDate | null;
}

export interface RuleChange {
  // The day the new version takes effect, inside the lease term.
  on: IsoDate;
  // false when the section changed but this rule's quoted text did not.
  quoteChanged: boolean;
}

export interface ResolvedRule {
  rule: Rule;
  versions: ApplicableVersion[];
  changes: RuleChange[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDate(value: string, name: string) {
  const m = ISO_DATE.exec(value);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== value) throw new RangeError(`${name} must be a YYYY-MM-DD date, got "${value}"`);
}

function assertTerm(term: LeaseTerm) {
  assertDate(term.start, 'term.start');
  if (term.end !== null) {
    assertDate(term.end, 'term.end');
    if (term.end < term.start) throw new RangeError(`term.end ${term.end} is before term.start ${term.start}`);
  }
}

// The day before an ISO date, for turning an exclusive end into an inclusive one.
function dayBefore(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ISO dates compare correctly as strings.
const later = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
const earlier = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

// Every version of the rule whose effective range overlaps the term, oldest first.
export function versionsForTerm(rule: Rule, term: LeaseTerm): ApplicableVersion[] {
  assertTerm(term);
  return rule.versions
    .filter((v) => (term.end === null || v.effectiveFrom <= term.end) && (v.effectiveUntil === null || v.effectiveUntil > term.start))
    .map((v) => {
      const lastDay = v.effectiveUntil === null ? null : dayBefore(v.effectiveUntil);
      const until = lastDay === null ? term.end : term.end === null ? lastDay : earlier(lastDay, term.end);
      return { version: v, from: later(v.effectiveFrom, term.start), until };
    });
}

// The version in force on one day (spec §7.3 S6), or null.
export function versionOn(rule: Rule, date: IsoDate): RuleVersion | null {
  assertDate(date, 'date');
  return rule.versions.find((v) => v.effectiveFrom <= date && (v.effectiveUntil === null || v.effectiveUntil > date)) ?? null;
}

// Every rule with at least one version in force during the term, each with
// its applicable versions and the days it changes mid-lease.
export function resolveRules(rules: readonly Rule[], term: LeaseTerm): ResolvedRule[] {
  return rules.flatMap((rule) => {
    const versions = versionsForTerm(rule, term);
    if (versions.length === 0) return [];
    const changes = versions.slice(1).map((applicable, i) => ({
      on: applicable.from,
      quoteChanged: applicable.version.statuteQuote !== versions[i]?.version.statuteQuote,
    }));
    return [{ rule, versions, changes }];
  });
}
