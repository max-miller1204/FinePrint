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
- Pack today (#13): 16 VA rules over 9 snapshots (§§ 55.1-1204, -1208,
  -1214, -1220, -1226, -1229, -1244). Deterministic: `VA_LATE_FEE_CAP`,
  `VA_DEPOSIT_CAP`, `VA_DEPOSIT_PLUS_INSURANCE_CAP`,
  `VA_ROUTINE_MAINTENANCE_NOTICE_72H`. Informational:
  `VA_RENT_ESCROW_PROCESS`. The rest are semantic. Two sections have a
  future version: § 55.1-1204 (July 1, 2027; `VA_LATE_FEE_CAP` and
  `VA_TENANT_RIGHTS_STATEMENT`, same quote in both) and § 55.1-1244
  (January 1, 2027; the escrow payment moves from B 2 to C, so the quote
  changes). Every rule has `verifiedBy` and `verifiedAt` (Max Miller,
  2026-10-24), set after a person checked every quote and subsection
  letter against its snapshot, so the pack loads with
  `requireVerified: true` and `verifiedThrough` is 2026-10-24.

## How to get to it (user POV)

Not reachable from a route yet. The lease pipeline
([lease-pipeline](lease-pipeline.md), #14) reads it: S4 runs the registry,
S5 puts every rule's `summaryForModel` and `paraphraseExamples` in the
prompt, and S6 checks each cited rule against the lease dates with
`resolveRules`. The route, `POST /v1/rentals/:id/leases`, is #16.

## Driving it with e2e

No e2e test until a route reads the pack. `server/test/rules.test.ts`
covers it under `pnpm test`: it loads the real packs (all 16 VA rule ids,
both § 55.1-1244 versions with `quoteChanged: true` for an October 2026
lease, and `requireVerified: true`), checks the resolver
(both § 55.1-1204 versions for an October 2026 to October 2027 lease, the
exclusive and inclusive boundaries, open-ended terms, gaps, bad dates), runs
every check (including the cent that tips 10% over), breaks a scratch copy
of the pack one way at a time, runs `scripts/check-jurisdictions.ts` against
a snapshot whose subsection E was reworded (exit 1), and parses a fixture of
a two-version law.lis.virginia.gov page.

## Proof

`pnpm check:jurisdictions` prints `jurisdictions: 18 JSON file(s) parse, 17
rule(s) valid with quotes in their snapshots` and exits 0 (the 16 VA rules
and the TEMPLATE example). `node scripts/refresh-snapshots.ts` prints `ok`
for all 9 VA snapshots and exits 0 while the site's text is unchanged.

## Charters

None until a route reads the pack. The lease route's charter (#16) covers it.
