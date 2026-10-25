# Render handoff: FinePrint demo video (final cut)

This folder is the finished Remotion project for the hackathon demo video. The cut is locked, so rendering it again gives the same video. A reference render is already in `render/fineprint-demo-final.mp4` (1:56.3, 1920x1080, 30 fps, H.264 + AAC, 15.5 MB). Re-render only if that file is lost or you change something.

## Render on a faster machine (about 5 minutes)

Requires Node 20+. Remotion downloads its own Chrome and ffmpeg on first run.

```bash
cd video
npm install
npm run music            # rebuilds public/music-bed.wav (30 MB, left out of git; deterministic)
npx remotion render FinePrintDemo out/fineprint-demo-final.mp4 --concurrency=<number of CPU cores>
```

- Do **not** run `npm run vo`. The voiceover WAVs in `public/vo/` and `public/vo/manifest.json` are committed and match `src/script.ts`. Re-running it is only needed after a script change, and it downloads a 330 MB model.
- Check the length: `npx remotion compositions` should list `FinePrintDemo` at 3489 frames (116.30 s).
- On the original machine (6-core Mac running the x64 build of Node), the render took 16 minutes at `--concurrency=6`.
- Preview and scrub: `npm run studio`.

## What's in the cut

Problem → Solution → AI and track fit → Impact. Every phone screen is real simulator footage: the demo build against a live server making real Gemma 4 calls. Nothing is mocked, and no scene carries a `<TestTag>`.

| Scene | Time | Content |
|---|---|---|
| Hook | 0:00 | Va. Code § 55.1-1214(A) five-day rule, Jordan (VT junior) |
| Stakes | 0:10 | 64% of Blacksburg households rent; 24% of recent movers got no deposit back |
| Title | 0:16 | FinePrint |
| MoveIn | 0:18 | Clips 03, 04, 06: walkthrough, "Too dark" warning, retake, SHA-256 fingerprint, seal |
| Lease | 0:41 | Clips 08, 09, 10: on-device redaction, What Gets Sent, live Gemma 4 lease check (3:40 real wait shown 20× faster and labeled), stage tracker with real server timings (26B, 31B verifier, code checks), 12 findings, the late-fee finding against § 55.1-1204(E) |
| Ask | 1:12 | Clips 11, 12: grounded answer with citation chip; out-of-scope handoff to Virginia Legal Aid (waits shown 3× faster and labeled) |
| Safety | 1:26 | Eval numbers: 100% of 65 high-stakes cases flagged (docs/ai-pipeline.md) |
| Delete | 1:32 | Clip 13: Delete Everything and the receipt |
| Close | 1:38 | Architecture, `./deploy.sh`, cost per lease (8 calls, 29,351 prompt tokens), Apache-2.0, repo link |

## Files

- `src/script.ts`: voiceover lines and caption cues.
- `src/Phone.tsx`: phone frame, clip segments (trim, speed-ramp, hold) and tap ripples.
- `src/scenes/Footage.tsx`: segment lists for each footage scene, plus the Gemma stage tracker.
- `public/clips/cNN.mp4`: the simulator recordings from `~/fineprint-clips/clip-NN-*.mp4`, re-encoded to constant 30 fps at 600 px wide. The originals are variable frame rate, which throws off trim points.
- `src/Sheet.tsx`: a dev-only contact-sheet composition used to pick trim points. Not part of the video.
- `MoveIn.tsx`, `Gemma.tsx` and `Integrity.tsx` in `src/scenes/` are the old mock scenes. They're no longer in the cut.

## Checked

- All 78 frames sampled from the render (one every 1.5 s) show working screens. There are no error states, placeholder tabs, unbuilt screens or hanging spinners. The "Too dark" warning and the legal-aid handoff are intended.
- The voiceover never uses the late-fee "before you sign" line.
- Two features exist in the repo but aren't in any clip, so the video doesn't claim them: the hidden-AI-instruction flag (the synthetic lease doesn't trigger it) and Cloud Run min-instances 0 (not set in `deploy.sh`).
