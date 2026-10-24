# Insights

Synthesis of the 27 quotes in [user-voices.md](user-voices.md) (spec §3.1).
Quotes below are copied from that file unchanged; `Q` numbers link back to
the source entry with its permalink and date.

## Method

- Gathered by hand, one thread at a time, from searches in the §3.1
  subreddits. No scraper, no API.
- 27 quotes from 25 posts and comments. Two posts gave two quotes each
  (Q7/Q8, Q12/Q13).
- 10 from Virginia (Blacksburg 3, Richmond 3, Northern Virginia 3, city not
  stated 1). 6 from landlords or property managers.
- Subreddits: r/Tenant 8, r/nova 3, r/Landlord 4, r/rva 3, r/legaladvice 2,
  r/VirginiaTech 2, r/PropertyManagement 2, r/Renters 1, r/Blacksburg 1,
  r/povertyfinance 1. (Q16 is a tenant posting in r/Landlord.)
- Names of private people and of property companies accused in posts are
  left out of the quotes.
- Posters' legal claims are theirs and were not checked. Where a claim
  looked wrong, the entry says so.

| Theme | Quotes |
| --- | --- |
| `didnt-know-rights` | 14 |
| `deposit-withheld` | 8 |
| `landlord-no-proof` | 8 |
| `preexisting-damage` | 6 |
| `repair-ignored` | 5 |
| `illegal-clause` | 5 |
| `language-barrier` | 1 |

## Top 5 themes

### 1. Renters don't know what the law already gives them (`didnt-know-rights`, 14)

The most common thread is not a bad landlord but a renter who can't tell
where they stand. Even people who do research get it wrong, and many give
up on claims the law supports.

> I'm familiar with tenant laws in NYC, where I lived for many years, but I don't know exactly what are my rights here in PA.

Q9, r/Tenant, Pennsylvania

> The 45-Day Rule: I moved out in August. It is now December. He never sent me an itemized list of deductions or damages. In Virginia, doesn't this mean he forfeits the right to withhold the deposit or claim damages?

Q21, r/nova, Northern Virginia

**Feature that answers it:** Lease Explainer (F1) for what the lease says
and which terms Virginia law overrides, Grounded Ask (F7) for "what are my
rights" questions answered only from the lease and the rule pack, and the
next-deadline accessory for the clocks renters miss (the 5-day objection,
the 45-day deposit refund). Q21 has photos and the law on their side and is
still afraid to file, so the High-Stakes Handoff (F10) to legal aid matters
as much as the explanation.

### 2. Deposits held back with charges the renter can't contest (`deposit-withheld`, 8)

Bills for paint, cleaning, and carpet arrive weeks after move-out, often
for what reads as normal wear, and renters don't know how to push back.

> We received a bill for $932 with a majority of that being fees from prorating the carpet, drip pans, blinds and paint. Is there anything we can do to fight any of these charges?

Q16, r/Landlord, location not stated

> I am a incoming broke medical student and need every dollar I can get back.I have lived in apartments before and never been charged.

Q20, r/povertyfinance, Georgia

**Feature that answers it:** Move-out Ghost Overlay + Diff (F6) pairs each
move-out photo with its move-in twin and labels it `pre_existing_unchanged`,
`new_damage`, or `worsened`, which is how a renter shows "wear and tear"
(excluded from deductions under § 55.1-1226). F6 also starts the 45-day
deposit clock. The Legal-Aid Web Evidence Report (F8) gives anyone who
helps, for free or not, a clean file.

### 3. Nobody can prove what happened (`landlord-no-proof`, 8)

Both sides argue without a record. Tenants are billed with no photos;
landlords suspect damage they can't pin down. The side with documentation
tends to win.

> Showing damage occurred is NOT the same as proving damages are the responsibility of the existing tenant.

Q14, r/Tenant, commenter

> I am a first time landlord and I am dealing with tenants who pretend to not know why things are broken every time there is a maintenance issue.

Q27, r/PropertyManagement, landlord

**Feature that answers it:** Move-in Evidence (F2) seals each photo with a
SHA-256 hash and a server signature at capture time, and the web report
(F8) lets anyone press Verify. The record is neutral: it helps the honest
side, whichever side that is. That is the pitch to landlords like Ray, and
why the app's tone stays factual.

### 4. Charged for damage that was already there (`preexisting-damage`, 6)

The video's hook. Renters who documented move-in got their money back;
renters who didn't, or whose only copy went to the landlord, had nothing.

> My roommates tried to make fun of me for being so specific in documenting everything when we moved in, like pictures and videos, but I ended up saving us all hundreds of dollars in the end.

Q8, r/rva, Richmond, Virginia

> My Landlord let me know that he lost my move-in inspection checklist a few days after I gave it to him.

Q22, r/legaladvice

**Feature that answers it:** Move-in Evidence (F2) walks the renter through
every room and item, and the tenant keeps the sealed original, so it can't
be lost by the other side. Landlord Report Diff + 5-Day Objection (F3)
turns that record into a written objection under § 55.1-1214 before the
landlord's report is "deemed correct". No quote mentions the five-day
clock, which supports the spec's claim that most renters don't know it
exists.

### 5. Repairs left waiting (`repair-ignored`, 5)

Months-long waits, space heaters instead of fixes, and renters who feel
like a nuisance for asking again.

> I notified my landlord that I had no heat on Oct 28th.

Q19, r/Tenant, South Carolina (the fix was pushed to Jan 2)

> I feel like a jerk trying to contact them repeatedly to get some answers.

Q25, r/nova, Northern Virginia (a parent with a baby in an 87-degree house)

**Feature that answers it:** Responsibility Check (F4) says whose job the
repair likely is and why, citing § 55.1-1220. Repair Request (F5) replaces
repeated asking with a dated written notice, nudges at 14 days, and, for
conditions like no heat, explains the court rent-escrow path under
§ 55.1-1244 and says never to withhold rent.

### Runner-up: lease clauses renters can't judge (`illegal-clause`, 5)

Tied with repairs on count. Renters spot odd clauses but can't tell legal
from unenforceable, before signing (Q18, Q24) or after (Q5, Q10, Q12).

> There is a clause in the lease that stipulates in the last 90 days of the agreement, we need to keep the apartment very neat and tidy so the landlord/realtor can show the apartment, and they need to give a minimum of 1 hour notice to enter the property to show the apartment to prospective tenants and we will have a lockbox on the door. 1 hour seems like super short notice to me and so I was wondering if this is standard practice?

Q24, r/nova, Northern Virginia

> When I brought it up he pointed me to a clause in the lease. I went and read it. He wasn't wrong. The wording basically gave him that right and I'd agreed to it.

Q5, r/Tenant, California

**Feature that answers it:** Lease Explainer (F1), with its three tiers.
Q12 shows why the tiers matter: a motivated Blacksburg renter lists a 10%
late fee as abnormal, but it is within Virginia's cap (§ 55.1-1204). Q23
(a Richmond landlord on joint and several liability) is a `Good to know`
clause, legal but surprising. The app must separate `Likely unenforceable`
from `Good to know` and verify each claim, or it repeats the confusion.

## Counterpoints and gaps

- **Generic AI letters lost.** In Q11, tenants who sent "obviously chat-gpt
  generated emails" lost in small claims to a landlord's itemized record.
  FinePrint's letters must cite the actual lease clause, statute, and sealed
  exhibits, and the Responsibility Check must say plainly when the tenant is
  likely responsible.
- **Renters misread the law too.** Q12 and Q21 make legal claims that are
  partly right. Every finding needs a verbatim statute quote, not a summary.
- **Language barriers are under-represented.** Four targeted searches found
  no first-person quote. The only voice (Q26) is a property manager
  describing a tenant who does not speak English. Reddit skews toward
  English-speaking posters, so this is a gap in the source, not evidence
  that the problem is rare. Marisol's Spanish flow rests on the spec, not on
  this research; interviews or local legal-aid input would fill it.
- **No legal-aid voice.** Dana's persona has no first-hand quote; the tenant
  quotes show what reaches a caseworker, not what the caseworker needs.

## Video picks

The spec's hook (§17, 0:00 to 0:15) puts two Reddit quotes on screen about
deposits withheld for pre-existing damage. Show each quote with only its
subreddit and year, no usernames.

1. **Q1, r/Tenant, Virginia, ~2023:** "No pictures, no detailed report,
   nothing else." The problem, from a Virginia renter, in six words.
2. **Q8, r/rva, Richmond, ~2025:** "My roommates tried to make fun of me
   for being so specific in documenting everything when we moved in, like
   pictures and videos, but I ended up saving us all hundreds of dollars in
   the end." The payoff, from a Virginia student renter, right before the
   line "In Virginia, you have five days to object."
3. **Alternate, Q22, r/legaladvice, ~2019:** "My Landlord let me know that
   he lost my move-in inspection checklist a few days after I gave it to
   him." Use it as a cutaway at "Seal move-in report" (§17, 0:45 to 1:20):
   the tenant's sealed copy can't be lost.
