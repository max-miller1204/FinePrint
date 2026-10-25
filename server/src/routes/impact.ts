import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AppEnv } from '../app.js';
import type { ImpactTotals } from '../impact.js';
import type { Store } from '../storage/firestore.js';
import { guard } from './rentals.js';

export function createImpact(store: Store) {
  const impact = new Hono<AppEnv>();
  impact.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.html(renderImpact(await guard(store.getImpact())));
  });
  return impact;
}

export function renderImpact(totals: ImpactTotals) {
  const format = (n: number) => new Intl.NumberFormat('en-US').format(n);
  const metrics = [
    ['tenantsHelped', 'Tenants who opted in', 'One count per account that chose to contribute. This is participation, not a count of legal outcomes.'],
    ['verifiedClausesFlagged', 'Verified clauses flagged', 'Distinct clauses flagged as likely unenforceable by a code check or an agreeing verifier. This is not a court ruling.'],
    ['moveInReportsWithin5Days', 'Move-in reports sealed early', 'First move-in seal during the first five calendar days of occupancy, using UTC dates. This measures a habit, not a legal deadline.'],
    ['depositDollarsCovered', 'Deposit dollars covered', 'Tenant-entered deposits behind first sealed move-in reports. Each amount is rounded down to a $500 bucket before adding it, so this is a lower bound.'],
  ] as const;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f6f5f1"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#151b17"><meta name="color-scheme" content="light dark">
<title>Our impact | FinePrint</title><style>
:root{color-scheme:light dark;--paper:#f6f5f1;--ink:#202923;--muted:#525e56;--line:#c8cec5;--card:#fff;--accent:#24533c}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,sans-serif;line-height:1.6}
main{max-width:960px;margin:auto;padding:calc(40px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) calc(48px + env(safe-area-inset-bottom,0px)) max(24px,env(safe-area-inset-left,0px))}
.brand{font-weight:700;color:var(--accent);letter-spacing:-.02em}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1;letter-spacing:-.04em;margin:40px 0 20px}h2{font-size:1.25rem;line-height:1.3;letter-spacing:-.02em}p{max-width:65ch;color:var(--muted)}.intro{font-size:1.125rem}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:32px 0}.metric{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;min-width:0}.value{display:block;font-size:clamp(1.75rem,4vw,2.75rem);font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.04em;overflow-wrap:anywhere;line-height:1.2}.metric p{margin-bottom:0}.note{border-top:1px solid var(--line);padding-top:24px;margin-top:32px}li{margin:.5rem 0;color:var(--muted)}footer{margin-top:40px;font-size:.875rem;color:var(--muted)}
@media(max-width:600px){.metrics{grid-template-columns:1fr}.metric{padding:20px}}
@media(prefers-color-scheme:dark){:root{--paper:#151b17;--ink:#eef2ec;--muted:#b7c3b9;--line:#455249;--card:#1d2720;--accent:#a3d4b5}}
</style></head><body><main><div class="brand">FinePrint / Impact</div>
<h1>Small steps. Shared impact.</h1><p class="intro">A clearer lease. A sealed record. A better start. These totals show the steps tenants chose to count.</p>
<p>Participation is optional and off by default. These are live totals since counting began. Zero means no opted-in activity has been counted yet.</p>
<div class="metrics">${metrics.map(([key,label,description]) => html`<section class="metric" aria-labelledby="${key}"><span class="value" data-counter="${key}">${key === 'depositDollarsCovered' ? '$' : ''}${format(totals[key])}</span><h2 id="${key}">${label}</h2><p>${description}</p></section>`)}</div>
<section class="note"><h2>Your choice, without your story</h2><p>In Settings, turn on “Add to the Impact Count” to contribute. The public counters contain only totals: no names, rentals, documents, or account identifiers. No cookies, tracking scripts, or per-user activity history are used for this page.</p><p>Turning it off stops future contributions. Past anonymous totals stay in the count, including after Delete Everything. Turning it back on does not count your account again. Activity from before you opted in is not added later.</p></section>
<section class="note"><h2>Not tracked yet</h2><p>These outcomes need workflows that are not available yet. They are not reported as zero:</p><ul><li>Objection letters marked sent within the applicable five-day window</li><li>Repair notices sent and repairs marked resolved</li><li>High-stakes handoffs to legal aid</li></ul><p>Opening a resource or showing a warning does not prove that someone received legal help.</p></section>
<footer>Legal information, not legal advice. Aggregate counts do not establish legal outcomes.</footer></main></body></html>`;
}
