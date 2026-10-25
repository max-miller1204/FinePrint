# Rule pack

The legal rules every lease check cites (spec §7.4, #12). Data only:
`jurisdictions/<state>/rules/*.json`, each quoting a dated statute snapshot
in `jurisdictions/<state>/snapshots/`. Legal checks come from here, never
from model memory. No route of its own: the lease pipeline (#14) reads it
through `server/src/rules/`. How to add a state:
[`jurisdictions/TEMPLATE/README.md`](../../../../jurisdictions/TEMPLATE/README.md).

## Sub-features

- Schema: `jurisdictions/schema/rule.schema.json` (JSON Schema 2020-12).
  `checkType: "deterministic"` requires `deterministic: { fn, inputs }`,
  and other types forbid it. `verifiedBy` and `verifiedAt` come together.
  Each version has `effectiveFrom`, `effectiveUntil` (exclusive, or
  `null`), `statuteQuote`, and `snapshotFile`.
- Loader: `loadRulePacks()` / `loadRulePack(dir, { requireVerified })` in
  `server/src/rules/loader.ts`. It throws `RulePackError` with every issue
  when a file fails the schema, a quote is not verbatim in its snapshot's
  text (the header doesn't count), versions overlap or are out of order, an
  open-ended version is not last, the file name is not `<id>.json`, the
  id or `jurisdiction` does not match the folder, or the deterministic
  check is unknown or its inputs are wrong. `verifiedThrough` is the oldest
  `verifiedAt`, or `null` while any rule is unverified.
- Check registry: `server/src/rules/checks.ts`: `lateFeeCap`,
  `securityDepositCap`, `depositPlusInsuranceCap` (adds the optional
  `renterInsurancePremium`, which § 55.1-1208(A)(7) counts since its 2026
  amendment), `maintenanceNoticeHours`. Pure functions on verified key
  terms, money in integer cents. Each returns `violates`, `complies`, or
  `insufficient_input` (missing, negative, or NaN), with `limit` and
  `actual`.
- Resolver: `server/src/rules/resolve.ts`. `versionsForTerm(rule, { start,
  end })` returns every version in force at some point of the lease term
  (`end` is the inclusive last day; `null` for a periodic tenancy), each
  with the slice of the term it covers. `resolveRules` adds `changes[{ on,
  quoteChanged }]` for rules that change mid-lease. `versionOn(rule,
  date)` is S6's "is this version in force on that day" check.
- Snapshots: `node scripts/refresh-snapshots.ts` re-fetches every snapshot
  from law.lis.virginia.gov and prints `ok`, `CHANGED` (with the changed
  paragraphs), `NEW` (a version on the page with no snapshot), or `GONE`.
  It exits 1 when anything differs. `--write` writes new dated files and
  names the rules to re-check. `--add <url> <state>` snapshots a new section.
- Pack today (#13, #43, #93): 31 VA rules over 19 snapshots (§§ 55.1-1204,
  -1208, -1214, -1220, -1226, -1228, -1229, -1235, -1236, -1240, -1244,
  -1251, -1252, -1253, -1258). Deterministic: `VA_LATE_FEE_CAP`,
  `VA_DEPOSIT_CAP`, `VA_DEPOSIT_PLUS_INSURANCE_CAP`,
  `VA_ROUTINE_MAINTENANCE_NOTICE_72H`. Informational:
  `VA_RENT_ESCROW_PROCESS`. The rest are semantic. The second batch covers
  retaliation, entry, early termination for military orders and for
  victims of family abuse (with no liquidated damages for either), lockouts
  and utility shutoffs, repair fees, payment processing fees, unilateral
  lease and rule changes, renewal notice, the holdover penalty cap, the
  duty to mitigate, and fire or casualty damage. Five sections have a
  future version: § 55.1-1204 (July 1, 2027; same quote for
  `VA_LATE_FEE_CAP`, `VA_TENANT_RIGHTS_STATEMENT`,
  `VA_PAYMENT_PROCESSING_FEE`, `VA_NO_UNILATERAL_CHANGE`, but
  `VA_RENEWAL_NOTICE` changes: rent increase notice goes from 60 to 90
  days), § 55.1-1244 (January 1, 2027; the escrow payment moves from B 2
  to C), § 55.1-1258 (January 1, 2027; retaliation rewritten, acts listed
  in B), and § 55.1-1240 (January 1, 2027; casualty notice 14 to 21 days).
  Every rule has `verifiedBy` and `verifiedAt` (Max Miller, 2026-10-24),
  set after a person checked every quote and subsection letter against
  its snapshot, so the pack loads with `requireVerified: true` and
  `verifiedThrough` is 2026-10-24.
- Golden cases: `eval/datasets/clauses-golden.jsonl` holds 45 clause
  excerpts for the 15 rules added in #43 and #93: two that break each rule
  (`match`) and one benign look-alike (`no_match`). `pnpm verifier` in
  `eval/` runs them through the S7 verifier ([lease-pipeline](lease-pipeline.md));
  the S5 runner and cases for the first 16 rules come with #20.

## How to get to it (user POV)

Not reachable from a route yet. The lease pipeline
([lease-pipeline](lease-pipeline.md), #14) reads it: S4 runs the registry,
S5 puts every rule's `summaryForModel` and `paraphraseExamples` in the
prompt, and S6 checks each cited rule against the lease dates with
`resolveRules`. The lease routes ([leases](leases.md), #16) load every
verified pack on first use; a rental outside a pack's state is 422
`UNSUPPORTED_JURISDICTION`. The Cloud Run image copies `jurisdictions/` to
`/jurisdictions`.

## Driving it with e2e

No e2e test until a route reads the pack. `server/test/rules.test.ts`
covers it under `pnpm test`: it loads the real packs (all 31 VA rule ids,
both § 55.1-1244 versions with `quoteChanged: true` for an October 2026
lease, the mid-lease changes of § 55.1-1258, -1240, and -1204(K), and
`requireVerified: true`), checks that every `clauses-golden` case names a
real rule and every rule added after #13 has a `match` and a `no_match`, checks the resolver
(both § 55.1-1204 versions for an October 2026 to October 2027 lease, the
exclusive and inclusive boundaries, open-ended terms, gaps, bad dates), runs
every check (including the cent that tips 10% over), breaks a scratch copy
of the pack one way at a time, runs `scripts/check-jurisdictions.ts` against
a snapshot whose subsection E was reworded (exit 1), and parses a fixture of
a two-version law.lis.virginia.gov page.

## Proof

`pnpm check:jurisdictions` prints `jurisdictions: 33 JSON file(s) parse, 32
rule(s) valid with quotes in their snapshots` and exits 0 (the 31 VA rules
and the TEMPLATE example). `node scripts/refresh-snapshots.ts` prints `ok`
for all 19 VA snapshots and exits 0 while the site's text is unchanged.

## Charters

The lease upload charter in [leases](leases.md) covers it.
