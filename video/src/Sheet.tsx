// Dev only: contact sheet of a clip, for picking trim points.
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";

export const Sheet: React.FC<{ clip: string; times: number[]; w?: number }> = ({ clip, times, w = 228 }) => (
  <AbsoluteFill style={{ background: "#222", flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8 }}>
    {times.map((t) => (
      <div key={t} style={{ width: w, position: "relative" }}>
        <>
          <OffthreadVideo src={staticFile(`clips/${clip}.mp4`)} style={{ width: w }} muted trimBefore={Math.round(t * 30)} />
        </>
        <div style={{ position: "absolute", top: 0, left: 0, background: "#000c", color: "#ff0", font: "bold 22px monospace", padding: 2 }}>{t}</div>
      </div>
    ))}
  </AbsoluteFill>
);
