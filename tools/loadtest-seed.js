// Synthetic load test of the faceted filter on 10 000 stories.
// Works in a separate database (<POSTGRES_DB>_load) so the site data stays untouched:
// creates it, migrates, seeds dictionaries + 10 000 random stories, ANALYZE, then measures
// the facet counts + one result page for typical filter states (p50 / p95 / max).
// Usage: node tools/loadtest-seed.js [--stories=10000] [--runs=40] [--keep]
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const knexLib = require('knex');
const baseConfig = require('../knexfile');
const dict = require('../src/shared/dictionaries');

const N = Number((process.argv.find((a) => a.startsWith('--stories=')) || '').slice(10)) || 10000;
const RUNS = Number((process.argv.find((a) => a.startsWith('--runs=')) || '').slice(7)) || 40;
const KEEP = process.argv.includes('--keep');

function connFor(dbName) {
  const c = baseConfig.connection;
  if (typeof c === 'string') { const u = new URL(c); u.pathname = '/' + dbName; return u.toString(); }
  return { ...c, database: dbName };
}

// mulberry32: small seeded PRNG with good enough distribution for synthetic data.
const rnd = (() => { let a = 42; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const some = (a, max) => [...new Set(Array.from({ length: 1 + Math.floor(rnd() * max) }, () => pick(a)))];
const hex = (n) => require('crypto').randomBytes(n / 2).toString('hex');

async function main() {
  const mainDb = (typeof baseConfig.connection === 'string' ? new URL(baseConfig.connection).pathname.slice(1) : baseConfig.connection.database);
  const loadDb = `${mainDb}_load`;
  const admin = knexLib({ ...baseConfig, connection: connFor(mainDb) });
  await admin.raw(`DROP DATABASE IF EXISTS ${loadDb}`);
  await admin.raw(`CREATE DATABASE ${loadDb}`);
  await admin.destroy();

  const db = knexLib({ ...baseConfig, connection: connFor(loadDb) });
  await db.migrate.latest();
  await db('categories').insert(dict.CATEGORIES.map((c, i) => ({ id: c._id, name: c.name, name_en: c.en, name_es: c.es, sort: i })));
  const countries = ['UA', 'PL', 'IT', 'ES', 'FR', 'PT', 'GR', 'HR', 'ME', 'AL', 'GE', 'AM', 'TR', 'JP', 'TH', 'VN', 'ID', 'IN', 'NP', 'US', 'MX', 'PE', 'AR', 'MA', 'EG', 'KE', 'NA', 'ZA', 'AU', 'NZ'];
  await db('countries').insert(countries.map((c) => ({ code: c, name_uk: c, name_en: c, name_es: c })));
  const fv = [];
  dict.SEASONS.forEach((s) => fv.push({ facet: 'season', slug: s, label_uk: s, label_en: s, label_es: s }));
  dict.BUDGETS.forEach((s) => fv.push({ facet: 'budget', slug: s, label_uk: s, label_en: s, label_es: s }));
  dict.TRIP_TYPES.forEach((s) => fv.push({ facet: 'trip', slug: s, label_uk: s, label_en: s, label_es: s }));
  dict.DURATIONS.forEach((d) => fv.push({ facet: 'days', slug: d.slug, label_uk: d.uk, label_en: d.en, label_es: d.es }));
  dict.TAGS.forEach((t) => fv.push({ facet: 'tags', slug: t.slug, label_uk: t.uk, label_en: t.en, label_es: t.es }));
  await db('facet_values').insert(fv);
  const users = Array.from({ length: 500 }, (_, i) => ({ id: hex(24), name: `User ${i}`, description: 'Synthetic user' }));
  await db.batchInsert('users', users, 500);

  const t0 = Date.now();
  const rows = [];
  for (let i = 0; i < N; i++) {
    const d = new Date(Date.now() - Math.floor(rnd() * 365) * 86400000);
    rows.push({
      id: hex(24), title: `Synthetic story ${i}`, article: 'Lorem ipsum dolor sit amet, travel story text. '.repeat(20),
      title_en: `Synthetic story ${i}`, category_id: pick(dict.CATEGORIES)._id, owner_id: pick(users).id,
      date: d.toISOString().slice(0, 10), favorite_count: Math.floor(rnd() * 80), country_code: pick(countries),
      region: `Region ${i % 300}`, region_en: `Region ${i % 300}`, region_slug: `region-${i % 300}`,
      seasons: some(dict.SEASONS, 2), budget: pick(dict.BUDGETS), duration_days: 1 + Math.floor(rnd() * 25),
      trip_type: pick(dict.TRIP_TYPES), tags: some(dict.TAGS.map((t) => t.slug), 4),
      lat: -50 + rnd() * 110, lng: -170 + rnd() * 340, is_demo: true, source: 'loadtest',
    });
  }
  await db.batchInsert('stories', rows, 1000);
  await db.raw('ANALYZE');
  const seedMs = Date.now() - t0;

  await db.destroy();
  // Point the shared knex instance (and so the facet service) at the load database.
  const mainConnection = baseConfig.connection;
  baseConfig.connection = connFor(loadDb);
  const coreDb = require('../src/core/db');
  baseConfig.connection = mainConnection;
  const facets = require('../src/project/services/facets');
  const fsState = require('../src/shared/filter-state');

  const STATES = {
    'no filter': fsState.parse([], {}),
    '1 facet (season)': fsState.parse(['season-spring'], {}),
    '3 facets': fsState.parse(['season-summer', 'budget-low,medium', 'trip-family'], {}),
    '5 facets + category': fsState.parse(['country-it,es,pt,fr,gr', 'season-summer,autumn', 'budget-low,medium', 'days-4-7,8-14', 'tags-food,beach,history,culture'], { category: dict.CATEGORIES[2]._id }),
    'bbox (Europe)': fsState.parse(['tags-history'], { bbox: '35,-10,60,30' }),
    'sort popular': fsState.parse(['trip-friends'], { sort: 'popular' }),
  };
  const report = { stories: N, runs: RUNS, seedMs, cases: {} };
  for (const [name, s] of Object.entries(STATES)) {
    const times = [];
    for (let i = 0; i < RUNS; i++) {
      const a = process.hrtime.bigint();
      await Promise.all([facets.counts(s), facets.list(s, { perPage: 9 })]);
      times.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    times.sort((x, y) => x - y);
    const c = await facets.counts(s);
    report.cases[name] = { total: c.total, p50: +times[Math.floor(RUNS * 0.5)].toFixed(1), p95: +times[Math.floor(RUNS * 0.95)].toFixed(1), max: +times[RUNS - 1].toFixed(1) };
    console.log(`${name.padEnd(22)} total=${String(c.total).padStart(5)}  p50=${report.cases[name].p50}ms  p95=${report.cases[name].p95}ms  max=${report.cases[name].max}ms`);
  }
  const explain = await coreDb.raw(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT count(*) FROM stories s WHERE NOT s.hidden AND s.seasons && ARRAY['summer'] AND s.budget = ANY(ARRAY['low','medium']) AND s.trip_type = 'family'`);
  report.explainSample = explain.rows.map((r) => r['QUERY PLAN']);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'loadtest.json'), JSON.stringify(report, null, 1));
  await coreDb.destroy();
  if (!KEEP) {
    const admin2 = knexLib({ ...baseConfig, connection: connFor(mainDb) });
    await admin2.raw(`DROP DATABASE IF EXISTS ${loadDb}`);
    await admin2.destroy();
  }
  console.log(`seeded ${N} stories in ${seedMs} ms; report -> docs/loadtest.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
