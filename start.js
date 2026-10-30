// Podorozhnyky+ — application entry point.
// Core (engine) and project parts are kept apart the way reference-engine does it:
//   src/core     — reusable infrastructure: db, i18n, views, images, security, stats, mail, llm
//   src/project  — this site: content, facets, search, booking, routes, admin, MCP
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);

const db = require('./src/core/db');
const views = require('./src/core/views');
const stats = require('./src/core/stats');
const { UPLOADS } = require('./src/core/images');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');
views.setup(app);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(compression());

// ─── Static files ─────────────────────────────────────────────────────────────
app.use('/build', express.static(path.join(__dirname, 'public', 'build'), { maxAge: isProd ? '1y' : 0, immutable: isProd }));
app.use('/uploads', express.static(UPLOADS, { maxAge: '30d', fallthrough: false }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

app.get('/healthz', async (req, res) => {
  try {
    await db.raw('select 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Sessions (admin only; public pages stay cookie-free) ─────────────────────
const sessionMw = session({
  store: new PgStore({ conString: connString(), tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 3600 }),
  name: 'pp.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 60 * 60 * 1000 },
});
app.use('/admin', sessionMw);
app.use('/api/admin', sessionMw);

function connString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const e = process.env;
  return `postgres://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@${e.PGHOST || '127.0.0.1'}:${e.PGPORT || e.POSTGRES_HOST_PORT || 5440}/${e.POSTGRES_DB}`;
}

// ─── API and docs (before page routes) ────────────────────────────────────────
require('./src/project/routes/docs').register(app);
require('./src/project/mcp').register(app);
require('./src/project/routes/admin').register(app);
require('./src/project/routes/api-v2').register(app);
require('./src/project/routes/api-v1').register(app);
require('./src/project/routes/seo').register(app);

// ─── Public pages for every locale ────────────────────────────────────────────
require('./src/project/routes/pages').register(app);

// ─── 404 and 500 ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('pages/error.njk', {
    code: 404,
    seo: { ...res.locals.seo, title: `${res.locals.t('errors.404Title')} — ${res.locals.t('site.name')}`, description: res.locals.t('errors.404Text'), noindex: true },
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err.stack || err);
  if (res.headersSent) return;
  const status = err.status && err.status < 500 ? err.status : 500;
  if (req.originalUrl.startsWith('/api') || req.get('x-partial')) {
    return res.status(status).json({ status, message: status === 500 ? 'Internal server error' : err.message });
  }
  const t = res.locals.t || ((k) => k);
  res.status(status).render('pages/error.njk', {
    code: status === 404 ? 404 : 500,
    seo: { title: t('errors.500Title'), description: t('errors.500Text'), alternates: [], jsonld: [], noindex: true },
  });
});

const server = app.listen(PORT, () => console.log(`[podorozhnyky+] listening on :${PORT}`));

async function shutdown() {
  server.close();
  await stats.flush();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
