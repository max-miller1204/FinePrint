import { html } from 'hono/html';
export function SharePage({ state, wrong = false }: { state: 'pin' | 'expired' | 'revoked' | 'limited'; wrong?: boolean }) {
  const title = { pin: 'Enter the PIN', expired: 'This link has expired', revoked: 'This link was revoked', limited: 'Too many PIN attempts' }[state];
  return html`<!doctype html>${<html lang="en"><head>
    <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" /><title>{title} | FinePrint</title>
    <style>{`*{box-sizing:border-box}html{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;background:light-dark(#f5f5ef,#111813);color:light-dark(#17231a,#eef3ed);line-height:1.6}main{max-width:32rem;margin:10svh auto;padding:calc(1.5rem + env(safe-area-inset-top)) max(1.5rem,env(safe-area-inset-right)) calc(1.5rem + env(safe-area-inset-bottom));overflow-wrap:anywhere}h1{font-size:clamp(1.5rem,5vw,2rem);line-height:1.2}label,input,button{display:block}input,button{font:inherit;min-height:44px;border-radius:8px;padding:.65rem .9rem;width:100%;margin:.5rem 0 1rem}input{border:1px solid currentColor;min-width:0}button{border:0;background:light-dark(#244a31,#b7d7bd);color:light-dark(white,#14281a);touch-action:manipulation;user-select:none;cursor:pointer}button:active{opacity:.75}:focus-visible{outline:3px solid light-dark(#225ca3,#90c5ff);outline-offset:4px}.brand{font-weight:650;letter-spacing:.03em}.error{color:light-dark(#a22323,#ffb4b4)}`}</style>
    </head><body><main><p class="brand">FinePrint</p><h1>{title}</h1>
    {state === 'pin' ? <><p>The tenant protected this report with a PIN. Ask them for it if you do not have it.</p>
      {wrong && <p role="alert" id="pin-error" class="error">That PIN did not match. Try again.</p>}
      <form method="post"><label for="pin">PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength={6} maxlength={12} required autocomplete="off" aria-invalid={wrong ? 'true' : undefined} aria-describedby={wrong ? 'pin-error' : undefined} /><button type="submit">Open report</button></form>
    </> : <p>{state === 'limited' ? 'Try again in 15 minutes, or ask the tenant for a new link.' : 'Ask the tenant for a new link to view this report.'}</p>}
    <p>No report details are shown here.</p></main></body></html>}`;
}
