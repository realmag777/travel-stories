// Interface translations from languages/<locale>.json, locale detection from the URL prefix
// and helpers for localized links. Ukrainian is the default locale and has no prefix.
const fs = require('fs');
const path = require('path');

const LOCALES = ['uk', 'en', 'es'];
const DEFAULT_LOCALE = 'uk';
const HTML_LANG = { uk: 'uk', en: 'en', es: 'es' };
const OG_LOCALE = { uk: 'uk_UA', en: 'en_US', es: 'es_ES' };

const dicts = {};
function load() {
  for (const l of LOCALES) {
    const file = path.join(__dirname, '..', '..', 'languages', `${l}.json`);
    dicts[l] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }
}
load();

function lookup(dict, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
}

/** Translate a dotted key; falls back to Ukrainian, then to the key itself. {name} placeholders are replaced. */
function t(key, locale = DEFAULT_LOCALE, vars) {
  let s = lookup(dicts[locale] || {}, key);
  if (s === undefined) s = lookup(dicts[DEFAULT_LOCALE], key);
  if (s === undefined) return key;
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

/** Plural form for Ukrainian/Spanish/English counters: forms = [one, few, many]. */
function plural(n, forms, locale = DEFAULT_LOCALE) {
  if (locale !== 'uk') return n === 1 ? forms[0] : forms[forms.length > 2 ? 2 : 1];
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** Split '/en/stories' into { locale: 'en', rest: '/stories' }. */
function splitLocale(urlPath) {
  const m = urlPath.match(/^\/(en|es)(?=\/|$)/);
  if (!m) return { locale: DEFAULT_LOCALE, rest: urlPath || '/' };
  return { locale: m[1], rest: urlPath.slice(m[0].length) || '/' };
}

const prefix = (locale) => (locale === DEFAULT_LOCALE ? '' : '/' + locale);

/** Localized path: lurl('/stories', 'en') -> '/en/stories'. */
function lurl(p, locale) {
  const pre = prefix(locale);
  if (!p || p === '/') return pre ? pre + '/' : '/';
  return pre + p;
}

module.exports = { LOCALES, DEFAULT_LOCALE, HTML_LANG, OG_LOCALE, t, plural, splitLocale, prefix, lurl, reload: load, dicts };
