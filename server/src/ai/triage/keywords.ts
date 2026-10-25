// The keyword backstop (spec §7.9): EN and ES term lists matched in code, so
// a high-stakes input escalates even when Gemma misses it or is down.
//
// Patterns run on normalized text: lowercase, accents removed, curly quotes
// straightened, whitespace collapsed. Write them without accents (`citacion`,
// not `citación`).
//
// Scope keeps the backstop from firing on every lease. `any` terms only appear
// in a court paper or a crisis, wherever the text came from. `message` terms
// are the tenant describing their own situation, and only run on Ask messages
// and repair descriptions: a lease says "Landlord may file an unlawful
// detainer" and "Tenant shall not change the locks" without anything being
// wrong.

import type { KeywordProvider, TriageCategory, TriageSource } from './index.js';

type Scope = 'any' | 'message';

interface Term {
  // `<lang>.<category>.<slug>`, returned in `matches` and the eval report.
  id: string;
  category: Exclude<TriageCategory, 'none'>;
  scope: Scope;
  pattern: RegExp;
}

const MESSAGE_SOURCES: ReadonlySet<TriageSource> = new Set(['ask', 'repair']);

function terms(lang: 'en' | 'es', category: Term['category'], scope: Scope, list: Record<string, RegExp>): Term[] {
  return Object.entries(list).map(([slug, pattern]) => ({ id: `${lang}.${category}.${slug}`, category, scope, pattern }));
}

// Ordered by severity, then specificity: the first category with a match
// names the result, so a message about self-harm and eviction reports
// self-harm, and a threat to evict after a complaint reports retaliation.
export const TERMS: readonly Term[] = [
  ...terms('en', 'self_harm', 'any', {
    'kill-myself': /\b(kill|hang|shoot) myself\b/,
    suicide: /\bsuicid/,
    'end-my-life': /\bend(ing)? (my life|it all)\b/,
    'not-want-to-live': /\b(don'?t|do not) want to (be alive|live|exist)\b/,
    'hurt-myself': /\b(hurt|harm|cut)(ing)? myself\b/,
  }),
  ...terms('es', 'self_harm', 'any', {
    suicidio: /\bsuicid/,
    matarme: /\b(matarme|quitarme la vida|acabar con mi vida)\b/,
    'no-quiero-vivir': /\bno quiero (vivir|seguir viviendo|estar vivo|estar viva)\b/,
    'hacerme-dano': /\bhacerme dano\b/,
  }),
  ...terms('en', 'immediate_danger', 'message', {
    gas: /\b(smell(s|ing)? (of |like )?gas|gas leak|leaking gas)\b/,
    sparks: /\b(sparks?|sparking)\b/,
    fire: /\b(on fire|fire in|smoke (is )?coming)\b/,
    'carbon-monoxide': /\bcarbon monoxide\b/,
    weapon: /\b(with|had|has|pulled) a (gun|knife|weapon)\b/,
    'threat-to-kill': /\bthreaten\w* to (kill|hurt|shoot|beat)\b/,
    collapse: /\b(ceiling|roof|floor|stairs?) (is |are )?(collaps|caving|falling)/,
    '911': /\b(call(ed)?|calling) 911\b/,
  }),
  ...terms('es', 'immediate_danger', 'message', {
    gas: /\b(olor a gas|huele a gas|fuga de gas)\b/,
    chispas: /\b(chispas|chispea)/,
    fuego: /\b(incendio|se esta quemando|hay fuego)\b/,
    monoxido: /\bmonoxido\b/,
    arma: /\b(pistola|arma|cuchillo|navaja)\b/,
    amenaza: /\bamenaz\w* (de muerte|con matar|con pegar)/,
    techo: /\bse (esta )?(cayendo|cayo|derrumba\w*) (el|la) (techo|piso|escalera)/,
    '911': /\b(llam\w*|marcar) al 911\b/,
  }),
  ...terms('en', 'domestic_violence', 'message', {
    'hits-me': /\b(he|she|they|partner|husband|wife|boyfriend|girlfriend|ex) (hits|beats|chokes|hurts|hit|beat|choked|hurt) me\b/,
    abuse: /\babus(e|ed|er|ive)\b/,
    'domestic-violence': /\bdomestic (violence|abuse)\b/,
    'protective-order': /\b(protective|protection|restraining) order\b/,
    stalking: /\bstalk(s|ing|er)?\b/,
  }),
  ...terms('es', 'domestic_violence', 'message', {
    golpea: /\b(me|la|lo|nos) (golpea|golpeo|pega|pego|maltrata|maltrato)\b/,
    violencia: /\bviolencia (domestica|familiar|de genero)\b/,
    maltrato: /\bmaltrat/,
    'orden-de-proteccion': /\borden (de proteccion|de alejamiento|de restriccion)\b/,
    acoso: /\b(me acosa|acoso)\b/,
  }),
  ...terms('en', 'eviction_or_court', 'any', {
    summons: /\bsummon(s|ed)\b/,
    'commanded-to-appear': /\b(commanded|required) to appear\b/,
    'writ-of-possession': /\bwrit of (possession|eviction)\b/,
    'notice-to-vacate': /\bnotice to (vacate|quit)\b/,
    'eviction-notice': /\b(eviction notice|notice of eviction)\b/,
  }),
  ...terms('es', 'eviction_or_court', 'any', {
    citacion: /\bcitacion\b/,
    'se-le-cita': /\bse le (cita|emplaza|ordena comparecer)\b/,
    'orden-de-desalojo': /\b(orden|aviso|demanda|notificacion) de (desalojo|desahucio|lanzamiento)\b/,
  }),
  ...terms('en', 'retaliation', 'message', {
    retaliation: /\bretaliat/,
    'because-i-complained': /\b(because|after|since|ever since) i (complained|reported|called|asked|filed|requested)\b/,
    'tenant-union': /\btenants?'? (union|association)\b/,
    'threaten-eviction': /\bthreaten\w* (to )?(evict|kick|throw)/,
  }),
  ...terms('es', 'retaliation', 'message', {
    represalia: /\brepresalia/,
    queja: /\b(desde que|porque|despues de que) (me queje|reporte|denuncie|llame|pedi)\b/,
    amenaza: /\bamenaz\w* con (echar|desalojar|sacar)/,
    sindicato: /\b(sindicato|asociacion) de inquilinos\b/,
  }),
  ...terms('en', 'eviction_or_court', 'message', {
    'evict-me': /\bevict(ed|ing)? (me|us|my)\b/,
    'being-evicted': /\b(get|getting|be|being|been) evicted\b/,
    'unlawful-detainer': /\bunlawful detainer\b/,
    'court-date': /\b(court date|court hearing|(go|going|appear) to court|taking me to court|sued me|suing me)\b/,
    'pay-or-quit': /\bpay (or|and) (quit|get out|leave|move)\b/,
    'days-to-leave': /\bdays to (get out|leave|vacate|move out)\b/,
  }),
  ...terms('es', 'eviction_or_court', 'message', {
    desalojar: /\b(desalojar(me|nos|te)|(me|nos|te) (van a |quieren )?desaloj\w*)/,
    desalojo: /\b(desalojo|desahucio)\b/,
    corte: /\b(fecha (de|en la) corte|ir a (la )?corte|tribunal|juicio|me demand\w*)\b/,
    echar: /\b(echar|sacar)(me|nos)\b/,
  }),
  ...terms('en', 'lockout', 'message', {
    'changed-locks': /\b(changed|changing|switched) (the |my |our )?locks?\b/,
    'locked-out': /\block(ed|ing)? (me|us) out\b/,
    'key-not-working': /\b(my|our) keys? (doesn'?t|does not|don'?t|won'?t|no longer) work/,
    'cannot-get-in': /\bcan'?t (get|come|go) (back )?in(to)?\b/,
    belongings: /\b(put|threw|thrown|removed|took) (all )?(my|our) (stuff|things|belongings|furniture)\b/,
    'removed-door': /\b(removed|took off|took) (my |our |the )?(front )?doors?\b/,
  }),
  ...terms('es', 'lockout', 'message', {
    cerradura: /\b(cambio|cambiaron) (la |las )?(cerradura|chapa|llave)/,
    afuera: /\b(me|nos) (dejo|dejaron|echo|echaron) (afuera|fuera)\b/,
    cosas: /\b(sacaron|saco|tiraron|tiro) (mis|nuestras|todas mis) cosas\b/,
    'no-puedo-entrar': /\bno (puedo|podemos) (entrar|volver a entrar)\b/,
  }),
  ...terms('en', 'utility_shutoff', 'message', {
    'shut-off': /\b(shut|cut|turned|switched) off (my |our |the )?(water|power|electricity|electric|heat|heating|gas|utilities|ac|a\/c)\b/,
    'was-shut-off': /\b(water|power|electricity|heat|heating|gas|utilities) (has been |have been |was |is |got )?(shut|cut|turned|switched) off\b/,
    'no-utilities': /\b(no|without) (water|power|electricity|heat) (for|since)\b/,
  }),
  ...terms('es', 'utility_shutoff', 'message', {
    corto: /\b(corto|cortaron|quito|quitaron|apago|apagaron) (el |la )?(agua|luz|gas|electricidad|calefaccion)\b/,
    'sin-servicio': /\bsin (agua|luz|gas|electricidad|calefaccion) (desde|por)\b/,
  }),
  ...terms('en', 'discrimination', 'message', {
    discrimination: /\bdiscriminat/,
    voucher: /\b(section 8|voucher|housing choice)\b/,
    'protected-trait': /\bmy (race|religion|accent|disability|skin|color|national origin|sexual orientation|gender|pregnancy|nationality)\b/,
    'wont-rent': /\b(don'?t|do not|won'?t|will not|refuse\w* to) rent to\b/,
    'service-animal': /\b(service (dog|animal)|emotional support animal|reasonable accommodation)\b/,
    'no-kids': /\b(no (kids|children)|because (i have|of my) (kids|children))\b/,
  }),
  ...terms('es', 'discrimination', 'message', {
    discriminacion: /\bdiscrimin/,
    hijos: /\bporque tengo (hijos|ninos|una discapacidad)\b/,
    'no-aceptan': /\bno (aceptan|rentan|alquilan|quieren rentar\w*|quiere rentar\w*) a\b/,
    rasgo: /\bmi (pais|raza|religion|acento|discapacidad|color|nacionalidad|origen)\b/,
    seccion8: /\b(seccion 8|vale de vivienda|voucher)\b/,
  }),
];

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

export function keywordBackstop(list: readonly Term[] = TERMS): KeywordProvider {
  return {
    name: 'keywords',
    async classify({ source, text, imageCaptions = [] }) {
      const scopes: ReadonlySet<Scope> = new Set(MESSAGE_SOURCES.has(source) ? ['any', 'message'] : ['any']);
      const haystack = normalize([text, ...imageCaptions].join('\n'));
      const matched = list.filter((term) => scopes.has(term.scope) && term.pattern.test(haystack));
      const first = matched[0];
      return first
        ? { category: first.category, confidence: 1, matches: matched.map((term) => term.id) }
        : { category: 'none', confidence: 0, matches: [] };
    },
  };
}
