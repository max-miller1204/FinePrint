import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts } from "./theme";

export const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.bg,
      backgroundImage:
        "radial-gradient(1200px 700px at 50% 35%, rgba(10,132,255,0.07), transparent 70%)",
      fontFamily: fonts.sans,
      color: colors.text,
    }}
  >
    {children}
  </AbsoluteFill>
);

// Fades and lifts children in, starting at `delay` frames.
export const Rise: React.FC<{
  delay?: number;
  distance?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, distance = 24, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * distance}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const useSpring = (delay: number, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

export const useRamp = (from: number, to: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = colors.muted,
}) => (
  <div
    style={{
      fontFamily: fonts.mono,
      fontSize: 22,
      letterSpacing: 2,
      textTransform: "uppercase",
      color,
    }}
  >
    {children}
  </div>
);

export const Seal: React.FC<{ size?: number; color?: string }> = ({
  size = 48,
  color = colors.green,
}) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
    <path
      d="M24 3l5 4.2 6.4-.8 2.5 6 6 2.5-.8 6.4L47.3 24l-4.2 5 .8 6.4-6 2.5-2.5 6-6.4-.8L24 45.3l-5-4.2-6.4.8-2.5-6-6-2.5.8-6.4L.7 24l4.2-5-.8-6.4 6-2.5 2.5-6 6.4.8z"
      fill={color}
    />
    <path
      d="M15.5 24.5l6 6 11-12"
      fill="none"
      stroke={colors.bg}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Marks scenes that stand in for footage or output we have not captured yet.
export const TestTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "absolute",
      right: 40,
      top: 36,
      fontFamily: fonts.mono,
      fontSize: 18,
      letterSpacing: 1,
      color: colors.orange,
      border: `1px solid ${colors.orange}55`,
      borderRadius: 999,
      padding: "6px 14px",
    }}
  >
    TEST · {children}
  </div>
);

export const Card: React.FC<{
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ style, children }) => (
  <div
    style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 24,
      padding: 28,
      boxShadow: "0 30px 60px rgba(0,0,0,0.35)",
      ...style,
    }}
  >
    {children}
  </div>
);
