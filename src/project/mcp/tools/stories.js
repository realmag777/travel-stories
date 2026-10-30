// MCP tools: search and CRUD for stories (+ translation).
const db = require('../../../core/db');
const { objectId, isObjectId } = require('../../../core/ids');
const schemas = require('../../../shared/schemas');
const filterState = require('../../../shared/filter-state');
const facets = require('../../services/facets');
const nlsearch = require('../../services/nlsearch');
const translate = require('../../services/translate');
const content = require('../../content');
const { slugify } = require('../../../shared/slug');

const FIELDS = ['title', 'article', 'title_en', 'article_en', 'title_es', 'article_es', 'category_id', 'owner_id', 'date', 'country_code',
  'region', 'region_en', 'region_es', 'seasons', 'budget', 'duration_days', 'trip_type', 'tags', 'lat', 'lng', 'favorite_count',
  'cover_author', 'cover_license', 'cover_license_url', 'cover_source_url', 'is_demo'];

const storyProps = {
  title: { type: 'string', maxLength: 80 }, article: { type: 'string', maxLength: 2500 },
  title_en: { type: 'string' }, article_en: { type: 'string' }, title_es: { type: 'string' }, article_es: { type: 'string' },
  category_id: { type: 'string', description: '24-hex category id (see categories_list)' }, owner_id: { type: 'string', description: '24-hex traveller id' },
  date: { type: 'string', description: 'YYYY-MM-DD' }, country_code: { type: 'string', description: 'ISO alpha-2, must exist in the countries dictionary' },
  region: { type: 'string' }, region_en: { type: 'string' }, region_es: { type: 'string' },
  seasons: { type: 'array', items: { type: 'string', enum: ['spring', 'summer', 'autumn', 'winter'] } },
  budget: { type: 'string', enum: ['low', 'medium', 'high'] }, duration_days: { type: 'integer' },
  trip_type: { type: 'string', enum: ['solo', 'couple', 'family', 'friends'] }, tags: { type: 'array', items: { type: 'string' } },
  lat: { type: 'number' }, lng: { type: 'number' }, favorite_count: { type: 'integer' }, is_demo: { type: 'boolean' },
  cover_author: { type: 'string' }, cover_license: { type: 'string' }, cover_license_url: { type: 'string' }, cover_source_url: { type: 'string' },
};

function toRow(v) {
  return {
    ...v,
    title_en: v.title_en || null, article_en: v.article_en || null, title_es: v.title_es || null, article_es: v.article_es || null,
    country_code: v.country_code || null, region: v.region || null, region_en: v.region_en || null, region_es: v.region_es || null,
    region_slug: slugify(v.region_en || v.region) || null, budget: v.budget || null, trip_type: v.trip_type || null,
    duration_days: v.duration_days === '' ? null : v.duration_days, lat: v.lat === '' ? null : v.lat, lng: v.lng === '' ? null : v.lng,
    cover_author: v.cover_author || null, cover_license: v.cover_license || null, cover_license_url: v.cover_license_url || null, cover_source_url: v.cover_source_url || null,
  };
}

async function validateRefs(v) {
  const d = await content.dicts();
  if (!d.categoryById[v.category_id]) throw new Error('category_id not found');
  if (v.country_code && !d.countryByCode[v.country_code]) throw new Error('country_code not in dictionary');
  if (!(await db('users').where({ id: v.owner_id }).first())) throw new Error('owner_id not found');
}

const tools = [
  {
    name: 'stories_search',
    description: 'Search stories. Either `query` in natural language (parsed into facets) or explicit facets. Returns cards, total and facet counts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' }, text: { type: 'string', description: 'Full-text search' },
        country: { type: 'array', items: { type: 'string' } }, season: { type: 'array', items: { type: 'string' } }, budget: { type: 'array', items: { type: 'string' } },
        trip: { type: 'array', items: { type: 'string' } }, days: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } },
        category: { type: 'string' }, sort: { type: 'string', enum: filterState.SORTS }, page: { type: 'integer', minimum: 1 }, perPage: { type: 'integer', maximum: 50 },
        includeHidden: { type: 'boolean' },
      },
    },
    async handler(a) {
      let state = filterState.emptyState();
      let parser = null;
      if (a.query) {
        const r = await nlsearch.parse(a.query, 'uk');
        state = { ...state, ...r.facets, category: r.facets.category || null };
        parser = r.parser;
      }
      for (const f of ['country', 'season', 'budget', 'trip', 'days', 'tags']) if (Array.isArray(a[f])) state[f] = a[f].map(String);
      if (a.category) state.category = a.category;
      if (a.sort) state.sort = a.sort;
      if (a.text) state.text = String(a.text);
      state.page = Math.max(1, a.page || 1);
      state.includeHidden = Boolean(a.includeHidden);
      const perPage = Math.min(a.perPage || 10, 50);
      const [rows, c] = await Promise.all([facets.list(state, { perPage }), facets.counts(state)]);
      return {
        parser, total: c.total, page: state.page,
        stories: rows.map((r) => ({ id: r.id, title: r.title, date: r.date, owner: r.owner_name, category_id: r.category_id, country: r.country_code, region: r.region, favorite_count: r.favorite_count, is_demo: r.is_demo, hidden: r.hidden })),
        facetCounts: c,
      };
    },
  },
  {
    name: 'story_get',
    description: 'Full story by id (all languages and facet fields).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    async handler({ id }) {
      if (!isObjectId(id)) throw new Error('id must be 24-hex');
      const s = await db('stories').where({ id }).first();
      if (!s) throw new Error('Story not found');
      delete s.search;
      return s;
    },
  },
  {
    name: 'story_create',
    description: 'Create a story. Cover images are uploaded through the admin panel; text, facets and coordinates come here.',
    write: true,
    inputSchema: { type: 'object', required: ['title', 'article', 'category_id', 'owner_id', 'date'], properties: storyProps },
    async handler(a) {
      const v = schemas.adminStory.parse({ ...a, is_demo: Boolean(a.is_demo) });
      await validateRefs(v);
      const id = objectId(new Date(v.date + 'T12:00:00Z'));
      await db('stories').insert({ id, ...toRow(v), source: 'local' });
      nlsearch.invalidate();
      return { id };
    },
  },
  {
    name: 'story_update',
    description: 'Update a story: pass the id and only the fields to change.',
    write: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, hidden: { type: 'boolean' }, ...storyProps } },
    async handler(a) {
      const s = await db('stories').where({ id: a.id }).first();
      if (!s) throw new Error('Story not found');
      const merged = { ...s, ...a, date: a.date || s.date, is_demo: a.is_demo ?? s.is_demo };
      for (const k of Object.keys(merged)) if (merged[k] === null) merged[k] = '';
      merged.seasons = merged.seasons || []; merged.tags = merged.tags || [];
      const v = schemas.adminStory.parse(Object.fromEntries(FIELDS.map((k) => [k, merged[k]])));
      await validateRefs(v);
      const patch = { ...toRow(v), updated_at: db.fn.now() };
      if (typeof a.hidden === 'boolean') patch.hidden = a.hidden;
      await db('stories').where({ id: a.id }).update(patch);
      nlsearch.invalidate();
      return { id: a.id, updated: true };
    },
  },
  {
    name: 'story_delete',
    description: 'Delete a story permanently.',
    write: true,
    destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    async handler({ id }) {
      const s = await db('stories').where({ id }).first();
      if (!s) throw new Error('Story not found');
      await db('stories').where({ id }).del();
      require('../../../core/images').removeKey(s.cover_key);
      return { id, deleted: true };
    },
  },
  {
    name: 'story_translate',
    description: 'Translate a story into en or es through the configured LLM and save it.',
    write: true,
    inputSchema: { type: 'object', required: ['id', 'locale'], properties: { id: { type: 'string' }, locale: { type: 'string', enum: ['en', 'es'] } } },
    handler: ({ id, locale }) => translate.translateStory(id, locale),
  },
];

module.exports = { tools };
