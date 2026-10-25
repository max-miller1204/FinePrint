export const reportStyles = `
:root {
  color-scheme:light dark;
  --paper:#fff;
  --ink:#202723;
  --muted:#56635c;
  --line:#cbd3ce;
  --wash:#f4f6f4;
  --accent:#245c43;
  --red:#9f2525;
  --orange:#805000;
  --blue:#205a99;
}
* {
  box-sizing:border-box;
}
html {
  -webkit-text-size-adjust:100%;
  scroll-padding-top:1rem;
}
body {
  margin:0;
  background:var(--wash);
  color:var(--ink);
  font:1rem/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  overflow-wrap:anywhere;
}
a {
  color:var(--accent);
  text-underline-offset:.2em;
}
a,summary {
  touch-action:manipulation;
}
a:active,summary:active {
  background:var(--line);
}
:focus-visible {
  outline:3px solid var(--accent);
  outline-offset:4px;
}
.skip {
  position:absolute;
  top:-10rem;
  left:1rem;
  background:var(--paper);
  padding:1rem;
  z-index:2;
}
.skip:focus {
  top:1rem;
}
.shell {
  max-width:70rem;
  margin:auto;
  padding:calc(2rem + env(safe-area-inset-top)) max(1rem,env(safe-area-inset-left)) calc(3rem + env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-right));
}
.masthead {
  display:flex;
  flex-wrap:wrap;
  justify-content:space-between;
  gap:1rem;
  border-bottom:2px solid var(--ink);
  padding:1rem 0;
}
.brand {
  font-weight:750;
  letter-spacing:-.035em;
  font-size:1.5rem;
}
.eyebrow {
  text-transform:uppercase;
  letter-spacing:.12em;
  font-size:.75rem;
  font-weight:700;
  color:var(--muted);
}
h1 {
  font-size:clamp(2rem,6vw,3.6rem);
  line-height:1.1;
  letter-spacing:-.04em;
  margin:.7rem 0 1.5rem;
}
h2 {
  font-size:1.5rem;
  line-height:1.25;
  letter-spacing:-.025em;
  margin:0 0 1.5rem;
}
h3 {
  font-size:1.15rem;
  line-height:1.4;
  margin:.6rem 0;
}
p {
  margin:.6rem 0 1rem;
}
.intro {
  padding:2.5rem 0 1.5rem;
}
.meta {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:1rem;
}
dl {
  margin:0;
}
dt,.muted {
  color:var(--muted);
}
dd {
  margin:0 0 .8rem;
}
nav {
  display:flex;
  flex-wrap:wrap;
  gap:.5rem 1rem;
  padding:1rem 0;
}
nav a {
  display:inline-flex;
  align-items:center;
  min-height:44px;
  padding:.25rem .5rem;
}
section {
  border-top:1px solid var(--line);
  padding:2rem 0;
  scroll-margin-top:1rem;
}
.notice {
  border-left:3px solid var(--accent);
  padding:.75rem 1rem;
  background:var(--paper);
}
.timeline {
  list-style:none;
  padding:0;
  margin:0;
}
.timeline li {
  display:grid;
  grid-template-columns:minmax(9rem,1fr) minmax(0,3fr);
  gap:1rem;
  border-left:2px solid var(--line);
  padding:0 0 1.5rem 1.25rem;
}
.timeline p {
  margin:0;
}
.card {
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:12px;
  padding:1.5rem;
  margin:0 0 1.25rem;
  min-width:0;
}
.badge {
  display:inline-block;
  font-size:.875rem;
  font-weight:650;
  color:var(--blue);
}
.unenforceable {
  color:var(--red);
}
.ask,.warning {
  color:var(--orange);
}
.sealed {
  color:var(--accent);
}
blockquote,code,pre {
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:.875rem;
}
blockquote {
  border-left:2px solid var(--line);
  padding-left:1rem;
  margin:1rem 0;
  white-space:pre-wrap;
}
pre {
  white-space:pre-wrap;
  overflow-wrap:anywhere;
}
code {
  overflow-wrap:anywhere;
}
summary {
  cursor:pointer;
  min-height:44px;
  padding:.5rem 0;
  font-weight:600;
}
details {
  margin-top:1rem;
}
.exhibits {
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:1.5rem;
}
.exhibit {
  margin:0;
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:12px;
  overflow:hidden;
  min-width:0;
}
.photo {
  position:relative;
  background:var(--wash);
}
.photo img {
  display:block;
  width:100%;
  height:auto;
}
.overlay {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  pointer-events:none;
}
.overlay rect {
  fill:none;
  stroke:#ffb900;
  stroke-width:3;
  vector-effect:non-scaling-stroke;
}
.exhibit figcaption {
  padding:1.25rem;
}
.exhibit .placeholder {
  padding:2rem 1.25rem;
  border-bottom:1px solid var(--line);
}
.exhibit dl {
  font-size:.875rem;
}
.exhibit dd {
  font-variant-numeric:tabular-nums;
}
.annotations {
  padding-left:1.25rem;
}
table {
  border-collapse:collapse;
  width:100%;
  table-layout:fixed;
  font-size:.875rem;
}
caption {
  text-align:left;
  color:var(--muted);
  padding-bottom:1rem;
}
th,td {
  text-align:left;
  vertical-align:top;
  border-bottom:1px solid var(--line);
  padding:.75rem .5rem;
}
th:first-child {
  width:4rem;
}
th:nth-child(2) {
  width:28%;
}
.ledger-detail {
  margin-top:1rem;
}
footer {
  border-top:2px solid var(--ink);
  padding-top:1.5rem;
  color:var(--muted);
}
.fixture-controls {
  position:fixed;
  bottom:.5rem;
  left:50%;
  transform:translateX(-50%);
  display:flex;
  flex-wrap:wrap;
  justify-content:center;
  gap:.25rem;
  max-width:calc(100% - 1rem);
  width:max-content;
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:12px;
  padding:.25rem;
  box-shadow:0 2px 10px #0002;
}
.fixture-controls a {
  font-size:.75rem;
  min-height:44px;
  display:flex;
  align-items:center;
  padding:.4rem;
}
.fixture-controls [aria-current] {
  font-weight:800;
  text-decoration-thickness:3px;
}
.fixture-page {
  padding-bottom:8rem;
}
@media(hover:hover) and (pointer:fine) {
  a:hover {
    color:var(--ink);
  }
  summary:hover {
    text-decoration:underline;
  }
}
@media(max-width:42rem) {
  .meta,.exhibits {
    grid-template-columns:minmax(0,1fr);
  }
  .timeline li {
    grid-template-columns:minmax(0,1fr);
    gap:.25rem;
  }
  .shell {
    padding-top:calc(.5rem + env(safe-area-inset-top));
  }
  .intro {
    padding-top:1.75rem;
  }
  .card {
    padding:1rem;
  }
  th:nth-child(2) {
    width:33%;
  }
}
@media(prefers-color-scheme:dark) {
  :root {
    --paper:#19211d;
    --ink:#eef3ef;
    --muted:#b2c2b8;
    --line:#4d6054;
    --wash:#111813;
    --accent:#92d9b1;
    --red:#ffaaaa;
    --orange:#ffd18a;
    --blue:#a2ccff;
  }
}
@media print {
  @page {
    size:auto;
    margin:16mm;
  }
  html {
    color-scheme:light;
  }
  :root {
    --paper:#fff;
    --ink:#000;
    --muted:#333;
    --line:#888;
    --wash:#fff;
    --accent:#000;
    --red:#000;
    --orange:#000;
    --blue:#000;
  }
  body {
    font-size:10pt;
    background:#fff;
  }
  .shell {
    padding:0;
    max-width:none;
  }
  .masthead {
    padding-top:0;
  }
  .intro {
    padding:1rem 0;
  }
  h1 {
    font-size:26pt;
  }
  h2 {
    font-size:16pt;
  }
  nav,.skip,.fixture-controls {
    display:none!important;
  }
  section {
    padding:1rem 0;
  }
  .card,.exhibit {
    border-radius:0;
    box-shadow:none;
  }
  .exhibits {
    display:block;
  }
  .exhibit {
    break-before:page;
    break-inside:avoid;
    margin-bottom:1rem;
  }
  .photo {
    max-width:150mm;
    margin:auto;
  }
  .photo img {
    width:auto;
    max-width:100%;
    max-height:95mm;
    height:auto;
  }
  .exhibit figcaption {
    padding: .75rem;
  }
  .exhibit dl {
    display: grid;
    grid-template-columns: minmax(0,1fr) minmax(0,2fr);
    column-gap: .75rem;
  }
  .exhibit dd {
    margin-bottom: .35rem;
  }
  .photo:has(img) {
    width:fit-content;
  }
  .overlay {
    stroke:#000;
  }
  .overlay rect {
    stroke:#000;
    stroke-dasharray:6 3;
  }
  h2,h3,dt,summary {
    break-after:avoid;
  }
  blockquote,pre {
    white-space:pre-wrap;
  }
  tr {
    break-inside:avoid;
  }
  thead {
    display:table-header-group;
  }
  a {
    color:#000;
    text-decoration:none;
  }
  .notice {
    border:1px solid #888;
  }
  footer {
    margin-top:1rem;
  }
  summary {
    list-style:none;
  }
  details {
    display:block;
  }
  details::details-content {
    content-visibility:visible;
    display:block;
  }
  details>* {
    display:block!important;
  }
}
`;
