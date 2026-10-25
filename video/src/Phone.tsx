// Simulator footage inside the phone frame. Clips are public/clips/cNN.mp4: the
// recordings in ~/fineprint-clips, re-encoded to constant 30 fps (SHOTS.md has what each shows).
import type React from "react";
import { Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Eyebrow, Rise } from "./components";
import { colors } from "./theme";

export const PHONE_W = 442;
export const PHONE_H = 932;
const INNER_W = PHONE_W - 24;
const INNER_H = PHONE_H - 24;

// x, y are fractions of the screen. t is the logged tap time in clip seconds; the tap lands about 0.3 s later.
export type Tap = { t: number; x: number; y: number };
// Plays clip seconds [from, to] at `speed`, or holds the frame at `from` for `hold` seconds.
export type Seg = { clip: string; from: number; to?: number; speed?: number; hold?: number; taps?: Tap[] };

const TAP_DELAY = 0.3;

export const segFrames = (s: Seg) =>
  s.hold !== undefined ? Math.round(s.hold * 30) : Math.round((((s.to ?? s.from) - s.from) / (s.speed ?? 1)) * 30);

export const segStarts = (segs: Seg[]) => segs.map((_, i) => segs.slice(0, i).reduce((n, s) => n + segFrames(s), 0));

export const totalFrames = (segs: Seg[]) => segs.reduce((n, s) => n + segFrames(s), 0);

const Ripple: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = 30 + p * 50;
  return (
    <div
      style={{
        position: "absolute",
        left: x * INNER_W - size / 2,
        top: y * INNER_H - size / 2,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `rgba(255,255,255,${0.28 * (1 - p)})`,
        border: `2px solid rgba(255,255,255,${0.6 * (1 - p)})`,
      }}
    />
  );
};

const Clip: React.FC<{ seg: Seg }> = ({ seg }) => {
  const video = (
    <OffthreadVideo
      src={staticFile(`clips/${seg.clip}.mp4`)}
      trimBefore={Math.round(seg.from * 30)}
      playbackRate={seg.speed ?? 1}
      muted
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
  return (
    <>
      {seg.hold !== undefined ? <Freeze frame={0}>{video}</Freeze> : video}
      {(seg.taps ?? []).map((tap) => (
        <Sequence
          key={tap.t}
          from={Math.round(((tap.t + TAP_DELAY - seg.from) / (seg.speed ?? 1)) * 30)}
          durationInFrames={18}
          layout="none"
        >
          <Ripple x={tap.x} y={tap.y} />
        </Sequence>
      ))}
    </>
  );
};

export const Phone: React.FC<{ segs: Seg[]; left?: number; children?: React.ReactNode }> = ({
  segs,
  left = 260,
  children,
}) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const starts = segStarts(segs);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: (1080 - PHONE_H) / 2,
        width: PHONE_W,
        height: PHONE_H,
        borderRadius: 64,
        padding: 12,
        boxSizing: "border-box",
        background: "#2A2E38",
        boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
        transform: `translateY(${(1 - enter) * 60}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          position: "relative",
          width: INNER_W,
          height: INNER_H,
          borderRadius: 52,
          overflow: "hidden",
          background: "#000",
        }}
      >
        {segs.map((seg, i) => (
          <Sequence
            key={`${seg.clip}-${seg.from}-${i}`}
            from={starts[i]}
            // The last segment (always a hold) runs to the end of the scene, however long the voiceover makes it.
            durationInFrames={i === segs.length - 1 ? undefined : segFrames(seg)}
            layout="none"
          >
            <div style={{ position: "absolute", inset: 0 }}>
              <Clip seg={seg} />
            </div>
          </Sequence>
        ))}
        {children}
      </div>
    </div>
  );
};

// The headline beside the phone, swapping at each beat's frame.
export type Beat = { at: number; eyebrow: string; title: string; color?: string };

export const Beats: React.FC<{ beats: Beat[]; top?: number }> = ({ beats, top = 300 }) => {
  const frame = useCurrentFrame();
  const current = [...beats].reverse().find((b) => frame >= b.at) ?? beats[0];
  return (
    <div style={{ position: "absolute", left: 860, right: 140, top }}>
      <Sequence key={current.at} from={current.at} layout="none">
        <Rise>
          <Eyebrow color={current.color ?? colors.green}>{current.eyebrow}</Eyebrow>
          <div style={{ marginTop: 20, fontSize: 64, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1.12 }}>
            {current.title}
          </div>
        </Rise>
      </Sequence>
    </div>
  );
};
