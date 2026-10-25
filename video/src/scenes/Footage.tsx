// Real simulator footage (SHOTS.md). Every screen here is the demo build against a live server
// making real Gemma 4 calls; nothing is mocked. Long waits are sped up and labeled.
import type React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { Eyebrow, Rise, Scene } from "../components";
import { Beats, Phone, type Seg, segFrames, segStarts } from "../Phone";
import { colors, fonts } from "../theme";

// A pill over the phone screen while a segment runs faster than real time.
const SpeedPill: React.FC<{ segs: Seg[]; children: (seg: Seg, frame: number) => React.ReactNode }> = ({
  segs,
  children,
}) => {
  const starts = segStarts(segs);
  return (
    <>
      {segs.map((seg, i) =>
        (seg.speed ?? 1) > 1 ? (
          <Sequence key={i} from={starts[i]} durationInFrames={segFrames(seg)} layout="none">
            <PillFrame>{(f) => children(seg, f)}</PillFrame>
          </Sequence>
        ) : null,
      )}
    </>
  );
};

const PillFrame: React.FC<{ children: (frame: number) => React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 17,
          padding: "7px 14px",
          borderRadius: 999,
          background: "rgba(255,159,10,0.92)",
          color: "#1A1200",
          fontWeight: 500,
        }}
      >
        {children(frame)}
      </div>
    </div>
  );
};

// ── Move-in walkthrough: clips 03, 04, 06 ──────────────────────────────────────

const MOVE_IN: Seg[] = [
  {
    clip: "c03",
    from: 0.6,
    to: 7.7,
    taps: [
      { t: 1.0, x: 0.5, y: 0.66 },
      { t: 2.5, x: 0.3, y: 0.373 },
      { t: 4.0, x: 0.25, y: 0.343 },
      { t: 6.0, x: 0.5, y: 0.895 },
    ],
  },
  { clip: "c03", from: 7.7, hold: 1.4 },
  {
    clip: "c04",
    from: 0.6,
    to: 4.6,
    taps: [
      { t: 1.0, x: 0.285, y: 0.964 },
      { t: 3.0, x: 0.5, y: 0.897 },
    ],
  },
  { clip: "c04", from: 4.6, hold: 1.4 },
  { clip: "c04", from: 17.9, to: 19.8, taps: [{ t: 18.4, x: 0.285, y: 0.964 }] },
  {
    clip: "c06",
    from: 0.6,
    to: 4.0,
    taps: [
      { t: 1.0, x: 0.09, y: 0.097 },
      { t: 2.6, x: 0.5, y: 0.74 },
    ],
  },
  { clip: "c06", from: 11.2, to: 13.4, taps: [{ t: 11.6, x: 0.5, y: 0.665 }] },
  { clip: "c06", from: 13.4, hold: 2.0 },
];

export const MOVE_IN_FRAMES = MOVE_IN.reduce((n, s) => n + segFrames(s), 0);

export const MoveInFootage: React.FC = () => (
  <Scene>
    <Phone segs={MOVE_IN} />
    <Beats
      top={280}
      beats={[
        { at: 0, eyebrow: "Move-in walkthrough", title: "Five days to object. FinePrint keeps the clock." },
        { at: 184, eyebrow: "Checked on the phone", title: "Too dark? It tells you why.", color: colors.orange },
        { at: 357, eyebrow: "SHA-256 at the shutter", title: "Fingerprinted. Location data stripped." },
        { at: 540, eyebrow: "Signed with Cloud KMS", title: "Sealed into a hash-chained ledger." },
      ]}
    />
  </Scene>
);

// ── Lease check: clips 08, 09, 10 ──────────────────────────────────────────────

const RAMP = 15;
const LEASE: Seg[] = [
  { clip: "c08", from: 0.7, to: 4.5, taps: [{ t: 1.0, x: 0.5, y: 0.52 }] },
  { clip: "c09", from: 0.7, to: 4.2, taps: [{ t: 1.0, x: 0.34, y: 0.371 }] },
  { clip: "c10", from: 0.6, to: 3.0, taps: [{ t: 1.0, x: 0.5, y: 0.647 }] },
  { clip: "c10", from: 3.0, to: 221.5, speed: RAMP },
  { clip: "c10", from: 221.5, to: 223.2 },
  { clip: "c10", from: 223.2, hold: 4.7, taps: [{ t: 227.4, x: 0.4, y: 0.496 }] },
  { clip: "c10", from: 223.9, hold: 5.0 },
];
const L = segStarts(LEASE);
export const LEASE_FRAMES = LEASE.reduce((n, s) => n + segFrames(s), 0);
const CHECK_AT = L[2];
const TAP_TIME = 1.3; // Check My Lease lands

// Clip-10 seconds at a scene frame, for syncing the stage list to the live run.
const leaseClock = (f: number) => {
  if (f < L[2]) return 0;
  if (f < L[3]) return 0.6 + (f - L[2]) / 30;
  if (f < L[4]) return 3.0 + ((f - L[3]) / 30) * RAMP;
  return 221.5 + (f - L[4]) / 30;
};

// Server-logged stage times for this run (SHOTS.md, "Clip 10: live Gemma 4 pipeline timing").
const STAGES = [
  { name: "Triage: is this high-stakes?", model: "gemma-4-26b-a4b-it", start: 1.3, end: 3.2, note: "1.1 s" },
  { name: "Clauses and key terms", model: "gemma-4-26b-a4b-it", start: 3.2, end: 41.3, note: "38.0 s" },
  { name: "Map clauses to Virginia law", model: "gemma-4-26b-a4b-it", start: 45.7, end: 170.6, note: "4 calls" },
  { name: "Quotes matched, math checked", model: "deterministic code", start: 170.6, end: 170.6, note: "" },
  { name: "Second opinion on findings", model: "gemma-4-31b-it", start: 170.6, end: 203.5, note: "32.8 s" },
  { name: "Plain-language explanation", model: "gemma-4-26b-a4b-it", start: 203.5, end: 220.9, note: "17.3 s" },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const Tracker: React.FC = () => {
  const frame = useCurrentFrame();
  const t = leaseClock(frame);
  const done = frame >= L[4];
  return (
    <div style={{ position: "absolute", left: 860, right: 120, top: 110 }}>
      <Rise delay={CHECK_AT}>
        <Eyebrow color={colors.orange}>Gemma 4 runs the lease check · live run</Eyebrow>
        <div style={{ marginTop: 14, fontSize: 52, fontWeight: 700, letterSpacing: -1.2, lineHeight: 1.1 }}>
          Clause by clause, against Virginia law.
        </div>
      </Rise>
      <div style={{ marginTop: 30 }}>
        {STAGES.map((s, i) => {
          const active = t >= s.start && t < s.end;
          const finished = t >= s.end && (s.end > s.start || t > s.end + 0.01);
          const isCode = s.model === "deterministic code";
          const is31 = s.model === "gemma-4-31b-it";
          const accent = isCode ? colors.blue : is31 ? colors.green : colors.orange;
          return (
            <Rise key={s.name} delay={CHECK_AT + 6 + i * 4} distance={10}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  marginBottom: 10,
                  padding: "12px 18px",
                  borderRadius: 14,
                  background: active ? `${accent}1F` : colors.surface,
                  border: `1px solid ${active ? `${accent}AA` : colors.border}`,
                  opacity: finished || active ? 1 : 0.45,
                }}
              >
                <div
                  style={{
                    width: 26,
                    fontSize: 24,
                    color: finished ? colors.green : accent,
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                >
                  {finished ? "✓" : active ? "●" : "○"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontFamily: fonts.mono, fontSize: 17, color: accent, marginTop: 2 }}>{s.model}</div>
                </div>
                <div style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.muted }}>{finished ? s.note : ""}</div>
              </div>
            </Rise>
          );
        })}
      </div>
      {done && (
        <Rise delay={L[4] + 4}>
          <div
            style={{ marginTop: 14, fontFamily: fonts.mono, fontSize: 21, color: colors.text, lineHeight: 1.55 }}
          >
            8 model calls · 29,351 prompt tokens · 3:40 end to end
            <br />
            <span style={{ color: colors.green }}>12 findings, all verified</span>
            <span style={{ color: colors.muted }}> · 8 unsupported claims dropped</span>
          </div>
        </Rise>
      )}
    </div>
  );
};

export const LeaseFootage: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <Phone segs={LEASE}>
        <SpeedPill segs={LEASE}>
          {(seg, f) => {
            const real = seg.from + (f / 30) * (seg.speed ?? 1) - TAP_TIME;
            return `▶▶ ${RAMP}× faster · real wait ${mmss(Math.max(0, real))}`;
          }}
        </SpeedPill>
      </Phone>
      {frame < CHECK_AT ? (
        <Beats
          top={280}
          beats={[{ at: 0, eyebrow: "Private by default", title: "Names hidden on the phone. You see what's sent." }]}
        />
      ) : (
        <Tracker />
      )}
    </Scene>
  );
};

// ── Ask: clips 11 and 12 ───────────────────────────────────────────────────────

const ASK: Seg[] = [
  { clip: "c11", from: 11.8, to: 13.4, taps: [{ t: 12.6, x: 0.14, y: 0.643 }] },
  { clip: "c11", from: 13.4, to: 21.8, speed: 3 },
  { clip: "c11", from: 21.8, to: 23.0 },
  { clip: "c11", from: 32.6, to: 35.5, taps: [{ t: 33.2, x: 0.33, y: 0.56 }] },
  { clip: "c11", from: 35.5, hold: 1.0 },
  { clip: "c12", from: 22.7, to: 24.0, taps: [{ t: 23.2, x: 0.13, y: 0.756 }] },
  { clip: "c12", from: 24.0, to: 30.0, speed: 3 },
  { clip: "c12", from: 30.0, hold: 1.6 },
];
export const ASK_FRAMES = ASK.reduce((n, s) => n + segFrames(s), 0);

export const AskFootage: React.FC = () => (
  <Scene>
    <Phone segs={ASK}>
      <SpeedPill segs={ASK}>{(seg) => `▶▶ ${seg.speed}× faster`}</SpeedPill>
    </Phone>
    <Beats
      top={280}
      beats={[
        { at: 0, eyebrow: "Ask · Gemma 4 function calling", title: "Every sentence cites its source.", color: colors.orange },
        { at: 290, eyebrow: "Knows its limits", title: "Out of scope? It hands you to legal aid." },
      ]}
    />
  </Scene>
);

// ── Delete everything: clip 13 ─────────────────────────────────────────────────

const DELETE: Seg[] = [
  {
    clip: "c13",
    from: 0.6,
    to: 3.8,
    taps: [
      { t: 1.0, x: 0.25, y: 0.64 },
      { t: 3.1, x: 0.32, y: 0.567 },
    ],
  },
  { clip: "c13", from: 21.3, to: 22.95 },
  { clip: "c13", from: 23.0, hold: 2.0 },
];
export const DELETE_FRAMES = DELETE.reduce((n, s) => n + segFrames(s), 0);

export const DeleteFootage: React.FC = () => (
  <Scene>
    <Phone segs={DELETE} />
    <Beats top={280} beats={[{ at: 0, eyebrow: "Your data, your call", title: "Delete everything. Get a receipt." }]} />
  </Scene>
);

