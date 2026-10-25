import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { Cue } from "./script";
import { colors, fonts } from "./theme";

const FADE = 6;

// Burned-in captions. `area` places the caption box; the default is bottom center.
export const Captions: React.FC<{ cues: Cue[]; area?: React.CSSProperties; align?: "center" | "left" }> = ({
  cues,
  area,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const cue = cues.find((c) => frame >= c.from && frame < c.to);
  if (!cue) return null;
  const o = interpolate(frame, [cue.from, cue.from + FADE, cue.to - FADE, cue.to], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 160,
        right: 160,
        bottom: 44,
        display: "flex",
        justifyContent: align === "center" ? "center" : "flex-start",
        ...area,
      }}
    >
      <div
        style={{
          opacity: o,
          transform: `translateY(${(1 - o) * 6}px)`,
          maxWidth: 1400,
          padding: "14px 26px",
          borderRadius: 16,
          background: "rgba(5,7,10,0.78)",
          border: `1px solid ${colors.border}`,
          fontFamily: fonts.sans,
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.35,
          color: colors.text,
          textAlign: align,
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};
