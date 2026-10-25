# Triage and escalation

The check that sends a tenant to a person when a situation is high stakes
(spec §4.3 F10, §7.9, §12; #37). Gemma (the `triage` stage, 26B, enum
output) and a keyword backstop (EN and ES term lists) run side by side;
either one firing escalates. Recall over precision. The handoff sheet the
app shows on `escalate: true` is #38.

## Sub-features

- `POST /v1/triage` with `{ source, text, imageCaptions?, locale? }`.
  `source` is `lease`, `ask`, `repair`, or `landlord_report`; `text` is 1 to
  200,000 characters after trimming; up to 20 `imageCaptions` of 1,000
  characters; `locale` is a BCP 47 tag, default `en`. 200 with `{ escalate,
  category, model, keywords }`. Nothing is stored.
- `category` is one of `none`, `eviction_or_court`, `lockout`,
  `utility_shutoff`, `retaliation`, `discrimination`, `domestic_violence`,
  `immediate_danger`, `self_harm`: the model's when it fired, else the
  backstop's.
- `model` is `{ status: "ok", category, confidence }`, `{ status: "off" }`
  (no `GEMINI_API_KEY`, and `GEMMA_PROVIDER` is not `openai_compatible`), or `{ status: "unavailable" }` (every model in the
  chain failed or answered off schema; logged as `triage model unavailable`).
  The backstop decides alone in the last two cases. The model reads the
  first 8,000 characters; the backstop reads all of it.
- `keywords` is `{ category, confidence, matches }`; `matches` are term ids
  such as `en.lockout.changed-locks`, never the tenant's text. Terms scoped
  `any` (court papers, self-harm) run on every source; `message` terms
  (lockout, shutoffs, danger, ...) run only on `ask` and `repair`, so a
  lease clause about unlawful detainer or locks does not fire.
- 400 `BAD_REQUEST` naming the field, never the value (unknown fields,
  bad source, empty text, bad locale). 413 over 1 MB. 401 without a token.
- Log: one `triage` line per check (`source`, `escalate`, `category`,
  `modelStatus`, `modelCategory`, `keywordCategory`, `keywordMatches`,
  `textChars`), plus the Gemma client's `model call` line. No content.
- The lease (#16), Ask (#41), responsibility/repair (#31, #32), and
  landlord report (#28) routes will call the same `triage.check` on their
  own input when they land.

## How to get to it (user POV)

The app posts the text before it starts a model-backed flow (a scanned
lease, an Ask message, a repair description, a landlord report) and opens
the handoff sheet when `escalate` is true.

## Driving it with e2e

`tests/web/triage.e2e.ts`: an eviction summons sent as `lease` escalates
(`eviction_or_court`, `en.eviction_or_court.summons`), a lease clause about
unlawful detainer does not, a Spanish lockout in Ask escalates, a bad
source is 400 and no token 401, and `server.log` has the `triage` line and
none of the text. The server gets `GEMINI_API_KEY` and `GEMMA_*` through
`inheritEnv`: a plain run has the model `off`; wrap it to ask Gemma too:

```bash
cd e2e
npx e2e run tests/web/triage.e2e.ts --target web                                   # backstop only
op run --env-file ~/.config/fineprint/.env -- npx e2e run tests/web/triage.e2e.ts --target web   # Gemma too
```

The escalation eval (40 high-stakes, 40 benign, EN and ES) is
`eval/datasets/escalation.jsonl`:

```bash
pnpm --filter @fineprint/server test                                  # CI gate: backstop recall 100% on the set
cd eval && op run --env-file ~/.config/fineprint/.env -- pnpm escalation   # live: Gemma, backstop, combined
cd eval && pnpm escalation --keywords-only                            # no key
cd eval && op run --env-file ~/.config/fineprint/.env -- pnpm escalation --heldout   # held-out set, report only
```

`--heldout` runs `eval/datasets/escalation-heldout.jsonl` (#90): 25
high-stakes and 24 benign phrasings written without reading the keyword
lists. It prints the same table, ends with `REPORT: combined recall ...`,
and always exits 0. Results are in `docs/ai-pipeline.md` (2026-10-24:
backstop 52.0%, Gemma 100%, combined 100%).

## Proof

The 200 body with `escalate: true` for the summons; `modelStatus` `ok` or
`off` in the `triage` log line, matching how the run was started. The live
eval prints `PASS: combined recall 100.0%` and exits 0; it fails on any
miss or any case Gemma could not answer.

## Charters

```
triage-handoff|web|skeptic|POST /v1/triage with inputs a frightened tenant might write, in English and Spanish, with typos and slang, and inputs that only look scary (lease boilerplate, a neighborhood power outage). A high-stakes input that does not escalate is a bug; a false alarm is a note, not a bug.
```

## Gotchas

- Precision is not gated. Gemma flags some look-alikes (a landlord report
  noting the locks were changed before move-in; weak heat in a repair).
- Each check is one 26B call (free, 30 RPM, 16K input tokens per minute
  shared with the other 26B stages).
- The backstop passing 100% of the set is the CI floor, not proof it
  generalizes: the terms were written alongside the set. On the held-out
  set it catches 52% (13/25). Add a missed real phrasing to
  `escalation.jsonl` first, then to `server/src/ai/triage/keywords.ts`.
  Never add held-out cases to the term lists; that makes the set useless.
