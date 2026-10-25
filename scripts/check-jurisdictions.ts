// CI gate for jurisdictions/: every JSON file parses, every rule in
// jurisdictions/<state>/rules/ (and the TEMPLATE example) validates against
// jurisdictions/schema/rule.schema.json, and every version's statuteQuote
// appears verbatim in the body of its snapshot (spec §7.4). The server's
// loader (server/src/rules/loader.ts) checks the rest: version order,
// file names, and deterministic check names, under `pnpm test`.
//
//   node scripts/check-jurisdictions.ts [root]   (default: jurisdictions)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.argv[2] ?? 'jurisdictions';
const schemaPath = join(root, 'schema', 'rule.schema.json');

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

interface Rule {
  versions: { statuteQuote: string; snapshotFile: string }[];
}

// A snapshot is a header, a `---` line, then the statute text verbatim
// (scripts/refresh-snapshots.ts). Quotes must come from the text, not the header.
function missingQuotes(file: string, rule: Rule): string[] {
  const pack = join(dirname(file), '..');
  return rule.versions.flatMap((version, i) => {
    const where = `${file}/versions/${i}`;
    const snapshot = join(pack, version.snapshotFile);
    if (!existsSync(snapshot)) return [`${where}/snapshotFile: ${snapshot} does not exist`];
    const text = readFileSync(snapshot, 'utf8');
    const split = text.indexOf('\n---\n');
    if (split < 0) return [`${where}/snapshotFile: ${snapshot} has no --- line after its header`];
    if (!text.slice(split + 5).includes(version.statuteQuote)) return [`${where}/statuteQuote: not found verbatim in ${snapshot}`];
    return [];
  });
}

const errors: string[] = [];
const parsed = new Map<string, unknown>();

for (const file of jsonFiles(root)) {
  try {
    parsed.set(file, JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    errors.push(`${file}: invalid JSON: ${(error as Error).message}`);
  }
}

// jurisdictions/<state>/rules/**/*.json, TEMPLATE/ included: its example
// rule must stay valid, or it teaches the wrong format.
const rules = [...parsed.keys()].filter((file) => {
  const parts = relative(root, file).split(sep);
  return parts.length >= 3 && parts[1] === 'rules' && parts[0] !== 'schema';
});

if (existsSync(schemaPath) && parsed.has(schemaPath)) {
  const schema = parsed.get(schemaPath) as { $schema?: string };
  const AjvClass = schema.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
  const ajv = new AjvClass({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const file of rules) {
    if (!validate(parsed.get(file))) {
      for (const e of validate.errors ?? []) errors.push(`${file}${e.instancePath || '/'}: ${e.message}`);
      continue;
    }
    errors.push(...missingQuotes(file, parsed.get(file) as Rule));
  }
} else if (rules.length > 0) {
  errors.push(`${schemaPath} is missing, so ${rules.length} rule file(s) cannot be validated`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`jurisdictions: ${parsed.size} JSON file(s) parse, ${rules.length} rule(s) valid with quotes in their snapshots${existsSync(schemaPath) ? '' : ' (no rule schema yet)'}`);
