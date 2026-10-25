# Adding a state

A rule pack is data only: JSON rules that quote statute snapshots. The
server never asks a model what the law is; every legal check comes from
here (spec §7.4). This folder is a working example pack. CI validates it
like a real one, and the server does not load it.

## 1. Create the pack

```
jurisdictions/<state>/        lower-case two-letter code, such as va
  rules/<ID>.json             one rule per file, named by its id
  snapshots/<section>@<fetched>.txt
```

The server loads every folder under `jurisdictions/` except `schema/` and
`TEMPLATE/` (`server/src/rules/loader.ts`), and keys it by the folder name
upper-cased.

## 2. Snapshot each statute section

A snapshot is the section's text, verbatim, with the date it was fetched:

```
Source: <the official URL>
Fetched: YYYY-MM-DD
Heading: <the section heading as the site shows it>
---
<one paragraph per line, copied exactly>
```

For Virginia, `scripts/refresh-snapshots.ts` writes these for you, one
file per effective-dated version on the page:

```bash
node scripts/refresh-snapshots.ts --add https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1226/ va
```

A version that is not in force yet gets `~<effective date>` in its name,
such as `55.1-1204~2027-07-01@2026-10-25.txt`. Another state's site needs
its own parser in that script, or a snapshot written by hand in this format.

Never edit a snapshot's text. When the law changes, add a new dated file.

## 3. Write each rule

Copy `rules/XX_EXAMPLE_LATE_FEE_CAP.json`. The schema,
[`../schema/rule.schema.json`](../schema/rule.schema.json), describes every
field. The ones that need care:

- `id`: `<STATE>_<NAME>`, and the file is `<id>.json`.
- `versions`: oldest first. `effectiveUntil` is the day the next version
  takes effect (exclusive), or `null` for no end date. Versions must not
  overlap, and only the last may have `null`. When a section has a future
  version, give the rule one version per snapshot, even when the quoted
  sentence is the same in both: a lease that spans the change date is
  checked against both, and the tenant is told the law changes mid-lease.
- `statuteQuote`: copied from the snapshot body, character for character.
  CI fails if it is not there.
- `checkType`: `deterministic` when code can decide it from numbers in the
  lease (name a check from `server/src/rules/checks.ts` in
  `deterministic.fn`, and the key terms it reads in `deterministic.inputs`;
  add a check there, with tests, if none fits), `semantic` when the model
  maps clauses to it, `informational` when it only drives guidance.
- `verifiedBy` and `verifiedAt`: leave both out. A person sets them after
  checking every quote and subsection letter against the snapshot. Never
  set them from a tool.

## 4. Check it

```bash
pnpm check:jurisdictions                      # schema and quotes, as CI runs it
pnpm --filter @fineprint/server test rules    # loads every pack with the server's loader
node scripts/refresh-snapshots.ts             # snapshots still match the official site
```
