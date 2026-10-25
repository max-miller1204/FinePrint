import { interpolate, useCurrentFrame } from "remotion";
import { Eyebrow, Rise, Scene, useRamp } from "../components";
import { colors } from "../theme";

// Va. Code § 55.1-1214(A), verbatim. `hl` is the frame its highlight starts.
const SEGMENTS: { text: string; hl?: number }[] = [
  { text: "“…the report shall be " },
  { text: "deemed correct", hl: 150 },
  { text: " unless the tenant objects to it in writing " },
  { text: "within five days", hl: 172 },
  { text: " after receipt of the report.”" },
];

const TYPE_START = 18;
const TYPE_END = 130;
const TOTAL_CHARS = SEGMENTS.reduce((n, s) => n + s.text.length, 0);

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const shown = Math.floor(
    interpolate(frame, [TYPE_START, TYPE_END], [0, TOTAL_CHARS], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const settle = useRamp(205, 235);

  let index = 0;
  return (
    <Scene>
      <div
        style={{
          position: "absolute",
          left: 200,
          right: 200,
          top: interpolate(settle, [0, 1], [270, 200]),
        }}
      >
        <Rise>
          <Eyebrow color={colors.orange}>Jordan · Virginia Tech junior · first off-campus lease</Eyebrow>
        </Rise>
        <Rise delay={10} style={{ marginTop: 14 }}>
          <Eyebrow>Va. Code § 55.1-1214(A)</Eyebrow>
        </Rise>
        <div
          style={{
            marginTop: 36,
            fontSize: 64,
            lineHeight: 1.3,
            fontWeight: 500,
            letterSpacing: -0.5,
            opacity: interpolate(settle, [0, 1], [1, 0.4]),
          }}
        >
          {SEGMENTS.map((seg, si) => {
            const chars = [...seg.text].map((ch, ci) => {
              const visible = index++ < shown;
              return (
                <span key={ci} style={{ opacity: visible ? 1 : 0 }}>
                  {ch}
                </span>
              );
            });
            if (seg.hl === undefined) return <span key={si}>{chars}</span>;
            const p = interpolate(frame, [seg.hl, seg.hl + 14], [0, 100], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <span
                key={si}
                style={{
                  backgroundImage: `linear-gradient(${colors.highlight}, ${colors.highlight})`,
                  backgroundSize: `${p}% 100%`,
                  backgroundRepeat: "no-repeat",
                  borderRadius: 8,
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                  color: p > 0 ? "#FFD8A0" : undefined,
                }}
              >
                {chars}
              </span>
            );
          })}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 200,
          right: 200,
          top: 690,
          fontSize: 56,
          fontWeight: 600,
          letterSpacing: -0.5,
        }}
      >
        <Rise delay={222}>In Virginia, you have five days to object.</Rise>
        <Rise delay={250} style={{ color: colors.muted, marginTop: 12 }}>
          Most renters never find out.
        </Rise>
      </div>
    </Scene>
  );
};
