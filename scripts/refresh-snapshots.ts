// Re-fetch every statute snapshot from law.lis.virginia.gov and diff it
// against the stored text (spec §7.4), so a maintainer sees when the General
// Assembly changes a section or adds a version with a new effective date.
//
//   node scripts/refresh-snapshots.ts [root]                 report only; exit 1 on any change
//   node scripts/refresh-snapshots.ts --write [root]         also write changed and new versions
//   node scripts/refresh-snapshots.ts --add <url> <state> [root]   snapshot every version of a new section
//
// A snapshot is `jurisdictions/<state>/snapshots/<section>[~<from>]@<fetched>.txt`:
// a header (Source, Fetched, Heading), a `---` line, then the section text
// verbatim, one paragraph per line. `~<from>` marks a version that is not in
// force yet ("Effective July 1, 2027"). --write never edits an existing
// file or a rule: it writes a new dated file and names the rules that still
// point at the old one, so a human re-checks each quote before repointing.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

interface PageVersion {
  heading: string;
  paragraphs: string[];
}

interface Snapshot {
  file: string;
  source: string;
  heading: string;
  paragraphs: string[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

const plain = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/[\r\n]+/g, ' ');

// The section text sits in <span id='va_code'>: one <h2> heading and one
// <section class='body'> of <p> paragraphs per version.
export function parseSectionPage(html: string): PageVersion[] {
  const start = html.indexOf("id='va_code'");
  if (start < 0) throw new Error('no va_code block on the page');
  const end = html.indexOf('<!--googleoff: index-->', start);
  const block = html.slice(start, end < 0 ? undefined : end);
  return block
    .split(/<h2[^>]*>/)
    .slice(1)
    .map((part) => {
      const [headingHtml = '', rest = ''] = part.split('</h2>');
      const body = rest.match(/<section[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
      const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => plain(m[1] ?? '').trim()).filter(Boolean);
      return { heading: plain(headingHtml).replace(/\s+/g, ' ').trim(), paragraphs };
    });
}

// "(Effective July 1, 2027)" -> "2027-07-01"; current and single versions -> null.
function futureFrom(heading: string): string | null {
  const m = heading.match(/\(Effective (\w+) (\d{1,2}), (\d{4})\)/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1] ?? '') + 1;
  if (month === 0) throw new Error(`unknown month in "${heading}"`);
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function sectionFromUrl(url: string): string {
  const m = url.match(/section([\d.]+-[\d.]+)\/?$/);
  if (!m?.[1]) throw new Error(`cannot read a section number from ${url}`);
  return m[1];
}

export function formatSnapshot(source: string, fetched: string, version: PageVersion): string {
  return `Source: ${source}\nFetched: ${fetched}\nHeading: ${version.heading}\n---\n${version.paragraphs.join('\n')}\n`;
}

export function readSnapshot(file: string): Snapshot {
  const text = readFileSync(file, 'utf8');
  const split = text.indexOf('\n---\n');
  if (split < 0) throw new Error(`${file}: no --- line between header and text`);
  const header = Object.fromEntries(
    text
      .slice(0, split)
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]),
  );
  if (!header.Source || !header.Heading) throw new Error(`${file}: header needs Source and Heading`);
  return { file, source: header.Source, heading: header.Heading, paragraphs: text.slice(split + 5).split('\n').filter(Boolean) };
}

async function fetchVersions(url: string): Promise<PageVersion[]> {
  const response = await fetch(url, { headers: { 'User-Agent': 'FinePrint snapshot refresh (+https://github.com/max-miller1204/FinePrint)' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return parseSectionPage(await response.text());
}

function snapshotName(url: string, heading: string, fetched: string): string {
  const from = futureFrom(heading);
  return `${sectionFromUrl(url)}${from ? `~${from}` : ''}@${fetched}.txt`;
}

function diff(before: string[], after: string[]): string[] {
  const out: string[] = [];
  const removed = before.filter((line) => !after.includes(line));
  const added = after.filter((line) => !before.includes(line));
  for (const line of removed) out.push(`  - ${line}`);
  for (const line of added) out.push(`  + ${line}`);
  if (out.length === 0) out.push('  (same paragraphs, different order)');
  return out;
}

function rulesUsing(stateDir: string, snapshotFile: string): string[] {
  const rulesDir = join(stateDir, 'rules');
  if (!existsSync(rulesDir)) return [];
  return readdirSync(rulesDir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => readFileSync(join(rulesDir, name), 'utf8').includes(`"snapshots/${snapshotFile}"`));
}

async function add(url: string, state: string, root: string, fetched: string) {
  const dir = join(root, state, 'snapshots');
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  for (const version of await fetchVersions(url)) {
    const file = join(dir, snapshotName(url, version.heading, fetched));
    writeFileSync(file, formatSnapshot(url, fetched, version));
    console.log(`wrote ${relative(process.cwd(), file)}  (${version.heading})`);
  }
}

async function refresh(root: string, write: boolean, fetched: string): Promise<boolean> {
  const states = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'schema' && entry.name !== 'TEMPLATE')
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, 'snapshots')));

  let changed = false;
  for (const stateDir of states) {
    const snapshots = readdirSync(join(stateDir, 'snapshots'))
      .filter((name) => name.endsWith('.txt'))
      .map((name) => readSnapshot(join(stateDir, 'snapshots', name)));
    // Several fetch dates of one version can sit side by side; compare the newest.
    const newest = new Map<string, Snapshot>();
    for (const s of snapshots.sort((a, b) => a.file.localeCompare(b.file))) newest.set(`${s.source}\n${s.heading}`, s);

    for (const source of new Set(snapshots.map((s) => s.source))) {
      const page = await fetchVersions(source);
      for (const version of page) {
        const stored = newest.get(`${source}\n${version.heading}`);
        if (stored && stored.paragraphs.join('\n') === version.paragraphs.join('\n')) {
          console.log(`ok       ${relative(root, stored.file)}`);
          continue;
        }
        changed = true;
        if (stored) {
          console.log(`CHANGED  ${relative(root, stored.file)}`);
          for (const line of diff(stored.paragraphs, version.paragraphs)) console.log(line);
        } else {
          console.log(`NEW      ${source}\n  ${version.heading}`);
        }
        if (write) {
          const name = snapshotName(source, version.heading, fetched);
          writeFileSync(join(stateDir, 'snapshots', name), formatSnapshot(source, fetched, version));
          console.log(`  wrote snapshots/${name}`);
          const old = stored ? relative(join(stateDir, 'snapshots'), stored.file) : null;
          const rules = old ? rulesUsing(stateDir, old) : [];
          if (rules.length > 0) console.log(`  re-check and repoint: ${rules.join(', ')}`);
        }
      }
      for (const s of snapshots.filter((s) => s.source === source && !page.some((v) => v.heading === s.heading))) {
        if (newest.get(`${s.source}\n${s.heading}`) !== s) continue;
        changed = true;
        console.log(`GONE     ${relative(root, s.file)}: no version headed "${s.heading}" on the page (repealed, or now in force under a new heading)`);
      }
    }
  }
  return changed;
}

// Run as a script; a test imports the parser without fetching anything.
if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const fetched = new Date().toISOString().slice(0, 10);
  if (args[0] === '--add') {
    const [, url, state, root = 'jurisdictions'] = args;
    if (!url || !state) {
      console.error('usage: node scripts/refresh-snapshots.ts --add <url> <state> [root]');
      process.exit(2);
    }
    await add(url, state, root, fetched);
  } else {
    const write = args.includes('--write');
    const root = args.find((a) => !a.startsWith('--')) ?? 'jurisdictions';
    const changed = await refresh(root, write, fetched);
    console.log(changed ? 'snapshots differ from law.lis.virginia.gov' : 'every snapshot matches law.lis.virginia.gov');
    process.exit(changed ? 1 : 0);
  }
}
