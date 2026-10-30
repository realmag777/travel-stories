// Own page-view counter: no external analytics. Views are buffered in memory and flushed
// in batches; bots and static files are skipped. Story views also bump stories.views.
const db = require('./db');
const { visitorHash } = require('./security');

const BOT_RE = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|curl|wget|python|axios|node-fetch|playwright/i;
let buffer = [];
let storyViews = new Map();

function track(req, { kind = 'page', entityId = null } = {}) {
  const ua = req.get('user-agent') || '';
  if (BOT_RE.test(ua) || req.get('x-no-track')) return;
  let refHost = null;
  try { refHost = req.get('referer') ? new URL(req.get('referer')).host.slice(0, 120) : null; } catch { /* bad referer */ }
  buffer.push({
    path: req.originalUrl.split('?')[0].slice(0, 300),
    kind,
    entity_id: entityId,
    locale: req.locale || null,
    visitor: visitorHash(req),
    referrer_host: refHost,
  });
  if (kind === 'story' && entityId) storyViews.set(entityId, (storyViews.get(entityId) || 0) + 1);
  if (buffer.length >= 200) flush();
}

async function flush() {
  if (!buffer.length && !storyViews.size) return;
  const rows = buffer;
  const views = storyViews;
  buffer = [];
  storyViews = new Map();
  try {
    if (rows.length) await db.batchInsert('page_views', rows, 500);
    for (const [id, n] of views) await db('stories').where({ id }).increment('views', n);
  } catch (e) {
    console.error('[stats] flush failed:', e.message);
  }
}

const timer = setInterval(flush, 10_000);
timer.unref();

async function logSearch({ kind, query = null, facets = null, results = null, parser = null, locale = null }) {
  try {
    await db('search_events').insert({ kind, query: query && query.slice(0, 300), facets: facets ? JSON.stringify(facets) : null, results, parser, locale });
  } catch (e) {
    console.error('[stats] search log failed:', e.message);
  }
}

module.exports = { track, flush, logSearch, BOT_RE };
