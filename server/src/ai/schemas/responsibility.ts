// What the responsibility check asks the model for (spec §7.7). Every
// citation here is a claim: pipeline/responsibility.ts resolves each one
// against what was sent and drops the reason when it does not resolve.

import { z } from 'zod';

export const VERDICTS = ['likely_landlord', 'likely_tenant', 'could_be_either', 'not_sure'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CATEGORIES = ['normal_wear_and_tear', 'tenant_damage', 'landlord_maintenance', 'pre_existing', 'unknown'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CITATION_KINDS = ['lease', 'rule', 'evidence'] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];

// A sentence runs well under these; a looping answer runs past them, fails
// validation, and is retried.
const MAX_REASON_CHARS = 300;
const MAX_CHANGE_CHARS = 200;

// The `responsibility` stage, on 26B, built per request so `ref` is an enum
// of what was sent: the rule ids in force and the document ids. The model
// cannot cite anything else; code still checks that each ref matches its
// kind and that a lease quote is in its clause.
export function responsibilitySchema(refs: readonly [string, ...string[]]) {
  return z.object({
    verdict: z.enum(VERDICTS),
    category: z.enum(CATEGORIES),
    confidence: z.enum(CONFIDENCES),
    reasons: z
      .array(
        z.object({
          text: z.string().max(MAX_REASON_CHARS).describe('One sentence to the tenant, in plain English.'),
          citation: z.object({
            kind: z.enum(CITATION_KINDS),
            ref: z.enum(refs).describe('A rule id for kind rule, or the id of a lease or evidence document.'),
            quote: z.string().optional().describe('For a lease citation: the exact words of the clause the reason rests on, copied from it.'),
          }),
        }),
      )
      .min(1)
      .max(4),
    whatWouldChange: z.array(z.string().max(MAX_CHANGE_CHARS).describe('One short sentence.')).min(1).max(3),
    escrowEligibleCondition: z.boolean(),
  });
}

export type ResponsibilityAnswer = z.output<ReturnType<typeof responsibilitySchema>>;

// The `responsibility_verify` stage, on 31B. It gives its own verdict from
// the cited text without seeing 26B's, so agreement is not a rubber stamp.
export const ResponsibilityVerifySchema = z.object({
  verdict: z.enum(VERDICTS),
  reasoning: z.string().describe('One or two sentences.'),
});
