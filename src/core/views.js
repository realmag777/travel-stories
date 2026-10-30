// Nunjucks environment, filters and the hashed asset manifest produced by tools/build-assets.js.
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'public', 'build', 'manifest.json');
let manifest = {};
let manifestAt = 0;

function asset(name) {
  // Re-read the manifest in development so rebuilt bundles are picked up without a restart.
  if (!manifestAt || (process.env.NODE_ENV !== 'production' && Date.now() - manifestAt > 2000)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { manifest = {}; }
    manifestAt = Date.now();
  }
  return '/build/' + (manifest[name] || name);
}

function setup(app) {
  const env = nunjucks.configure(path.join(ROOT, 'views'), {
    autoescape: true,
    express: app,
    noCache: process.env.NODE_ENV !== 'production',
    throwOnUndefined: false,
  });
  env.addGlobal('asset', asset);
  env.addGlobal('currentYear', new Date().getFullYear());
  // JSON-LD: escape '<' so no string can close the script tag.
  env.addFilter('jsonld', (v) => new nunjucks.runtime.SafeString(JSON.stringify(v).replace(/</g, '\\u003c')));
  env.addFilter('dump', (v) => JSON.stringify(v).replace(/</g, '\\u003c'));
  env.addFilter('urlencode', (v) => encodeURIComponent(String(v)));
  env.addFilter('number', (v, locale = 'uk') => Number(v || 0).toLocaleString(locale === 'uk' ? 'uk-UA' : locale));
  env.addFilter('shortDay', (v) => { const [, m, d] = String(v).split('-'); return `${d}.${m}`; });
  // Booking times are shown in the guide's time zone.
  env.addFilter('kyiv', (v) => (v ? new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : ''));
  // Nearest slot label in the visitor's language, Kyiv time: "пн, 3 лист., 10:00".
  env.addFilter('slotLabel', (iso, locale = 'uk') => (iso ? new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : locale, { timeZone: 'Europe/Kyiv', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''));
  env.addFilter('ymd', (v) => (v ? new Date(v).toISOString().slice(0, 10) : ''));
  app.set('view engine', 'njk');
  return env;
}

module.exports = { setup, asset };
