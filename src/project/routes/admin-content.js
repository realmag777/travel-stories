// Admin CRUD: stories (with cover upload, facets, map point, translations), travellers
// (avatar, booking services and slots), categories, countries and facet dictionaries.
const multer = require('multer');
const db = require('../../core/db');
const images = require('../../core/images');
const { objectId, isObjectId } = require('../../core/ids');
const { asyncRoute } = require('../../core/http');
const schemas = require('../../shared/schemas');
const { slugify } = require('../../shared/slug');
const translate = require('../services/translate');
const bookingService = require('../services/booking');
const content = require('../content');
const nlsearch = require('../services/nlsearch');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const PER_PAGE = 25;

const toArray = (v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]);
const wantsJson = (req) => req.xhr || req.accepts(['html', 'json']) === 'json';

function storyFormBody(body) {
  return {
    ...body,
    seasons: toArray(body.seasons),
    tags: toArray(body.tags),
    is_demo: body.is_demo === 'on' || body.is_demo === 'true',
    country_code: (body.country_code || '').toUpperCase(),
  };
}

async function storyFormData() {
  const d = await content.dicts();
  const owners = await db('users').select('id', 'name', 'is_demo').orderBy('name');
  return { d, owners, facets: d.facets };
}

function register(r, { flash }) {
  // ================= Stories =================
  r.get('/stories', asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const f = { category: req.query.category || '', demo: req.query.demo || '', hidden: req.query.hidden || '', source: req.query.source || '' };
    const sort = ['date', 'favorite_count', 'views', 'title'].includes(req.query.sort) ? req.query.sort : 'date';
    const base = db('stories as s').join('users as u', 'u.id', 's.owner_id');
    if (q) {
      if (isObjectId(q)) base.where('s.id', q.toLowerCase());
      else base.where((w) => w.whereILike('s.title', `%${q}%`).orWhereILike('s.title_en', `%${q}%`).orWhereILike('u.name', `%${q}%`).orWhereILike('s.region', `%${q}%`));
    }
    if (isObjectId(f.category)) base.where('s.category_id', f.category);
    if (f.demo === '1') base.where('s.is_demo', true); else if (f.demo === '0') base.where('s.is_demo', false);
    if (f.hidden === '1') base.where('s.hidden', true); else if (f.hidden === '0') base.where('s.hidden', false);
    if (['original', 'demo', 'api', 'local'].includes(f.source)) base.where('s.source', f.source);
    const [{ n }] = await base.clone().count({ n: '*' });
    const rows = await base.select('s.id', 's.title', 's.title_en', 's.title_es', 's.category_id', 's.date', 's.favorite_count', 's.views', 's.is_demo', 's.hidden', 's.source', 's.cover_key', 's.img', 's.country_code', 'u.name as owner_name')
      .orderBy(`s.${sort}`, sort === 'title' ? 'asc' : 'desc').orderBy('s.id', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
    const d = await content.dicts();
    res.render('admin/stories.njk', {
      section: 'stories', rows: rows.map((x) => ({ ...x, cover: images.coverImage(x), category: d.categoryById[x.category_id]?.name })),
      total: Number(n), page, pages: Math.ceil(Number(n) / PER_PAGE), q, f, sort, categories: d.categories,
      query: new URLSearchParams({ q, ...f, sort }).toString(),
    });
  }));

  r.get('/stories/new', asyncRoute(async (req, res) => {
    res.render('admin/story-form.njk', {
      section: 'stories', ...(await storyFormData()),
      story: { date: new Date().toISOString().slice(0, 10), seasons: [], tags: [], favorite_count: 0 }, isNew: true,
    });
  }));

  r.get('/stories/:id', asyncRoute(async (req, res, next) => {
    if (!isObjectId(req.params.id)) return next();
    const story = await db('stories').where({ id: req.params.id }).first();
    if (!story) return next();
    res.render('admin/story-form.njk', { section: 'stories', ...(await storyFormData()), story, cover: images.coverImage(story), isNew: false });
  }));

  const saveStory = asyncRoute(async (req, res) => {
    const isNew = !req.params.id;
    const parsed = schemas.adminStory.safeParse(storyFormBody(req.body || {}));
    const existing = isNew ? null : await db('stories').where({ id: req.params.id }).first();
    if (!isNew && !existing) return res.status(404).json({ ok: false, message: 'Story not found' });
    if (!parsed.success) {
      const errors = schemas.fieldErrors(parsed.error);
      if (wantsJson(req)) return res.status(400).json({ ok: false, message: 'Перевірте поля форми', errors });
      flash(req, 'error', 'Перевірте поля форми');
      return res.redirect(req.get('referer') || '/admin/stories');
    }
    const v = parsed.data;
    const d = await content.dicts();
    if (!d.categoryById[v.category_id]) return res.status(400).json({ ok: false, message: 'Категорію не знайдено', errors: { category_id: { key: 'validation.invalid' } } });
    if (v.country_code && !d.countryByCode[v.country_code]) return res.status(400).json({ ok: false, message: 'Країну не знайдено у словнику', errors: { country_code: { key: 'validation.invalid' } } });
    const id = isNew ? objectId(new Date(v.date + 'T12:00:00Z')) : req.params.id;
    const row = {
      title: v.title, article: v.article, title_en: v.title_en || null, article_en: v.article_en || null,
      title_es: v.title_es || null, article_es: v.article_es || null, category_id: v.category_id, owner_id: v.owner_id,
      date: v.date, country_code: v.country_code || null, region: v.region || null, region_en: v.region_en || null, region_es: v.region_es || null,
      region_slug: slugify(v.region_en || v.region) || null, seasons: v.seasons, budget: v.budget || null,
      duration_days: v.duration_days === '' ? null : v.duration_days, trip_type: v.trip_type || null, tags: v.tags,
      lat: v.lat === '' ? null : v.lat, lng: v.lng === '' ? null : v.lng, favorite_count: v.favorite_count,
      cover_author: v.cover_author || null, cover_license: v.cover_license || null, cover_license_url: v.cover_license_url || null, cover_source_url: v.cover_source_url || null,
      is_demo: v.is_demo, updated_at: db.fn.now(),
    };
    if (req.file) {
      try { await images.assertImage(req.file.buffer, 8 * 1024 * 1024); } catch (e) {
        return res.status(400).json({ ok: false, message: e.message, errors: { cover: { key: 'validation.invalid' } } });
      }
      row.cover_key = await images.processCover(req.file.buffer, id);
      row.img = null;
      if (existing && existing.cover_key) images.removeKey(existing.cover_key);
    }
    if (isNew) await db('stories').insert({ id, ...row, source: 'local' });
    else await db('stories').where({ id }).update(row);
    nlsearch.invalidate();
    if (wantsJson(req)) return res.json({ ok: true, id, redirect: `/admin/stories/${id}`, message: isNew ? 'Історію створено' : 'Зміни збережено' });
    flash(req, 'success', isNew ? 'Історію створено' : 'Зміни збережено');
    res.redirect(`/admin/stories/${id}`);
  });
  r.post('/stories', upload.single('cover'), saveStory);
  r.post('/stories/:id', upload.single('cover'), saveStory);

  r.post('/stories/:id/delete', asyncRoute(async (req, res) => {
    const s = await db('stories').where({ id: req.params.id }).first();
    if (!s) return res.status(404).json({ ok: false, message: 'Story not found' });
    await db('stories').where({ id: s.id }).del();
    images.removeKey(s.cover_key);
    if (wantsJson(req)) return res.json({ ok: true, redirect: '/admin/stories', message: 'Історію видалено' });
    flash(req, 'success', 'Історію видалено');
    res.redirect('/admin/stories');
  }));

  r.post('/stories/:id/hidden', asyncRoute(async (req, res) => {
    const hidden = req.body.hidden === '1' || req.body.hidden === true;
    await db('stories').where({ id: req.params.id }).update({ hidden, updated_at: db.fn.now() });
    if (wantsJson(req)) return res.json({ ok: true, hidden });
    res.redirect(req.get('referer') || '/admin/stories');
  }));

  r.post('/stories/:id/translate', asyncRoute(async (req, res) => {
    try {
      const patch = await translate.translateStory(req.params.id, req.body.locale);
      res.json({ ok: true, patch, message: 'Переклад готовий' });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, message: e.message });
    }
  }));

  // ================= Travellers =================
  r.get('/travellers', asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const base = db('users as u');
    if (q) base.where((w) => w.whereILike('u.name', `%${q}%`).orWhereILike('u.name_en', `%${q}%`).orWhere('u.id', q.toLowerCase()));
    if (req.query.demo === '1') base.where('u.is_demo', true); else if (req.query.demo === '0') base.where('u.is_demo', false);
    if (req.query.bookings === '1') base.where('u.accepts_bookings', true);
    const [{ n }] = await base.clone().count({ n: '*' });
    const rows = await base.select('u.*', db.raw('(SELECT count(*) FROM stories s WHERE s.owner_id = u.id)::int AS stories'))
      .orderBy('u.created_at', 'desc').limit(PER_PAGE).offset((page - 1) * PER_PAGE);
    res.render('admin/travellers.njk', {
      section: 'travellers', rows: rows.map((u) => ({ ...u, avatar: images.avatarImage(u) })), total: Number(n), page,
      pages: Math.ceil(Number(n) / PER_PAGE), q, demo: req.query.demo || '', bookings: req.query.bookings || '',
      query: new URLSearchParams({ q, demo: req.query.demo || '', bookings: req.query.bookings || '' }).toString(),
    });
  }));

  r.get('/travellers/new', (req, res) => res.render('admin/traveller-form.njk', { section: 'travellers', traveller: {}, isNew: true }));

  r.get('/travellers/:id', asyncRoute(async (req, res, next) => {
    if (!isObjectId(req.params.id)) return next();
    const traveller = await db('users').where({ id: req.params.id }).first();
    if (!traveller) return next();
    const [services, slots, bookings] = await Promise.all([
      bookingService.servicesFor(traveller.id, { activeOnly: false }),
      db('slots as sl').leftJoin('bookings as b', function onJoin() { this.on('b.slot_id', 'sl.id').andOnVal('b.status', '<>', 'cancelled'); })
        .where('sl.user_id', traveller.id).andWhere('sl.starts_at', '>', db.fn.now()).orderBy('sl.starts_at').limit(200)
        .select('sl.id', 'sl.starts_at', 'sl.duration_min', 'b.id as booking_id', 'b.name as booked_by', 'b.status as booking_status'),
      bookingService.listBookings({ travellerId: traveller.id, perPage: 10 }),
    ]);
    res.render('admin/traveller-form.njk', {
      section: 'travellers', traveller, avatar: images.avatarImage(traveller), services, isNew: false,
      slots: slots.map((s) => ({ ...s, ...bookingService.kyivParts(new Date(s.starts_at)) })), bookings: bookings.rows,
    });
  }));

  const saveTraveller = asyncRoute(async (req, res) => {
    const isNew = !req.params.id;
    const parsed = schemas.adminTraveller.safeParse({ ...req.body, accepts_bookings: req.body.accepts_bookings === 'on', is_demo: req.body.is_demo === 'on' });
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте поля форми', errors: schemas.fieldErrors(parsed.error) });
    const v = parsed.data;
    const id = isNew ? objectId() : req.params.id;
    const existing = isNew ? null : await db('users').where({ id }).first();
    if (!isNew && !existing) return res.status(404).json({ ok: false, message: 'Not found' });
    const row = { ...v, name_en: v.name_en || null, description_en: v.description_en || null, description_es: v.description_es || null, booking_intro: v.booking_intro || null, updated_at: db.fn.now() };
    if (req.file) {
      try { await images.assertImage(req.file.buffer, 5 * 1024 * 1024); } catch (e) { return res.status(400).json({ ok: false, message: e.message, errors: { avatar: { key: 'validation.invalid' } } }); }
      row.avatar_key = await images.processAvatar(req.file.buffer, id);
      row.avatar_url = null;
      if (existing && existing.avatar_key) images.removeKey(existing.avatar_key);
    }
    if (isNew) await db('users').insert({ id, ...row, source: 'local' }); else await db('users').where({ id }).update(row);
    res.json({ ok: true, id, redirect: `/admin/travellers/${id}`, message: isNew ? 'Мандрівника створено' : 'Зміни збережено' });
  });
  r.post('/travellers', upload.single('avatar'), saveTraveller);
  r.post('/travellers/:id', upload.single('avatar'), saveTraveller);

  r.post('/travellers/:id/delete', asyncRoute(async (req, res) => {
    const u = await db('users').where({ id: req.params.id }).first();
    if (!u) return res.status(404).json({ ok: false, message: 'Not found' });
    const [{ n }] = await db('stories').where({ owner_id: u.id }).count({ n: '*' });
    if (Number(n) > 0) return res.status(409).json({ ok: false, message: `Неможливо видалити: у мандрівника ${n} історій. Спочатку видаліть або передайте їх іншому автору.` });
    await db('users').where({ id: u.id }).del();
    images.removeKey(u.avatar_key);
    res.json({ ok: true, redirect: '/admin/travellers', message: 'Мандрівника видалено' });
  }));

  r.post('/travellers/:id/services', asyncRoute(async (req, res) => {
    const parsed = schemas.adminService.safeParse({ ...req.body, active: req.body.active === 'on' || req.body.active === true || req.body.active === undefined });
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте поля послуги', errors: schemas.fieldErrors(parsed.error) });
    const v = parsed.data;
    if (req.body.serviceId) await db('services').where({ id: Number(req.body.serviceId), user_id: req.params.id }).update({ ...v, updated_at: db.fn.now() });
    else await db('services').insert({ ...v, user_id: req.params.id });
    res.json({ ok: true, reload: true, message: 'Послугу збережено' });
  }));

  r.post('/services/:id/delete', asyncRoute(async (req, res) => {
    const live = await db('bookings').where({ service_id: req.params.id }).whereNot('status', 'cancelled').first();
    if (live) return res.status(409).json({ ok: false, message: 'Послуга має активні бронювання — вимкніть її замість видалення' });
    await db('services').where({ id: req.params.id }).del();
    res.json({ ok: true, reload: true, message: 'Послугу видалено' });
  }));

  r.post('/travellers/:id/slots', asyncRoute(async (req, res) => {
    const parsed = schemas.adminSlots.safeParse({ ...req.body, weekdays: toArray(req.body.weekdays), times: String(req.body.times || '').split(/[\s,;]+/).filter(Boolean) });
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте розклад: дати, дні тижня та час (ГГ:ХХ)', errors: schemas.fieldErrors(parsed.error) });
    if (parsed.data.from > parsed.data.to) return res.status(400).json({ ok: false, message: 'Дата «з» пізніше дати «по»' });
    const n = await bookingService.generateSlots(req.params.id, parsed.data);
    res.json({ ok: true, reload: true, message: `Додано слотів: ${n}` });
  }));

  r.post('/slots/:id/delete', asyncRoute(async (req, res) => {
    const live = await db('bookings').where({ slot_id: req.params.id }).whereNot('status', 'cancelled').first();
    if (live) return res.status(409).json({ ok: false, message: 'Слот заброньовано — спочатку скасуйте бронювання' });
    await db('slots').where({ id: req.params.id }).del();
    res.json({ ok: true, reload: true, message: 'Слот видалено' });
  }));

  // ================= Dictionaries =================
  r.get('/dictionaries', asyncRoute(async (req, res) => {
    const d = await content.dicts();
    const [catUse, countryUse, tagUse] = await Promise.all([
      db('stories').select('category_id').count({ n: '*' }).groupBy('category_id'),
      db('stories').select('country_code').count({ n: '*' }).groupBy('country_code'),
      db.raw('SELECT v AS slug, count(*)::int AS n FROM stories, unnest(tags) v GROUP BY v'),
    ]);
    const use = (rows, key) => Object.fromEntries(rows.map((x) => [x[key], Number(x.n)]));
    res.render('admin/dictionaries.njk', {
      section: 'dictionaries', categories: d.categories, countries: d.countries, facets: d.facets,
      catUse: use(catUse, 'category_id'), countryUse: use(countryUse, 'country_code'), tagUse: use(tagUse.rows, 'slug'),
    });
  }));

  r.post('/categories', asyncRoute(async (req, res) => {
    const parsed = schemas.adminCategory.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте назву категорії', errors: schemas.fieldErrors(parsed.error) });
    const v = parsed.data;
    try {
      if (req.body.id) await db('categories').where({ id: req.body.id }).update({ ...v, updated_at: db.fn.now() });
      else await db('categories').insert({ id: objectId(), ...v });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ ok: false, message: 'Категорія з такою назвою вже існує' });
      throw e;
    }
    content.invalidateDicts();
    res.json({ ok: true, reload: true, message: 'Категорію збережено' });
  }));

  r.post('/categories/:id/delete', asyncRoute(async (req, res) => {
    const [{ n }] = await db('stories').where({ category_id: req.params.id }).count({ n: '*' });
    if (Number(n) > 0) return res.status(409).json({ ok: false, message: `Категорія використовується в ${n} історіях — видалення заборонено. Перенесіть історії в іншу категорію.` });
    await db('categories').where({ id: req.params.id }).del();
    content.invalidateDicts();
    res.json({ ok: true, reload: true, message: 'Категорію видалено' });
  }));

  r.post('/countries', asyncRoute(async (req, res) => {
    const parsed = schemas.adminCountry.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте код і назви країни', errors: schemas.fieldErrors(parsed.error) });
    await db('countries').insert(parsed.data).onConflict('code').merge();
    content.invalidateDicts();
    nlsearch.invalidate();
    res.json({ ok: true, reload: true, message: 'Країну збережено' });
  }));

  r.post('/countries/:code/delete', asyncRoute(async (req, res) => {
    const [{ n }] = await db('stories').where({ country_code: req.params.code }).count({ n: '*' });
    if (Number(n) > 0) return res.status(409).json({ ok: false, message: `Країна використовується в ${n} історіях — видалення заборонено.` });
    await db('countries').where({ code: req.params.code }).del();
    content.invalidateDicts();
    nlsearch.invalidate();
    res.json({ ok: true, reload: true, message: 'Країну видалено' });
  }));

  r.post('/facets', asyncRoute(async (req, res) => {
    const parsed = schemas.adminFacetValue.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, message: 'Перевірте поля значення', errors: schemas.fieldErrors(parsed.error) });
    const v = parsed.data;
    const existing = await db('facet_values').where({ facet: v.facet, slug: v.slug }).first();
    if (existing) await db('facet_values').where({ id: existing.id }).update({ label_uk: v.label_uk, label_en: v.label_en, label_es: v.label_es, sort: v.sort });
    else if (v.facet !== 'tags') return res.status(400).json({ ok: false, message: 'Нові значення можна додавати лише до тегів: сезон, бюджет, тип і тривалість — фіксовані' });
    else await db('facet_values').insert(v);
    content.invalidateDicts();
    res.json({ ok: true, reload: true, message: 'Значення збережено' });
  }));

  r.post('/facets/:id/delete', asyncRoute(async (req, res) => {
    const v = await db('facet_values').where({ id: req.params.id }).first();
    if (!v) return res.status(404).json({ ok: false, message: 'Not found' });
    if (v.locked) return res.status(409).json({ ok: false, message: 'Це системне значення фільтра — його можна перейменувати, але не видалити' });
    const { rows } = await db.raw('SELECT count(*)::int AS n FROM stories WHERE ? = ANY(tags)', [v.slug]);
    if (rows[0].n > 0) return res.status(409).json({ ok: false, message: `Тег використовується в ${rows[0].n} історіях — видалення заборонено.` });
    await db('facet_values').where({ id: v.id }).del();
    content.invalidateDicts();
    res.json({ ok: true, reload: true, message: 'Тег видалено' });
  }));
}

module.exports = { register };
