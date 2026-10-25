// Loads a jurisdiction's rule pack from jurisdictions/<state>/ (spec §7.4).
// Legal checks come only from this data, never from model memory, so a pack
// that is wrong in any way fails to load as a whole: every file must pass
// rule.schema.json, quote its snapshot verbatim, keep its versions in order
// without overlaps, and name a registered deterministic check.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { CHECKS, isCheckName } from './checks.js';
import type { Rule, RulePack } from './types.js';

// The repo's jurisdictions/, from src/rules/ or dist/rules/.
export const JURISDICTIONS_ROOT = resolve(import.meta.dirname, '..', '..', '..', 'jurisdictions');

// Folders under the root that are not packs.
const NOT_PACKS = new Set(['schema', 'TEMPLATE']);

export class RulePackError extends Error {
  readonly issues: string[];

  constructor(dir: string, issues: string[]) {
    super(`rule pack ${dir} is invalid:\n${issues.map((issue) => `  ${issue}`).join('\n')}`);
    this.name = 'RulePackError';
    this.issues = issues;
  }
}

export interface LoadOptions {
  // Refuse rules without verifiedBy and verifiedAt. Off until #13's human
  // review lands; then production loads with it on.
  requireVerified?: boolean;
}

// The text after the header's `---` line: what a statuteQuote must appear in.
export function snapshotBody(text: string): string | null {
  const split = text.indexOf('\n---\n');
  return split < 0 ? null : text.slice(split + 5);
}

// ajv-formats is CommonJS: under NodeNext the default import is module.exports.
const addFormats = addFormatsModule.default;

const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
function validateSchema(root: string) {
  let validate = validators.get(root);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    validate = ajv.compile(JSON.parse(readFileSync(join(root, 'schema', 'rule.schema.json'), 'utf8')));
    validators.set(root, validate);
  }
  return validate;
}

function checkRule(rule: Rule, file: string, dir: string, state: string, options: LoadOptions): string[] {
  const issues: string[] = [];
  const where = (path: string) => `${basename(file)}${path}`;

  if (basename(file) !== `${rule.id}.json`) issues.push(`${where('')}: file name must be ${rule.id}.json`);
  if (rule.jurisdiction !== state) issues.push(`${where('/jurisdiction')}: ${rule.jurisdiction} in the ${state} pack`);
  if (!rule.id.startsWith(`${state}_`)) issues.push(`${where('/id')}: must start with ${state}_`);

  rule.versions.forEach((version, i) => {
    const at = (field: string) => where(`/versions/${i}/${field}`);
    if (version.effectiveUntil !== null && version.effectiveUntil <= version.effectiveFrom) {
      issues.push(`${at('effectiveUntil')}: must be after effectiveFrom`);
    }
    const previous = rule.versions[i - 1];
    if (previous) {
      if (previous.effectiveUntil === null) issues.push(`${at('effectiveFrom')}: version ${i - 1} has no end date, so only the last version may be open-ended`);
      else if (version.effectiveFrom < previous.effectiveUntil) issues.push(`${at('effectiveFrom')}: overlaps version ${i - 1}, which runs until ${previous.effectiveUntil}`);
    }
    const snapshot = join(dir, version.snapshotFile);
    if (!existsSync(snapshot)) {
      issues.push(`${at('snapshotFile')}: ${version.snapshotFile} does not exist`);
      return;
    }
    const body = snapshotBody(readFileSync(snapshot, 'utf8'));
    if (body === null) issues.push(`${at('snapshotFile')}: ${version.snapshotFile} has no --- line after its header`);
    else if (!body.includes(version.statuteQuote)) issues.push(`${at('statuteQuote')}: not found verbatim in ${version.snapshotFile}`);
  });

  if (rule.deterministic) {
    const { fn, inputs } = rule.deterministic;
    if (!isCheckName(fn)) {
      issues.push(`${where('/deterministic/fn')}: no check named ${fn} in server/src/rules/checks.ts`);
    } else {
      const check = CHECKS[fn];
      const known: readonly string[] = [...check.inputs, ...check.optionalInputs];
      for (const input of check.inputs) if (!inputs.includes(input)) issues.push(`${where('/deterministic/inputs')}: ${fn} needs ${input}`);
      for (const input of inputs) if (!known.includes(input)) issues.push(`${where('/deterministic/inputs')}: ${fn} does not take ${input}`);
    }
  }

  if (options.requireVerified && !rule.verifiedAt) issues.push(`${where('')}: not verified (verifiedBy, verifiedAt)`);
  return issues;
}

// One pack, such as jurisdictions/va. Throws RulePackError listing every problem.
export function loadRulePack(dir: string, options: LoadOptions = {}): RulePack {
  const root = resolve(dir, '..');
  const state = basename(dir).toUpperCase();
  const validate = validateSchema(root);
  const rulesDir = join(dir, 'rules');
  const files = existsSync(rulesDir) ? readdirSync(rulesDir).filter((name) => name.endsWith('.json')).sort() : [];
  const issues: string[] = [];
  const rules: Rule[] = [];

  for (const name of files) {
    const file = join(rulesDir, name);
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      issues.push(`${name}: invalid JSON: ${(error as Error).message}`);
      continue;
    }
    if (!validate(data)) {
      for (const e of validate.errors ?? []) issues.push(`${name}${e.instancePath || ''}: ${e.message}`);
      continue;
    }
    const rule = data as Rule;
    issues.push(...checkRule(rule, file, dir, state, options));
    rules.push(rule);
  }

  const byId = new Map<string, Rule>();
  for (const rule of rules) {
    if (byId.has(rule.id)) issues.push(`${rule.id}: duplicate id`);
    byId.set(rule.id, rule);
  }
  if (issues.length > 0) throw new RulePackError(dir, issues);

  const verified = rules.map((rule) => rule.verifiedAt);
  const verifiedThrough = verified.length > 0 && verified.every((at) => at !== undefined) ? (verified.sort()[0] ?? null) : null;
  return { jurisdiction: state, rules, byId, verifiedThrough };
}

// Every pack under the root, keyed by jurisdiction code ("VA").
export function loadRulePacks(root: string = JURISDICTIONS_ROOT, options: LoadOptions = {}): Map<string, RulePack> {
  const packs = new Map<string, RulePack>();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || NOT_PACKS.has(entry.name)) continue;
    const pack = loadRulePack(join(root, entry.name), options);
    packs.set(pack.jurisdiction, pack);
  }
  return packs;
}
