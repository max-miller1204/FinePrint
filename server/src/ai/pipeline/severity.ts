// The severity decision table (spec §7.3), in code:
//
//   S4/S5 assessment               S7 verifier            result
//   deterministic violation (S4)   not needed             unenforceable
//   violates                       agree                  unenforceable
//   violates                       disagree or unclear    ask
//   unclear                        any                    ask
//   complies but notable           n/a                    info
//   not_covered                    n/a                    info, no legal claim
//
// A code finding (`check`, `absence`) is the deterministic row. A violation
// no verifier answered for is `ask`: one model's word is not enough for
// "likely unenforceable". The result is then capped at the rule's
// `severityIfViolated`, so a rule the pack marks `ask` (a landlord duty, not
// a clause a court strikes) never reads as unenforceable.

import type { Severity } from '../../rules/types.js';
import type { Assessment } from '../schemas/lease.js';
import type { FindingBasis, VerifierVerdict } from './types.js';

export const SEVERITY_RANK: Record<Severity, number> = { unenforceable: 0, ask: 1, info: 2 };

// The app's labels (spec §4.3 F1).
export const SEVERITY_LABEL: Record<Severity, string> = {
  unenforceable: 'Likely unenforceable',
  ask: 'Worth asking about',
  info: 'Good to know',
};

export interface SeverityInput {
  basis: FindingBasis;
  assessment: Assessment;
  // Only for an S5 `violates`.
  verdict: VerifierVerdict | null;
  // The rule's `severityIfViolated`; null for `not_covered`.
  cap: Severity | null;
}

function fromTable({ basis, assessment, verdict }: SeverityInput): Severity {
  if (basis !== 'mapping') return 'unenforceable';
  switch (assessment) {
    case 'violates':
      return verdict === 'agree' ? 'unenforceable' : 'ask';
    case 'unclear':
      return 'ask';
    case 'complies':
    case 'not_covered':
      return 'info';
  }
}

export function severityFor(input: SeverityInput): Severity {
  const severity = fromTable(input);
  return input.cap && SEVERITY_RANK[input.cap] > SEVERITY_RANK[severity] ? input.cap : severity;
}
