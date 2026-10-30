// Key/value settings stored in Postgres and cached in memory; the admin edits them at runtime.
// Environment variables provide defaults for LLM and SMTP so the site works without the admin.
const db = require('./db');

const DEFAULTS = {
  affiliate: { bookingAid: '', skyscannerAssociateId: '', tripadvisorPartnerId: '' },
  llm: { provider: '', apiKey: '', model: '', baseUrl: '' },
  smtp: { host: '', port: 587, user: '', pass: '', from: '', notify: '' },
};

let cache = null;
let loadedAt = 0;
const TTL_MS = 30_000;

async function all() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  const rows = await db('settings').select('key', 'value');
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows) out[r.key] = { ...(out[r.key] || {}), ...(r.value || {}) };
  cache = out;
  loadedAt = Date.now();
  return out;
}

async function get(key) {
  return (await all())[key];
}

async function set(key, value) {
  await db('settings').insert({ key, value: JSON.stringify(value), updated_at: db.fn.now() })
    .onConflict('key').merge();
  cache = null;
}

/** Effective LLM config: admin settings win over env. */
async function llmConfig() {
  const s = (await get('llm')) || {};
  const e = process.env;
  return {
    provider: s.provider || e.LLM_PROVIDER || '',
    apiKey: s.apiKey || e.LLM_API_KEY || '',
    model: s.model || e.LLM_MODEL || '',
    baseUrl: s.baseUrl || e.LLM_BASE_URL || '',
  };
}

async function smtpConfig() {
  const s = (await get('smtp')) || {};
  const e = process.env;
  return {
    host: s.host || e.SMTP_HOST || '',
    port: Number(s.port || e.SMTP_PORT || 587),
    user: s.user || e.SMTP_USER || '',
    pass: s.pass || e.SMTP_PASS || '',
    from: s.from || e.SMTP_FROM || 'Подорожники+ <no-reply@localhost>',
    notify: s.notify || e.BOOKING_NOTIFY_EMAIL || '',
  };
}

module.exports = { all, get, set, llmConfig, smtpConfig, DEFAULTS, invalidate: () => { cache = null; } };
