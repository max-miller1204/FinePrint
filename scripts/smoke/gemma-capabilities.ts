// Day-one smoke test for Gemma 4 on the Gemini API (issue #8, spec §21 items 1 and 2).
//
// Checks, for each model: plain text, structured output (`responseSchema` and
// `responseJsonSchema`), function calling (call + response round trip),
// thinking levels, and image input. Uses the REST API directly so the request
// bodies match what `@google/genai` sends, without adding a dependency.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/smoke/gemma-capabilities.ts [--out FILE] [--probe-rpm]
//
// Exit codes: 0 every required capability passed on every model, 1 a required
// capability failed, 2 setup error (no key, network). A `partial` result (works
// only with a client-side workaround, such as stripping a code fence) passes the
// gate and is reported as a gap.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'] as const;
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
// Published free-tier estimate is 15 RPM; pace under it.
const PACE_MS = 4500;
// Structured output is sampled several times; a single run hid a 31B fence bug.
const STRUCTURED_RUNS = 3;

type Status = 'confirmed' | 'partial' | 'not supported' | 'error';
interface Check {
  model: string;
  capability: string;
  required: boolean;
  status: Status;
  detail: string;
  latencyMs?: number;
  usage?: Record<string, number>;
}

const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'scripts/smoke/out/gemma-capabilities.json';
const probeRpm = args.includes('--probe-rpm');
const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(2);
}

let lastCall = 0;
async function generate(model: string, body: unknown) {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const started = performance.now();
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key! },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json, latencyMs: Math.round(performance.now() - started) };
}

function parts(json: any): any[] {
  return json?.candidates?.[0]?.content?.parts ?? [];
}
function answerText(json: any): string {
  return parts(json).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
}
function errorText(r: { status: number; json: any }): string {
  return `HTTP ${r.status}: ${r.json?.error?.message ?? JSON.stringify(r.json).slice(0, 300)}`;
}

// A 64x64 PNG, left half red, right half blue, built by hand so the script has no image dependency.
function twoColorPng(): string {
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = x < w / 2 ? [220, 20, 20] : [20, 40, 220];
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

const SEVERITY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    clause: { type: 'STRING' },
    severity: { type: 'STRING', enum: ['info', 'caution', 'warning', 'illegal'] },
    feeDollars: { type: 'NUMBER' },
  },
  required: ['clause', 'severity', 'feeDollars'],
};
const SEVERITY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    clause: { type: 'string' },
    severity: { type: 'string', enum: ['info', 'caution', 'warning', 'illegal'] },
    feeDollars: { type: 'number' },
  },
  required: ['clause', 'severity', 'feeDollars'],
  additionalProperties: false,
};
const LEASE_PROMPT =
  'Lease clause: "Tenant shall pay a late fee of $75 if rent is received after the 5th." ' +
  'Classify it. feeDollars is the fee amount.';

// Strips a markdown code fence around or after the JSON, the workaround the Gemma client would apply.
function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function strictJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function checkSeverity(json: any): string | null {
  let value: any;
  try {
    value = JSON.parse(stripFence(answerText(json)));
  } catch {
    return `not JSON even after stripping a fence: ${JSON.stringify(answerText(json).slice(0, 200))}`;
  }
  if (!['info', 'caution', 'warning', 'illegal'].includes(value.severity)) return `severity outside enum: ${value.severity}`;
  if (value.feeDollars !== 75) return `feeDollars ${value.feeDollars}, expected 75`;
  if (typeof value.clause !== 'string') return 'clause missing';
  return null;
}

const GET_RULE = {
  name: 'get_rule',
  description: 'Look up a Virginia Residential Landlord and Tenant Act rule by its section id.',
  parameters: {
    type: 'OBJECT',
    properties: { rule_id: { type: 'STRING', description: 'Section id, such as "55.1-1204".' } },
    required: ['rule_id'],
  },
};

async function runModel(model: string): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'model'>) => {
    checks.push({ model, ...c });
    const mark = { confirmed: 'ok ', partial: '~  ', 'not supported': 'no ', error: 'ERR' }[c.status];
    console.log(`  [${mark}] ${c.capability}: ${c.detail}`);
  };

  // 1. Baseline text.
  {
    const r = await generate(model, { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }] });
    add({
      capability: 'text generation',
      required: true,
      status: r.ok && /ready/i.test(answerText(r.json)) ? 'confirmed' : 'error',
      detail: r.ok ? `answered "${answerText(r.json).trim().slice(0, 40)}"` : errorText(r),
      latencyMs: r.latencyMs,
      usage: r.json?.usageMetadata,
    });
    if (!r.ok) return checks;
  }

  // 2. System instruction.
  {
    const r = await generate(model, {
      systemInstruction: { parts: [{ text: 'Always answer in uppercase letters only.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
    });
    const text = answerText(r.json).trim();
    add({
      capability: 'systemInstruction',
      required: false,
      status: !r.ok ? 'not supported' : text && text === text.toUpperCase() ? 'confirmed' : 'error',
      detail: r.ok ? `answered "${text.slice(0, 40)}"` : errorText(r),
      latencyMs: r.latencyMs,
    });
  }

  // 3 and 4. Structured output, as the OpenAPI-subset `responseSchema` (what the issue
  // names) and as JSON Schema `responseJsonSchema` (what a Zod-derived schema maps to).
  const schemaForms = [
    { capability: 'structured output (responseSchema)', required: true, config: { responseSchema: SEVERITY_SCHEMA } },
    { capability: 'structured output (responseJsonSchema)', required: false, config: { responseJsonSchema: SEVERITY_JSON_SCHEMA } },
  ];
  for (const form of schemaForms) {
    let strict = 0, conforming = 0, latencyMs = 0, rejected: string | null = null, problem: string | null = null, sample = '';
    for (let run = 0; run < STRUCTURED_RUNS && !rejected; run++) {
      const r = await generate(model, {
        contents: [{ role: 'user', parts: [{ text: LEASE_PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', ...form.config },
      });
      latencyMs += r.latencyMs;
      if (!r.ok) {
        rejected = errorText(r);
        break;
      }
      const text = answerText(r.json);
      const issue = checkSeverity(r.json);
      if (strictJson(text)) strict++;
      else sample = text;
      if (issue) problem = issue;
      else conforming++;
    }
    const status: Status = rejected
      ? 'not supported'
      : conforming < STRUCTURED_RUNS
        ? 'error'
        : strict < STRUCTURED_RUNS
          ? 'partial'
          : 'confirmed';
    add({
      capability: form.capability,
      required: form.required,
      status,
      detail:
        rejected ??
        `${conforming}/${STRUCTURED_RUNS} match the schema, ${strict}/${STRUCTURED_RUNS} strictly valid JSON` +
          (sample ? `; non-strict sample ${JSON.stringify(sample.slice(-40))}` : '') +
          (problem ? `; ${problem}` : ''),
      latencyMs: Math.round(latencyMs / STRUCTURED_RUNS),
    });
  }

  // 5. Function calling: the model asks for a tool, then answers from the tool result.
  {
    const ask = { role: 'user', parts: [{ text: 'What does Virginia Code section 55.1-1204 say? Use the tool.' }] };
    const tools = [{ functionDeclarations: [GET_RULE] }];
    const r = await generate(model, { contents: [ask], tools });
    const call = parts(r.json).find((p) => p.functionCall)?.functionCall;
    if (!r.ok || !call) {
      add({
        capability: 'function calling',
        required: true,
        status: r.ok ? 'error' : 'not supported',
        detail: r.ok ? `no functionCall part; text "${answerText(r.json).slice(0, 80)}"` : errorText(r),
        latencyMs: r.latencyMs,
      });
    } else {
      const r2 = await generate(model, {
        contents: [
          ask,
          r.json.candidates[0].content,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: call.name,
                  ...(call.id ? { id: call.id } : {}),
                  response: { rule_id: '55.1-1204', summary: 'A security deposit may not exceed two months of periodic rent.' },
                },
              },
            ],
          },
        ],
        tools,
      });
      const final = answerText(r2.json);
      const roundTrip = r2.ok && /two months/i.test(final);
      add({
        capability: 'function calling',
        required: true,
        status: call.name === 'get_rule' && call.args?.rule_id?.includes('55.1-1204') && roundTrip ? 'confirmed' : 'error',
        detail: `called ${call.name}(${JSON.stringify(call.args)}); ${
          r2.ok ? `final answer ${roundTrip ? 'used' : 'did not use'} the tool result` : errorText(r2)
        }`,
        latencyMs: r.latencyMs + r2.latencyMs,
      });
    }
  }

  // 6. Thinking levels. The spec plans `low` for triage/vision and `high` for mapping/verification.
  const thinkingResults: Record<string, { ok: boolean; thoughts: number }> = {};
  for (const level of THINKING_LEVELS) {
    const r = await generate(model, {
      contents: [{ role: 'user', parts: [{ text: 'A lease starts March 3 and the move-in report is due 5 days later. What date is it due? One line.' }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: level, includeThoughts: true } },
    });
    const thoughts = r.json?.usageMetadata?.thoughtsTokenCount ?? 0;
    thinkingResults[level] = { ok: r.ok, thoughts };
    add({
      capability: `thinkingLevel=${level}`,
      required: false,
      status: r.ok ? 'confirmed' : 'not supported',
      detail: r.ok
        ? `accepted; thoughtsTokenCount=${thoughts}; thought parts=${parts(r.json).filter((p) => p.thought).length}`
        : errorText(r),
      latencyMs: r.latencyMs,
      usage: r.json?.usageMetadata,
    });
  }
  {
    const accepted = Object.entries(thinkingResults).filter(([, v]) => v.ok);
    const high = thinkingResults.high;
    const lowest = accepted[0];
    const controls = high?.ok && lowest && lowest[0] !== 'high' && high.thoughts > lowest[1].thoughts;
    add({
      capability: 'thinking level control',
      required: true,
      status: controls ? 'confirmed' : accepted.length ? 'error' : 'not supported',
      detail: `accepted levels: ${accepted.map(([k]) => k).join(', ') || 'none'}; thoughts ${lowest?.[0]}=${lowest?.[1].thoughts} vs high=${high?.thoughts}`,
    });
  }

  // 7. Image input (inline base64, as the vision path sends the 1536px model copy).
  const image = { inlineData: { mimeType: 'image/png', data: twoColorPng() } };
  {
    const r = await generate(model, {
      contents: [{ role: 'user', parts: [image, { text: 'What color is the left half of this image, and what color is the right half? Answer like "left: X, right: Y".' }] }],
    });
    const text = answerText(r.json).toLowerCase();
    const seen = /left[^,]*red/.test(text) && /right[^.]*blue/.test(text);
    add({
      capability: 'image input',
      required: true,
      status: !r.ok ? 'not supported' : seen ? 'confirmed' : 'error',
      detail: r.ok ? `answered "${text.trim().slice(0, 80)}"` : errorText(r),
      latencyMs: r.latencyMs,
      usage: r.json?.usageMetadata,
    });
  }

  // 8. Image + structured output + low thinking together, the shape of the damage and quality calls.
  {
    const r = await generate(model, {
      contents: [{ role: 'user', parts: [image, { text: 'Name the dominant colors, left to right.' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { colors: { type: 'ARRAY', items: { type: 'STRING', enum: ['red', 'green', 'blue', 'white', 'black'] } } },
          required: ['colors'],
        },
        thinkingConfig: { thinkingLevel: thinkingResults.low?.ok ? 'low' : 'minimal' },
      },
    });
    let colors: string[] = [];
    try {
      colors = JSON.parse(stripFence(answerText(r.json))).colors;
    } catch {}
    add({
      capability: 'image + structured output + thinking',
      required: false,
      status: !r.ok ? 'not supported' : colors?.[0] === 'red' && colors?.includes('blue') ? 'confirmed' : 'error',
      detail: r.ok ? `colors=${JSON.stringify(colors)}` : errorText(r),
      latencyMs: r.latencyMs,
    });
  }

  return checks;
}

// Opt-in: burst 1-token calls until a 429, then read the quota the error reports.
async function probeLimits(model: string) {
  const started = Date.now();
  for (let i = 1; i <= 40; i++) {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key! },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply: ok' }] }],
        generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel: 'minimal' } },
      }),
    });
    if (res.status === 429) {
      const json: any = await res.json();
      const quota = json?.error?.details?.find((d: any) => d['@type']?.includes('QuotaFailure'))?.violations ?? [];
      return { model, endpoint: 'generateContent', hit429After: i - 1, seconds: (Date.now() - started) / 1000, quota };
    }
  }
  return { model, endpoint: 'generateContent', hit429After: null, note: 'no 429 within 40 calls' };
}

async function main() {
  const all: Check[] = [];
  for (const model of MODELS) {
    console.log(`\n${model}`);
    try {
      all.push(...(await runModel(model)));
    } catch (err) {
      console.error(`  setup error: ${(err as Error).message}`);
      process.exit(2);
    }
  }
  const limits = probeRpm ? await Promise.all(MODELS.map(probeLimits)) : undefined;
  if (limits) console.log('\nlimit probe', JSON.stringify(limits, null, 2));

  const failed = all.filter((c) => c.required && c.status !== 'confirmed' && c.status !== 'partial');
  const gaps = all.filter((c) => c.status === 'partial');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), models: MODELS, checks: all, limits }, null, 2));
  console.log(`\nwrote ${outPath}`);
  if (gaps.length) console.log(`GAPS: ${gaps.map((c) => `${c.model} ${c.capability}`).join('; ')}`);
  console.log(failed.length ? `FAIL: ${failed.map((c) => `${c.model} ${c.capability}`).join('; ')}` : 'PASS: every required capability confirmed on both models');
  process.exit(failed.length ? 1 : 0);
}

main();
