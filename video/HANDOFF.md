# FinePrint demo video: handoff

Remotion 4.0.538 project for FinePrint's hackathon demo video. 1920x1080, 30 fps. Built on Windows, moving to the Mac.
`fineprint-reference-render.mp4` (sent separately) is the last full render (2:31, test version, Kokoro voiceover).

**First run `npm run music` to rebuild `public/music-bed.wav` (left out of the zip for size; the output is the same every time).**

## Priorities (read before editing anything)

1. **Show working features, in footage of the real app.** Every second of screen time goes to something a judge could do themselves on the demo build. Real simulator footage beats motion graphics, and motion graphics beat mock UI.
2. **Never show anything broken or unbuilt.** No error states (other than the intended "Too dark" warning and the legal-aid handoff), no spinners left running, no placeholder screens, and no tabs that aren't built yet (check which ones are built on the demo branch). Don't mention a feature in the voiceover that the video can't show working. If a clip shows a bug, cut around it or drop the beat. Don't fake around it.
3. **Hit the rubric's major points.** It's 100 points, 25 per category, and the video is the judges' main look at the app. Each beat below should land in a sentence or a shot, without lecturing:

| Rubric (points) | What to show or say for FinePrint |
|---|---|
| Problem definition (10), impact (10), empathy (5) | The five-day rule from Va. Code § 55.1-1214, the stats in Stakes (most Blacksburg households rent, and nearly a quarter of renters who move get no deposit back), and Jordan as the renter going through it |
| AI that's genuinely needed (15) | Gemma 4 reads clauses and maps them to Virginia rules, the 31B model checks the result, and code checks every quote and does the math. Plus triage, and Ask with function calling if it's in the clips. Say why AI is needed: leases are free text, and the rules are specific |
| Architecture and a working prototype (10) | Real app footage end to end, the S1–S9 trace, SHA-256 hashes, KMS-signed manifests and the hash-chained ledger |
| Safety and grounding (10) | Every finding quotes the lease word for word and cites the rule. Ask drops any sentence without a citation. The app flags hidden AI instructions in a lease. High-stakes situations go to people: 100% of high-stakes eval cases escalated |
| Privacy (8) | Lease text is read and personal details are hidden on the phone, and you can review what gets sent. Photo location data is stripped. Delete everything gives you a receipt |
| Inclusive design (7) | VoiceOver announcements on every step, plus burned-in captions in the video itself. Mention it in one line at most, and check the repo before claiming more |
| Easy deployment (10) | One `./deploy.sh` to a legal aid group's own Google Cloud project, on Cloud Run with min-instances 0 |
| Inference cost (8) | The 26B MoE model for most of the work and 31B only to verify, with the measured token use per lease (docs/leases or the cost table) |
| Docs (7) | Apache-2.0, open source, with a link to the repo on the end card |

Track: **Best Use of Gemma 4**. Make Gemma the clear engine of the lease check, not a footnote.
Structure follows the judges' demo order: Problem → Solution → AI and track fit → Impact. Keep it to **2:00 or less**.

## Run

```bash
npm install
npm run studio      # preview and scrub in the browser
npm run render      # out/fineprint-demo.mp4
npx remotion still <SceneId> out/x.png --frame=<n>   # check one frame
```

## How it fits together

- `src/Root.tsx`: the scene list (`BASE`) with base lengths, the 15-frame fades between scenes, the music bed with ducking under the voice, and one composition per scene plus `FinePrintDemo`.
- `src/scenes/*.tsx`: one file per scene: Hook, Stakes, Title, MoveIn, Integrity, Gemma, Safety, Close.
- `src/components.tsx`: shared pieces: `Scene`, `Rise`, `Eyebrow`, `Card`, `Seal`, and `TestTag`, the orange "TEST" pill on any staged or mock scene.
- `src/theme.ts`: colors, fonts (Inter, JetBrains Mono), sizes.
- `src/script.ts`: the voiceover script, cut into caption cues per scene. **This is where you edit the words.**
- `src/timeline.ts`: places each line from its recorded length in `public/vo/manifest.json` and stretches a scene when its lines run long.
- `src/Captions.tsx`: burned-in captions.
- `scripts/make-vo.mjs`: speaks every line in `script.ts` with Kokoro-82M (open weights, Apache-2.0, runs locally, about 330 MB download on first run), normalizes loudness, and rewrites `public/vo/` and `manifest.json`. Run `npm run vo` after any script change. Set `VO_VOICE` to try another voice (default `af_heart`).
- `scripts/make-music.mjs`: synthesizes the original royalty-free music bed (`npm run music`).

## What is real and what is staged

Everything shown uses real project data: the app's UI strings, `server/test/fixtures/lease-synthetic.txt`, rule quotes from `jurisdictions/va/rules`, measured eval numbers, and a real SHA-256. Spec §17 says "do not fake outputs", so any mock or staged screen carries `<TestTag>`. Remove the tag only when that scene uses real footage or real output.

- MoveIn: a phone mock built from the app's real strings. **Replace with simulator footage.**
- Gemma: five findings on the synthetic lease (3 from code checks, 2 mapped by Gemma), with a close-up of the late fee and a trace strip for S1–S5. **Replace or back with real lease findings from the demo branch.**
- Safety: eval case `lockout-01-en`, 100% of 65 high-stakes cases escalated.
- Integrity, Close: motion graphics, which are fine as they are.

## Known issues

- **Too long.** MLH asks for a 2-minute video, and this render is 2:31. Cut words from `script.ts`, re-run `npm run vo`, and re-render.
- `voiceover-script.md` has stale timings (`npm run vo-script` regenerates it from the base lengths only).
- Nobody has listened to the full render yet. Check the pronunciations in the `SAY` map in `make-vo.mjs`, such as SHA-256 read as "shaw two fifty-six".

