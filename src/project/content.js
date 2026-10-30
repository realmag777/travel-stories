// Content access: story and traveller queries, localization of content fields and
// serializers for templates and for the original API contract.
const db = require('../core/db');
const { coverImage, avatarImage } = require('../core/images');
const { DEFAULT_LOCALE } = require('../core/i18n');

// ---- Dictionaries cache (categories, countries, facet labels) ----
let dictCache = null;
let dictAt = 0;

async function dicts() {
  if (dictCache && Date.now() - dictAt < 60_000) return dictCache;
  const [categories, countries, facetValues] = await Promise.all([
    db('categories').orderBy([{ column: 'sort' }, { column: 'name' }]),
    db('countries').orderBy('name_uk'),
    db('facet_values').orderBy([{ column: 'facet' }, { column: 'sort' }, { column: 'slug' }]),
  ]);
  const byFacet = {};
  for (const v of facetValues) (byFacet[v.facet] = byFacet[v.facet] || []).push(v);
  dictCache = {
    categories,
    categoryById: Object.fromEntries(categories.map((c) => [c.id, c])),
    countries,
    countryByCode: Object.fromEntries(countries.map((c) => [c.code, c])),
    facets: byFacet,
  };
  dictAt = Date.now();
  return dictCache;
}
const invalidateDicts = () => { dictCache = null; };

const pick = (row, field, locale) => (locale === DEFAULT_LOCALE ? row[field] : row[`${field}_${locale}`] || row[field]);

function categoryName(cat, locale) {
  if (!cat) return null;
  return locale === DEFAULT_LOCALE ? cat.name : cat[`name_${locale}`] || cat.name;
}
const countryName = (c, locale) => (c ? c[`name_${locale}`] || c.name_uk : null);
const facetLabel = (v, locale) => (v ? v[`label_${locale}`] || v.label_uk : '');

/** Story text in the requested locale; `fallback` tells the template to show the "not translated" note. */
function localizeStory(row, locale) {
  if (locale === DEFAULT_LOCALE) return { title: row.title, article: row.article, fallback: false };
  const title = row[`title_${locale}`];
  const article = row[`article_${locale}`];
  if (title && article) return { title, article, fallback: false };
  return { title: row.title, article: row.article, fallback: true };
}

function localizeUser(row, locale) {
  const name = locale === DEFAULT_LOCALE ? row.owner_name || row.name : (row.owner_name_en || row.name_en) || row.owner_name || row.name;
  return name;
}

const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

// ---- Story queries ----
const STORY_COLUMNS = [
  's.id', 's.img', 's.cover_key', 's.title', 's.article', 's.title_en', 's.article_en', 's.title_es', 's.article_es',
  's.category_id', 's.owner_id', 's.date', 's.favorite_count', 's.created_at', 's.updated_at',
  's.country_code', 's.region', 's.region_en', 's.region_es', 's.region_slug', 's.seasons', 's.budget', 's.duration_days',
  's.trip_type', 's.tags', 's.lat', 's.lng', 's.is_demo', 's.views',
  's.hidden', 's.cover_author', 's.cover_license', 's.cover_license_url', 's.cover_source_url',
  'u.name as owner_name', 'u.name_en as owner_name_en', 'u.avatar_url as owner_avatar_url', 'u.avatar_key as owner_avatar_key',
];

const storyBase = () => db('stories as s').join('users as u', 'u.id', 's.owner_id').select(STORY_COLUMNS);

async function getStory(id) {
  return storyBase().where('s.id', id).first();
}

/** Card view-model for templates. */
function storyCard(row, d, locale) {
  const loc = localizeStory(row, locale);
  const cat = d.categoryById[row.category_id];
  return {
    id: row.id,
    title: loc.title,
    excerpt: loc.article.slice(0, 300),
    fallback: loc.fallback,
    category: categoryName(cat, locale),
    categoryId: row.category_id,
    cover: coverImage(row),
    owner: {
      id: row.owner_id,
      name: localizeUser(row, locale),
      avatar: avatarImage({ avatar_key: row.owner_avatar_key, avatar_url: row.owner_avatar_url }),
    },
    date: row.date,
    dateLabel: formatDate(row.date),
    favoriteCount: row.favorite_count,
    lat: row.lat,
    lng: row.lng,
  };
}

function travellerCard(row, locale) {
  const description = locale === DEFAULT_LOCALE ? row.description : row[`description_${locale}`] || row.description;
  return {
    id: row.id,
    name: locale === DEFAULT_LOCALE ? row.name : row.name_en || row.name,
    description: description || '',
    avatar: avatarImage(row),
    articlesAmount: row.articles_amount !== undefined ? Number(row.articles_amount) : undefined,
    acceptsBookings: row.accepts_bookings,
  };
}

// ---- Original API serializers ----
function absolute(base, url) {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : base + url;
}

function apiStory(row, base, { populate = true, d } = {}) {
  const cover = coverImage(row);
  const cat = d && d.categoryById[row.category_id];
  const avatar = avatarImage({ avatar_key: row.owner_avatar_key, avatar_url: row.owner_avatar_url });
  return {
    _id: row.id,
    img: absolute(base, cover.local ? cover.large : cover.src),
    title: row.title,
    article: row.article,
    category: populate ? (cat ? { _id: cat.id, name: cat.name } : null) : row.category_id,
    ownerId: populate
      ? { _id: row.owner_id, name: row.owner_name, avatarUrl: avatar.placeholder ? null : absolute(base, avatar.large) }
      : row.owner_id,
    date: row.date,
    favoriteCount: row.favorite_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function apiUser(row, base) {
  const avatar = avatarImage(row);
  return {
    _id: row.id,
    name: row.name,
    avatarUrl: avatar.placeholder ? null : absolute(base, avatar.large),
    articlesAmount: Number(row.articles_amount || 0),
    description: row.description || '',
  };
}

const usersWithCounts = () => db('users as u')
  .select('u.*', db.raw('(SELECT count(*) FROM stories s WHERE s.owner_id = u.id)::int AS articles_amount'));

module.exports = {
  dicts, invalidateDicts, pick, categoryName, countryName, facetLabel, localizeStory, localizeUser, formatDate,
  storyBase, getStory, storyCard, travellerCard, apiStory, apiUser, usersWithCounts, absolute,
};
