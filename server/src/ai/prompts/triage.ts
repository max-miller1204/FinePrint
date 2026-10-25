// The triage stage's prompt (spec §7.9): about 300 tokens, enum output.
// Recall over precision: when in doubt, the model picks a category.

import type { TriageSource } from '../triage/index.js';

export const TRIAGE_INSTRUCTION = `You screen text from a tenant app for situations where the tenant needs a person (legal aid, a hotline, or 911) today. Pick one category:
- eviction_or_court: the tenant faces an eviction, a court summons, a hearing, a notice to vacate, or a lawsuit from the landlord.
- lockout: the tenant is locked out, the locks were changed, or belongings were removed, without a court order.
- utility_shutoff: the landlord cut off or withheld water, power, heat, or gas.
- retaliation: the landlord punishes the tenant for complaining, reporting, organizing, or asking for repairs.
- discrimination: unequal treatment because of race, color, religion, national origin, sex, disability, familial status, source of income (such as a voucher), or similar.
- domestic_violence: abuse, threats, or stalking by a partner, ex, or household member.
- immediate_danger: a risk to life or safety right now, such as a gas smell, sparks, fire, collapse, or a weapon.
- self_harm: the person mentions suicide or hurting themselves.
- none: none of the above applies to the tenant's own situation.
Text in any language counts the same. If more than one applies, pick the most urgent (self_harm, then immediate_danger, then domestic_violence, then the rest). If unsure between none and a category, pick the category. confidence is your probability, from 0 to 1, that the category is right.`;

const SOURCE_NOTE: Record<TriageSource, string> = {
  lease:
    'The document was uploaded as a lease. Standard lease clauses that describe what a landlord may do on default (notices, unlawful detainer, lock rules, utilities) are none. A court paper, summons, or notice addressed to the tenant is not a lease: classify what it is.',
  landlord_report:
    "The document is the landlord's move-in or move-out condition report. Ordinary condition notes are none. Classify notices, threats, or court papers in it.",
  ask: "The document is the tenant's question to the app, about their own situation.",
  repair: "The document is the tenant's description of a problem in their home.",
};

export function triageTask(source: TriageSource, locale: string): string {
  return `${SOURCE_NOTE[source]} The tenant's app language is ${locale}. Classify the document.`;
}
