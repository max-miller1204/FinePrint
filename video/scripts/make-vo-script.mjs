// Writes voiceover-script.md from src/script.ts, with each line's start time in the video.
// Run: npm run vo-script
import { writeFileSync } from "node:fs";
import { readCaptions } from "./read-script.mjs";

const FPS = 30;
const TRANSITION = 15;
// Scene lengths in frames, in order. Keep in sync with SCENES in src/Root.tsx.
const SCENES = [
  ["Hook", 315],
  ["Stakes", 210],
  ["Title", 180],
  ["MoveIn", 1050],
  ["Integrity", 600],
  ["Gemma", 1050],
  ["Safety", 360],
  ["Close", 390],
];

const captions = readCaptions();

const time = (f) => {
  const sec = f / FPS;
  return `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
};

let start = 0;
let words = 0;
const out = ["# FinePrint demo: voiceover script", ""];
out.push("Read at a calm pace, about 150 words a minute. Times are where each line starts in the video.", "");
for (const [id, frames] of SCENES) {
  out.push(`## ${id} (${time(start)})`, "");
  for (const cue of captions[id] ?? []) {
    out.push(`- **${time(start + cue.from)}** ${cue.text}`);
    words += cue.text.split(/\s+/).length;
  }
  out.push("");
  start += frames - TRANSITION;
}
out.push(`${words} words in ${time(start + TRANSITION)}.`, "");
writeFileSync(new URL("../voiceover-script.md", import.meta.url), out.join("\n"));
console.log(`voiceover-script.md: ${words} words`);
