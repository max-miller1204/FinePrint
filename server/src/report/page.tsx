import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import {
  acceptedAnnotations,
  receiptGap,
  validBox,
  webUrl,
  type EvidenceReport,
  type ReportExhibit,
  type ReportFinding,
} from './model.js';
import { reportStyles } from './styles.js';

function Time({ at }: { at: string | null }) {
  // Preserve the original offset for device times. Calendar dates do not
  // acquire a timezone by being displayed in the reader's browser.
  return at ? (
    <time dateTime={at}>{at.replace('T', ' ').replace('.000Z', ' UTC').replace(/Z$/, ' UTC')}</time>
  ) : (
    <span>Not recorded</span>
  );
}
function Hash({ value }: { value: string }) {
  return <code>{value}</code>;
}
function Layout({ children, fixture = false }: { children: Child; fixture?: boolean }) {
  return (
    <>
      {raw('<!doctype html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="color-scheme" content="light dark" />
          <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f6f4" />
          <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111813" />
          <meta name="robots" content="noindex, nofollow, noarchive" />
          <title>Evidence Report | FinePrint</title>
          <style>{raw(reportStyles)}</style>
        </head>
        <body>
          <a class="skip" href="#report">
            Skip to report
          </a>
          <div class={`shell${fixture ? ' fixture-page' : ''}`}>
            <header class="masthead">
              <span class="brand">FinePrint</span>
              <span class="eyebrow">Evidence Report</span>
            </header>
            {children}
            <footer>
              <p>Prepared by the tenant using FinePrint. Not legal advice.</p>
              <p>Tenant names and street addresses are not included in this report.</p>
            </footer>
          </div>
        </body>
      </html>
    </>
  );
}
export function Unavailable({ temporary = false }: { temporary?: boolean }) {
  return (
    <Layout>
      <main id="report" tabIndex={-1} class="intro">
        <h1>{temporary ? 'Report temporarily unavailable' : 'Report unavailable'}</h1>
        <p>
          {temporary ? 'Please try again later.' : 'This link cannot open a report. Ask the tenant for a current link.'}
        </p>
      </main>
    </Layout>
  );
}
const severity = {
  unenforceable: '⚠ Likely unenforceable',
  ask: '△ Worth asking about',
  info: 'ⓘ Good to know',
};
function FindingCard({ finding, leaseLocale }: { finding: ReportFinding; leaseLocale: string }) {
  const source = webUrl(finding.sourceUrl);
  return (
    <article class="card" aria-labelledby={`finding-${finding.id}`}>
      <span class={`badge ${finding.severity}`}>{severity[finding.severity]}</span>
      <h3 id={`finding-${finding.id}`}>{finding.titleEn}</h3>
      <p>{finding.explanationEn}</p>
      <p class="eyebrow">Lease quote</p>
      {finding.leaseQuote === null ? (
        <p>No matching lease clause was found.</p>
      ) : (
        <blockquote lang={finding.leaseLocale ?? leaseLocale}>{finding.leaseQuote}</blockquote>
      )}
      {finding.statuteQuote && (
        <>
          <p class="eyebrow">Statute quote</p>
          <blockquote lang="en">{finding.statuteQuote}</blockquote>
        </>
      )}
      {finding.citation && (
        <p>
          {source ? (
            <a href={source} rel="noreferrer">
              {finding.citation}
            </a>
          ) : (
            finding.citation
          )}
        </p>
      )}
      <p>
        <strong>What you can do</strong>
        <br />
        {finding.actionEn}
      </p>
      {Object.entries(finding.translations).map(([locale, translation]) => (
        <div key={locale} lang={locale} dir="auto">
          <h3>{translation.title}</h3>
          <p>{translation.explanation}</p>
          <p>{translation.action}</p>
        </div>
      ))}
    </article>
  );
}
function Exhibit({ item, number, report }: { item: ReportExhibit; number: number; report: EvidenceReport }) {
  const deleted = item.deletedAt !== null;
  const annotations = acceptedAnnotations(item);
  const image = deleted ? undefined : webUrl(item.imageUrl);
  const manifest = report.manifests.find((m) => m.id === item.sealedManifestId);
  const gap = receiptGap(item);
  const title = `Exhibit ${number}: ${item.room}, ${item.checklistItem}`;
  return (
    <figure class="exhibit" id={`exhibit-${item.id}`} aria-labelledby={`caption-${item.id}`}>
      {image ? (
        <div class="photo">
          <img
            src={image}
            alt={`${item.room}, ${item.checklistItem}${annotations.length ? `. Tenant annotations: ${annotations.map((a) => `${a.label}: ${a.description}`).join('; ')}` : '. No tenant annotations.'}`}
          />
          <svg class="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {annotations
              .filter((a) => validBox(a.box))
              .map((a, i) => (
                <rect
                  key={i}
                  x={a.box.x * 1000}
                  y={a.box.y * 1000}
                  width={a.box.width * 1000}
                  height={a.box.height * 1000}
                />
              ))}
          </svg>
        </div>
      ) : (
        <p class="placeholder">
          {deleted
            ? 'Photo deleted by tenant. Original bytes are no longer available.'
            : item.mime === 'image/heic'
              ? 'HEIC original. A browser preview is not available.'
              : 'Photo preview unavailable.'}
        </p>
      )}
      <figcaption id={`caption-${item.id}`}>
        <span class="eyebrow">{item.session.replaceAll('_', ' ')}</span>
        <h3>{title}</h3>
        <p class={`badge ${deleted ? '' : item.sealedManifestId ? 'sealed' : 'ask'}`}>
          {deleted ? 'ⓘ Deleted' : item.sealedManifestId ? '✓ Sealed record' : '◷ Waiting to seal'}
        </p>
        {item.source === 'imported' && <p class="warning">Imported photo: capture time unverified.</p>}
        {gap !== null && gap > 24 && (
          <p class="warning">
            Offline gap over 24h: {Math.floor(gap)} hours between the device capture and server receipt. Device clock
            accuracy is unverified.
          </p>
        )}
        {gap !== null && gap < 0 && (
          <p class="warning">Device capture time is after server receipt. Device clock accuracy is unverified.</p>
        )}
        <dl>
          <dt>Capture time (device, reported)</dt>
          <dd>
            <Time at={item.capturedAtDevice} />
          </dd>
          <dt>Received (server)</dt>
          <dd>
            <Time at={item.receivedAtServer?.toISOString() ?? null} />
          </dd>
          <dt>Sealed (server)</dt>
          <dd>
            <Time at={manifest?.sealedAt.toISOString() ?? null} />
          </dd>
          {deleted && (
            <>
              <dt>Deleted (server)</dt>
              <dd>
                <Time at={item.deletedAt!.toISOString()} />
              </dd>
            </>
          )}
          <dt>SHA-256 of original</dt>
          <dd>
            <Hash value={item.sha256} />
          </dd>
          <dt>Record ID</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
        </dl>
        {annotations.length > 0 && (
          <>
            <p>
              <strong>Tenant annotations</strong> (overlay only)
            </p>
            <ul class="annotations">
              {annotations.map((a, i) => (
                <li key={i}>
                  <strong>{a.label}</strong>: {a.description} ({a.decision})
                </li>
              ))}
            </ul>
          </>
        )}
        <div data-verify-exhibit={item.id} />
      </figcaption>
    </figure>
  );
}
export function ReportPage({ report, variant = 'demo' }: { report: EvidenceReport; variant?: string }) {
  const exhibits = [...report.exhibits].sort(
    (a, b) => Date.parse(a.capturedAtDevice) - Date.parse(b.capturedAtDevice) || a.id.localeCompare(b.id),
  );
  const timeline = [...report.timeline].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <Layout fixture={report.fixture}>
      <main id="report" tabIndex={-1}>
        <div class="intro">
          <p class="eyebrow">{report.fixture ? 'Synthetic fixture • ' : ''}Prepared for review</p>
          <h1>A record of your tenancy.</h1>
          <div class="meta">
            <dl>
              <dt>Location</dt>
              <dd>
                {report.city ?? 'City not recorded'}, {report.jurisdiction}
              </dd>
              <dt>Prepared by</dt>
              <dd>Tenant</dd>
            </dl>
            <dl>
              <dt>Occupancy date</dt>
              <dd>
                <Time at={report.occupancyDate} />
              </dd>
              <dt>Tenancy end</dt>
              <dd>
                <Time at={report.tenancyEndDate} />
              </dd>
            </dl>
            <dl>
              <dt>Generated</dt>
              <dd>
                <Time at={report.generatedAt} />
              </dd>
              <dt>Report contents</dt>
              <dd>
                {report.findings.length.toLocaleString('en-US')} {report.findings.length === 1 ? 'finding' : 'findings'}{' '}
                • {exhibits.length.toLocaleString('en-US')} {exhibits.length === 1 ? 'exhibit' : 'exhibits'}
              </dd>
            </dl>
          </div>
          <p class="notice">Prepared by the tenant using FinePrint. Not legal advice.</p>
          <p class="muted">To save a PDF, use your browser’s Print menu and choose Save as PDF.</p>
          <nav aria-label="Report sections">
            <a href="#timeline">Timeline</a>
            <a href="#findings">Lease findings</a>
            <a href="#exhibits">Exhibits</a>
            <a href="#ledger">Ledger</a>
            <a href="#integrity">Integrity and limits</a>
          </nav>
        </div>
        <section id="timeline" aria-labelledby="timeline-heading">
          <h2 id="timeline-heading">01 / Timeline</h2>
          {timeline.length ? (
            <ol class="timeline">
              {timeline.map((event, i) => (
                <li key={i}>
                  <Time at={event.at} />
                  <div>
                    <strong>{event.label}</strong>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>No timeline events recorded.</p>
          )}
        </section>
        <section id="findings" aria-labelledby="findings-heading">
          <h2 id="findings-heading">02 / Lease findings</h2>
          {report.findings.length ? (
            report.findings.map((f) => <FindingCard key={f.id} finding={f} leaseLocale={report.leaseLocale} />)
          ) : (
            <p>No lease findings are included. This does not establish that a lease complies with the law.</p>
          )}
        </section>
        <section id="exhibits" aria-labelledby="exhibits-heading">
          <h2 id="exhibits-heading">03 / Exhibits</h2>
          <p class="muted">
            In device capture order. Annotations are separate from the original photo. Deleted records keep their place.
          </p>
          {exhibits.length ? (
            <div class="exhibits">
              {exhibits.map((item, i) => (
                <Exhibit key={item.id} item={item} number={i + 1} report={report} />
              ))}
            </div>
          ) : (
            <p>No exhibits are included.</p>
          )}
        </section>
        <section id="ledger" aria-labelledby="ledger-heading">
          <h2 id="ledger-heading">04 / Ledger</h2>
          {report.ledger.length ? (
            <>
              <table>
                <caption>Signed events in ledger sequence, including deletions</caption>
                <thead>
                  <tr>
                    <th scope="col">No.</th>
                    <th scope="col">Server time</th>
                    <th scope="col">Event</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ledger.map((entry) => {
                    const exhibitNumber = exhibits.findIndex((item) => item.id === entry.payload.itemId) + 1;
                    return (
                      <tr key={entry.seq}>
                        <th scope="row">{entry.seq}</th>
                        <td>
                          <Time at={entry.at} />
                        </td>
                        <td>
                          {entry.type === 'evidence_deleted'
                            ? exhibitNumber
                              ? `Photo ${exhibitNumber} deleted by tenant`
                              : 'Photo deleted by tenant (not included in this report)'
                            : entry.type === 'share_created' ? 'Share link created' : entry.type === 'share_revoked' ? 'Share link revoked' : 'Manifest sealed'}
                          <br />
                          <code>
                            {entry.type === 'evidence_deleted' ? entry.payload.itemId : entry.payload.manifestId ?? entry.payload.shareId}
                          </code>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <details class="ledger-detail" open>
                <summary>Ledger hashes and signatures</summary>
                {report.ledger.map((entry) => (
                  <div key={entry.seq} data-ledger-entry={entry.seq}>
                    <h3>Entry {entry.seq}</h3>
                    <pre>{JSON.stringify(entry, null, 2)}</pre>
                  </div>
                ))}
              </details>
            </>
          ) : (
            <p>No signed ledger events recorded.</p>
          )}
        </section>
        <section id="integrity" aria-labelledby="integrity-heading">
          <h2 id="integrity-heading">05 / Integrity and limits</h2>
          <p>
            A seal signs a capture record and its photo hash. It does not prove when a photo was taken, what caused
            damage, or whether a legal claim will succeed. Device times are reported by the device. Server times record
            receipt and sealing.
          </p>
          <p>
            Signatures have not been verified in this browser. Deleted photos cannot be checked against their original
            bytes.
          </p>
          <div id="verify-report" data-verify-report="" />
          <p>
            <a href="/.well-known/fineprint-keys.json">Public signing keys (JWK)</a>
          </p>
          {report.manifests.length ? (
            report.manifests.map((m) => (
              <details key={m.id} open data-manifest={m.id}>
                <summary>Signed manifest {m.id}</summary>
                <dl>
                  <dt>SHA-256</dt>
                  <dd>
                    <Hash value={m.sha256} />
                  </dd>
                  <dt>Key ID</dt>
                  <dd>
                    <code>{m.keyId}</code>
                  </dd>
                  <dt>Signature (Base64)</dt>
                  <dd>
                    <code>{m.signatureB64}</code>
                  </dd>
                </dl>
                <p>Canonical JSON (signed bytes)</p>
                <pre>{m.canonicalJson}</pre>
              </details>
            ))
          ) : (
            <p>No signed manifests included.</p>
          )}
        </section>
      </main>
      {report.fixture && (
        <nav class="fixture-controls" aria-label="Fixture data">
          {[
            ['demo', 'Demo data'],
            ['worst', 'Worst case'],
            ['empty', 'Empty'],
            ['one', 'One'],
          ].map(([key, label]) => (
            <a key={key} href={`?data=${key}`} aria-current={variant === key ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </Layout>
  );
}
