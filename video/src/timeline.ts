// Times captions and voiceover from the generated clip lengths (public/vo/manifest.json).
// A line starts at its cue's `from`, or right after the previous line, whichever is later.
// A scene stretches if its last line runs past the end.
import manifest from "../public/vo/manifest.json";
import { CAPTIONS, type Cue } from "./script";

export type Line = Cue & { file: string };

const GAP = 8; // frames of silence between lines
const TAIL = 6; // caption lingers after the voice stops
const SCENE_TAIL = 12; // breathing room after the last line

const clips = manifest.scenes as Record<string, { file: string; frames: number }[]>;

export const linesFor = (scene: string): Line[] => {
  let cursor = 0;
  return (CAPTIONS[scene] ?? []).map((cue, i) => {
    const clip = clips[scene]?.[i];
    const frames = clip?.frames ?? cue.to - cue.from;
    const from = Math.max(cue.from, cursor);
    const to = from + frames + TAIL;
    cursor = from + frames + GAP;
    return { ...cue, from, to, file: clip?.file ?? "" };
  });
};

export const sceneLength = (scene: string, base: number) => {
  const lines = linesFor(scene);
  const last = lines[lines.length - 1];
  return last ? Math.max(base, last.to + SCENE_TAIL) : base;
};
