import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKS, runCheck } from '../src/rules/checks.js';
import { JURISDICTIONS_ROOT, type LoadOptions, loadRulePack, loadRulePacks, RulePackError } from '../src/rules/loader.js';
import { resolveRules, versionOn, versionsForTerm } from '../src/rules/resolve.js';
import type { Rule } from '../src/rules/types.js';
import { parseSectionPage } from '../../scripts/refresh-snapshots.ts';

const packs = loadRulePacks();
const va = packs.get('VA');
const lateFeeCap = va?.byId.get('VA_LATE_FEE_CAP') as Rule;

// A rule with versions [from, until) for resolver edge cases.
function ruleWith(...ranges: [string, string | null, string?][]): Rule {
  return {
    ...lateFeeCap,
    id: 'VA_TEST',
    versions: ranges.map(([effectiveFrom, effectiveUntil, quote = 'quote']) => ({
      effectiveFrom,
      effectiveUntil,
      statuteQuote: quote,
      snapshotFile: 'snapshots/x.txt',
    })),
  };
}

describe('the real rule packs', () => {
  it('load with every quote in its snapshot', () => {
    expect([...packs.keys()]).toEqual(['VA']);
    expect(va?.rules.map((rule) => rule.id)).toEqual([
      'VA_ABUSE_VICTIM_EARLY_TERMINATION',
      'VA_ABUSE_VICTIM_NO_LIQUIDATED_DAMAGES',
      'VA_CASUALTY_TERMINATION',
      'VA_DEPOSIT_CAP',
      'VA_DEPOSIT_PLUS_INSURANCE_CAP',
      'VA_DEPOSIT_RETURN_45_DAYS',
      'VA_DEPOSIT_WEAR_AND_TEAR',
      'VA_ENTRY_NOTICE_REASONABLE_TIMES',
      'VA_HOLDOVER_PENALTY_CAP',
      'VA_LANDLORD_MAINTAIN_FIT',
      'VA_LATE_FEE_CAP',
      'VA_MILITARY_EARLY_TERMINATION',
      'VA_MILITARY_NO_LIQUIDATED_DAMAGES',
      'VA_MITIGATE_NO_ACCELERATED_RENT',
      'VA_MOVE_IN_REPORT_5_DAYS',
      'VA_MOVE_OUT_INSPECTION_PRESENCE',
      'VA_NO_CONFESSION_OF_JUDGMENT',
      'VA_NO_EXCULPATION_INDEMNITY',
      'VA_NO_LANDLORD_ATTORNEY_FEES',
      'VA_NO_REPAIR_FEES',
      'VA_NO_RETALIATION',
      'VA_NO_RIGHTS_WAIVER',
      'VA_NO_SCRA_WAIVER',
      'VA_NO_SELF_HELP_EVICTION',
      'VA_NO_UNILATERAL_CHANGE',
      'VA_PAYMENT_PROCESSING_FEE',
      'VA_RENEWAL_NOTICE',
      'VA_RENT_ESCROW_PROCESS',
      'VA_ROUTINE_MAINTENANCE_NOTICE_72H',
      'VA_RULE_CHANGES_NEED_CONSENT',
      'VA_TENANT_RIGHTS_STATEMENT',
    ]);
  });

  it('give an October 2026 lease both § 55.1-1244 versions, with the changed quote', () => {
    const escrow = va?.byId.get('VA_RENT_ESCROW_PROCESS') as Rule;
    const [resolved] = resolveRules([escrow], { start: '2026-10-01', end: '2027-09-30' });
    expect(resolved?.versions.map((v) => v.version.snapshotFile)).toEqual([
      'snapshots/55.1-1244@2026-10-25.txt',
      'snapshots/55.1-1244~2027-01-01@2026-10-25.txt',
    ]);
    expect(resolved?.changes).toEqual([{ on: '2027-01-01', quoteChanged: true }]);
  });

  it('tell an October 2026 lease which of the newer rules change mid-lease', () => {
    const ids = ['VA_NO_RETALIATION', 'VA_CASUALTY_TERMINATION', 'VA_RENEWAL_NOTICE', 'VA_PAYMENT_PROCESSING_FEE', 'VA_NO_SELF_HELP_EVICTION'];
    const resolved = resolveRules(ids.map((id) => va?.byId.get(id) as Rule), { start: '2026-10-01', end: '2027-09-30' });
    expect(resolved.map((r) => [r.rule.id, r.changes])).toEqual([
      // § 55.1-1258 is rewritten on January 1, 2027 (retaliatory acts move to subsection B).
      ['VA_NO_RETALIATION', [{ on: '2027-01-01', quoteChanged: true }]],
      // § 55.1-1240: the tenant's notice after a fire goes from 14 to 21 days.
      ['VA_CASUALTY_TERMINATION', [{ on: '2027-01-01', quoteChanged: true }]],
      // § 55.1-1204(K): rent increase notice goes from 60 to 90 days.
      ['VA_RENEWAL_NOTICE', [{ on: '2027-07-01', quoteChanged: true }]],
      ['VA_PAYMENT_PROCESSING_FEE', [{ on: '2027-07-01', quoteChanged: false }]],
      ['VA_NO_SELF_HELP_EVICTION', []],
    ]);
  });

  it('have clauses-golden cases, a match and a benign look-alike, for every rule added after #13', () => {
    const cases: { id: string; ruleId: string; expected: string; text: string }[] = readFileSync(
      new URL('../../eval/datasets/clauses-golden.jsonl', import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(va?.byId.has(c.ruleId), c.id).toBe(true);
      expect(['match', 'no_match']).toContain(c.expected);
      expect(c.text.length).toBeGreaterThan(0);
    }
    const added = [
      'VA_ABUSE_VICTIM_EARLY_TERMINATION',
      'VA_ABUSE_VICTIM_NO_LIQUIDATED_DAMAGES',
      'VA_CASUALTY_TERMINATION',
      'VA_ENTRY_NOTICE_REASONABLE_TIMES',
      'VA_HOLDOVER_PENALTY_CAP',
      'VA_MILITARY_EARLY_TERMINATION',
      'VA_MILITARY_NO_LIQUIDATED_DAMAGES',
      'VA_MITIGATE_NO_ACCELERATED_RENT',
      'VA_NO_REPAIR_FEES',
      'VA_NO_RETALIATION',
      'VA_NO_SELF_HELP_EVICTION',
      'VA_NO_UNILATERAL_CHANGE',
      'VA_PAYMENT_PROCESSING_FEE',
      'VA_RENEWAL_NOTICE',
      'VA_RULE_CHANGES_NEED_CONSENT',
    ];
    for (const id of added) {
      const expected = cases.filter((c) => c.ruleId === id).map((c) => c.expected);
      expect(expected, id).toContain('match');
      expect(expected, id).toContain('no_match');
    }
  });

  it('are verified by a person, so they load when verification is required', () => {
    expect(va?.verifiedThrough).toBe('2026-10-24');
    expect(loadRulePacks(JURISDICTIONS_ROOT, { requireVerified: true }).get('VA')?.rules).toHaveLength(31);
  });
});

describe('versionsForTerm', () => {
  it('returns both § 55.1-1204 versions for an October 2026 to October 2027 lease', () => {
    const versions = versionsForTerm(lateFeeCap, { start: '2026-10-01', end: '2027-09-30' });
    expect(versions.map((v) => [v.version.effectiveFrom, v.version.effectiveUntil])).toEqual([
      ['2019-10-01', '2027-07-01'],
      ['2027-07-01', null],
    ]);
    expect(versions.map((v) => v.version.snapshotFile)).toEqual([
      'snapshots/55.1-1204@2026-10-25.txt',
      'snapshots/55.1-1204~2027-07-01@2026-10-25.txt',
    ]);
    // Each version covers its own slice of the term, with no gap and no overlap.
    expect(versions.map((v) => [v.from, v.until])).toEqual([
      ['2026-10-01', '2027-06-30'],
      ['2027-07-01', '2027-09-30'],
    ]);
  });

  it('treats effectiveUntil as exclusive and the lease end as inclusive', () => {
    const before = versionsForTerm(lateFeeCap, { start: '2026-07-01', end: '2027-06-30' });
    expect(before.map((v) => v.version.effectiveFrom)).toEqual(['2019-10-01']);
    const onTheDay = versionsForTerm(lateFeeCap, { start: '2026-07-02', end: '2027-07-01' });
    expect(onTheDay.map((v) => [v.from, v.until])).toEqual([
      ['2026-07-02', '2027-06-30'],
      ['2027-07-01', '2027-07-01'],
    ]);
    const after = versionsForTerm(lateFeeCap, { start: '2027-07-01', end: '2028-06-30' });
    expect(after.map((v) => v.version.effectiveFrom)).toEqual(['2027-07-01']);
  });

  it('gives an open-ended term every version from its start on', () => {
    const versions = versionsForTerm(lateFeeCap, { start: '2026-11-01', end: null });
    expect(versions.map((v) => [v.from, v.until])).toEqual([
      ['2026-11-01', '2027-06-30'],
      ['2027-07-01', null],
    ]);
  });

  it('returns nothing outside every version, and skips a gap between versions', () => {
    const rule = ruleWith(['2020-01-01', '2021-01-01'], ['2022-01-01', null]);
    expect(versionsForTerm(rule, { start: '2019-01-01', end: '2019-12-31' })).toEqual([]);
    expect(versionsForTerm(rule, { start: '2021-03-01', end: '2021-09-30' })).toEqual([]);
    expect(versionsForTerm(rule, { start: '2020-06-01', end: '2022-05-31' }).map((v) => [v.from, v.until])).toEqual([
      ['2020-06-01', '2020-12-31'],
      ['2022-01-01', '2022-05-31'],
    ]);
  });

  it('rejects malformed dates and a term that ends before it starts', () => {
    expect(() => versionsForTerm(lateFeeCap, { start: '2026-02-30', end: null })).toThrow(RangeError);
    expect(() => versionsForTerm(lateFeeCap, { start: '10/01/2026', end: null })).toThrow(RangeError);
    expect(() => versionsForTerm(lateFeeCap, { start: '2027-01-01', end: '2026-12-31' })).toThrow(/before term.start/);
  });
});

describe('versionOn', () => {
  it('picks the version in force on a day', () => {
    expect(versionOn(lateFeeCap, '2027-06-30')?.effectiveFrom).toBe('2019-10-01');
    expect(versionOn(lateFeeCap, '2027-07-01')?.effectiveFrom).toBe('2027-07-01');
    expect(versionOn(lateFeeCap, '2019-09-30')).toBeNull();
  });
});

describe('resolveRules', () => {
  it('reports the mid-lease change and whether the quoted text changed', () => {
    const [resolved] = resolveRules([lateFeeCap], { start: '2026-10-01', end: '2027-09-30' });
    expect(resolved?.changes).toEqual([{ on: '2027-07-01', quoteChanged: false }]);
    const changed = ruleWith(['2020-01-01', '2027-01-01', 'old'], ['2027-01-01', null, 'new']);
    expect(resolveRules([changed], { start: '2026-10-01', end: '2027-09-30' })[0]?.changes).toEqual([{ on: '2027-01-01', quoteChanged: true }]);
  });

  it('leaves out rules not in force during the term and reports no change within one version', () => {
    const future = ruleWith(['2030-01-01', null]);
    const resolved = resolveRules([lateFeeCap, future], { start: '2027-08-01', end: '2028-07-31' });
    expect(resolved.map((r) => [r.rule.id, r.changes])).toEqual([['VA_LATE_FEE_CAP', []]]);
  });
});

describe('deterministic checks', () => {
  it('caps late fees at 10% of rent, or of a lower remaining balance', () => {
    expect(runCheck('lateFeeCap', { lateFee: 150, monthlyRent: 1500 })).toEqual({ outcome: 'complies', limit: 150, actual: 150 });
    expect(runCheck('lateFeeCap', { lateFee: 150.01, monthlyRent: 1500 }).outcome).toBe('violates');
    expect(runCheck('lateFeeCap', { lateFee: 50, monthlyRent: 1500, remainingBalance: 400 })).toEqual({ outcome: 'violates', limit: 40, actual: 50 });
    // 10% of $1234.56 is $123.456: $123.45 complies, $123.46 does not.
    expect(runCheck('lateFeeCap', { lateFee: 123.45, monthlyRent: 1234.56 }).outcome).toBe('complies');
    expect(runCheck('lateFeeCap', { lateFee: 123.46, monthlyRent: 1234.56 }).outcome).toBe('violates');
  });

  it('caps the deposit, alone and with damage insurance, at two months of rent', () => {
    expect(runCheck('securityDepositCap', { securityDeposit: 3000, monthlyRent: 1500 }).outcome).toBe('complies');
    expect(runCheck('securityDepositCap', { securityDeposit: 3000.01, monthlyRent: 1500 }).outcome).toBe('violates');
    expect(runCheck('depositPlusInsuranceCap', { securityDeposit: 2900, damageInsurancePremium: 100.1, monthlyRent: 1500 })).toEqual({
      outcome: 'violates',
      limit: 3000,
      actual: 3000.1,
    });
    expect(runCheck('depositPlusInsuranceCap', { securityDeposit: 2800, damageInsurancePremium: 100, renterInsurancePremium: 100, monthlyRent: 1500 }).outcome).toBe(
      'complies',
    );
    expect(runCheck('depositPlusInsuranceCap', { securityDeposit: 2800, damageInsurancePremium: 100, renterInsurancePremium: 100.01, monthlyRent: 1500 })).toEqual({
      outcome: 'violates',
      limit: 3000,
      actual: 3000.01,
    });
  });

  it('requires 72 hours of maintenance notice', () => {
    expect(runCheck('maintenanceNoticeHours', { maintenanceNoticeHours: 24 })).toEqual({ outcome: 'violates', limit: 72, actual: 24 });
    expect(runCheck('maintenanceNoticeHours', { maintenanceNoticeHours: 72 }).outcome).toBe('complies');
  });

  it('says so instead of guessing when an input is missing or nonsense', () => {
    for (const fn of Object.keys(CHECKS)) expect(runCheck(fn, {}).outcome).toBe('insufficient_input');
    expect(runCheck('lateFeeCap', { lateFee: -5, monthlyRent: 1500 }).outcome).toBe('insufficient_input');
    expect(runCheck('lateFeeCap', { lateFee: Number.NaN, monthlyRent: 1500 }).outcome).toBe('insufficient_input');
    expect(runCheck('securityDepositCap', { securityDeposit: 100, monthlyRent: 0 }).outcome).toBe('insufficient_input');
    expect(() => runCheck('noSuchCheck', {})).toThrow(/unknown/);
  });
});

describe('loadRulePack refuses a bad pack', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // A copy of the real schema and VA pack that a test can break.
  function scratchPack(edit: (rule: Record<string, unknown> & { versions: [Record<string, unknown>, Record<string, unknown>] }) => void, name = 'VA_LATE_FEE_CAP.json') {
    root = mkdtempSync(join(tmpdir(), 'rules-'));
    cpSync(join(JURISDICTIONS_ROOT, 'schema'), join(root, 'schema'), { recursive: true });
    cpSync(join(JURISDICTIONS_ROOT, 'va'), join(root, 'va'), { recursive: true });
    const file = join(root, 'va', 'rules', 'VA_LATE_FEE_CAP.json');
    const rule = JSON.parse(readFileSync(file, 'utf8'));
    edit(rule);
    rmSync(file);
    writeFileSync(join(root, 'va', 'rules', name), JSON.stringify(rule));
    return join(root, 'va');
  }

  const issues = (dir: string, options?: LoadOptions) => {
    try {
      loadRulePack(dir, options);
    } catch (error) {
      expect(error).toBeInstanceOf(RulePackError);
      return (error as RulePackError).issues;
    }
    throw new Error('expected the pack to fail');
  };

  it('when a quote is not in its snapshot', () => {
    const dir = scratchPack((rule) => {
      rule.versions[1].statuteQuote = 'No late charge shall exceed the lesser of 10 percent of the periodic rent.';
    });
    expect(issues(dir)).toEqual(['VA_LATE_FEE_CAP.json/versions/1/statuteQuote: not found verbatim in snapshots/55.1-1204~2027-07-01@2026-10-25.txt']);
  });

  it('when a quote is only in the snapshot header', () => {
    const dir = scratchPack((rule) => {
      rule.versions[0].statuteQuote = 'Fetched: 2026-10-25';
    });
    expect(issues(dir)).toEqual([expect.stringMatching(/versions\/0\/statuteQuote: not found verbatim/)]);
  });

  it('when a snapshot is missing', () => {
    const dir = scratchPack((rule) => {
      rule.versions[0].snapshotFile = 'snapshots/55.1-1204@1999-01-01.txt';
    });
    expect(issues(dir)).toEqual([expect.stringMatching(/does not exist/)]);
  });

  it('when versions overlap or an open-ended version is not last', () => {
    expect(issues(scratchPack((rule) => {
      rule.versions[1].effectiveFrom = '2027-06-01';
    }))).toEqual([expect.stringMatching(/overlaps version 0/)]);
    expect(issues(scratchPack((rule) => {
      rule.versions[0].effectiveUntil = null;
    }))).toEqual([expect.stringMatching(/only the last version may be open-ended/)]);
    expect(issues(scratchPack((rule) => {
      rule.versions[0].effectiveUntil = '2019-10-01';
    }))).toEqual([expect.stringMatching(/must be after effectiveFrom/)]);
  });

  it('when the deterministic check is unknown or its inputs do not match', () => {
    expect(issues(scratchPack((rule) => {
      rule.deterministic = { fn: 'lateFeeLimit', inputs: ['lateFee'] };
    }))).toEqual([expect.stringMatching(/no check named lateFeeLimit/)]);
    expect(issues(scratchPack((rule) => {
      rule.deterministic = { fn: 'lateFeeCap', inputs: ['lateFee', 'weeklyRent'] };
    }))).toEqual([
      expect.stringMatching(/lateFeeCap needs monthlyRent/),
      expect.stringMatching(/lateFeeCap does not take weeklyRent/),
    ]);
    expect(() => loadRulePack(scratchPack((rule) => {
      rule.deterministic = { fn: 'lateFeeCap', inputs: ['lateFee', 'monthlyRent', 'remainingBalance'] };
    }))).not.toThrow();
  });

  it('when the schema fails', () => {
    expect(issues(scratchPack((rule) => {
      rule.checkType = 'semantic';
    }))).toEqual([
      'VA_LATE_FEE_CAP.json/deterministic: boolean schema is false',
      'VA_LATE_FEE_CAP.json: must match "else" schema',
    ]);
    expect(issues(scratchPack((rule) => {
      delete rule.verifiedAt;
    }))).toEqual([expect.stringMatching(/verifiedAt/)]);
    expect(issues(scratchPack((rule) => {
      rule.versions[0].effectiveFrom = '2019-13-01';
    }))).toEqual([expect.stringMatching(/effectiveFrom: must match format "date"/)]);
    expect(issues(scratchPack((rule) => {
      rule.severityIfViolated = 'illegal';
    }))).toEqual([expect.stringMatching(/severityIfViolated/)]);
  });

  it('when the file name, id prefix, or jurisdiction do not match the pack', () => {
    expect(issues(scratchPack(() => {}, 'LATE_FEE.json'))).toEqual(['LATE_FEE.json: file name must be VA_LATE_FEE_CAP.json']);
    expect(issues(scratchPack((rule) => {
      rule.jurisdiction = 'MD';
    }))).toEqual([expect.stringMatching(/MD in the VA pack/)]);
  });

  it('when verification is required and a rule is unverified', () => {
    const dir = scratchPack((rule) => {
      delete rule.verifiedBy;
      delete rule.verifiedAt;
    });
    expect(loadRulePack(dir).verifiedThrough).toBeNull();
    expect(issues(dir, { requireVerified: true })).toEqual(['VA_LATE_FEE_CAP.json: not verified (verifiedBy, verifiedAt)']);
  });

  it('reports the oldest verification date once every rule is verified', () => {
    const dir = scratchPack((rule) => {
      rule.verifiedAt = '2026-10-20';
    });
    expect(loadRulePack(dir, { requireVerified: true }).verifiedThrough).toBe('2026-10-20');
  });
});

describe('scripts/check-jurisdictions.ts (the CI gate)', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const runCheckScript = (dir: string) =>
    spawnSync(process.execPath, [join(JURISDICTIONS_ROOT, '..', 'scripts', 'check-jurisdictions.ts'), dir], { encoding: 'utf8' });

  it('passes the real packs', () => {
    root = mkdtempSync(join(tmpdir(), 'ci-'));
    const result = runCheckScript(JURISDICTIONS_ROOT);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails when a quote is missing from its snapshot', () => {
    root = mkdtempSync(join(tmpdir(), 'ci-'));
    cpSync(JURISDICTIONS_ROOT, root, { recursive: true });
    const snapshot = join(root, 'va', 'snapshots', '55.1-1204~2027-07-01@2026-10-25.txt');
    // The General Assembly rewords subsection E; the rule still quotes the old text.
    writeFileSync(snapshot, readFileSync(snapshot, 'utf8').replace('No such late charge shall exceed the lesser', 'No such late charge shall exceed the greater'));
    const result = runCheckScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/VA_LATE_FEE_CAP\.json\/versions\/1\/statuteQuote: not found verbatim/);
  });

  it('fails when a rule breaks the schema', () => {
    root = mkdtempSync(join(tmpdir(), 'ci-'));
    cpSync(JURISDICTIONS_ROOT, root, { recursive: true });
    mkdirSync(join(root, 'md', 'rules'), { recursive: true });
    writeFileSync(join(root, 'md', 'rules', 'MD_BAD.json'), JSON.stringify({ id: 'MD_BAD' }));
    const result = runCheckScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MD_BAD\.json\/: must have required property 'jurisdiction'/);
  });
});

describe('parseSectionPage (scripts/refresh-snapshots.ts)', () => {
  it('splits a multi-version page into headings and verbatim paragraphs', () => {
    const html = `<html><nav>menu</nav><span id='va_code' class="content"><!--googleon: index--><p class='sidenote'>This section has more than one version.<p>
      <h2> <span id='v1'>§ 55.1-1204</span>. (Effective until July 1, 2027) Terms.</h2><section class='body'><p>E. No such late charge shall exceed 10 percent of the periodic rent &amp; fees, see § <a href='/vacode/36-139/'>36-139</a>.</p><p>J. 1.  The landlord&#39;s receipt.</p></section>
      <h2>§ <span id='v2'>55.1-1204</span>. (Effective July 1, 2027) Terms.</h2><section class='body'><p>E. Changed.</p></section><!--googleoff: index--></span><p>footer</p>`;
    expect(parseSectionPage(html)).toEqual([
      {
        heading: '§ 55.1-1204. (Effective until July 1, 2027) Terms.',
        paragraphs: ['E. No such late charge shall exceed 10 percent of the periodic rent & fees, see § 36-139.', "J. 1.  The landlord's receipt."],
      },
      { heading: '§ 55.1-1204. (Effective July 1, 2027) Terms.', paragraphs: ['E. Changed.'] },
    ]);
  });
});
