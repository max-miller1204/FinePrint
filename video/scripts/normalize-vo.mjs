// Brings each voiceover clip (32-bit float WAV) to the same loudness, without clipping.
// make-vo runs this; run it alone with: node scripts/normalize-vo.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET_RMS_DB = -16;
const PEAK_LIMIT = 0.95;

export const normalizeWav = (path) => {
  const b = readFileSync(path);
  let o = 12;
  while (b.toString("ascii", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4);
  if (b.readUInt16LE(20) !== 3) throw new Error(`${path}: expected 32-bit float WAV`);
  const len = b.readUInt32LE(o + 4);
  const d = new Float32Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + len));
  let sum = 0;
  let peak = 0;
  for (const x of d) {
    sum += x * x;
    peak = Math.max(peak, Math.abs(x));
  }
  const rms = Math.sqrt(sum / d.length);
  const gain = Math.min(10 ** (TARGET_RMS_DB / 20) / rms, PEAK_LIMIT / peak);
  for (let i = 0; i < d.length; i++) d[i] *= gain;
  Buffer.from(d.buffer).copy(b, o + 8);
  writeFileSync(path, b);
  return gain;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../public/vo/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".wav"))) {
    console.log(`${f.padEnd(16)} gain ${normalizeWav(fileURLToPath(new URL(f, dir))).toFixed(2)}`);
  }
}
