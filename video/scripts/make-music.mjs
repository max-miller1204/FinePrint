// Synthesizes an original, royalty-free ambient bed: slow pad chords plus sparse soft bells.
// Writes public/music-bed.wav (44.1 kHz, 16-bit stereo). Run: npm run music
import { writeFileSync } from "node:fs";

const SR = 44100;
const DURATION = 180; // seconds; longer than the video, Remotion trims it
const CHORD_LEN = 8;
const XFADE = 2.5;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// Cmaj9 – Am9 – Fmaj7 – G6, voiced low and open.
const CHORDS = [
  [48, 55, 59, 62, 64],
  [45, 52, 55, 59, 60],
  [41, 48, 52, 57, 60],
  [43, 50, 52, 59, 62],
];

const n = SR * DURATION;
const left = new Float32Array(n);
const right = new Float32Array(n);

// Smooth window for each chord, overlapping its neighbors by XFADE.
const chordGain = (t, start) => {
  const end = start + CHORD_LEN;
  if (t < start - XFADE || t > end + XFADE) return 0;
  const rise = Math.min(1, (t - (start - XFADE)) / (2 * XFADE));
  const fall = Math.min(1, (end + XFADE - t) / (2 * XFADE));
  const g = Math.max(0, Math.min(rise, fall));
  return 0.5 - 0.5 * Math.cos(Math.PI * g);
};

for (let c = 0; c * CHORD_LEN < DURATION + XFADE; c++) {
  const start = c * CHORD_LEN;
  const notes = CHORDS[c % CHORDS.length];
  const from = Math.max(0, Math.floor((start - XFADE) * SR));
  const to = Math.min(n, Math.ceil((start + CHORD_LEN + XFADE) * SR));
  notes.forEach((m, v) => {
    const f = hz(m);
    const pan = 0.5 + (v - (notes.length - 1) / 2) * 0.14;
    const amp = 0.09 / (1 + v * 0.15);
    for (let i = from; i < to; i++) {
      const t = i / SR;
      const g = chordGain(t, start);
      if (!g) continue;
      const lfo = 1 + 0.12 * Math.sin(2 * Math.PI * (0.07 + v * 0.013) * t + v);
      const s =
        Math.sin(2 * Math.PI * f * t) +
        0.6 * Math.sin(2 * Math.PI * f * 1.0035 * t + 1.3) +
        0.18 * Math.sin(2 * Math.PI * f * 2 * t + 0.4);
      const x = s * amp * g * lfo;
      left[i] += x * (1 - pan) * 2;
      right[i] += x * pan * 2;
    }
  });
}

// Sparse bells from the current chord, two octaves up, every 2 s with a fixed pattern.
const PATTERN = [4, 2, 3, 1, 4, 3, 2, 0];
for (let k = 0; k * 2 < DURATION - 2; k++) {
  if (k % 4 === 3) continue; // leave space
  const t0 = k * 2 + 0.5;
  const chord = CHORDS[Math.floor(t0 / CHORD_LEN) % CHORDS.length];
  const f = hz(chord[PATTERN[k % PATTERN.length]] + 24);
  const pan = k % 2 ? 0.35 : 0.65;
  const from = Math.floor(t0 * SR);
  const to = Math.min(n, from + SR * 3);
  for (let i = from; i < to; i++) {
    const dt = (i - from) / SR;
    const env = Math.min(1, dt / 0.01) * Math.exp(-dt * 1.6);
    const x = 0.035 * env * (Math.sin(2 * Math.PI * f * dt) + 0.25 * Math.sin(2 * Math.PI * f * 3.01 * dt) * Math.exp(-dt * 4));
    left[i] += x * (1 - pan) * 2;
    right[i] += x * pan * 2;
  }
}

// Gentle one-pole low-pass for warmth, then a light feedback echo for space.
const smooth = (buf, a) => {
  let y = 0;
  for (let i = 0; i < buf.length; i++) buf[i] = y += a * (buf[i] - y);
};
smooth(left, 0.35);
smooth(right, 0.35);
const D = Math.floor(0.37 * SR);
for (let i = D; i < n; i++) {
  left[i] += 0.28 * right[i - D];
  right[i] += 0.28 * left[i - D];
}

let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
const scale = 0.6 / peak;

const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.round(left[i] * scale * 32767), i * 4);
  data.writeInt16LE(Math.round(right[i] * scale * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(new URL("../public/music-bed.wav", import.meta.url), Buffer.concat([header, data]));
console.log(`public/music-bed.wav: ${DURATION}s, peak scaled by ${scale.toFixed(2)}`);
