// One iOS verification cycle: build, unit tests, and e2e files, in one turn of
// the shared simulator lock (heavy.sh). It skips what already passed, names
// why anything failed, and refuses to rerun a failure nothing has changed.
//
//   node scripts/ios-gate/gate.ts [--unit] [--only-testing <Target/Suite>]...
//     [--force] [--no-cache] [--label <name>] [e2e files...]
//
// It checks the worktree you run it from, wherever the script itself lives.
// e2e files are paths under e2e/ (tests/ios/smoke.e2e.ts) or bare names
// (smoke). Exit codes: 0 everything passed or was already passing, 1 the app
// or a test failed (build, unit, assertion), 2 the app hung, 3 test tooling
// failed twice (the driver was reset in between), 4 refused: nothing changed
// since the same failure, 5 setup (the server or the install is broken).
//
// Pass cache. A step is skipped when it passed before on the same inputs:
//   build and unit tests: the ios/ tree;
//   one e2e file: the ios/, server/, and e2e/ trees (other test files left
//   out), plus that file and firebase.ios.json.
// Inputs are hashed from the working tree, uncommitted files included, so
// editing walkthrough.e2e.ts reruns only walkthrough.e2e.ts, and a Swift edit
// reruns everything. Passes are shared by every worktree (by content, not
// branch). --no-cache runs every step.
//
// Failure classes, from e2e/.e2e/gate/<run>/report.json and the app's hang log:
//   APP_HANG  the app's watchdog stopped a frozen main thread: do not rerun.
//   INFRA     the driver or the simulator failed (boot, launch, "Daemon
//             request timed out" with no hang), or the Firebase emulators
//             crashed while the test ran (server/firebase-debug.log): the
//             driver is reset and the failed files run once more, with fresh
//             emulators, in the same turn of the lock.
//   SETUP     the server never answered or the build would not install.
//   APP_FAIL  everything else: an assertion, a locator, a covered tap.
// Each step's result goes to e2e/.e2e/gate/history.jsonl. A step whose inputs
// match its last failure is refused (exit 4) unless --force.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { type FailureClass, type ReportResult, classify } from './classify.ts';

type Outcome = 'PASS' | FailureClass;

interface Step {
  name: string; // 'build', 'unit', or an e2e file such as tests/ios/smoke.e2e.ts
  key: string;
}

interface StepResult {
  name: string;
  outcome: Outcome;
  detail: string;
}

interface Plan {
  root: string;
  label: string;
  run: Step[];
  build: Step;
  onlyTesting: string[];
}

interface HistoryEntry {
  at: string;
  step: string;
  key: string;
  outcome: Outcome;
  signature: string;
}

const exitCodes: Record<Outcome, number> = { PASS: 0, APP_FAIL: 1, APP_HANG: 2, INFRA: 3, SETUP: 5 };
const refusedExit = 4;

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env }).trim();

const sha = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex');

const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
const common = resolve(root, git(root, ['rev-parse', '--git-common-dir']));
const cacheDir = join(common, 'fineprint-heavy', 'pass-cache');
const gateDir = join(root, 'e2e', '.e2e', 'gate');
const historyFile = join(gateDir, 'history.jsonl');
const hangLog = join(root, 'e2e', '.e2e', 'logs', 'app-hangs.log');
const derivedData = join(root, 'ios', 'DerivedData');
const buildKeyFile = join(derivedData, '.gate-build-key');
const appPath = join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', 'FinePrint.app');

const xcodebuild = [
  '-project', join(root, 'ios', 'FinePrint.xcodeproj'),
  '-scheme', 'FinePrint',
  '-configuration', 'Debug',
  // The booted simulator's architecture only; `pnpm build:ios` builds every one.
  '-destination', `platform=iOS Simulator,name=${process.env.E2E_IOS_DEVICE ?? 'iPhone 17 Pro'}`,
  '-derivedDataPath', derivedData,
  'CODE_SIGNING_ALLOWED=NO',
];

// MARK: Keys

/** Tree hashes of the working tree, uncommitted and untracked (not ignored) files included. */
function workingTree(): string {
  const index = join(tmpdir(), `fineprint-gate-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(root, ['read-tree', 'HEAD'], env);
    git(root, ['add', '-A', '--', 'ios', 'e2e', 'server', 'firebase.ios.json', 'pnpm-lock.yaml'], env);
    return git(root, ['write-tree'], env);
  } finally {
    rmSync(index, { force: true });
  }
}

function keys(files: string[]): { build: Step; unit: Step; e2e: Step[] } {
  const tree = workingTree();
  const object = (path: string) => git(root, ['rev-parse', `${tree}:${path}`]);
  const xcode = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim();
  const ios = sha(object('ios'), xcode);
  // e2e/ without its test files, so editing one test file keeps the others' passes.
  const support = git(root, ['ls-tree', '-r', tree, 'e2e'])
    .split('\n')
    .filter((line) => !/\te2e\/tests\/.*\.e2e\.ts$/.test(line))
    .join('\n');
  const shared = sha(ios, object('server'), sha(support), object('firebase.ios.json'), object('pnpm-lock.yaml'));
  return {
    build: { name: 'build', key: ios },
    unit: { name: 'unit', key: ios },
    e2e: files.map((file) => ({ name: file, key: sha(shared, object(`e2e/${file}`)) })),
  };
}

function normalizeTestFile(arg: string): string {
  const path = arg.includes('/') ? arg.replace(/^e2e\//, '') : `tests/ios/${arg}`;
  const file = path.endsWith('.e2e.ts') ? path : `${path}.e2e.ts`;
  if (!existsSync(join(root, 'e2e', file))) throw new Error(`no e2e file e2e/${file}`);
  return file;
}

// MARK: Cache and history

const cacheFile = (step: Step) => join(cacheDir, sha(step.name, step.key));

function cachedPass(step: Step): { at: string; branch: string } | undefined {
  const file = cacheFile(step);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

function history(): HistoryEntry[] {
  if (!existsSync(historyFile)) return [];
  return readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function lastRun(entries: HistoryEntry[], step: string): HistoryEntry | undefined {
  return entries.findLast((entry) => entry.step === step);
}

/** Which tests failed and how (class, code, title), without messages that vary run to run. */
function signature(result: StepResult): string {
  const tests = result.detail
    .split('\n')
    .map((line) => /^\s*(\S+ \S*)(?: at line \d+)?: "(.*?)":/.exec(line))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} "${match[2]}"`);
  return `${result.outcome} ${tests.length > 0 ? tests.join(' | ') : result.detail.split('\n')[0]}`;
}

function record(step: Step, result: StepResult, branch: string) {
  mkdirSync(gateDir, { recursive: true });
  const previous = lastRun(history(), step.name);
  const entry: HistoryEntry = {
    at: new Date().toISOString(),
    step: step.name,
    key: step.key,
    outcome: result.outcome,
    signature: result.outcome === 'PASS' ? '' : signature(result),
  };
  appendFileSync(historyFile, `${JSON.stringify(entry)}\n`);
  if (result.outcome === 'PASS') {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile(step), JSON.stringify({ at: entry.at, branch }));
  } else if (previous && previous.signature === entry.signature) {
    result.detail += '\n  STOP: the same failure as the previous run of this step. Diagnose it before running again.';
  }
}

// MARK: Running

function run(command: string, args: string[], cwd: string, logFile: string): number {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(logFile, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  return result.status ?? 1;
}

function tail(file: string, pattern: RegExp, count = 15): string {
  return readFileSync(file, 'utf8').split('\n').filter((line) => pattern.test(line)).slice(-count).join('\n    ');
}

function build(plan: Plan, runDir: string): StepResult {
  if (existsSync(appPath) && existsSync(buildKeyFile) && readFileSync(buildKeyFile, 'utf8') === plan.build.key) {
    return { name: 'build', outcome: 'PASS', detail: 'up to date' };
  }
  const log = join(runDir, 'build.log');
  const status = run('xcodebuild', [...xcodebuild, '-quiet', 'build-for-testing'], root, log);
  if (status !== 0) return { name: 'build', outcome: 'APP_FAIL', detail: `xcodebuild exit ${status}\n    ${tail(log, /error:/)}\n    log: ${relative(root, log)}` };
  writeFileSync(buildKeyFile, plan.build.key);
  return { name: 'build', outcome: 'PASS', detail: 'built' };
}

function unit(plan: Plan, runDir: string): StepResult {
  const log = join(runDir, 'unit.log');
  const only = plan.onlyTesting.flatMap((suite) => [`-only-testing:${suite}`]);
  // One simulator on an 8 GB Mac: no "Clone 1 of" devices.
  const status = run('xcodebuild', [...xcodebuild, 'test-without-building', '-parallel-testing-enabled', 'NO', ...only], root, log);
  const summary = tail(log, /Test run with|✘|error:/, 20);
  if (status === 0) return { name: 'unit', outcome: 'PASS', detail: summary.split('\n').at(-1)?.trim() ?? '' };
  return { name: 'unit', outcome: 'APP_FAIL', detail: `xcodebuild test exit ${status}\n    ${summary}\n    log: ${relative(root, log)}` };
}

/** Abort lines the app's watchdog wrote at or after `since`. */
function hangAborts(since: Date): string[] {
  if (!existsSync(hangLog)) return [];
  return readFileSync(hangLog, 'utf8')
    .split('\n')
    .filter((line) => line.includes(' abort ') && new Date(line.split(' ')[0]) >= since);
}

const emulatorLog = join(root, 'server', 'firebase-debug.log');

/**
 * The first error the Firebase emulators logged at or after `since`, and the time of the debug
 * line before it. firebase-tools rewrites the log on every start, so lines are matched by time.
 * The Storage emulator can crash on its own (an unhandled ENOENT on a blob), which takes Auth
 * down too, and every later test then fails on sign-in or a 503 that reads like an app bug.
 */
function emulatorCrash(since: Date): { at: Date; line: string } | undefined {
  if (!existsSync(emulatorLog)) return undefined;
  let last: { at: Date; line: string } | undefined;
  for (const line of readFileSync(emulatorLog, 'utf8').split('\n')) {
    const debug = /^\[debug\] \[([^\]]+)\] (.*)$/.exec(line);
    if (debug) last = { at: new Date(debug[1]), line: debug[2].slice(0, 200) };
    else if (/^\[error\] \S/.test(line) && last && last.at >= since) return last;
  }
  return undefined;
}

function e2e(files: string[], runDir: string, attempt: number): StepResult[] {
  const output = join(runDir, `e2e-${attempt}`);
  const log = join(runDir, `e2e-${attempt}.log`);
  const startedAt = new Date();
  const npx = run('npx', ['e2e', 'run', ...files, '--target', 'ios', '--exclude-tag', 'bugbash', '--trace', 'on', '--output', output], join(root, 'e2e'), log);
  const reportFile = join(output, 'report.json');
  if (!existsSync(reportFile)) {
    const detail = `e2e exit ${npx} with no report\n    ${tail(log, /ERROR|Error|error/, 8)}\n    log: ${relative(root, log)}`;
    return files.map((name) => ({ name, outcome: 'INFRA', detail }));
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8')).run as { results: ReportResult[]; summary: { executed: number } };
  const hung = hangAborts(startedAt).length > 0;
  const crash = emulatorCrash(startedAt);
  return files.map((name) => {
    const results = report.results.filter((result) => result.file === name && result.status !== 'skipped');
    if (results.length === 0) return { name, outcome: 'INFRA', detail: `no tests executed (e2e exit ${npx}); log: ${relative(root, log)}` };
    const failed = results.filter((result) => result.status !== 'passed');
    if (failed.length === 0) return { name, outcome: 'PASS', detail: `${results.length} passed` };
    const classes = failed.map((result) => {
      const last = result.attempts.at(-1);
      let outcome = classify(last?.error, last?.secondaryErrors ?? [], hung);
      // A test still running when the emulators crashed failed on them, not on the app.
      const endedAt = last?.startedAt ? new Date(last.startedAt).getTime() + (last.durationMs ?? 0) : Number.POSITIVE_INFINITY;
      if (outcome === 'APP_FAIL' && crash && endedAt >= crash.at.getTime()) outcome = 'INFRA';
      return { result, error: last?.error, outcome };
    });
    // The most serious class wins: a hang explains the tooling errors around it.
    const order: FailureClass[] = ['APP_HANG', 'SETUP', 'APP_FAIL', 'INFRA'];
    const outcome = order.find((item) => classes.some((entry) => entry.outcome === item)) ?? 'APP_FAIL';
    const lines = classes.map(({ result, error, outcome: each }) => {
      const where = error?.source?.line ? ` at line ${error.source.line}` : '';
      const message = (error?.message ?? 'no error recorded').split('\n')[0].slice(0, 220);
      return `${each} ${error?.code ?? ''}${where}: "${result.titlePath.join(' > ')}": ${message}`;
    });
    const emulator = crash ? `\n    Firebase emulator error at ${crash.at.toISOString()}: ${crash.line} (server/firebase-debug.log)` : '';
    return { name, outcome, detail: `${failed.length} of ${results.length} failed\n    ${lines.join('\n    ')}${emulator}\n    traces: ${relative(root, output)}/results/` };
  });
}

function insideLock(queued: Plan): number {
  const runDir = join(gateDir, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(runDir, { recursive: true });
  const branch = git(root, ['branch', '--show-current']) || 'detached';
  // Files can change while the job waits in the queue, so key what actually runs.
  const files = queued.run.filter((step) => step.name.endsWith('.e2e.ts')).map((step) => step.name);
  const fresh = keys(files);
  const plan: Plan = {
    ...queued,
    build: fresh.build,
    run: queued.run.map((step) => (step.name === 'unit' ? fresh.unit : (fresh.e2e.find((item) => item.name === step.name) ?? step))),
  };
  const results: StepResult[] = [];
  const stepsByName = new Map(plan.run.map((step) => [step.name, step]));
  const finish = (result: StepResult) => {
    const step = stepsByName.get(result.name);
    // A unit run narrowed with --only-testing proves only those suites.
    if (step && !(result.name === 'unit' && plan.onlyTesting.length > 0)) record(step, result, branch);
    results.push(result);
  };

  const built = build(plan, runDir);
  results.push(built);
  if (built.outcome === 'PASS') {
    if (stepsByName.has('unit')) finish(unit(plan, runDir));
    const files = plan.run.filter((step) => step.name.endsWith('.e2e.ts')).map((step) => step.name);
    if (files.length > 0) {
      let e2eResults = e2e(files, runDir, 1);
      const retry = e2eResults.filter((result) => result.outcome === 'INFRA').map((result) => result.name);
      if (retry.length > 0) {
        console.log(`[gate] tooling failed on ${retry.join(', ')}; resetting the driver and running those once more`);
        spawnSync(join(import.meta.dirname, 'reset-driver.sh'), ['--shutdown'], { stdio: 'inherit' });
        const again = e2e(retry, runDir, 2);
        e2eResults = e2eResults.map((result) => again.find((item) => item.name === result.name) ?? result);
      }
      for (const result of e2eResults) finish(result);
    }
  }

  console.log(`\n[gate] ${plan.label}: results (run folder ${relative(root, runDir)})`);
  for (const result of results) console.log(`  ${result.outcome.padEnd(8)} ${result.name}: ${result.detail}`);
  printAdvice(results);
  const order: Outcome[] = ['APP_HANG', 'SETUP', 'APP_FAIL', 'INFRA'];
  const worst = order.find((outcome) => results.some((result) => result.outcome === outcome));
  return worst ? exitCodes[worst] : 0;
}

function printAdvice(results: StepResult[]) {
  const seen = new Set(results.map((result) => result.outcome));
  if (seen.has('APP_HANG')) console.log('\n  APP_HANG: the main thread froze. Do not rerun. Read the crash report named above (main thread stack), or bisect the screen\'s modifiers. #99 lists known triggers.');
  if (seen.has('INFRA')) console.log('\n  INFRA: tooling failed twice with a fresh driver. Run `npx agent-device doctor` and check memory pressure before another run.');
  if (seen.has('SETUP')) console.log('\n  SETUP: read e2e/.e2e/logs/server-ios.log. After a rebase, run `pnpm install` (the server may lack a new package).');
  if (seen.has('APP_FAIL')) console.log('\n  APP_FAIL: read the trace.md and screenshot in the traces folder, fix, then rerun only the failing file.');
}

// MARK: Main

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === '--inside') return insideLock(JSON.parse(readFileSync(args[1], 'utf8')) as Plan);

  let wantsUnit = false;
  let force = false;
  let noCache = false;
  let label = '';
  const onlyTesting: string[] = [];
  const files: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--unit') wantsUnit = true;
    else if (arg === '--force') force = true;
    else if (arg === '--no-cache') noCache = true;
    else if (arg === '--label') label = args[++index];
    else if (arg === '--only-testing') { wantsUnit = true; onlyTesting.push(args[++index]); }
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else files.push(normalizeTestFile(arg));
  }
  if (!wantsUnit && files.length === 0) {
    console.error('usage: gate.ts [--unit] [--only-testing <Target/Suite>]... [--force] [--no-cache] [--label <name>] [e2e files...]');
    return 64;
  }

  const branch = git(root, ['branch', '--show-current']) || 'detached';
  const all = keys(files);
  const requested = [...(wantsUnit ? [all.unit] : []), ...all.e2e];
  const entries = history();
  const toRun: Step[] = [];
  const refused: string[] = [];
  for (const step of requested) {
    const narrowed = step.name === 'unit' && onlyTesting.length > 0;
    const pass = noCache || narrowed ? undefined : cachedPass(step);
    if (pass) {
      console.log(`  CACHED   ${step.name}: passed ${pass.at} on ${pass.branch}, same inputs`);
      continue;
    }
    const last = lastRun(entries, step.name);
    if (!force && last && last.outcome !== 'PASS' && last.outcome !== 'INFRA' && last.key === step.key) {
      refused.push(`  REFUSED  ${step.name}: nothing changed since it failed at ${last.at}: ${last.signature}`);
      continue;
    }
    toRun.push(step);
  }
  for (const line of refused) console.log(line);
  if (refused.length > 0) {
    console.log('\n  Change the code (or the test) first, or pass --force to run it anyway.');
    return refusedExit;
  }
  if (toRun.length === 0) {
    console.log(`[gate] ${label || branch}: everything requested already passed on these inputs`);
    return 0;
  }

  const plan: Plan = { root, label: label || branch, run: toRun, build: all.build, onlyTesting };
  mkdirSync(gateDir, { recursive: true });
  const planFile = join(gateDir, `plan-${process.pid}.json`);
  writeFileSync(planFile, JSON.stringify(plan));
  console.log(`[gate] ${plan.label}: running ${toRun.map((step) => step.name).join(', ')}`);
  const heavy = spawnSync(
    join(import.meta.dirname, 'heavy.sh'),
    [plan.label, process.execPath, import.meta.filename, '--inside', planFile],
    { stdio: 'inherit' },
  );
  rmSync(planFile, { force: true });
  return heavy.status ?? 1;
}

try {
  process.exit(main());
} catch (error) {
  console.error(`[gate] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(64);
}
