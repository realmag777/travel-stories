// Filter state <-> shareable URL, used by the server (SSR of /stories) and by the browser
// (instant updates through history.pushState). The same code on both sides keeps URLs canonical.
//
//   /stories/filter/country-it,jp/season-spring/budget-low/trip-family/days-4-7/tags-food,history
//   ?category=<24-hex>&sort=popular&bbox=s,w,n,e&q=text&view=map
//
// Multi-select facets are OR inside a facet and AND across facets.

const FACETS = ['country', 'region', 'season', 'budget', 'trip', 'days', 'tags'];
const SORTS = ['new', 'popular', 'duration-asc', 'duration-desc'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ID_RE = /^[0-9a-fA-F]{24}$/;

function emptyState() {
  const s = { category: null, sort: 'new', page: 1, bbox: null, q: '', view: 'list' };
  for (const f of FACETS) s[f] = [];
  return s;
}

function cleanList(values, facet) {
  const out = [];
  for (let v of values) {
    v = String(v).trim().toLowerCase();
    if (facet === 'country') v = v.toUpperCase();
    const ok = facet === 'country' ? /^[A-Z]{2}$/.test(v) : SLUG_RE.test(v);
    if (ok && !out.includes(v)) out.push(v);
  }
  return out.sort();
}

function parseBbox(v) {
  if (!v) return null;
  const n = String(v).split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  const [s, w, nn, e] = n;
  if (s < -90 || nn > 90 || s >= nn || w < -180 || e > 180) return null;
  return n.map((x) => Math.round(x * 1e4) / 1e4);
}

/**
 * Parse the part after /stories/filter/ (string or array of segments) plus query params.
 * @param {string|string[]} segments
 * @param {Record<string,string>} query
 */
function parse(segments, query = {}) {
  const s = emptyState();
  const segs = Array.isArray(segments) ? segments : String(segments || '').split('/');
  for (const seg of segs) {
    if (!seg) continue;
    const dash = seg.indexOf('-');
    if (dash < 1) continue;
    const key = seg.slice(0, dash);
    if (!FACETS.includes(key)) continue;
    const raw = decodeURIComponent(seg.slice(dash + 1)).split(',');
    s[key] = cleanList([...s[key], ...raw], key);
  }
  // Query fallbacks (?country=IT,JP) keep API calls and old links working.
  for (const f of FACETS) {
    if (query[f]) s[f] = cleanList([...s[f], ...String(query[f]).split(',')], f);
  }
  if (query.category && ID_RE.test(String(query.category))) s.category = String(query.category).toLowerCase();
  if (SORTS.includes(query.sort)) s.sort = query.sort;
  const page = parseInt(query.page, 10);
  if (page > 1 && page < 10000) s.page = page;
  s.bbox = parseBbox(query.bbox);
  if (query.q) s.q = String(query.q).slice(0, 200);
  if (query.view === 'map') s.view = 'map';
  return s;
}

/** Canonical path + query for a state (page and view are optional). */
function toUrl(state, { base = '/stories', withPage = true, withView = true } = {}) {
  const segs = [];
  for (const f of FACETS) {
    const vals = (state[f] || []).slice().sort();
    if (vals.length) segs.push(`${f}-${vals.map((v) => (f === 'country' ? v.toLowerCase() : v)).join(',')}`);
  }
  let url = base + (segs.length ? '/filter/' + segs.join('/') : '');
  const q = [];
  if (state.category) q.push('category=' + state.category);
  if (state.sort && state.sort !== 'new') q.push('sort=' + state.sort);
  if (state.bbox) q.push('bbox=' + state.bbox.join(','));
  if (state.q) q.push('q=' + encodeURIComponent(state.q));
  if (withView && state.view === 'map') q.push('view=map');
  if (withPage && state.page > 1) q.push('page=' + state.page);
  if (q.length) url += '?' + q.join('&');
  return url;
}

/** Toggle one value of a facet and reset paging. Category is single-select. */
function toggle(state, facet, value) {
  const s = JSON.parse(JSON.stringify(state));
  s.page = 1;
  if (facet === 'category') {
    s.category = s.category === value ? null : value;
    return s;
  }
  const v = facet === 'country' ? String(value).toUpperCase() : String(value);
  const list = s[facet] || [];
  s[facet] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort();
  return s;
}

function activeCount(state) {
  return FACETS.reduce((n, f) => n + (state[f] || []).length, 0) + (state.category ? 1 : 0) + (state.bbox ? 1 : 0);
}

module.exports = { FACETS, SORTS, emptyState, parse, toUrl, toggle, activeCount, parseBbox };
