// Self-hosted vanilla JS. Kept as source text so tsc deployments need no
// bundler or copied public directory. No report data is interpolated here.
export const verifyScript = `
(() => {
  'use strict';
  const exhibits = [...document.querySelectorAll('[data-verify-exhibit]')];
  const report = document.querySelector('[data-verify-report]');
  if (!report) return;
  const encoder = new TextEncoder();
  const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  };
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const request = async url => {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Download unavailable. The link may have expired. Reload the report and retry.');
    return response;
  };
  const loadKeys = async () => {
    const { keys } = await (await request('/.well-known/fineprint-keys.json')).json();
    if (!Array.isArray(keys)) throw new Error('Public signing keys unavailable. Retry later.');
    return keys;
  };
  const checkManifest = async (block, keys) => {
    const text = block.querySelector('pre').textContent;
    const body = JSON.parse(text);
    if (canonical(body) !== text || body.version !== 1 || body.manifestId !== block.dataset.manifest || !Array.isArray(body.items)) {
      throw new Error('Manifest content does not match its signed record.');
    }
    const bytes = encoder.encode(text);
    if (await digest(bytes) !== block.dataset.sha256) throw new Error('Manifest SHA-256 mismatch.');
    const jwk = keys.find(key => key.kid === block.dataset.keyId);
    if (!jwk) throw new Error('Signing key not found in the published key set.');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.alg !== 'ES256' || jwk.use !== 'sig') {
      throw new Error('Unsupported signing key.');
    }
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(block.dataset.signature), char => char.charCodeAt(0));
    if (signature.length !== 64 || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, bytes)) {
      throw new Error('Manifest signature mismatch.');
    }
    return body;
  };
  const checkExhibit = async (element, manifest) => {
    const records = manifest.items.filter(item => item.itemId === element.dataset.verifyExhibit);
    if (records.length !== 1 || records[0].sha256 !== element.dataset.sha256) {
      throw new Error('Exhibit ID or SHA-256 does not match the signed manifest.');
    }
    if (element.dataset.deleted === 'true') return 'Original deleted; signed record verified, original bytes not checked.';
    if (!element.dataset.original) return 'Original unavailable; signed record verified, original bytes not checked.';
    const url = new URL(element.dataset.original, location.href);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Original URL unavailable.');
    const bytes = await (await request(url)).arrayBuffer();
    if (await digest(bytes) !== records[0].sha256 || bytes.byteLength !== records[0].bytes) {
      throw new Error('Original SHA-256 or byte length does not match the signed manifest.');
    }
    return null;
  };
  const setResult = (element, text) => { element.querySelector('[role="status"]').textContent = text; };
  const run = async (target, whole) => {
    const blocks = [...document.querySelectorAll('[data-manifest]')];
    const button = target.querySelector('button');
    if (button.getAttribute('aria-disabled') === 'true') return;
    const buttons = [report, ...exhibits].map(element => element.querySelector('button'));
    buttons.forEach(control => control.setAttribute('aria-disabled', 'true'));
    if (whole) exhibits.forEach(element => setResult(element, 'Not checked in this run.'));
    else setResult(report, 'Report not checked in this run. Choose Verify report to check all included originals and manifests.');
    setResult(target, 'Verifying: downloading originals and checking signatures...');
    try {
      if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is unavailable. Open this report in a browser over HTTPS.');
      if (whole && !blocks.length && !exhibits.length) {
        setResult(target, 'Nothing to verify: no signed manifests or exhibits included.');
        return;
      }
      // Each click fetches keys and originals again. Cache only within this
      // action, including failures; retries never reuse a previous verdict.
      const keys = await loadKeys();
      const checked = new Map();
      const manifestFor = id => {
        if (!checked.has(id)) {
          const matches = blocks.filter(block => block.dataset.manifest === id);
          checked.set(id, matches.length === 1 ? checkManifest(matches[0], keys) : Promise.reject(new Error('Signed manifest unavailable or ambiguous.')));
        }
        return checked.get(id);
      };
      if (whole) {
        let failed = 0, incomplete = 0, verified = 0;
        for (const block of blocks) {
          try { await manifestFor(block.dataset.manifest); } catch { failed++; }
        }
        for (const exhibit of exhibits) {
          try {
            const warning = await checkExhibit(exhibit, await manifestFor(exhibit.dataset.manifestId));
            setResult(exhibit, warning || 'Verified: original SHA-256 and manifest signature match.');
            if (warning) incomplete++; else verified++;
          } catch (error) {
            failed++;
            setResult(exhibit, 'Could not verify: ' + error.message);
          }
        }
        setResult(target, (failed ? 'Verification failed. ' : incomplete ? 'Verification incomplete. ' : 'Verified. ') +
          'Originals verified: ' + verified + '; originals not checked: ' + incomplete + '; checks failed: ' + failed + '. ' +
          'Checked included originals and ' + blocks.length + ' manifest signature' + (blocks.length === 1 ? '' : 's') + ' only.');
      } else {
        const warning = await checkExhibit(target, await manifestFor(target.dataset.manifestId));
        setResult(target, warning || 'Verified: original SHA-256 and manifest signature match.');
      }
    } catch (error) {
      setResult(target, 'Could not verify: ' + (error instanceof TypeError || error.name === 'TimeoutError' || error.name === 'AbortError'
        ? 'Download or browser check unavailable. Check your connection, reload the report and retry.' : error.message));
    } finally {
      buttons.forEach(control => control.removeAttribute('aria-disabled'));
    }
  };
  for (const element of [report, ...exhibits]) {
    const button = element.querySelector('button');
    button.hidden = false;
    button.addEventListener('click', () => run(element, element === report));
  }
})();
`;
