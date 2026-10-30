// Public SSR pages for every locale prefix ('' = uk, '/en', '/es'). The catalog (/stories, /map)
// also answers X-Partial requests with rendered fragments, so the browser updates results,
// facets and chips instantly while every state keeps a real, shareable, server-rendered URL.
const express = require('express');
const db = require('../../core/db');
const { asyncRoute } = require('../../core/http');
const { isObjectId } = require('../../core/ids');
const i18n = require('../../core/i18n');
const stats = require('../../core/stats');
const { coverImage, avatarImage } = require('../../core/images');
const filterState = require('../../shared/filter-state');
const { DURATIONS } = require('../../shared/dictionaries');
const facets = require('../services/facets');
const nlsearch = require('../services/nlsearch');
const bookingService = require('../services/booking');
const affiliate = require('../services/affiliate');
const content = require('../content');

const STORIES_PER_PAGE = 9;
const TRAVELLERS_PER_PAGE = 12;
const PROFILE_PER_PAGE = 6;
const SITE_URL = () => (process.env.PUBLIC_URL || 'http://localhost:8350').replace(/\/$/, '');

// ---------- SEO helpers ----------
function seo(req, { title, description, image, jsonld = [], type, noindex, article, canonicalPath }) {
  const rest = canonicalPath || req.restPath;
  const site = SITE_URL();
  const alternates = i18n.LOCALES.map((l) => ({ hreflang: l, href: site + i18n.lurl(rest, l) }));
  alternates.push({ hreflang: 'x-default', href: site + i18n.lurl(rest, i18n.DEFAULT_LOCALE) });
  const abs = (u) => (!u ? site + '/build/og-default.jpg' : /^https?:/.test(u) ? u : site + u);
  return {
    title,
    description: String(description || '').replace(/\s+/g, ' ').slice(0, 160),
    canonical: site + i18n.lurl(rest, req.locale),
    alternates,
    ogImage: abs(image),
    ogType: type,
    noindex,
    article,
    jsonld: [websiteLd(req), ...jsonld],
  };
}

function websiteLd(req) {
  const site = SITE_URL();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': site + '/#website',
    url: site + i18n.lurl('/', req.locale),
    name: req.t('site.name'),
    inLanguage: req.locale,
    potentialAction: {
      '@type': 'SearchAction',
      target: site + i18n.lurl('/stories/search', req.locale) + '?q={query}',
      'query-input': 'required name=query',
    },
  };
}

function breadcrumbs(req, items) {
  const site = SITE_URL();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: site + i18n.lurl(it.path, req.locale) })),
  };
}

// ---------- Catalog helpers ----------
const SORT_KEYS = ['new', 'popular', 'duration-asc', 'duration-desc'];

function chipsFor(req, state, model) {
  const chips = [];
  const label = (facet, value) => {
    const list = facet === 'category' ? model.category : model[facet] || [];
    const o = list.find((x) => x.value === value);
    return o ? o.label : value;
  };
  const href = (s) => req.url_(filterState.toUrl(s, { base: req.catalogBase }));
  if (state.q) chips.push({ facet: 'q', value: '', label: `«${state.q}»`, href: href({ ...state, q: '', page: 1 }), ai: true });
  if (state.category) chips.push({ facet: 'category', value: state.category, label: label('category', state.category), href: href(filterState.toggle(state, 'category', state.category)), ai: Boolean(state.q) });
  for (const f of filterState.FACETS) {
    for (const v of state[f]) chips.push({ facet: f, value: v, label: label(f, v), href: href(filterState.toggle(state, f, v)), ai: Boolean(state.q) });
  }
  if (state.bbox) chips.push({ facet: 'bbox', value: '', label: req.t('map.visibleArea'), href: href({ ...state, bbox: null, page: 1 }) });
  return chips;
}

function facetGroups(req, model) {
  const g = (key, options, extra = {}) => ({ key, title: req.t(`filters.${key}`), options, ...extra });
  const regions = model.region.slice(0, 40);
  return [
    g('country', model.country, { open: true, scroll: model.country.length > 10 }),
    g('region', regions, { open: model.region.some((o) => o.selected), scroll: regions.length > 10 }),
    g('season', model.season, { open: true, pills: true }),
    g('budget', model.budget, { open: true, pills: true }),
    g('trip', model.trip, { open: true, pills: true }),
    g('days', model.days, { open: true, pills: true }),
    g('tags', model.tags, { open: true, pills: true }),
  ].filter((x) => x.options.length);
}

async function catalogContext(req, state, { base }) {
  req.catalogBase = base;
  const locale = req.locale;
  const [model, rows, d] = await Promise.all([
    facets.facetModel(state, locale),
    state.view === 'map' ? Promise.resolve([]) : facets.list(state, { perPage: STORIES_PER_PAGE }),
    content.dicts(),
  ]);
  const toUrl = (s) => req.url_(filterState.toUrl(s, { base }));
  const facetUrls = {};
  for (const group of facetGroups(req, model)) {
    for (const o of group.options) facetUrls[`${group.key}:${o.value}`] = toUrl(filterState.toggle(state, group.key, o.value));
  }
  facetUrls['bbox:'] = toUrl({ ...state, bbox: null, page: 1 });
  const categoryUrls = { '': toUrl({ ...state, category: null, page: 1 }) };
  for (const c of model.category) categoryUrls[c.value] = toUrl({ ...state, category: c.value, page: 1 });
  const n = model.total;
  const totalLabel = req.t('stories.found', { n: `<b>${n}</b>`, word: i18n.plural(n, req.t('stories.storyForms'), locale) });
  return {
    state,
    facetModel: model,
    facetGroups: facetGroups(req, model),
    facetUrls,
    categoryUrls,
    showCounts: true,
    chips: chipsFor(req, state, model),
    stories: rows.map((r) => content.storyCard(r, d, locale)),
    hasMore: state.page * STORIES_PER_PAGE < n,
    nextUrl: toUrl({ ...state, page: state.page + 1 }),
    listUrl: req.url_(filterState.toUrl({ ...state, view: 'list', page: 1 }, { base: '/stories' })),
    mapUrl: req.url_(filterState.toUrl({ ...state, view: 'map', page: 1 }, { base: '/stories' })),
    activeCount: filterState.activeCount(state),
    totalLabel,
    sorts: SORT_KEYS.map((v) => ({ value: v, label: req.t(`filters.sort_${v}`) })),
    searchExamples: req.t('search.examples'),
  };
}

/** Render named partials to strings for X-Partial responses. */
function renderPartials(res, names, ctx) {
  const app = res.app;
  const out = {};
  return Promise.all(names.map((n) => new Promise((resolve, reject) => {
    app.render(`partials/${n}.njk`, { ...res.locals, ...ctx }, (err, html) => (err ? reject(err) : resolve((out[n] = html))));
  }))).then(() => out);
}

function catalogTitle(req, state, model) {
  const parts = [];
  const pick = (facet, list) => state[facet].map((v) => (list.find((o) => o.value === v) || {}).label).filter(Boolean);
  if (state.category) parts.push((model.category.find((c) => c.value === state.category) || {}).label);
  parts.push(...pick('country', model.country), ...pick('season', model.season), ...pick('trip', model.trip));
  return parts.filter(Boolean).slice(0, 3).join(', ');
}

/** Paging window: ?page=N (SSR links) or ?offset=&limit= ("Показати ще" on smaller screens). */
function windowOf(req, defLimit) {
  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || defLimit));
  const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));
  const offset = req.query.offset !== undefined ? Math.max(0, Math.min(100000, parseInt(req.query.offset, 10) || 0)) : (page - 1) * limit;
  return { page, offset, limit };
}

// ---------- Router ----------
function router() {
  const r = express.Router();

  r.get('/', asyncRoute(async (req, res) => {
    const locale = req.locale;
    const [popularRows, travellerRows, d] = await Promise.all([
      content.storyBase().where('s.hidden', false).orderBy([{ column: 's.favorite_count', order: 'desc' }, { column: 's.date', order: 'desc' }]).limit(4),
      db('users as u').where('u.hidden', false).orderBy('u.id').limit(4),
      content.dicts(),
    ]);
    stats.track(req, { kind: 'home' });
    res.render('pages/home.njk', {
      isHome: true,
      popular: popularRows.map((r0) => content.storyCard(r0, d, locale)),
      travellers: travellerRows.map((u) => content.travellerCard(u, locale)),
      preloadImage: { href: '/build/hero-768.webp' },
      seo: seo(req, {
        title: req.t('seo.homeTitle'),
        description: req.t('seo.homeDescription'),
        image: '/build/og-default.jpg',
        jsonld: [{
          '@context': 'https://schema.org', '@type': 'Organization', '@id': SITE_URL() + '/#org', name: req.t('site.name'),
          url: SITE_URL() + '/', logo: SITE_URL() + '/images/logo.svg',
        }],
      }),
    });
  }));

  // Catalog with facets: /stories and /stories/filter/<segments>
  const catalog = (base, view) => asyncRoute(async (req, res, next) => {
    const segs = req.params.segments ? String(req.params.segments).split('/') : (req.params[0] ? req.params[0].split('/') : []);
    const state = filterState.parse(segs, req.query);
    if (view) state.view = view;
    // Canonical redirect for unsorted/duplicated segments (only for real browsers, keeps URLs unique).
    const canonicalUrl = filterState.toUrl(state, { base });
    const requested = req.restPath + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    if (segs.length && decodeURIComponent(requested) !== decodeURIComponent(canonicalUrl) && !req.get('x-partial')) {
      return res.redirect(301, req.url_(canonicalUrl));
    }
    const ctx = await catalogContext(req, state, { base });
    if (state.q || filterState.activeCount(state)) {
      stats.logSearch({ kind: 'filter', query: state.q || null, facets: { ...state, page: undefined, view: undefined }, results: ctx.facetModel.total, locale: req.locale });
    }
    const partial = req.get('x-partial');
    if (partial === 'append') {
      const html = await renderPartials(res, ['story-results'], { ...ctx, appended: true });
      return res.json({ html: html['story-results'], hasMore: ctx.hasMore, nextUrl: ctx.nextUrl });
    }
    if (partial) {
      const html = await renderPartials(res, ['story-results', 'facets', 'active-chips', 'categories'], ctx);
      return res.json({
        html,
        total: ctx.facetModel.total,
        totalLabel: ctx.totalLabel,
        showLabel: req.t('filters.show', { n: ctx.facetModel.total }),
        activeCount: ctx.activeCount,
        url: req.url_(filterState.toUrl(state, { base })),
        title: res.locals.t('seo.storiesTitle'),
      });
    }
    stats.track(req, { kind: view === 'map' ? 'map' : 'stories' });
    const extra = catalogTitle(req, state, ctx.facetModel);
    const titleBase = view === 'map' ? req.t('seo.mapTitle') : req.t('seo.storiesTitle');
    res.render(view === 'map' ? 'pages/map.njk' : 'pages/stories.njk', {
      ...ctx,
      seo: seo(req, {
        title: extra ? `${extra} — ${titleBase}` : titleBase,
        description: view === 'map' ? req.t('seo.mapDescription') : req.t('seo.storiesDescription', { n: ctx.facetModel.total }),
        canonicalPath: filterState.toUrl({ ...state, sort: 'new', page: 1, q: '', bbox: null, view: 'list' }, { base }),
        noindex: filterState.activeCount(state) > 2 || Boolean(state.q) || Boolean(state.bbox) || state.page > 1,
        image: ctx.stories[0] ? ctx.stories[0].cover.large : null,
        jsonld: [{
          '@context': 'https://schema.org', '@type': 'CollectionPage', name: titleBase, url: SITE_URL() + req.url_(canonicalUrl),
          mainEntity: { '@type': 'ItemList', numberOfItems: ctx.facetModel.total, itemListElement: ctx.stories.slice(0, 9).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE_URL() + req.url_('/stories/' + s.id) })) },
        }],
      }),
      preloadImage: ctx.stories[0] && ctx.stories[0].cover.srcset ? { href: ctx.stories[0].cover.src, srcset: ctx.stories[0].cover.srcset, sizes: '(min-width: 1440px) 421px, (min-width: 768px) 340px, 335px' } : null,
    });
  });

  // NL search without JS: parse, then redirect to the filter URL.
  r.get('/stories/search', asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').slice(0, 200).trim();
    if (!q) return res.redirect(req.url_('/stories'));
    const { facets: f, parser } = await nlsearch.parse(q, req.locale);
    const state = { ...filterState.emptyState(), ...f, category: f.category || null, q };
    const model = await facets.counts(state);
    stats.logSearch({ kind: 'nl', query: q, facets: f, results: model.total, parser, locale: req.locale });
    res.redirect(req.url_(filterState.toUrl(state)));
  }));

  r.get('/stories', catalog('/stories'));
  r.get(/^\/stories\/filter\/(.+)$/, catalog('/stories'));
  r.get('/map', catalog('/map', 'map'));
  r.get(/^\/map\/filter\/(.+)$/, catalog('/map', 'map'));

  r.get('/stories/create', (req, res) => {
    res.render('pages/create.njk', { seo: seo(req, { title: req.t('seo.createTitle'), description: req.t('create.subtitle'), noindex: true }), editorialEmail: editorialEmail() });
  });

  r.get('/saved', (req, res) => {
    res.render('pages/saved.njk', { seo: seo(req, { title: req.t('seo.savedTitle'), description: req.t('saved.text'), noindex: true }) });
  });

  // Cards for the "Збережені" page: ids come from the visitor's localStorage.
  r.get('/saved/cards', asyncRoute(async (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter(isObjectId).slice(0, 100);
    const [rows, d] = await Promise.all([
      ids.length ? content.storyBase().whereIn('s.id', ids).where('s.hidden', false) : [],
      content.dicts(),
    ]);
    const byId = Object.fromEntries(rows.map((r0) => [r0.id, r0]));
    const stories = ids.filter((id) => byId[id]).map((id) => content.storyCard(byId[id], d, req.locale));
    const html = await renderPartials(res, ['story-results'], { stories, hasMore: false });
    res.json({ html: html['story-results'], total: stories.length });
  }));

  r.get('/stories/:id', asyncRoute(async (req, res, next) => {
    if (!isObjectId(req.params.id)) return next();
    const row = await content.storyBase().where('s.id', req.params.id).where('s.hidden', false).first();
    if (!row) return next();
    const locale = req.locale;
    const d = await content.dicts();
    const card = content.storyCard(row, d, locale);
    const loc = content.localizeStory(row, locale);
    const [popularRows, travel] = await Promise.all([
      content.storyBase().where('s.hidden', false).orderBy([{ column: 's.favorite_count', order: 'desc' }, { column: 's.date', order: 'desc' }]).limit(4),
      row.country_code || row.region ? affiliate.linksFor({
        place: row.region_en || row.region, country: d.countryByCode[row.country_code]?.name_en, lat: row.lat, lng: row.lng,
      }) : null,
    ]);
    const country = d.countryByCode[row.country_code];
    const regionLabel = (locale !== 'uk' && row[`region_${locale}`]) || row.region;
    const fl = (facet, value) => req.url_(filterState.toUrl(filterState.toggle(filterState.emptyState(), facet, value)));
    const labels = d.facets;
    const lab = (facet, slug) => content.facetLabel((labels[facet] || []).find((v) => v.slug === slug), locale) || slug;
    const facts = [];
    if (country) facts.push({ label: content.countryName(country, locale), href: fl('country', country.code) });
    if (row.region_slug) facts.push({ label: regionLabel, href: fl('region', row.region_slug) });
    for (const s of row.seasons || []) facts.push({ label: lab('season', s), href: fl('season', s) });
    if (row.duration_days) {
      const bucket = DURATIONS.find((x) => row.duration_days >= x.min && row.duration_days <= x.max);
      facts.push({ label: req.t('story.days', { n: row.duration_days }), href: bucket ? fl('days', bucket.slug) : '#' });
    }
    if (row.budget) facts.push({ label: `${req.t('filters.budget')}: ${lab('budget', row.budget)}`, href: fl('budget', row.budget) });
    if (row.trip_type) facts.push({ label: lab('trip', row.trip_type), href: fl('trip', row.trip_type) });
    for (const tg of row.tags || []) facts.push({ label: '#' + lab('tags', tg), href: fl('tags', tg) });

    stats.track(req, { kind: 'story', entityId: row.id });
    const site = SITE_URL();
    const cover = coverImage(row);
    res.render('pages/story.njk', {
      story: { ...card, article: loc.article, fallback: loc.fallback, lat: row.lat, lng: row.lng },
      facts,
      travel: travel ? { ...travel, place: [regionLabel, country && content.countryName(country, locale)].filter(Boolean).join(', ') } : null,
      credit: row.cover_author || row.cover_license ? { author: row.cover_author, license: row.cover_license, licenseUrl: row.cover_license_url, sourceUrl: row.cover_source_url } : null,
      popular: popularRows.map((r0) => content.storyCard(r0, d, locale)),
      preloadImage: cover.srcset ? { href: cover.large, srcset: cover.srcset, sizes: '(min-width: 1440px) 1312px, (min-width: 768px) 704px, 335px' } : { href: cover.large },
      seo: seo(req, {
        title: `${loc.title} — ${req.t('site.name')}`,
        description: loc.article,
        image: cover.og,
        type: 'article',
        article: { published: row.date, author: card.owner.name },
        jsonld: [{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: loc.title,
          description: loc.article.slice(0, 200),
          image: [/^https?:/.test(cover.og) ? cover.og : site + cover.og],
          datePublished: row.date,
          dateModified: new Date(row.updated_at).toISOString(),
          inLanguage: loc.fallback ? 'uk' : locale,
          author: { '@type': 'Person', name: card.owner.name, url: site + req.url_('/travellers/' + row.owner_id) },
          publisher: { '@type': 'Organization', name: req.t('site.name'), logo: { '@type': 'ImageObject', url: site + '/images/logo.svg' } },
          mainEntityOfPage: site + req.url_('/stories/' + row.id),
          articleSection: card.category || undefined,
          keywords: (row.tags || []).join(', ') || undefined,
          ...(row.lat ? { contentLocation: { '@type': 'Place', name: regionLabel, geo: { '@type': 'GeoCoordinates', latitude: row.lat, longitude: row.lng } } } : {}),
          interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/BookmarkAction', userInteractionCount: row.favorite_count },
        }, breadcrumbs(req, [{ name: req.t('nav.home'), path: '/' }, { name: req.t('nav.stories'), path: '/stories' }, { name: loc.title, path: '/stories/' + row.id }])],
      }),
    });
  }));

  r.get('/travellers', asyncRoute(async (req, res) => {
    const { page, offset, limit } = windowOf(req, TRAVELLERS_PER_PAGE);
    const [{ n }] = await db('users').where({ hidden: false }).count({ n: '*' });
    const rows = await db('users as u').where('u.hidden', false).orderBy('u.id').limit(limit).offset(offset);
    const ctx = {
      travellers: rows.map((u) => content.travellerCard(u, req.locale)),
      total: Number(n),
      hasMore: offset + limit < Number(n),
      nextUrl: req.url_(`/travellers?offset=${offset + limit}&limit=${limit}`),
    };
    if (req.get('x-partial')) {
      const html = await renderPartials(res, ['traveller-items'], ctx);
      return res.json({ html: html['traveller-items'], hasMore: ctx.hasMore, nextUrl: ctx.nextUrl });
    }
    stats.track(req, { kind: 'travellers' });
    res.render('pages/travellers.njk', {
      ...ctx,
      mainClass: 'page--tint',
      seo: seo(req, { title: req.t('seo.travellersTitle'), description: req.t('seo.travellersDescription'), noindex: page > 1 }),
    });
  }));

  r.get('/travellers/:id', asyncRoute(async (req, res, next) => {
    if (!isObjectId(req.params.id)) return next();
    const u = await content.usersWithCounts().where('u.id', req.params.id).where('u.hidden', false).first();
    if (!u) return next();
    const locale = req.locale;
    const { page, offset, limit } = windowOf(req, PROFILE_PER_PAGE);
    const [[{ n }], rows, d] = await Promise.all([
      db('stories').where({ owner_id: u.id, hidden: false }).count({ n: '*' }),
      content.storyBase().where('s.owner_id', u.id).where('s.hidden', false).orderBy([{ column: 's.date', order: 'desc' }, { column: 's.id', order: 'desc' }])
        .limit(limit).offset(offset),
      content.dicts(),
    ]);
    const total = Number(n);
    const ctx = {
      stories: rows.map((r0) => content.storyCard(r0, d, locale)),
      total,
      hasMore: offset + limit < total,
      nextUrl: req.url_(`/travellers/${u.id}?offset=${offset + limit}&limit=${limit}`),
    };
    if (req.get('x-partial') === 'append') {
      const html = await renderPartials(res, ['story-results'], { ...ctx, appended: true });
      return res.json({ html: html['story-results'], hasMore: ctx.hasMore, nextUrl: ctx.nextUrl });
    }
    let booking = null;
    if (u.accepts_bookings) {
      const services = await bookingService.servicesFor(u.id);
      if (services.length) {
        booking = {
          intro: u.booking_intro,
          services: services.map((s) => ({ id: s.id, kind: s.kind, title: (locale !== 'uk' && s[`title_${locale}`]) || s.title, description: s.description, durationMin: s.duration_min, price: s.price_label })),
        };
      }
    }
    const card = content.travellerCard(u, locale);
    stats.track(req, { kind: 'traveller', entityId: u.id });
    const site = SITE_URL();
    const avatar = avatarImage(u);
    res.render('pages/traveller.njk', {
      ...ctx,
      traveller: card,
      booking,
      seo: seo(req, {
        title: `${card.name} — ${req.t('seo.travellerSuffix')}`,
        description: card.description || req.t('seo.travellersDescription'),
        image: avatar.large,
        type: 'profile',
        noindex: page > 1,
        jsonld: [{
          '@context': 'https://schema.org',
          '@type': 'ProfilePage',
          mainEntity: {
            '@type': 'Person',
            name: card.name,
            description: card.description,
            image: /^https?:/.test(avatar.large) ? avatar.large : site + avatar.large,
            url: site + req.url_('/travellers/' + u.id),
            ...(booking ? { makesOffer: booking.services.map((s) => ({ '@type': 'Offer', name: s.title, priceSpecification: { '@type': 'PriceSpecification', description: s.price } })) } : {}),
          },
          hasPart: ctx.stories.map((s) => ({ '@type': 'Article', headline: s.title, url: site + req.url_('/stories/' + s.id) })),
        }, breadcrumbs(req, [{ name: req.t('nav.home'), path: '/' }, { name: req.t('nav.travellers'), path: '/travellers' }, { name: card.name, path: '/travellers/' + u.id }])],
      }),
    });
  }));

  r.get('/auth/login', (req, res) => authPage(req, res, 'login'));
  r.get('/auth/register', (req, res) => authPage(req, res, 'register'));

  return r;
}

function editorialEmail() {
  return process.env.EDITORIAL_EMAIL || 'editors@podorozhnyky.example';
}

function authPage(req, res, mode) {
  res.render('pages/auth.njk', {
    mode,
    isAuth: true,
    minimalFooter: true,
    mainClass: 'page__main--screen',
    editorialEmail: editorialEmail(),
    seo: seo(req, { title: req.t(`seo.${mode}Title`), description: req.t(`auth.${mode}Subtitle`), noindex: true }),
  });
}

/** Locale detection + template globals; mounts the router under '', '/en' and '/es'. */
function register(app) {
  app.use((req, res, next) => {
    const { locale, rest } = i18n.splitLocale(req.path);
    req.locale = locale;
    req.restPath = rest;
    req.t = (key, vars) => i18n.t(key, locale, vars);
    req.url_ = (p) => i18n.lurl(p, locale);
    const t = (key, vars) => i18n.t(key, locale, vars);
    res.locals.locale = locale;
    res.locals.htmlLang = i18n.HTML_LANG[locale];
    res.locals.ogLocale = i18n.OG_LOCALE[locale];
    res.locals.ogAltLocales = i18n.LOCALES.filter((l) => l !== locale).map((l) => i18n.OG_LOCALE[l]);
    res.locals.t = t;
    res.locals.url = req.url_;
    res.locals.restPath = rest;
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.locals.languageLinks = i18n.LOCALES.map((l) => ({
      code: l, short: l.toUpperCase(), name: i18n.t('lang.name', l), current: l === locale, href: i18n.lurl(rest, l) + qs,
    }));
    const navDefs = [['/', 'nav.home'], ['/stories', 'nav.stories'], ['/travellers', 'nav.travellers'], ['/saved', 'nav.saved', true]];
    res.locals.navItems = navDefs.map(([p, key, savedOnly]) => ({
      href: req.url_(p), label: t(key), savedOnly: Boolean(savedOnly), current: p === '/' ? rest === '/' : rest.startsWith(p),
    }));
    res.locals.clientI18n = i18n.t('client', locale);
    res.locals.seo = { title: t('site.name'), description: '', alternates: [], jsonld: [] };
    next();
  });
  const r = router();
  app.use('/en', (req, res, next) => (req.locale === 'en' ? r(req, res, next) : next()));
  app.use('/es', (req, res, next) => (req.locale === 'es' ? r(req, res, next) : next()));
  app.use((req, res, next) => (req.locale === 'uk' ? r(req, res, next) : next()));
}

module.exports = { register, seo, SITE_URL };
