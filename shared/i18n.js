/**
 * Shared internationalization.
 *
 * - Initial language: ?lang= → browser language → English.
 * - setLang() updates the URL (history.replaceState), <html lang>, every
 *   [data-i18n] element and every [data-keep-lang] link.
 * - Simulations add their own dictionaries with registerStrings().
 *
 * DOM bindings:
 *   data-i18n="key"                      → textContent
 *   data-i18n-attr="aria-label:key,title:key2" → attributes
 *   data-keep-lang data-href="path/"     → href = path + ?lang=<current>
 */

export const SUPPORTED_LANGS = ['en', 'es', 'pt'];
export const DEFAULT_LANG = 'en';
const LOCALES = { en: 'en-US', es: 'es-AR', pt: 'pt-BR' };

const SHARED_STRINGS = {
  en: {
    'hub.title': 'Lean Six Sigma simulations',
    'hub.subtitle': 'Interactive simulations that make core Lean Six Sigma concepts visible.',
    'hub.pageTitle': 'Lean Six Sigma simulations',
    'nav.home': 'Home',
    'nav.homeAria': 'Back to the simulations home',
    'a11y.skip': 'Skip to content',
    'lang.label': 'Language',
    'lang.en': 'English',
    'lang.es': 'Español',
    'lang.pt': 'Português',
    'home.eyebrow': 'Available simulations',
    'home.open': 'Open simulation',
    'home.empty': 'No simulations are published yet.',
    'footer.credit': 'Amcor Digital Transformation Office · Lean Six Sigma training material',
    'tags.variation': 'Variation',
    'tags.normal-distribution': 'Normal distribution',
    'tags.central-limit-theorem': 'Central limit theorem',
  },
  es: {
    'hub.title': 'Simulaciones de Lean Six Sigma',
    'hub.subtitle': 'Simulaciones interactivas para ver en acción los conceptos clave de Lean Six Sigma.',
    'hub.pageTitle': 'Simulaciones de Lean Six Sigma',
    'nav.home': 'Inicio',
    'nav.homeAria': 'Volver al inicio de las simulaciones',
    'a11y.skip': 'Ir al contenido',
    'lang.label': 'Idioma',
    'lang.en': 'English',
    'lang.es': 'Español',
    'lang.pt': 'Português',
    'home.eyebrow': 'Simulaciones disponibles',
    'home.open': 'Abrir simulación',
    'home.empty': 'Todavía no hay simulaciones publicadas.',
    'footer.credit': 'Amcor Digital Transformation Office · Material de formación en Lean Six Sigma',
    'tags.variation': 'Variación',
    'tags.normal-distribution': 'Distribución normal',
    'tags.central-limit-theorem': 'Teorema del límite central',
  },
  pt: {
    'hub.title': 'Simulações de Lean Six Sigma',
    'hub.subtitle': 'Simulações interativas para ver na prática os principais conceitos de Lean Six Sigma.',
    'hub.pageTitle': 'Simulações de Lean Six Sigma',
    'nav.home': 'Início',
    'nav.homeAria': 'Voltar para o início das simulações',
    'a11y.skip': 'Pular para o conteúdo',
    'lang.label': 'Idioma',
    'lang.en': 'English',
    'lang.es': 'Español',
    'lang.pt': 'Português',
    'home.eyebrow': 'Simulações disponíveis',
    'home.open': 'Abrir simulação',
    'home.empty': 'Ainda não há simulações publicadas.',
    'footer.credit': 'Amcor Digital Transformation Office · Material de capacitação em Lean Six Sigma',
    'tags.variation': 'Variação',
    'tags.normal-distribution': 'Distribuição normal',
    'tags.central-limit-theorem': 'Teorema central do limite',
  },
};

const dict = { en: {}, es: {}, pt: {} };
const listeners = new Set();
const formatters = new Map();
let current = detectLang();

registerStrings(SHARED_STRINGS);

function normalize(code) {
  if (!code) return null;
  const base = String(code).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(base) ? base : null;
}

function detectLang() {
  const fromUrl = normalize(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) return fromUrl;
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const l = normalize(p);
    if (l) return l;
  }
  return DEFAULT_LANG;
}

/** Merge a { en: {...}, es: {...}, pt: {...} } dictionary. */
export function registerStrings(strings) {
  for (const l of SUPPORTED_LANGS) Object.assign(dict[l], strings[l] || {});
}

/** Translate a key, interpolating {placeholders}. Falls back to English, then the key. */
export function t(key, vars) {
  let s = dict[current][key] ?? dict[DEFAULT_LANG][key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/** Does a key exist in the dictionary? */
export function has(key) {
  return key in dict[current] || key in dict[DEFAULT_LANG];
}

/** Pick the current language from an { en, es, pt } object (used by the registry). */
export function localize(obj) {
  if (!obj || typeof obj !== 'object') return obj ?? '';
  return obj[current] ?? obj[DEFAULT_LANG] ?? '';
}

export function getLang() { return current; }
export function getLocale() { return LOCALES[current]; }

export function formatNumber(value, options = {}) {
  const k = current + JSON.stringify(options);
  let f = formatters.get(k);
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[current], options);
    formatters.set(k, f);
  }
  return f.format(value);
}

/** Add ?lang=<current> to a relative or absolute href, preserving other params and hash. */
export function withLang(href, lang = current) {
  const [beforeHash, hash = ''] = String(href).split('#');
  const [path, query = ''] = beforeHash.split('?');
  const params = new URLSearchParams(query);
  params.set('lang', lang);
  return `${path}?${params.toString()}${hash ? '#' + hash : ''}`;
}

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  updateLinks(root);
}

export function updateLinks(root = document) {
  root.querySelectorAll('a[data-keep-lang]').forEach((a) => {
    const base = a.dataset.href || a.getAttribute('href');
    a.dataset.href = base;
    a.setAttribute('href', withLang(base));
  });
}

export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setLang(lang) {
  const next = normalize(lang) || DEFAULT_LANG;
  current = next;
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  syncDocument();
  listeners.forEach((cb) => cb(next));
}

function syncDocument() {
  document.documentElement.lang = LOCALES[current];
  applyTranslations(document);
}

/** Call once per page, after registering page strings and rendering shared chrome. */
export function initI18n() {
  syncDocument();
  listeners.forEach((cb) => cb(current));
}
