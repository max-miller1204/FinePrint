// CI gate for jurisdictions/: every JSON file parses, and every rule in
// jurisdictions/<state>/rules/ validates against
// jurisdictions/schema/rule.schema.json (spec §7.4). Until the rule pack
// lands there is no schema and no rules, so only the parse check runs.
//
//   node scripts/check-jurisdictions.ts [root]   (default: jurisdictions)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

const errors: string[] = [];
const parsed = new Map<string, unknown>();

for (const file of jsonFiles(root)) {
  try {
    parsed.set(file, JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    errors.push(`${file}: invalid JSON: ${(error as Error).message}`);
  }
}

// jurisdictions/<state>/rules/**/*.json; TEMPLATE/ holds a placeholder pack.
const rules = [...parsed.keys()].filter((file) => {
  const parts = relative(root, file).split(sep);
  return parts.length >= 3 && parts[1] === 'rules' && parts[0] !== 'schema' && parts[0] !== 'TEMPLATE';
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
    }
  }
} else if (rules.length > 0) {
  errors.push(`${schemaPath} is missing, so ${rules.length} rule file(s) cannot be validated`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`jurisdictions: ${parsed.size} JSON file(s) parse, ${rules.length} rule(s) valid${existsSync(schemaPath) ? '' : ' (no rule schema yet)'}`);
