import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Rise, Scene, Seal, useSpring } from "../components";
import { colors } from "../theme";

const WORD = "FinePrint";

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const seal = useSpring(4, 12);
  const line = useSpring(24);

  return (
    <Scene>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div style={{ transform: `scale(${seal}) rotate(${(1 - seal) * -40}deg)` }}>
            <Seal size={120} />
          </div>
          <div style={{ fontSize: 168, fontWeight: 700, letterSpacing: -6 }}>
            {[...WORD].map((ch, i) => {
              const t = interpolate(frame, [8 + i * 2.5, 26 + i * 2.5], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    opacity: t,
                    filter: `blur(${(1 - t) * 12}px)`,
                    transform: `translateY(${(1 - t) * 20}px)`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        </div>
        <div
          style={{
            marginTop: 36,
            height: 3,
            width: 900 * line,
            background: `linear-gradient(90deg, transparent, ${colors.green}, transparent)`,
          }}
        />
        <Rise delay={26} style={{ marginTop: 40, textAlign: "center" }}>
          <div style={{ fontSize: 46, fontWeight: 500, color: colors.text }}>
            Your lease and your phone camera,
          </div>
          <div style={{ fontSize: 46, fontWeight: 500, color: colors.muted }}>
            turned into evidence and the deadlines Virginia law already gives you.
          </div>
        </Rise>
      </AbsoluteFill>
    </Scene>
  );
};
