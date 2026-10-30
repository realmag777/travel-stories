// Loaders used by tools/bootstrap.js: dictionaries, the original snapshot, generated demo
// content and demo booking setup. Every loader is idempotent (upserts by id).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/core/db');
const images = require('../src/core/images');
const { seedId } = require('../src/core/ids');
const dict = require('../src/shared/dictionaries');
const { kyivToUtc } = require('../src/project/services/booking');
const { slugify } = require('../src/shared/slug');

const SEEDS = path.join(__dirname, '..', 'seeds');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (s) => parseInt(crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 8), 16);


async function seedDictionaries() {
  await db('categories').insert(dict.CATEGORIES.map((c, i) => ({ id: c._id, name: c.name, name_en: c.en, name_es: c.es, sort: i })))
    .onConflict('id').merge(['name_en', 'name_es']);
  const fv = [];
  const push = (facet, slug, l, sort) => fv.push({ facet, slug, label_uk: l.uk, label_en: l.en, label_es: l.es, sort, locked: facet !== 'tags' });
  dict.SEASONS.forEach((s, i) => push('season', s, dict.SEASON_LABELS[s], i));
  dict.BUDGETS.forEach((s, i) => push('budget', s, dict.BUDGET_LABELS[s], i));
  dict.TRIP_TYPES.forEach((s, i) => push('trip', s, dict.TRIP_TYPE_LABELS[s], i));
  dict.DURATIONS.forEach((d, i) => push('days', d.slug, d, i));
  dict.TAGS.forEach((t, i) => push('tags', t.slug, t, i));
  await db('facet_values').insert(fv).onConflict(['facet', 'slug']).ignore();
}

/** Heuristic moderation for the imported test records of the original (e.g. "ТТТТТТ", "ND_TEST_..."). */
function looksLikeTestStory(s) {
  const title = String(s.title || '');
  const article = String(s.article || '');
  if (article.trim().length < 60) return true;
  if (/test|тест|lorem|asdf|qwer/i.test(title)) return true;
  if (/(.)\1{7,}/u.test(title) || /(.)\1{15,}/u.test(article)) return true;
  if (!s.category) return true;
  return false;
}

/**
 * Moderation pass over imported original records: hides test stories and repeated copies of
 * the same story by the same author (the earliest copy stays), then hides accounts that end up
 * with nothing public and no description. Re-runnable.
 */
async function moderateOriginal() {
  const rows = await db('stories').where({ source: 'original' }).orderBy('created_at').select('id', 'title', 'article', 'category_id', 'owner_id');
  const seen = new Set();
  const hide = [];
  const show = [];
  for (const r of rows) {
    const key = r.owner_id + '|' + String(r.title).toLowerCase().replace(/[^\p{L}]+/gu, '').replace(/^м?андрівк/u, 'андрівк');
    const bad = looksLikeTestStory({ title: r.title, article: r.article, category: r.category_id }) || seen.has(key);
    seen.add(key);
    (bad ? hide : show).push(r.id);
  }
  if (hide.length) await db('stories').whereIn('id', hide).update({ hidden: true });
  if (show.length) await db('stories').whereIn('id', show).update({ hidden: false });
  await db.raw(`UPDATE users u SET hidden = (position('@' in u.name) > 0) OR (
      NOT EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = u.id AND NOT s.hidden) AND coalesce(trim(u.description), '') = '')
    WHERE u.source = 'original'`);
  return { hidden: hide.length, visible: show.length };
}

async function storeImage(file, kind, id) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    return kind === 'avatar' ? await images.processAvatar(buf, id) : await images.processCover(buf, id);
  } catch (e) {
    console.warn(`[seed] image failed ${file}: ${e.message}`);
    return null;
  }
}

async function loadOriginal() {
  const dir = path.join(SEEDS, 'original');
  if (!fs.existsSync(path.join(dir, 'stories.json'))) {
    console.warn('[seed] no original snapshot, skipping');
    return { stories: 0, users: 0 };
  }
  const cats = readJson(path.join(dir, 'categories.json'));
  // Unknown categories (if the original adds some) are created with their original ids.
  for (const c of cats) {
    await db('categories').insert({ id: c._id, name: c.name, sort: 50 }).onConflict('id').ignore();
  }
  const stories = readJson(path.join(dir, 'stories.json'));
  const users = readJson(path.join(dir, 'users.json'));
  const storyCount = {};
  const visibleCount = {};
  for (const s of stories) {
    const owner = typeof s.ownerId === 'object' ? s.ownerId?._id : s.ownerId;
    storyCount[owner] = (storyCount[owner] || 0) + 1;
    if (!looksLikeTestStory(s)) visibleCount[owner] = (visibleCount[owner] || 0) + 1;
  }
  for (const u of users) {
    const avatarKey = u.localAvatar ? await storeImage(path.join(dir, 'media', 'avatars', u.localAvatar), 'avatar', u._id) : null;
    const name = String(u.name || 'Мандрівник').slice(0, 32);
    // Accounts that only hold test stories or carry an e-mail as a name stay out of public lists.
    const hidden = name.includes('@') || (!visibleCount[u._id] && !(u.description || '').trim());
    await db('users').insert({
      id: u._id, name, avatar_url: avatarKey ? null : (u.avatarUrl && !/default-avatar/.test(u.avatarUrl) ? u.avatarUrl : null),
      avatar_key: avatarKey, description: u.description || '', source: 'original', hidden,
    }).onConflict('id').merge(['name', 'description', 'avatar_key', 'hidden']);
  }
  let n = 0;
  for (const s of stories) {
    const owner = typeof s.ownerId === 'object' ? s.ownerId?._id : s.ownerId;
    if (!owner) continue;
    const coverKey = s.localImg ? await storeImage(path.join(dir, 'media', 'covers', s.localImg), 'cover', s._id) : null;
    await db('stories').insert({
      id: s._id,
      img: coverKey ? null : s.img,
      cover_key: coverKey,
      title: String(s.title).slice(0, 80),
      article: String(s.article).slice(0, 2500),
      category_id: s.category && typeof s.category === 'object' ? s.category._id : s.category || null,
      owner_id: owner,
      date: s.date || String(s.createdAt || new Date().toISOString()).slice(0, 10),
      favorite_count: s.favoriteCount || 0,
      created_at: s.createdAt || s.date,
      updated_at: s.updatedAt || s.createdAt || s.date,
      source: 'original',
      hidden: looksLikeTestStory(s),
    }).onConflict('id').merge(['title', 'article', 'favorite_count', 'cover_key', 'hidden']);
    n++;
  }
  return { stories: n, users: users.length };
}

function demoBatches() {
  const dir = path.join(SEEDS, 'data');
  return fs.readdirSync(dir).filter((f) => /^batch-.*\.json$/.test(f)).sort().map((f) => readJson(path.join(dir, f)));
}

async function loadDemo({ now = new Date() } = {}) {
  const batches = demoBatches();
  const travellers = batches.flatMap((b) => b.travellers || []);
  const stories = batches.flatMap((b) => b.stories || []);
  const credits = fs.existsSync(path.join(SEEDS, 'media', 'credits.json')) ? readJson(path.join(SEEDS, 'media', 'credits.json')) : {};
  const day = 86400000;

  // Countries dictionary from the content.
  const countries = new Map();
  for (const s of stories) countries.set(s.country.code, { code: s.country.code, name_uk: s.country.uk, name_en: s.country.en, name_es: s.country.es });
  await db('countries').insert([...countries.values()]).onConflict('code').merge();

  const tIds = {};
  for (const t of travellers) {
    // Travellers "joined" 13–18 months ago; ids carry that timestamp like real ObjectIds.
    const joined = new Date(now.getTime() - (395 + (hash(t.key) % 150)) * day);
    const id = seedId(t.key, joined);
    tIds[t.key] = id;
    const avatarKey = await storeImage(path.join(SEEDS, 'media', 'avatars', `${t.key}.jpg`), 'avatar', id);
    await db('users').insert({
      id, name: t.name.uk.slice(0, 32), name_en: t.name.en, description: t.description.uk, description_en: t.description.en,
      avatar_key: avatarKey, is_demo: true, source: 'demo', created_at: joined, updated_at: joined,
    }).onConflict('id').merge(['name', 'name_en', 'description', 'description_en', 'avatar_key']);
  }

  const catByName = Object.fromEntries(dict.CATEGORIES.map((c) => [c.name, c._id]));
  let n = 0;
  for (const s of stories) {
    // Publication dates spread over the last 12 months; popularity skewed so a few stories stand out.
    const h = hash(s.key);
    const published = new Date(now.getTime() - (2 + (h % 360)) * day - (h % 86400) * 1000);
    const id = seedId(s.key, published);
    const r = (h % 1000) / 1000;
    const favorites = Math.round(r < 0.08 ? 40 + (h % 45) : r < 0.35 ? 12 + (h % 25) : h % 14);
    const coverKey = await storeImage(path.join(SEEDS, 'media', 'covers', `${s.key}.jpg`), 'cover', id);
    const c = credits[s.key];
    await db('stories').insert({
      id,
      title: s.title.uk.slice(0, 80), article: s.article.uk.slice(0, 2500),
      title_en: s.title.en.slice(0, 120), article_en: s.article.en,
      category_id: catByName[s.category], owner_id: tIds[s.travellerKey],
      date: published.toISOString().slice(0, 10), favorite_count: favorites,
      country_code: s.country.code, region: s.region.uk.slice(0, 80), region_en: s.region.en.slice(0, 80), region_es: s.region.es.slice(0, 80),
      region_slug: slugify(s.region.en) || null,
      seasons: s.seasons, budget: s.budget, duration_days: s.durationDays, trip_type: s.tripType, tags: s.tags,
      lat: s.lat, lng: s.lng, cover_key: coverKey,
      cover_author: c ? c.author : null, cover_license: c ? c.license : null, cover_license_url: c ? c.licenseUrl : null, cover_source_url: c ? c.sourceUrl : null,
      views: 20 + (h % 900), is_demo: true, source: 'demo', created_at: published, updated_at: published,
    }).onConflict('id').merge(['title', 'article', 'title_en', 'article_en', 'cover_key', 'cover_author', 'cover_license', 'cover_license_url', 'cover_source_url']);
    n++;
  }
  return { travellers: travellers.length, stories: n, tIds };
}

/** Booking demo: every 5th demo traveller is a guide with two services and slots for 6 weeks. */
async function loadBookingDemo(tIds, { now = new Date() } = {}) {
  const keys = Object.keys(tIds).filter((k, i) => i % 5 === 0);
  let slots = 0;
  for (const key of keys) {
    const userId = tIds[key];
    await db('users').where({ id: userId }).update({ accepts_bookings: true });
    const existing = await db('services').where({ user_id: userId }).first();
    if (!existing) {
      const h = hash(key);
      await db('services').insert([
        { user_id: userId, kind: 'call', title: 'Консультація-созвон: маршрут під вас', title_en: 'Video call: a route made for you', title_es: 'Videollamada: una ruta a tu medida', description: 'Відповім на питання і складу план поїздки', duration_min: 45, price_label: `€${20 + (h % 4) * 5}`, sort: 0 },
        { user_id: userId, kind: 'tour', title: 'Екскурсія з автором історій', title_en: 'Guided walk with the author', title_es: 'Paseo guiado con el autor', description: 'Прогулянка місцями з моїх історій', duration_min: 180, price_label: `€${45 + (h % 5) * 10}`, sort: 1 },
      ]);
    }
    const from = new Date(now.getTime() + 86400000);
    const rows = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(from.getTime() + i * 86400000);
      const dow = d.getUTCDay();
      if (dow === 0) continue;
      const ymd = d.toISOString().slice(0, 10);
      for (const tm of dow === 6 ? ['11:00'] : ['10:00', '14:00', '18:30']) rows.push({ user_id: userId, starts_at: kyivToUtc(ymd, tm), duration_min: 60 });
    }
    const ins = await db('slots').insert(rows).onConflict(['user_id', 'starts_at']).ignore().returning('id');
    slots += ins.length;
  }
  // A few demo bookings so the admin has something to confirm.
  const [svc] = await db('services').where({ kind: 'call' }).limit(1);
  if (svc && !(await db('bookings').first())) {
    const free = await db('slots').where({ user_id: svc.user_id }).orderBy('starts_at').limit(3);
    const people = [['Олена Гребенюк', 'olena@example.com', 'Хочу маршрут на 5 днів з дитиною'], ['Marco Rossi', 'marco@example.com', 'Planning a trip in spring'], ['Ірина Савчук', 'iryna@example.com', '']];
    for (let i = 0; i < free.length; i++) {
      await db('bookings').insert({ slot_id: free[i].id, service_id: svc.id, user_id: svc.user_id, name: people[i][0], email: people[i][1], message: people[i][2], status: i === 1 ? 'confirmed' : 'new' });
    }
  }
  return { guides: keys.length, slots };
}

module.exports = { seedDictionaries, loadOriginal, moderateOriginal, loadDemo, loadBookingDemo, looksLikeTestStory, slugify };
