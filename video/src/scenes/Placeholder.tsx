import { useVideoConfig } from "remotion";
import { Eyebrow, Rise, Scene } from "../components";
import { colors, fonts } from "../theme";

// Stand-in for a scene that still needs real footage or real pipeline output.
export const Placeholder: React.FC<{
  kind: string;
  title: string;
  shots: string[];
}> = ({ kind, title, shots }) => {
  const { durationInFrames, fps } = useVideoConfig();
  return (
    <Scene>
      <div
        style={{
          position: "absolute",
          inset: 120,
          border: `3px dashed ${colors.faint}`,
          borderRadius: 40,
          padding: 80,
        }}
      >
        <Rise>
          <Eyebrow color={colors.orange}>
            Placeholder · {kind} · {(durationInFrames / fps).toFixed(0)}s
          </Eyebrow>
          <div style={{ marginTop: 24, fontSize: 80, fontWeight: 700, letterSpacing: -2 }}>
            {title}
          </div>
        </Rise>
        <div style={{ marginTop: 48 }}>
          {shots.map((s, i) => (
            <Rise key={s} delay={10 + i * 6}>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 30,
                  color: colors.muted,
                  marginTop: 16,
                }}
              >
                {String(i + 1).padStart(2, "0")} {s}
              </div>
            </Rise>
          ))}
        </div>
      </div>
    </Scene>
  );
};
