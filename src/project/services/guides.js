// Guides = public travellers who accept bookings and have at least one active service.
// A guide's country/region comes from their own stories (most frequent country, latest region).
// Filters: country, service kind, date (a free slot that day, Kyiv time).
const db = require('../../core/db');
const { avatarImage } = require('../../core/images');
const content = require('../content');
const { kyivParts } = require('./booking');

const KINDS = ['call', 'tour', 'plan'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilters(q = {}) {
  const country = /^[A-Za-z]{2}$/.test(q.country || '') ? q.country.toUpperCase() : '';
  const service = KINDS.includes(q.service) ? q.service : '';
  const date = DATE_RE.test(q.date || '') ? q.date : '';
  return { country, service, date };
}

/** Base SQL for guides with derived country/region, next free slot and popularity. */
function baseQuery({ service, date }) {
  const bindings = [];
  let slotDate = '';
  if (date) { slotDate = `AND (sl.starts_at AT TIME ZONE 'Europe/Kyiv')::date = ?::date`; bindings.push(date); }
  let kindSql = '';
  if (service) { kindSql = 'AND sv.kind = ?'; bindings.push(service); }
  const sql = `
    SELECT u.id, u.name, u.name_en, u.description, u.description_en, u.description_es, u.avatar_key, u.avatar_url, u.created_at,
      geo.country_code, geo.region, geo.region_en, geo.region_es,
      (SELECT min(sl.starts_at) FROM slots sl WHERE sl.user_id = u.id AND sl.starts_at > now() ${slotDate}
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = sl.id AND b.status <> 'cancelled')) AS next_slot,
      (SELECT coalesce(sum(s.favorite_count), 0) FROM stories s WHERE s.owner_id = u.id AND NOT s.hidden)
        + 5 * (SELECT count(*) FROM bookings b WHERE b.user_id = u.id AND b.status <> 'cancelled') AS popularity
    FROM users u
    LEFT JOIN LATERAL (
      SELECT s.country_code FROM stories s WHERE s.owner_id = u.id AND NOT s.hidden AND s.country_code IS NOT NULL
      GROUP BY s.country_code ORDER BY count(*) DESC, s.country_code LIMIT 1
    ) gc ON true
    LEFT JOIN LATERAL (
      SELECT gc.country_code, s.region, s.region_en, s.region_es FROM stories s
      WHERE s.owner_id = u.id AND NOT s.hidden AND s.region IS NOT NULL AND s.country_code IS NOT DISTINCT FROM gc.country_code
      ORDER BY s.date DESC LIMIT 1
    ) geo0 ON true
    CROSS JOIN LATERAL (SELECT gc.country_code, geo0.region, geo0.region_en, geo0.region_es) geo
    WHERE u.accepts_bookings AND NOT u.hidden
      AND EXISTS (SELECT 1 FROM services sv WHERE sv.user_id = u.id AND sv.active ${kindSql})`;
  return { sql, bindings };
}

/**
 * @returns {Promise<{rows: object[], total: number, facets: {country: object[], service: object[]}}>}
 */
async function list(filters, { offset = 0, limit = 12, locale = 'uk', order = 'popular' } = {}) {
  const f = parseFilters(filters);
  const base = baseQuery(f);
  const where = [];
  const wb = [];
  if (f.country) { where.push('g.country_code = ?'); wb.push(f.country); }
  if (f.date) where.push('g.next_slot IS NOT NULL');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const orderSql = order === 'soonest' ? 'g.next_slot ASC NULLS LAST, g.popularity DESC' : 'g.popularity DESC, g.next_slot ASC NULLS LAST, g.id';
  const all = await db.raw(`SELECT g.* FROM (${base.sql}) g ${whereSql} ORDER BY ${orderSql}`, [...base.bindings, ...wb]);
  const rows = all.rows;
  const page = rows.slice(offset, offset + limit);
  const services = page.length
    ? await db('services').whereIn('user_id', page.map((r) => r.id)).where({ active: true }).orderBy(['sort', 'id'])
    : [];
  const d = await content.dicts();
  return {
    total: rows.length,
    rows: page.map((r) => toCard(r, services.filter((s) => s.user_id === r.id), d, locale)),
    facets: await facetOptions(f, d, locale),
  };
}

/** Options for the filter selects with counts (country counts respect the other filters). */
async function facetOptions(f, d, locale) {
  const base = baseQuery({ service: f.service, date: f.date });
  const dateWhere = f.date ? 'WHERE g.next_slot IS NOT NULL' : '';
  const { rows: countries } = await db.raw(`SELECT g.country_code AS code, count(*)::int AS n FROM (${base.sql}) g ${dateWhere}
    GROUP BY 1 HAVING g.country_code IS NOT NULL ORDER BY 1`, base.bindings);
  const b2 = baseQuery({ service: '', date: f.date });
  const where2 = [f.country ? 'g.country_code = ?' : null, f.date ? 'g.next_slot IS NOT NULL' : null].filter(Boolean);
  const { rows: kinds } = await db.raw(`SELECT sv.kind, count(DISTINCT g.id)::int AS n FROM (${b2.sql}) g
      JOIN services sv ON sv.user_id = g.id AND sv.active ${where2.length ? 'WHERE ' + where2.join(' AND ') : ''} GROUP BY 1`,
    [...b2.bindings, ...(f.country ? [f.country] : [])]);
  return {
    country: countries.map((c) => ({ value: c.code, label: content.countryName(d.countryByCode[c.code], locale) || c.code, count: c.n, selected: c.code === f.country }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    service: KINDS.map((k) => ({ value: k, count: (kinds.find((x) => x.kind === k) || {}).n || 0, selected: k === f.service })),
  };
}

const priceNumber = (label) => {
  const m = String(label || '').match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
};

function toCard(r, services, d, locale) {
  const priced = services.map((s) => ({ s, n: priceNumber(s.price_label) })).filter((x) => x.n !== null).sort((a, b) => a.n - b.n);
  const cheapest = priced[0];
  const next = r.next_slot ? kyivParts(new Date(r.next_slot)) : null;
  const region = (locale !== 'uk' && r[`region_${locale}`]) || r.region;
  const country = content.countryName(d.countryByCode[r.country_code], locale);
  return {
    id: r.id,
    name: locale === 'uk' ? r.name : r.name_en || r.name,
    description: (locale === 'uk' ? r.description : r[`description_${locale}`] || r.description) || '',
    avatar: avatarImage(r),
    place: [region, country].filter(Boolean).join(', '),
    countryCode: r.country_code,
    nextSlot: next ? { iso: new Date(r.next_slot).toISOString(), day: next.day, time: next.time } : null,
    priceFrom: cheapest ? cheapest.s.price_label.replace(/\d+(?:[.,]\d+)?/, String(cheapest.n)) : null,
    kinds: [...new Set(services.map((s) => s.kind))],
    services: services.map((s) => ({ id: s.id, kind: s.kind, title: (locale !== 'uk' && s[`title_${locale}`]) || s.title, price: s.price_label, durationMin: s.duration_min })),
  };
}

/** Guide card data for one traveller (story page CTA, profile). Null when not bookable. */
async function forTraveller(userId, locale = 'uk') {
  const r = await list({}, { offset: 0, limit: 1000, locale });
  return r.rows.find((g) => g.id === userId) || null;
}

module.exports = { list, parseFilters, forTraveller, KINDS, priceNumber };
