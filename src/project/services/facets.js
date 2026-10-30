// Faceted search over stories. All counting happens in one SQL round-trip: for every facet the
// counts are taken with all OTHER active filters applied (standard "disjunctive faceting"), so
// options inside one facet behave as OR and never zero each other out.
const db = require('../../core/db');
const { DURATIONS, SEASONS, BUDGETS, TRIP_TYPES } = require('../../shared/dictionaries');
const { FACETS } = require('../../shared/filter-state');
const content = require('../content');

const DURATION_SQL = `CASE ${DURATIONS.map((d) => `WHEN s.duration_days BETWEEN ${d.min} AND ${d.max} THEN '${d.slug}'`).join(' ')} END`;

/**
 * Build WHERE fragments for a state. Returns { parts: [{facet, sql, bindings}] }.
 * `facet` lets the counting query drop the fragment of the facet being counted.
 */
function whereParts(state) {
  // Moderated (hidden) stories never reach public lists, counts or the map.
  const parts = state.includeHidden ? [] : [{ facet: 'base', sql: 's.hidden = false', bindings: [] }];
  if (state.category) parts.push({ facet: 'category', sql: 's.category_id = ?', bindings: [state.category] });
  if (state.country.length) parts.push({ facet: 'country', sql: `s.country_code = ANY(?::text[])`, bindings: [state.country] });
  if (state.region.length) parts.push({ facet: 'region', sql: `s.region_slug = ANY(?::text[])`, bindings: [state.region] });
  if (state.season.length) parts.push({ facet: 'season', sql: `s.seasons && ?::text[]`, bindings: [state.season] });
  if (state.budget.length) parts.push({ facet: 'budget', sql: `s.budget = ANY(?::text[])`, bindings: [state.budget] });
  if (state.trip.length) parts.push({ facet: 'trip', sql: `s.trip_type = ANY(?::text[])`, bindings: [state.trip] });
  if (state.tags.length) parts.push({ facet: 'tags', sql: `s.tags && ?::text[]`, bindings: [state.tags] });
  if (state.days.length) {
    const ranges = DURATIONS.filter((d) => state.days.includes(d.slug));
    if (ranges.length) {
      parts.push({
        facet: 'days',
        sql: '(' + ranges.map(() => 's.duration_days BETWEEN ? AND ?').join(' OR ') + ')',
        bindings: ranges.flatMap((d) => [d.min, d.max]),
      });
    }
  }
  if (state.bbox) {
    const [south, west, north, east] = state.bbox;
    // A box crossing the antimeridian (west > east) is split into two longitude ranges.
    const lngSql = west <= east ? 's.lng BETWEEN ? AND ?' : '(s.lng >= ? OR s.lng <= ?)';
    parts.push({ facet: 'bbox', sql: `s.lat BETWEEN ? AND ? AND ${lngSql}`, bindings: [south, north, west, east] });
  }
  if (state.text) parts.push({ facet: 'text', sql: `s.search @@ plainto_tsquery('simple', ?)`, bindings: [state.text] });
  return parts;
}

function combine(parts, skipFacet) {
  const used = parts.filter((p) => p.facet !== skipFacet);
  if (!used.length) return { sql: 'TRUE', bindings: [] };
  return { sql: used.map((p) => `(${p.sql})`).join(' AND '), bindings: used.flatMap((p) => p.bindings) };
}

// Value expression per facet; array facets are unnested.
const FACET_EXPR = {
  category: { from: 'stories s', value: 's.category_id' },
  country: { from: 'stories s', value: 's.country_code' },
  region: { from: 'stories s', value: 's.region_slug' },
  season: { from: 'stories s CROSS JOIN LATERAL unnest(s.seasons) AS v(val)', value: 'v.val' },
  budget: { from: 'stories s', value: 's.budget' },
  trip: { from: 'stories s', value: 's.trip_type' },
  days: { from: 'stories s', value: DURATION_SQL },
  tags: { from: 'stories s CROSS JOIN LATERAL unnest(s.tags) AS v(val)', value: 'v.val' },
};

/** Raw counts: { facet: { value: count } } for every facet, plus the total. */
async function counts(state) {
  const parts = whereParts(state);
  const selects = [];
  const bindings = [];
  for (const facet of ['category', ...FACETS]) {
    const e = FACET_EXPR[facet];
    const w = combine(parts, facet);
    selects.push(`SELECT '${facet}' AS facet, ${e.value} AS value, count(*)::int AS n FROM ${e.from} WHERE ${w.sql} GROUP BY 2`);
    bindings.push(...w.bindings);
  }
  const all = combine(parts, null);
  selects.push(`SELECT 'total' AS facet, NULL AS value, count(*)::int AS n FROM stories s WHERE ${all.sql}`);
  bindings.push(...all.bindings);
  const { rows } = await db.raw(selects.join('\nUNION ALL\n'), bindings);
  const out = { total: 0 };
  for (const r of rows) {
    if (r.facet === 'total') { out.total = r.n; continue; }
    if (r.value === null) continue;
    (out[r.facet] = out[r.facet] || {})[r.value] = r.n;
  }
  return out;
}

const ORDER = {
  new: 's.date DESC, s.created_at DESC, s.id DESC',
  popular: 's.favorite_count DESC, s.date DESC, s.id DESC',
  'duration-asc': 's.duration_days ASC NULLS LAST, s.date DESC, s.id DESC',
  'duration-desc': 's.duration_days DESC NULLS LAST, s.date DESC, s.id DESC',
};

/** One page of matching stories. `offset` overrides page-based offset for "show more". */
async function list(state, { perPage = 9, page = state.page || 1 } = {}) {
  const w = combine(whereParts(state), null);
  const rows = await content.storyBase()
    .whereRaw(w.sql, w.bindings)
    .orderByRaw(ORDER[state.sort] || ORDER.new)
    .limit(perPage)
    .offset((page - 1) * perPage);
  return rows;
}

/** All matching points for the map (light columns only). */
async function points(state, limit = 5000) {
  const w = combine(whereParts(state), null);
  return db('stories as s')
    .select('s.id', 's.title', 's.title_en', 's.title_es', 's.lat', 's.lng', 's.cover_key', 's.img', 's.category_id', 's.favorite_count', 's.date')
    .whereNotNull('s.lat').whereNotNull('s.lng')
    .whereRaw(w.sql, w.bindings)
    .orderByRaw(ORDER[state.sort] || ORDER.new)
    .limit(limit);
}

/**
 * Facet view-model for templates/JSON: every option with its label, count, selected and disabled flags.
 * Selected options are always listed even when their count dropped to zero.
 */
async function facetModel(state, locale) {
  const [c, d] = await Promise.all([counts(state), content.dicts()]);
  const fv = d.facets;
  const opt = (facet, value, label) => {
    const n = (c[facet] && c[facet][value]) || 0;
    const selected = facet === 'category' ? state.category === value : (state[facet] || []).includes(value);
    return { value, label, count: n, selected, disabled: n === 0 && !selected };
  };
  const labelOf = (facet, slug) => content.facetLabel((fv[facet] || []).find((v) => v.slug === slug), locale) || slug;

  // Countries and regions: only values that exist in the data, sorted by label.
  const countryCodes = Object.keys(c.country || {}).concat(state.country.filter((x) => !(c.country || {})[x]));
  const regionRows = await regionLabels(Object.keys(c.region || {}).concat(state.region), locale);

  const model = {
    total: c.total,
    category: d.categories.map((cat) => opt('category', cat.id, content.categoryName(cat, locale))),
    country: countryCodes
      .map((code) => opt('country', code, content.countryName(d.countryByCode[code], locale) || code))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    region: regionRows.map((r) => opt('region', r.slug, r.label)).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale)),
    season: SEASONS.map((s) => opt('season', s, labelOf('season', s))),
    budget: BUDGETS.map((b) => opt('budget', b, labelOf('budget', b))),
    trip: TRIP_TYPES.map((t) => opt('trip', t, labelOf('trip', t))),
    days: DURATIONS.map((x) => opt('days', x.slug, labelOf('days', x.slug))),
    tags: (fv.tags || []).map((t) => opt('tags', t.slug, content.facetLabel(t, locale)))
      .filter((o) => o.count > 0 || o.selected)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale)),
  };
  return model;
}

async function regionLabels(slugs, locale) {
  const uniq = [...new Set(slugs)].filter(Boolean);
  if (!uniq.length) return [];
  const rows = await db('stories').distinctOn('region_slug')
    .select('region_slug as slug', 'region', 'region_en', 'region_es')
    .whereIn('region_slug', uniq);
  return rows.map((r) => ({ slug: r.slug, label: (locale === 'uk' ? r.region : r[`region_${locale}`]) || r.region }));
}

module.exports = { whereParts, counts, list, points, facetModel, ORDER };
