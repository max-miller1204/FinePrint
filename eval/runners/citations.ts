// The `citations` eval gate (spec §12, #20): every finding from the other
// sets must resolve, 100% or the eval fails.
//
// A finding resolves when:
//   - its lease quote is the exact slice of the lease at its quoteSpan, and
//     not empty. An `absence` finding has no quote; the wording it says is
//     missing (REQUIRED_WORDING) must really be missing from the lease.
//   - its rule exists in the pack, with the pack's citation and source URL;
//     it has at least one rule version, each one a version of that rule;
//     every version's statuteQuote is verbatim in the body of its snapshot
//     file; and its statuteQuote is the first version's.
//   - a finding with no rule (`not_covered`) carries no citation, statute
//     quote, or versions.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_WORDING } from '../../server/src/ai/pipeline/checks.js';
import type { Finding } from '../../server/src/ai/pipeline/types.js';
import { snapshotBody } from '../../server/src/rules/loader.js';
import type { RulePack } from '../../server/src/rules/types.js';

export interface CitationSource {
  set: string;
  id: string;
  text: string;
  findings: readonly Finding[];
}

export interface CitationFailure {
  set: string;
  id: string;
  findingId: string;
  ruleId: string | null;
  problem: string;
}

export interface CitationsResult {
  findings: number;
  resolved: number;
  rate: number | null;
  pass: boolean;
  failures: CitationFailure[];
}

// Reads a snapshot body once per file.
export function snapshotReader(packDir: string): (file: string) => string | null {
  const cache = new Map<string, string | null>();
  return (file) => {
    if (!cache.has(file)) {
      let body: string | null = null;
      try {
        body = snapshotBody(readFileSync(join(packDir, file), 'utf8'));
      } catch {}
      cache.set(file, body);
    }
    return cache.get(file)!;
  };
}

export function citationProblems(text: string, f: Finding, pack: RulePack, snapshot: (file: string) => string | null): string[] {
  const problems: string[] = [];

  if (f.basis === 'absence') {
    if (f.leaseQuote !== null || f.quoteSpan !== null) problems.push('absence finding with a lease quote');
    const wording = f.ruleId ? REQUIRED_WORDING[f.ruleId] : undefined;
    if (!wording) problems.push('absence finding for a rule with no required wording');
    else if (wording.test(text.replace(/\s+/g, ' '))) problems.push('required wording is in the lease');
  } else if (!f.leaseQuote || !f.quoteSpan) {
    problems.push('no lease quote');
  } else if (text.slice(f.quoteSpan.start, f.quoteSpan.end) !== f.leaseQuote) {
    problems.push('lease quote is not the lease text at its span');
  }

  if (f.ruleId === null) {
    if (f.citation !== null || f.statuteQuote !== null || f.versions.length > 0) problems.push('no rule, but a citation or statute quote');
    return problems;
  }
  const rule = pack.byId.get(f.ruleId);
  if (!rule) return [...problems, 'rule not in the pack'];
  if (f.citation !== rule.citation) problems.push('citation differs from the pack');
  if (f.sourceUrl !== rule.sourceUrl) problems.push('source URL differs from the pack');
  if (f.versions.length === 0) problems.push('no rule version');
  for (const v of f.versions) {
    const known = rule.versions.some((rv) => rv.effectiveFrom === v.version.effectiveFrom && rv.statuteQuote === v.version.statuteQuote && rv.snapshotFile === v.version.snapshotFile);
    if (!known) problems.push(`version from ${v.version.effectiveFrom} is not in the pack`);
    const body = snapshot(v.version.snapshotFile);
    if (body === null) problems.push(`snapshot ${v.version.snapshotFile} missing or has no body`);
    else if (!body.includes(v.version.statuteQuote)) problems.push(`statute quote not verbatim in ${v.version.snapshotFile}`);
  }
  if (f.statuteQuote !== (f.versions[0]?.version.statuteQuote ?? null)) problems.push("statute quote is not the first version's");
  return problems;
}

export function checkCitations(sources: readonly CitationSource[], pack: RulePack, packDir: string): CitationsResult {
  const snapshot = snapshotReader(packDir);
  const failures: CitationFailure[] = [];
  let findings = 0;
  let resolved = 0;
  for (const s of sources) {
    for (const f of s.findings) {
      findings++;
      const problems = citationProblems(s.text, f, pack, snapshot);
      if (problems.length === 0) resolved++;
      else for (const problem of problems) failures.push({ set: s.set, id: s.id, findingId: f.id, ruleId: f.ruleId, problem });
    }
  }
  const rate = findings === 0 ? null : resolved / findings;
  // No findings at all is no evidence: the gate needs something to check.
  return { findings, resolved, rate, pass: findings > 0 && resolved === findings, failures };
}
