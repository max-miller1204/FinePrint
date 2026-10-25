import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Eyebrow, Rise, Scene, Seal, useRamp } from "../components";
import { colors, fonts } from "../theme";

type Node = { id: string; label: string; sub: string; x: number; y: number; color: string };

const PHONE: Node = { id: "phone", label: "iPhone app", sub: "SwiftUI · iOS 26", x: 300, y: 480, color: colors.text };
const RUN: Node = { id: "run", label: "Cloud Run", sub: "Hono · TypeScript", x: 900, y: 480, color: colors.blue };
const SERVICES: Node[] = [
  { id: "gemma", label: "Gemini API", sub: "Gemma 4 · 26B + 31B", x: 1520, y: 150, color: colors.orange },
  { id: "auth", label: "Firebase Auth", sub: "anonymous sign-in", x: 1520, y: 282, color: colors.muted },
  { id: "fs", label: "Firestore", sub: "rentals · ledger", x: 1520, y: 414, color: colors.muted },
  { id: "gcs", label: "Cloud Storage", sub: "evidence originals", x: 1520, y: 546, color: colors.muted },
  { id: "kms", label: "Cloud KMS", sub: "EC P-256 signing", x: 1520, y: 678, color: colors.green },
  { id: "sm", label: "Secret Manager", sub: "API key", x: 1520, y: 810, color: colors.muted },
];

const NODE_W = 340;
const NODE_H = 96;

const NodeBox: React.FC<{ node: Node; delay: number }> = ({ node, delay }) => (
  <div
    style={{
      position: "absolute",
      left: node.x - NODE_W / 2,
      top: node.y - NODE_H / 2,
      width: NODE_W,
    }}
  >
    <Rise delay={delay} distance={12}>
      <div
        style={{
          height: NODE_H,
          boxSizing: "border-box",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `4px solid ${node.color}`,
          borderRadius: 18,
          padding: "16px 22px",
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 600 }}>{node.label}</div>
        <div style={{ fontFamily: fonts.mono, fontSize: 17, color: colors.muted, marginTop: 4 }}>
          {node.sub}
        </div>
      </div>
    </Rise>
  </div>
);

const Edge: React.FC<{ from: Node; to: Node; start: number }> = ({ from, to, start }) => {
  const p = useRamp(start, start + 20);
  const x1 = from.x + NODE_W / 2;
  const x2 = to.x - NODE_W / 2;
  const mid = (x1 + x2) / 2;
  const d = `M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={to.id === "gemma" ? colors.orange : colors.faint}
      strokeWidth={2.5}
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - p}
    />
  );
};

const OUTRO = 480;

// Measured on the lease in the demo footage (SHOTS.md, clip 10).
const COST = [
  { model: "gemma-4-26b-a4b-it", role: "triage, clauses, rule mapping, plain language", color: colors.orange },
  { model: "gemma-4-31b-it", role: "second opinion only", color: colors.green },
];

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const out = useRamp(OUTRO, OUTRO + 24);

  return (
    <Scene>
      <AbsoluteFill
        style={{
          opacity: interpolate(out, [0, 1], [1, 0.12]),
          transform: `scale(${interpolate(out, [0, 1], [1, 0.94])})`,
          filter: `blur(${out * 6}px)`,
        }}
      >
        <div style={{ position: "absolute", left: 130, top: 70 }}>
          <Rise>
            <Eyebrow>Runs on Google Cloud · ./deploy.sh into your own project</Eyebrow>
          </Rise>
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <Edge from={PHONE} to={RUN} start={18} />
          {SERVICES.map((s, i) => (
            <Edge key={s.id} from={RUN} to={s} start={44 + i * 8} />
          ))}
        </svg>
        <div style={{ position: "absolute", left: 130, top: 640, width: 1040 }}>
          <Rise delay={163}>
            <Eyebrow color={colors.orange}>Inference cost · one lease</Eyebrow>
            {COST.map((c) => (
              <div key={c.model} style={{ display: "flex", gap: 20, marginTop: 16, fontSize: 28 }}>
                <span style={{ fontFamily: fonts.mono, color: c.color, width: 360 }}>{c.model}</span>
                <span style={{ color: colors.text }}>{c.role}</span>
              </div>
            ))}
            <div style={{ marginTop: 18, fontFamily: fonts.mono, fontSize: 24, color: colors.muted }}>
              8 calls · 29,351 prompt + 4,344 output tokens
            </div>
          </Rise>
        </div>
        <NodeBox node={PHONE} delay={4} />
        <NodeBox node={RUN} delay={26} />
        {SERVICES.map((s, i) => (
          <NodeBox key={s.id} node={s} delay={56 + i * 8} />
        ))}
      </AbsoluteFill>

      {frame >= OUTRO && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <Rise delay={OUTRO + 10}>
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <Seal size={88} />
              <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4 }}>FinePrint</div>
            </div>
          </Rise>
          <Rise delay={OUTRO + 24} style={{ marginTop: 36, fontSize: 44, fontWeight: 500, color: colors.muted }}>
            Open source · Apache-2.0 · built on Gemma 4
          </Rise>
          <Rise delay={OUTRO + 30} style={{ marginTop: 18, fontSize: 30, color: colors.faint }}>
            VoiceOver announcements in the app · captions in this video
          </Rise>
          <Rise delay={OUTRO + 38} style={{ marginTop: 44, display: "flex", gap: 24 }}>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 30,
                padding: "14px 26px",
                borderRadius: 14,
                background: colors.surfaceRaised,
                color: colors.green,
              }}
            >
              $ ./deploy.sh
            </div>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 30,
                padding: "14px 26px",
                borderRadius: 14,
                background: colors.surfaceRaised,
                color: colors.text,
              }}
            >
              github.com/max-miller1204/FinePrint
            </div>
          </Rise>
        </AbsoluteFill>
      )}
    </Scene>
  );
};
