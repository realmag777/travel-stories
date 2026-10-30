// Zod schemas shared by the server and the browser bundle: the same rules validate
// API input, SSR forms and client-side field messages.
const { z } = require('zod');
const { SEASONS, BUDGETS, TRIP_TYPES, DURATIONS } = require('./dictionaries');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);
const trimmed = (min, max) => z.string().trim().min(min).max(max);
const pageInt = z.coerce.number().int().min(1);

// ---- Original API (v1) ----
const v1 = {
  storiesQuery: z.object({
    page: pageInt.default(1),
    perPage: z.coerce.number().int().min(1).max(20).default(9),
    category: objectId.optional(),
  }).strict(),
  popularQuery: z.object({
    page: pageInt.default(1),
    perPage: z.coerce.number().int().min(1).max(12).default(3),
  }).strict(),
  ownQuery: z.object({
    page: pageInt.default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(12),
  }).strict(),
  usersQuery: z.object({
    page: pageInt.default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  }).strict(),
  userQuery: z.object({
    page: pageInt.default(1),
    limit: z.coerce.number().int().min(1).max(50).default(6),
  }).strict(),
  idParam: z.object({ id: objectId }),
  storyIdParam: z.object({ storyId: objectId }),
  register: z.object({
    name: trimmed(1, 32),
    email: z.string().trim().toLowerCase().max(64).pipe(z.email()),
    password: z.string().min(8).max(128),
  }).strict(),
  login: z.object({
    email: z.string().trim().toLowerCase().max(64).pipe(z.email()),
    password: z.string().min(8).max(128),
  }).strict(),
  userPatch: z.object({
    name: trimmed(1, 32).optional(),
    email: z.string().trim().toLowerCase().max(64).pipe(z.email()).optional(),
    description: z.string().trim().max(150).optional(),
  }).strict().refine((o) => Object.keys(o).length > 0, { message: 'must have at least 1 key' }),
  storyCreate: z.object({
    title: trimmed(1, 80),
    article: trimmed(1, 2500),
    category: objectId,
  }).strict(),
  storyPatch: z.object({
    title: trimmed(1, 80).optional(),
    article: trimmed(1, 2500).optional(),
    category: objectId.optional(),
  }).strict(),
};

// ---- Booking form (public) ----
const booking = z.object({
  serviceId: z.coerce.number().int().positive(),
  slotId: z.coerce.number().int().positive(),
  name: trimmed(2, 80),
  email: z.string().trim().toLowerCase().max(120).pipe(z.email()),
  message: z.string().trim().max(1000).optional().default(''),
});

// ---- Natural-language search result (LLM output and rule parser output) ----
const nlFacets = z.object({
  country: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).default([]),
  region: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(10).default([]),
  season: z.array(z.enum(SEASONS)).max(4).default([]),
  budget: z.array(z.enum(BUDGETS)).max(3).default([]),
  trip: z.array(z.enum(TRIP_TYPES)).max(4).default([]),
  days: z.array(z.enum(DURATIONS.map((d) => d.slug))).max(4).default([]),
  tags: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(8).default([]),
  category: objectId.nullable().optional().default(null),
});

// ---- Admin forms ----
const adminStory = z.object({
  title: trimmed(1, 80),
  article: trimmed(1, 2500),
  title_en: z.string().trim().max(120).optional().default(''),
  article_en: z.string().trim().max(5000).optional().default(''),
  title_es: z.string().trim().max(120).optional().default(''),
  article_es: z.string().trim().max(5000).optional().default(''),
  category_id: objectId,
  owner_id: objectId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  country_code: z.string().regex(/^[A-Z]{2}$/).optional().or(z.literal('')).default(''),
  region: z.string().trim().max(80).optional().default(''),
  region_en: z.string().trim().max(80).optional().default(''),
  region_es: z.string().trim().max(80).optional().default(''),
  seasons: z.array(z.enum(SEASONS)).default([]),
  budget: z.enum(BUDGETS).optional().or(z.literal('')).default(''),
  duration_days: z.coerce.number().int().min(1).max(365).optional().or(z.literal('')).default(''),
  trip_type: z.enum(TRIP_TYPES).optional().or(z.literal('')).default(''),
  tags: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(12).default([]),
  lat: z.coerce.number().min(-90).max(90).optional().or(z.literal('')).default(''),
  lng: z.coerce.number().min(-180).max(180).optional().or(z.literal('')).default(''),
  favorite_count: z.coerce.number().int().min(0).max(1000000).default(0),
  cover_author: z.string().trim().max(300).optional().default(''),
  cover_license: z.string().trim().max(80).optional().default(''),
  cover_license_url: z.string().trim().max(500).optional().default(''),
  cover_source_url: z.string().trim().max(500).optional().default(''),
  is_demo: z.coerce.boolean().default(false),
});

const adminTraveller = z.object({
  name: trimmed(1, 32),
  name_en: z.string().trim().max(64).optional().default(''),
  description: z.string().trim().max(400).optional().default(''),
  description_en: z.string().trim().max(400).optional().default(''),
  description_es: z.string().trim().max(400).optional().default(''),
  accepts_bookings: z.coerce.boolean().default(false),
  booking_intro: z.string().trim().max(500).optional().default(''),
  is_demo: z.coerce.boolean().default(false),
});

const adminService = z.object({
  kind: z.enum(['call', 'tour']),
  title: trimmed(2, 120),
  title_en: z.string().trim().max(120).optional().default(''),
  title_es: z.string().trim().max(120).optional().default(''),
  description: z.string().trim().max(500).optional().default(''),
  duration_min: z.coerce.number().int().min(15).max(720),
  price_label: trimmed(1, 40),
  active: z.coerce.boolean().default(true),
});

const adminSlots = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).max(12),
  duration_min: z.coerce.number().int().min(15).max(720).default(60),
});

const adminCategory = z.object({
  name: trimmed(2, 64),
  name_en: z.string().trim().max(64).optional().default(''),
  name_es: z.string().trim().max(64).optional().default(''),
  sort: z.coerce.number().int().min(0).max(999).default(0),
});

const adminFacetValue = z.object({
  facet: z.enum(['tags', 'season', 'budget', 'trip', 'days']),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  label_uk: trimmed(1, 80),
  label_en: trimmed(1, 80),
  label_es: trimmed(1, 80),
  sort: z.coerce.number().int().min(0).max(999).default(0),
});

const adminCountry = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  name_uk: trimmed(2, 80),
  name_en: trimmed(2, 80),
  name_es: trimmed(2, 80),
});

/** Map a zod issue to an i18n key + vars for field messages in the UI. */
function issueToMessage(issue) {
  if (issue.code === 'too_small') return { key: issue.minimum === 1 ? 'validation.required' : 'validation.min', vars: { min: issue.minimum } };
  if (issue.code === 'too_big') return { key: 'validation.max', vars: { max: issue.maximum } };
  if (issue.code === 'invalid_format' && issue.format === 'email') return { key: 'validation.email', vars: {} };
  if (issue.code === 'invalid_type' && /undefined/.test(issue.message)) return { key: 'validation.required', vars: {} };
  return { key: 'validation.invalid', vars: {} };
}

/** Field -> first issue map for forms. */
function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const k = issue.path[0] || '_form';
    if (!out[k]) out[k] = issueToMessage(issue);
  }
  return out;
}

module.exports = {
  z, objectId, v1, booking, nlFacets,
  adminStory, adminTraveller, adminService, adminSlots, adminCategory, adminFacetValue, adminCountry,
  issueToMessage, fieldErrors,
};
