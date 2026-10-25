# Grounded Ask

`POST /v1/rentals/:id/ask` requires a Firebase bearer token belonging to the
rental owner. The body is `{message, history?, locale?}`. Message limit: 2,000
characters. History: at most six `{role: "user" | "assistant", text}` turns,
each at most 4,000 characters. Requests and responses are not persisted or
logged. Responses set `Cache-Control: no-store`.

Triage checks the message and previous user turns before Ask runs. A high-stakes
input returns an escalation decision and legal-aid resources without running Ask.
Missing model configuration or an unavailable model returns 503 so the device
can retain the draft for retry.

Gemma receives native read-only function declarations on Gemini and OpenAI
compatible providers. The shared client supplies quota limiting, usage metadata,
validation, retries and fallback. Four tool executions are allowed, followed by
one final model turn without tools. Tool arguments are validated before dispatch.
The conversation and tool results are delimited as untrusted documents.

Tools can only read the authorized rental:

- `search_lease_clauses(query)`: up to ten matching clauses from up to ten
  analyzed leases, with lease-qualified clause references.
- `get_rule(rule_id)`: a verified rule's quote and source for today's effective
  version. The model receives the available rule IDs to discover the pack.
- `list_evidence(room?, item?)`: up to thirty uploaded, non-deleted photo records,
  without storage paths or image interpretation.
- `get_deadlines()`: the move-in report date from recorded occupancy and the
  deposit-clock condition. An exact deposit date is unavailable without the
  vacating date. Report receipt and objection dates are device-only and are not
  inferred.

Answers contain `sentences[{text,citations[{kind,ref,label,text,url?}]}]`,
`outOfScope`, `message`, `resources`, and `escalation`. The server drops units
containing multiple sentences, empty citation lists, or any citation not found
in this request's tool results. Device history never authorizes a citation.
The gate checks provenance, not whether a model's interpretation is correct.
No surviving sentences produces the fixed out-of-scope legal-aid handoff.

The iOS Ask tab keeps up to twenty exchanges per rental in view memory. It sends
only the last six turns. Closing the session discards history. Source chips show
quotes inline to avoid the existing tab accessory presentation hang. The input
stays available after failures. Requests returning after a rental switch stay
with the original rental; deleted rentals discard pending results.

## Verification

From `e2e/`, run:

```
pnpm exec e2e run --config e2e.ask.config.ts --target web --output .e2e/proof/ask --reporter list,markdown
```

This runs smoke, Ask, auth, rentals and triage in one invocation. The test-only
provider responds through the real OpenAI compatible HTTP transport. Firebase
uses isolated ports in `firebase.ask.json` to avoid other worktrees. This proves
route behavior and the citation gate, not model quality.

Live eval from the repo root:

```
op run --env-file ~/.config/fineprint/.env -- pnpm --filter @fineprint/eval ask
```

Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in the secret manager and enable Gemma
quota for `gemma-4-26b-a4b-it`. Never paste keys in chat. Self-hosted deployments
can use `GEMMA_PROVIDER=openai_compatible`, `GEMMA_BASE_URL`, and optionally
`GEMMA_API_KEY`. Results are written to `eval/out/ask.json`. Missing credentials,
model failure and missed expectations fail the eval. This is an English Ask eval;
Spanish parity work remains in #45.

## TestFlight device checks

Linux cannot compile or drive iOS. The `iOS build` workflow compiles the app on
macOS; the existing TestFlight workflow archives and distributes it. No iOS e2e
or visual verification is claimed from Linux. Deploy the updated server before testing the new client against the deployed URL.
After a TestFlight build is ready:

1. Sync a Virginia rental and open Ask. Check suggestions for each rental phase.
2. Ask about the move-in report or deposit cap. Expand each citation and follow
   its statute link. Check the quote matches the answer.
3. Ask an unrelated question and check the legal-aid handoff. Describe a lockout
   and check the high-stakes handoff instead of an ordinary answer.
4. Send a follow-up, switch rentals during a request, and confirm conversations
   stay separate. Close the app and confirm session history is discarded.
5. Disable networking, send a question, then reconnect and retry the retained
   draft. Check the spinner ends and duplicate submissions are disabled.
6. Check AX5 Dynamic Type, VoiceOver, dark mode, Reduce Motion, Increase Contrast,
   long questions, multiline quotes, and keyboard dismissal. No legal text should
   truncate and every source control should remain reachable.
