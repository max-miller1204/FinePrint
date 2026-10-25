// Speaks every caption line with Kokoro-82M (open weights, Apache-2.0), running locally.
// Writes public/vo/<Scene>-<n>.wav and public/vo/manifest.json with each clip's length.
// Run: npm run vo   (first run downloads the model from Hugging Face, about 330 MB)
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import { normalizeWav } from "./normalize-vo.mjs";
import { readCaptions } from "./read-script.mjs";

const VOICE = process.env.VO_VOICE ?? "am_michael";
const SPEED = Number(process.env.VO_SPEED ?? 1);
const FPS = 30;

// How to say things the model would read oddly. Captions keep the written form.
const SAY = [
  [/…/g, ""],
  [/SHA-256/g, "shaw two fifty-six"],
  [/Cloud KMS/g, "Cloud K M S"],
  [/Apache-2\.0/g, "Apache two point oh"],
  [/Gemma 4/g, "Gemma four"],
  [/FinePrint/g, "Fine Print"],
  [/\b65\b/g, "sixty-five"],
  [/\b26B\b/g, "twenty-six B"],
  [/\b31B\b/g, "thirty-one B"],
  [/29,000/g, "twenty-nine thousand"],
];
const spoken = (text) => SAY.reduce((t, [re, to]) => t.replace(re, to), text).trim();

const out = new URL("../public/vo/", import.meta.url);
mkdirSync(out, { recursive: true });

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "fp32",
  device: "cpu",
});

const manifest = {};
for (const [scene, cues] of Object.entries(readCaptions())) {
  manifest[scene] = [];
  for (const [i, cue] of cues.entries()) {
    const file = `${scene}-${i}.wav`;
    const audio = await tts.generate(spoken(cue.text), { voice: VOICE, speed: SPEED });
    await audio.save(fileURLToPath(new URL(file, out)));
    normalizeWav(fileURLToPath(new URL(file, out)));
    const frames = Math.ceil((audio.audio.length / audio.sampling_rate) * FPS);
    const room = cue.to - cue.from;
    manifest[scene].push({ file, frames });
    console.log(`${file.padEnd(16)} ${(frames / FPS).toFixed(1)}s of ${(room / FPS).toFixed(1)}s${frames > room ? "  OVER" : ""}`);
  }
}
writeFileSync(new URL("manifest.json", out), `${JSON.stringify({ voice: VOICE, scenes: manifest }, null, 2)}\n`);
