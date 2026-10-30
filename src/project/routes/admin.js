// Admin panel: login, dashboard with own analytics, bookings, settings, demo cleanup.
// Content CRUD lives in admin-content.js. Every /admin route needs a session; every write
// needs the CSRF token. Login is rate-limited and checks ADMIN_USER / ADMIN_PASS_HASH (bcrypt).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../core/db');
const settings = require('../../core/settings');
const images = require('../../core/images');
const { asyncRoute } = require('../../core/http');
const { csrfToken, csrfProtect, requireAdmin, limiters } = require('../../core/security');
const bookingService = require('../services/booking');
const content = require('../content');

function adminLocals(req, res, next) {
  res.locals.csrf = csrfToken(req);
  res.locals.adminUser = req.session.admin || null;
  res.locals.path = req.originalUrl.split('?')[0];
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.t = (k) => k;
  next();
}

const flash = (req, type, message) => { req.session.flash = { type, message }; };

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function dashboardData() {
  const since30 = db.raw("now() - interval '30 days'");
  const [counts, viewsDaily, topStories, newBookings, searches, filters, sources] = await Promise.all([
    db.raw(`SELECT
      (SELECT count(*) FROM stories)::int AS stories,
      (SELECT count(*) FROM stories WHERE is_demo)::int AS demo_stories,
      (SELECT count(*) FROM stories WHERE hidden)::int AS hidden_stories,
      (SELECT count(*) FROM users)::int AS travellers,
      (SELECT count(*) FROM users WHERE accepts_bookings)::int AS guides,
      (SELECT count(*) FROM bookings WHERE status = 'new')::int AS new_bookings,
      (SELECT count(*) FROM page_views WHERE created_at > now() - interval '30 days')::int AS views30,
      (SELECT count(DISTINCT visitor) FROM page_views WHERE created_at > now() - interval '30 days')::int AS visitors30,
      (SELECT coalesce(sum(favorite_count),0) FROM stories)::int AS saves`),
    db.raw(`SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(v.n, 0)::int AS views, coalesce(v.u, 0)::int AS visitors
      FROM generate_series(current_date - 29, current_date, interval '1 day') d
      LEFT JOIN (SELECT created_at::date AS day, count(*) AS n, count(DISTINCT visitor) AS u FROM page_views
                 WHERE created_at > current_date - 30 GROUP BY 1) v ON v.day = d::date ORDER BY d`),
    db.raw(`SELECT s.id, s.title, s.favorite_count, s.views,
        (SELECT count(*) FROM page_views p WHERE p.kind = 'story' AND p.entity_id = s.id AND p.created_at > now() - interval '30 days')::int AS views30
      FROM stories s WHERE NOT s.hidden ORDER BY views30 DESC, s.favorite_count DESC LIMIT 8`),
    bookingService.listBookings({ status: 'new', perPage: 6 }),
    db('search_events').where('kind', 'nl').andWhere('created_at', '>', since30).whereNotNull('query')
      .select(db.raw('lower(query) AS q'), db.raw('count(*)::int AS n'), db.raw('round(avg(results))::int AS avg_results'))
      .groupByRaw('lower(query)').orderBy('n', 'desc').limit(10),
    db.raw(`SELECT key, count(*)::int AS n FROM search_events, jsonb_each(facets)
      WHERE kind = 'filter' AND created_at > now() - interval '30 days'
        AND jsonb_typeof(value) IN ('array','string') AND value NOT IN ('[]'::jsonb, '""'::jsonb, 'null'::jsonb)
        AND key NOT IN ('sort','page','view','q')
      GROUP BY key ORDER BY n DESC LIMIT 10`),
    db('page_views').where('created_at', '>', since30).whereNotNull('referrer_host').select('referrer_host').count({ n: '*' })
      .groupBy('referrer_host').orderBy('n', 'desc').limit(6),
  ]);
  return {
    kpi: counts.rows[0],
    viewsDaily: viewsDaily.rows,
    topStories: topStories.rows,
    newBookings: newBookings.rows,
    searches,
    filters: filters.rows,
    sources,
  };
}

function register(app) {
  const r = express.Router();
  r.use(adminLocals);

  r.get('/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.render('admin/login.njk', { next: safeNext(req.query.next) });
  });

  r.post('/login', limiters.login, csrfProtect, asyncRoute(async (req, res) => {
    const { username = '', password = '' } = req.body || {};
    const userOk = timingSafeEqualStr(username, process.env.ADMIN_USER || 'admin');
    const hash = (process.env.ADMIN_PASS_HASH || '').replace(/^'|'$/g, '');
    const passOk = hash ? await bcrypt.compare(String(password), hash) : false;
    if (!userOk || !passOk) {
      res.status(401);
      return res.render('admin/login.njk', { error: 'Невірний логін або пароль', next: safeNext(req.body.next), username });
    }
    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.admin = { user: process.env.ADMIN_USER || 'admin', at: Date.now() };
      csrfToken(req);
      req.session.save(() => res.redirect(safeNext(req.body.next) || '/admin'));
    });
  }));

  r.use(requireAdmin);
  r.use(csrfProtect);

  r.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

  r.get('/', asyncRoute(async (req, res) => {
    res.render('admin/dashboard.njk', { ...(await dashboardData()), section: 'dashboard' });
  }));

  // ----- Bookings -----
  r.get('/bookings', asyncRoute(async (req, res) => {
    const status = ['new', 'confirmed', 'cancelled'].includes(req.query.status) ? req.query.status : '';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const { rows, total } = await bookingService.listBookings({ status, page, perPage: 20 });
    res.render('admin/bookings.njk', { section: 'bookings', rows, total, page, pages: Math.ceil(total / 20), status });
  }));

  r.post('/bookings/:id/status', asyncRoute(async (req, res) => {
    try {
      await bookingService.setStatus(Number(req.params.id), req.body.status);
      if (req.xhr || req.accepts(['html', 'json']) === 'json') return res.json({ ok: true });
      flash(req, 'success', `Бронювання #${req.params.id}: статус «${req.body.status}»`);
    } catch (e) {
      if (req.xhr || req.accepts(['html', 'json']) === 'json') return res.status(e.status || 500).json({ ok: false, message: e.message });
      flash(req, 'error', e.message);
    }
    res.redirect(req.get('referer') || '/admin/bookings');
  }));

  // ----- Settings -----
  r.get('/settings', asyncRoute(async (req, res) => {
    const s = await settings.all();
    const [{ n: demoStories }] = await db('stories').where({ is_demo: true }).count({ n: '*' });
    const [{ n: demoUsers }] = await db('users').where({ is_demo: true }).count({ n: '*' });
    res.render('admin/settings.njk', {
      section: 'settings', s, demoStories: Number(demoStories), demoUsers: Number(demoUsers),
      env: { llm: Boolean(process.env.LLM_PROVIDER), smtp: Boolean(process.env.SMTP_HOST) },
      mcpUrl: (process.env.PUBLIC_URL || '') + '/mcp',
    });
  }));

  r.post('/settings', asyncRoute(async (req, res) => {
    const b = req.body || {};
    const str = (v, max = 300) => String(v || '').trim().slice(0, max);
    await settings.set('affiliate', { bookingAid: str(b.bookingAid, 40), skyscannerAssociateId: str(b.skyscannerAssociateId, 80), tripadvisorPartnerId: str(b.tripadvisorPartnerId, 40) });
    const prevLlm = (await settings.get('llm')) || {};
    await settings.set('llm', {
      provider: ['', 'anthropic', 'openai-compatible'].includes(b.llmProvider) ? b.llmProvider : '',
      apiKey: b.llmApiKey ? str(b.llmApiKey, 400) : prevLlm.apiKey || '', model: str(b.llmModel, 80), baseUrl: str(b.llmBaseUrl, 200),
    });
    const prevSmtp = (await settings.get('smtp')) || {};
    await settings.set('smtp', {
      host: str(b.smtpHost, 120), port: Number(b.smtpPort) || 587, user: str(b.smtpUser, 120),
      pass: b.smtpPass ? str(b.smtpPass, 200) : prevSmtp.pass || '', from: str(b.smtpFrom, 160), notify: str(b.smtpNotify, 160),
    });
    flash(req, 'success', 'Налаштування збережено');
    res.redirect('/admin/settings');
  }));

  r.post('/demo/delete', asyncRoute(async (req, res) => {
    if (req.body.confirm !== 'DELETE') {
      flash(req, 'error', 'Введіть DELETE для підтвердження');
      return res.redirect('/admin/settings');
    }
    const covers = await db('stories').where({ is_demo: true }).pluck('cover_key');
    const avatars = await db('users').where({ is_demo: true }).pluck('avatar_key');
    const result = await db.transaction(async (trx) => {
      const stories = await trx('stories').where({ is_demo: true }).del();
      // Demo travellers go too, but a real story keeps its (demo) owner alive.
      const users = await trx('users').where({ is_demo: true }).whereNotExists(trx('stories').whereRaw('stories.owner_id = users.id')).del();
      await trx.raw(`DELETE FROM countries c WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.country_code = c.code)`);
      return { stories, users };
    });
    [...covers, ...avatars].forEach((k) => images.removeKey(k));
    content.invalidateDicts();
    require('../services/nlsearch').invalidate();
    flash(req, 'success', `Видалено демо-контент: ${result.stories} історій, ${result.users} мандрівників`);
    res.redirect('/admin/settings');
  }));

  require('./admin-content').register(r, { flash });

  app.use('/admin', r);
}

function safeNext(n) {
  return typeof n === 'string' && /^\/admin(\/|$)/.test(n) && !n.startsWith('//') ? n : '';
}

module.exports = { register };
