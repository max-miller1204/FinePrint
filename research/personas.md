# Personas

The four personas from spec §3.2, expanded with what the research in
[user-voices.md](user-voices.md) shows. The personas are composites; the
quotes attached to them are real and unchanged, from different people. See
[insights.md](insights.md) for the themes.

## Jordan (primary)

**Who:** VT junior signing a first off-campus lease in Blacksburg, a
12-month lease with three roommates. Has never read a lease end to end.
Owns an iPhone. Main fear: losing a $1,800 deposit share.

**When they use FinePrint:** at signing (Lease tab), move-in (Evidence),
and move-out (Evidence, deposit tracker).

**What the research adds:**
- Blacksburg students do read their leases and find alarming clauses, but
  can't tell legal from unenforceable, and feel locked in once fees are
  paid.
- Joint and several liability is the clause Jordan is most likely to miss:
  each roommate owes the whole rent and the others' damage.
- Roommates often treat documenting move-in as overkill. The one who does
  it saves everyone's deposit.

**Voices:**

> Stuff like they can put someone to stay in your bedroom with you and you can't do anything about it.

Q18, r/Blacksburg, Blacksburg student before signing

> Even if you paid your half of the rent, if they didn’t pay theirs, you are on the hook for that, unless you had a separate lease agreement.

Q23, r/rva, Richmond landlord

> My roommates tried to make fun of me for being so specific in documenting everything when we moved in, like pictures and videos, but I ended up saving us all hundreds of dollars in the end.

Q8, r/rva, Richmond student renter

> I would also like to note that I unfortunately didn’t take any pictures at the time of move in but neither did the landlord because this all seems to be under the table sketchy type stuff in the sense that they just needed someone to take the room to get their money.

Q15, r/Renters, California

**Design implications:**
- The Lease Explainer must work before signing, from a PDF the complex
  emails, not only from a scanned paper lease.
- Flag joint and several liability as `Good to know` in plain language.
- Make move-in capture fast enough that roommates don't mock it: room
  presets, "Mark no damage", and progress per room.

## Marisol (secondary)

**Who:** a parent in Annandale (Northern Virginia). Spanish is their first
language; they work shift jobs and read English legal text slowly. The
heater broke in January and the landlord has not responded.

**When they use FinePrint:** the Repairs tab, in Spanish.

**What the research adds:**
- Repair waits run weeks to months, and the landlord often offers a space
  heater or fan instead of a fix.
- Parents worry first about a child in an unsafe home, and feel like a
  nuisance for asking again.
- No first-person language-barrier quote was found (see insights). The one
  voice is a property manager describing a tenant who does not speak
  English and was back-charged for years of utilities.

**Voices:**

> I’ve explained I understand things are probably busy now with the heat wave, but I am worried about my dog and baby in this heat.

Q25, r/nova, Northern Virginia parent

> I feel like a jerk trying to contact them repeatedly to get some answers.

Q25, r/nova, Northern Virginia parent

> Landlord does not want to pay the $900 so he is waiting for it to be covered by warranty which is why it will take 2-3 weeks.

Q19, r/Tenant, South Carolina

> The past tenant does not speak English. She claims that when she moved in, she thought she called the utility company and was good to go.

Q26, r/PropertyManagement, property manager

**Design implications:**
- A dated written repair notice (F5) replaces repeated asking, so Marisol
  has a record instead of feeling like a pest.
- Safety guidance comes first for a child in an unsafe home; the escrow
  explainer says never to withhold rent.
- Spanish must cover the whole Repairs flow, including the notice the
  landlord receives (in English, with a Spanish copy for Marisol).
- Validate with Spanish-speaking renters or legal aid: this research did
  not reach them.

## Dana (caseworker)

**Who:** a staff attorney or paralegal at a Virginia legal aid office, or
VT Student Legal Services. Sees 20 tenants a week, each with a shoebox of
screenshots. Opens the shared web Evidence Report on a laptop or phone and
needs a clean timeline, signed evidence, and flagged clauses with citations
in under two minutes.

**When they use FinePrint:** the Legal-Aid Web Evidence Report (F8), and
the High-Stakes Handoff (F10) that sends tenants to them.

**What the research adds:**
- No caseworker voice was collected. The quotes below are what reaches
  Dana: renters who can't afford a lawyer, renters with evidence but no
  confidence, and possible retaliation.
- A paper checklist can be "lost", so Dana needs evidence whose integrity
  can be checked, not just photos.

**Voices:**

> I am pretty clueless about the legal system and don't have the money for a lawyer.

Q20, r/povertyfinance, Georgia

> I am scared that if I file a Small Claims case to get my deposit back, he will countersue me for much more.

Q21, r/nova, Northern Virginia

> I'm trying to act in good faith, but it FEELS like a form of retaliation.

Q10, r/legaladvice, Washington

> My Landlord let me know that he lost my move-in inspection checklist a few days after I gave it to him.

Q22, r/legaladvice

**Design implications:**
- The report leads with the timeline and the deadlines that were met or
  missed (such as the 45-day refund in Q21).
- Verify is per exhibit and whole report, so Dana can trust a photo
  without trusting the tenant's word.
- Triage routes retaliation and countersuit fears to F10, not the AI.

## Ray (counter-persona)

**Who:** a small landlord with four units, burned before by tenants who
claimed damage was pre-existing.

**Why Ray matters:** FinePrint's neutral, signed, timestamped record helps
Ray too, which is why the tone is factual, never adversarial.

**What the research adds:**
- Landlords give the same advice tenants do: document everything.
- Fair landlords want to return deposits and stay professional, but can't
  prove cause without a record.
- The side with an itemized record wins, even against an angry tenant with
  AI-written letters.

**Voices:**

> I am a first time landlord and I am dealing with tenants who pretend to not know why things are broken every time there is a maintenance issue.

Q27, r/PropertyManagement, landlord

> What is the most professional way to handle a situation like this?

Q27, r/PropertyManagement, landlord

> Document everything.

Q17, r/Landlord, commenter

> I explained to him (via text) that he would still owe for that month, and if no damage beyond wear and tear, he would get his full deposit back.

Q6, r/Landlord, Illinois landlord

> Anyhow, they made a racket- sent a bunch of obviously chat-gpt generated emails, sent a demand letter via certified mail, and finally served us and tried to sue us in court for the 2k we had kept from their deposit.

Q11, r/Landlord, California landlord

**Design implications:**
- Letters and reports state facts and cite exhibits; no accusatory
  language. A landlord should be able to read the share report and agree
  with the record.
- The Responsibility Check says "Likely tenant's responsibility" when
  that's the honest answer.
