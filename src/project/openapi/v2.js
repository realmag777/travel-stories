// OpenAPI paths and schemas of the v2 extensions, merged into the v1 spec at /docs.
const filterParams = [
  { name: 'category', in: 'query', schema: { $ref: '#/components/schemas/MongoObjectId' } },
  { name: 'country', in: 'query', description: 'ISO alpha-2 codes, comma-separated (OR inside the facet)', schema: { type: 'string', example: 'IT,JP' } },
  { name: 'region', in: 'query', description: 'Region slugs, comma-separated', schema: { type: 'string', example: 'kansai' } },
  { name: 'season', in: 'query', schema: { type: 'string', example: 'spring,summer' }, description: 'spring | summer | autumn | winter' },
  { name: 'budget', in: 'query', schema: { type: 'string', example: 'low' }, description: 'low | medium | high' },
  { name: 'trip', in: 'query', schema: { type: 'string', example: 'family' }, description: 'solo | couple | family | friends' },
  { name: 'days', in: 'query', schema: { type: 'string', example: '4-7' }, description: 'Duration buckets: 1-3 | 4-7 | 8-14 | 15-plus' },
  { name: 'tags', in: 'query', schema: { type: 'string', example: 'food,history' } },
  { name: 'bbox', in: 'query', description: 'south,west,north,east — only stories inside the box', schema: { type: 'string', example: '35,-10,60,30' } },
  { name: 'text', in: 'query', description: 'Full-text search in titles, regions and articles', schema: { type: 'string' } },
  { name: 'sort', in: 'query', schema: { type: 'string', enum: ['new', 'popular', 'duration-asc', 'duration-desc'], default: 'new' } },
  { name: 'lang', in: 'query', schema: { type: 'string', enum: ['uk', 'en', 'es'], default: 'uk' } },
];

const envelope = (data, message) => ({
  type: 'object', required: ['status', 'message', 'data'],
  properties: { status: { type: 'integer', example: 200 }, message: { type: 'string', example: message }, data },
});
const json = (schema, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const err = (description) => json({ $ref: '#/components/schemas/ErrorResponse' }, description);

const schemas = {
  FacetOption: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' }, selected: { type: 'boolean' }, disabled: { type: 'boolean', description: 'true when the option would give zero results' } } },
  FacetModel: {
    type: 'object',
    properties: Object.fromEntries(['total', 'category', 'country', 'region', 'season', 'budget', 'trip', 'days', 'tags']
      .map((k) => [k, k === 'total' ? { type: 'integer' } : { type: 'array', items: { $ref: '#/components/schemas/FacetOption' } }])),
  },
  StoryCard: {
    type: 'object',
    properties: {
      id: { type: 'string' }, title: { type: 'string' }, excerpt: { type: 'string' }, category: { type: 'string' }, date: { type: 'string', format: 'date' },
      favoriteCount: { type: 'integer' }, country: { type: 'string' }, region: { type: 'string' }, seasons: { type: 'array', items: { type: 'string' } },
      budget: { type: 'string' }, durationDays: { type: 'integer' }, tripType: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
      lat: { type: 'number' }, lng: { type: 'number' },
      cover: { type: 'object', properties: { src: { type: 'string' }, srcset: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } } },
      owner: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
    },
  },
  NlFacets: {
    type: 'object',
    properties: {
      country: { type: 'array', items: { type: 'string' } }, region: { type: 'array', items: { type: 'string' } }, season: { type: 'array', items: { type: 'string' } },
      budget: { type: 'array', items: { type: 'string' } }, trip: { type: 'array', items: { type: 'string' } }, days: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string', nullable: true },
    },
  },
  BookingRequest: {
    type: 'object', required: ['serviceId', 'slotId', 'name', 'email'],
    properties: { serviceId: { type: 'integer' }, slotId: { type: 'integer' }, name: { type: 'string', minLength: 2, maxLength: 80 }, email: { type: 'string', format: 'email' }, message: { type: 'string', maxLength: 1000 } },
  },
};

const paths = {
  '/api/v2/stories': {
    get: {
      tags: ['v2 Filter'], summary: 'Faceted story search with counts', description: 'Counts per option are computed with all other active facets applied (disjunctive faceting) in one SQL round-trip. `Server-Timing: db;dur=` reports the query time.',
      parameters: [...filterParams, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'perPage', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 9 } }],
      responses: { 200: json(envelope({ type: 'object', properties: { stories: { type: 'array', items: { $ref: '#/components/schemas/StoryCard' } }, facets: { $ref: '#/components/schemas/FacetModel' }, total: { type: 'integer' }, page: { type: 'integer' }, perPage: { type: 'integer' }, hasNextPage: { type: 'boolean' }, url: { type: 'string', description: 'Canonical shareable page URL' }, tookMs: { type: 'number' } } }, 'Successfully found stories')) },
    },
  },
  '/api/v2/facets': {
    get: { tags: ['v2 Filter'], summary: 'Facet counts only', parameters: filterParams, responses: { 200: json(envelope({ $ref: '#/components/schemas/FacetModel' }, 'Successfully counted facets')) } },
  },
  '/api/v2/search': {
    get: {
      tags: ['v2 Search'], summary: 'Natural-language query to facets',
      description: 'Uses the configured LLM (LLM_PROVIDER=anthropic | openai-compatible) with a strict JSON schema; falls back to the built-in rule parser, so it always works.',
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'куди поїхати в травні з дітьми недорого' } }, { name: 'lang', in: 'query', schema: { type: 'string', enum: ['uk', 'en', 'es'] } }],
      responses: { 200: json(envelope({ type: 'object', properties: { query: { type: 'string' }, parser: { type: 'string', enum: ['llm', 'rules', 'none'] }, facets: { $ref: '#/components/schemas/NlFacets' }, total: { type: 'integer' }, url: { type: 'string' } } }, 'Successfully parsed the query')) },
    },
  },
  '/api/v2/map': {
    get: {
      tags: ['v2 Map'], summary: 'Map points for the current filter', parameters: filterParams,
      responses: { 200: json(envelope({ type: 'object', properties: { total: { type: 'integer' }, points: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, title: { type: 'string' }, category: { type: 'string' }, img: { type: 'string' }, favoriteCount: { type: 'integer' }, date: { type: 'string' } } } } } }, 'Successfully found map points')) },
    },
  },
  '/api/v2/stories/by-ids': {
    get: { tags: ['v2 Saves'], summary: 'Cards for a list of ids (the "Збережені" page)', parameters: [{ name: 'ids', in: 'query', required: true, schema: { type: 'string' } }, { name: 'lang', in: 'query', schema: { type: 'string' } }], responses: { 200: json(envelope({ type: 'object', properties: { stories: { type: 'array', items: { $ref: '#/components/schemas/StoryCard' } } } }, 'Successfully found stories')) } },
  },
  '/api/v2/stories/{storyId}/save': {
    post: {
      tags: ['v2 Saves'], summary: 'Anonymous save / unsave (counter only)',
      description: 'The list of saved ids stays in the browser (localStorage). The server keeps one vote per visitor hash and story, rate-limited per IP and per IP+story.',
      parameters: [{ name: 'storyId', in: 'path', required: true, schema: { $ref: '#/components/schemas/MongoObjectId' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'remove'] } } } } } },
      responses: { 200: json(envelope({ type: 'object', properties: { storyId: { type: 'string' }, saved: { type: 'boolean' }, changed: { type: 'boolean' }, favoriteCount: { type: 'integer' } } }, 'Story saved')), 404: err('Story not found'), 429: err('Too many requests') },
    },
  },
  '/api/v2/stories/{storyId}/travel-links': {
    get: { tags: ['v2 Booking'], summary: 'Where to stay / how to get there links', parameters: [{ name: 'storyId', in: 'path', required: true, schema: { $ref: '#/components/schemas/MongoObjectId' } }], responses: { 200: json(envelope({ type: 'object' }, 'Successfully built links')), 404: err('Story not found') } },
  },
  '/api/v2/travellers/{id}/booking': {
    get: {
      tags: ['v2 Booking'], summary: 'Services and free slots of a guide', parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/MongoObjectId' } }],
      responses: { 200: json(envelope({ type: 'object', properties: { services: { type: 'array', items: { type: 'object' } }, slots: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, startsAt: { type: 'string', format: 'date-time' }, day: { type: 'string' }, time: { type: 'string' }, durationMin: { type: 'integer' } } } }, timezone: { type: 'string' } } }, 'Successfully found booking options')), 404: err('Traveller does not accept bookings') },
    },
  },
  '/api/v2/travellers/{id}/bookings': {
    post: {
      tags: ['v2 Booking'], summary: 'Book a slot (no payment, status "new")',
      description: 'Double booking is impossible: the slot row is locked in a transaction and a partial unique index allows one live booking per slot.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { $ref: '#/components/schemas/MongoObjectId' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingRequest' } } } },
      responses: { 201: json(envelope({ type: 'object', properties: { id: { type: 'integer' }, status: { type: 'string' }, startsAt: { type: 'string' }, service: { type: 'string' } } }, 'Booking created')), 400: err('Invalid request data'), 404: err('Service or slot not found'), 409: err('Slot is already booked') },
    },
  },
};

const tags = [
  { name: 'v2 Filter', description: 'Faceted filter (country, region, season, budget, duration, trip type, tags)' },
  { name: 'v2 Search', description: 'Natural-language search' },
  { name: 'v2 Map', description: 'Map points' },
  { name: 'v2 Saves', description: 'Anonymous saves' },
  { name: 'v2 Booking', description: 'Guides, slots, bookings and travel links' },
];

module.exports = { paths, schemas, tags };
