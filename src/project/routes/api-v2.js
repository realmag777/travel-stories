// API v2: everything the original did not have — facets, natural-language search, map points,
// anonymous saves, booking and travel links. Same { status, message, data } envelope as v1.
const express = require('express');
const db = require('../../core/db');
const { ok, fail, asyncRoute } = require('../../core/http');
const { isObjectId } = require('../../core/ids');
const { limiters, visitorHash } = require('../../core/security');
const stats = require('../../core/stats');
const { coverImage } = require('../../core/images');
const filterState = require('../../shared/filter-state');
const { booking: bookingSchema, fieldErrors } = require('../../shared/schemas');
const facets = require('../services/facets');
const nlsearch = require('../services/nlsearch');
const bookingService = require('../services/booking');
const affiliate = require('../services/affiliate');
const guides = require('../services/guides');
const content = require('../content');
const { LOCALES } = require('../../core/i18n');

const localeOf = (req) => (LOCALES.includes(req.query.lang) ? req.query.lang : 'uk');

/** Reject cross-site browser requests to public write endpoints (no session, so no CSRF token). */
function sameOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch { /* malformed header */ }
  return fail(res, 403, 'Cross-site request rejected');
}

function stateFromQuery(query) {
  const s = filterState.parse([], query);
  if (query.text) s.text = String(query.text).slice(0, 120);
  return s;
}

function register(app) {
  const r = express.Router();

  // Filtered stories with facet counts.
  r.get('/stories', limiters.search, asyncRoute(async (req, res) => {
    const locale = localeOf(req);
    const state = stateFromQuery(req.query);
    const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 9, 1), 50);
    const t0 = process.hrtime.bigint();
    const [rows, model, d] = await Promise.all([facets.list(state, { perPage }), facets.facetModel(state, locale), content.dicts()]);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    res.set('Server-Timing', `db;dur=${ms.toFixed(1)}`);
    ok(res, 200, 'Successfully found stories', {
      stories: rows.map((row) => {
        const c = content.storyCard(row, d, locale);
        return { ...c, country: row.country_code, region: row.region_slug, seasons: row.seasons, budget: row.budget, durationDays: row.duration_days, tripType: row.trip_type, tags: row.tags };
      }),
      facets: model,
      total: model.total,
      page: state.page,
      perPage,
      hasNextPage: state.page * perPage < model.total,
      url: filterState.toUrl(state),
      tookMs: Math.round(ms * 10) / 10,
    });
  }));

  // Facet counts only (used by the load test and external clients).
  r.get('/facets', limiters.search, asyncRoute(async (req, res) => {
    const state = stateFromQuery(req.query);
    const t0 = process.hrtime.bigint();
    const model = await facets.facetModel(state, localeOf(req));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    res.set('Server-Timing', `db;dur=${ms.toFixed(1)}`);
    ok(res, 200, 'Successfully counted facets', { ...model, tookMs: Math.round(ms * 10) / 10 });
  }));

  // Natural-language query -> facets (+ resulting URL).
  r.get('/search', limiters.search, asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').slice(0, 300);
    const locale = localeOf(req);
    const { facets: f, parser } = await nlsearch.parse(q, locale);
    const state = { ...filterState.emptyState(), ...f, category: f.category || null, q };
    const model = await facets.facetModel(state, locale);
    stats.logSearch({ kind: 'nl', query: q, facets: f, results: model.total, parser, locale });
    ok(res, 200, 'Successfully parsed the query', { query: q, parser, facets: f, total: model.total, url: filterState.toUrl(state) });
  }));

  // Map points for the current filter.
  r.get('/map', limiters.search, asyncRoute(async (req, res) => {
    const locale = localeOf(req);
    const state = stateFromQuery(req.query);
    const [rows, d] = await Promise.all([facets.points(state), content.dicts()]);
    ok(res, 200, 'Successfully found map points', {
      total: rows.length,
      points: rows.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        title: (locale !== 'uk' && p[`title_${locale}`]) || p.title,
        category: content.categoryName(d.categoryById[p.category_id], locale),
        img: coverImage(p).src,
        favoriteCount: p.favorite_count,
        date: content.formatDate(p.date),
      })),
    });
  }));

  // Cards for the "Збережені" page (ids come from localStorage).
  r.get('/stories/by-ids', asyncRoute(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(isObjectId).slice(0, 100);
    const locale = localeOf(req);
    if (!ids.length) return ok(res, 200, 'Successfully found stories', { stories: [] });
    const [rows, d] = await Promise.all([content.storyBase().whereIn('s.id', ids).where('s.hidden', false), content.dicts()]);
    const byId = Object.fromEntries(rows.map((r0) => [r0.id, r0]));
    ok(res, 200, 'Successfully found stories', { stories: ids.filter((id) => byId[id]).map((id) => content.storyCard(byId[id], d, locale)) });
  }));

  // Anonymous save: one vote per visitor and story; only the counter is stored server-side.
  r.post('/stories/:storyId/save', sameOrigin, limiters.favorite, limiters.favoritePerStory, asyncRoute(async (req, res) => {
    const id = req.params.storyId;
    if (!isObjectId(id)) return fail(res, 400, 'Malformed story id');
    const action = req.body && req.body.action === 'remove' ? 'remove' : 'add';
    const story = await db('stories').where({ id, hidden: false }).first('id');
    if (!story) return fail(res, 404, 'Story not found');
    const visitor = visitorHash(req);
    let changed = false;
    await db.transaction(async (trx) => {
      if (action === 'add') {
        const ins = await trx('anon_favorites').insert({ visitor, story_id: id }).onConflict(['visitor', 'story_id']).ignore().returning('story_id');
        if (ins.length) { await trx('stories').where({ id }).increment('favorite_count', 1); changed = true; }
      } else {
        const del = await trx('anon_favorites').where({ visitor, story_id: id }).del();
        if (del) { await trx('stories').where({ id }).andWhere('favorite_count', '>', 0).decrement('favorite_count', 1); changed = true; }
      }
    });
    const { favorite_count: favoriteCount } = await db('stories').where({ id }).first('favorite_count');
    ok(res, 200, action === 'add' ? 'Story saved' : 'Story removed', { storyId: id, saved: action === 'add', changed, favoriteCount });
  }));

  // Travel links for a story destination.
  r.get('/stories/:storyId/travel-links', asyncRoute(async (req, res) => {
    const s = await db('stories').where({ id: req.params.storyId }).first();
    if (!s) return fail(res, 404, 'Story not found');
    const d = await content.dicts();
    ok(res, 200, 'Successfully built links', await affiliate.linksFor({
      place: s.region_en || s.region, country: d.countryByCode[s.country_code]?.name_en, lat: s.lat, lng: s.lng,
    }));
  }));

  // Guides with the nearest free slot and the lowest price. Filters: country, service, date.
  r.get('/guides', asyncRoute(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const result = await guides.list(req.query, { offset, limit, locale: localeOf(req) });
    ok(res, 200, 'Successfully found guides', { guides: result.rows, total: result.total, offset, limit, hasNextPage: offset + limit < result.total, facets: result.facets });
  }));

  // Booking: services and free slots of a traveller.
  r.get('/travellers/:id/booking', asyncRoute(async (req, res) => {
    const u = await db('users').where({ id: req.params.id, hidden: false }).first();
    if (!u || !u.accepts_bookings) return fail(res, 404, 'Traveller does not accept bookings');
    const locale = localeOf(req);
    const [services, slots] = await Promise.all([bookingService.servicesFor(u.id), bookingService.freeSlots(u.id)]);
    ok(res, 200, 'Successfully found booking options', {
      services: services.map((s) => ({
        id: s.id, kind: s.kind, title: (locale !== 'uk' && s[`title_${locale}`]) || s.title,
        description: s.description, durationMin: s.duration_min, price: s.price_label,
      })),
      slots,
      timezone: 'Europe/Kyiv',
    });
  }));

  r.post('/travellers/:id/bookings', sameOrigin, limiters.booking, asyncRoute(async (req, res) => {
    const parsed = bookingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ status: 400, message: 'Invalid request data', errors: fieldErrors(parsed.error) });
    }
    try {
      const b = await bookingService.create({ travellerId: req.params.id, ...parsed.data, locale: localeOf(req) });
      ok(res, 201, 'Booking created', {
        id: b.id, status: b.status, startsAt: new Date(b.slot.starts_at).toISOString(), service: b.service.title,
        confirmUrl: bookingService.confirmPath(b), cancelUrl: bookingService.cancelPath(b),
      });
    } catch (e) {
      if (e instanceof bookingService.BookingError) return res.status(e.status).json({ status: e.status, message: e.message, code: e.code });
      throw e;
    }
  }));

  r.use((req, res) => fail(res, 404, 'Route not found'));
  app.use('/api/v2', r);
}

module.exports = { register, sameOrigin };
