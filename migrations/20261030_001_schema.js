// Initial schema: content, facets, booking, analytics, settings, sessions.

exports.up = async (knex) => {
  await knex.schema.createTable('categories', (t) => {
    t.string('id', 24).primary();
    t.string('name', 64).notNullable().unique();
    t.string('name_en', 64);
    t.string('name_es', 64);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('countries', (t) => {
    t.string('code', 2).primary();
    t.string('name_uk', 80).notNullable();
    t.string('name_en', 80).notNullable();
    t.string('name_es', 80).notNullable();
  });

  // Dictionary for every facet with labels. Slugs of fixed facets (season, budget, trip_type,
  // duration) are referenced by code and locked; tags can be added and removed freely.
  await knex.schema.createTable('facet_values', (t) => {
    t.increments('id');
    t.string('facet', 20).notNullable();
    t.string('slug', 40).notNullable();
    t.string('label_uk', 80).notNullable();
    t.string('label_en', 80).notNullable();
    t.string('label_es', 80).notNullable();
    t.integer('sort').notNullable().defaultTo(0);
    t.boolean('locked').notNullable().defaultTo(false);
    t.unique(['facet', 'slug']);
  });

  await knex.schema.createTable('users', (t) => {
    t.string('id', 24).primary();
    t.string('name', 32).notNullable();
    t.string('name_en', 64);
    t.string('email', 64).unique();
    t.string('password_hash', 100);
    t.text('avatar_url'); // external URL as imported, or null
    t.string('avatar_key', 120); // local variant base under /uploads, wins over avatar_url
    t.text('description').notNullable().defaultTo('');
    t.text('description_en');
    t.text('description_es');
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.string('source', 16).notNullable().defaultTo('local'); // local | original | demo
    t.boolean('hidden').notNullable().defaultTo(false); // moderated out of public lists
    t.boolean('accepts_bookings').notNullable().defaultTo(false);
    t.text('booking_intro');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('stories', (t) => {
    t.string('id', 24).primary();
    t.text('img'); // external cover URL as imported
    t.string('cover_key', 120); // local variant base under /uploads, wins over img
    t.text('cover_author');
    t.string('cover_license', 80);
    t.text('cover_license_url');
    t.text('cover_source_url');
    t.string('title', 80).notNullable();
    t.text('article').notNullable();
    t.string('title_en', 120);
    t.text('article_en');
    t.string('title_es', 120);
    t.text('article_es');
    t.string('category_id', 24).references('categories.id').onDelete('RESTRICT');
    t.string('owner_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.integer('favorite_count').notNullable().defaultTo(0);
    t.string('country_code', 2).references('countries.code').onDelete('RESTRICT');
    t.string('region', 80);
    t.string('region_en', 80);
    t.string('region_es', 80);
    t.string('region_slug', 80);
    t.specificType('seasons', 'text[]').notNullable().defaultTo('{}');
    t.string('budget', 10);
    t.integer('duration_days');
    t.string('trip_type', 10);
    t.specificType('tags', 'text[]').notNullable().defaultTo('{}');
    t.double('lat');
    t.double('lng');
    t.integer('views').notNullable().defaultTo(0);
    t.boolean('hidden').notNullable().defaultTo(false); // moderated out of public lists
    t.boolean('is_demo').notNullable().defaultTo(false);
    t.string('source', 16).notNullable().defaultTo('local');
    t.timestamps(true, true);
  });
  // Facet and sort indexes; GIN for array facets and full-text search.
  await knex.raw(`
    CREATE INDEX stories_category_idx ON stories (category_id);
    CREATE INDEX stories_owner_idx ON stories (owner_id, date DESC);
    CREATE INDEX stories_country_idx ON stories (country_code);
    CREATE INDEX stories_region_idx ON stories (region_slug);
    CREATE INDEX stories_budget_idx ON stories (budget);
    CREATE INDEX stories_trip_type_idx ON stories (trip_type);
    CREATE INDEX stories_duration_idx ON stories (duration_days);
    CREATE INDEX stories_date_idx ON stories (date DESC, created_at DESC, id DESC);
    CREATE INDEX stories_fav_idx ON stories (favorite_count DESC, id);
    CREATE INDEX stories_seasons_gin ON stories USING gin (seasons);
    CREATE INDEX stories_tags_gin ON stories USING gin (tags);
    CREATE INDEX stories_geo_idx ON stories (lat, lng);
    CREATE INDEX stories_demo_idx ON stories (is_demo);
    CREATE INDEX stories_hidden_idx ON stories (hidden);
    ALTER TABLE stories ADD COLUMN search tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(title_en,'')), 'A') ||
      setweight(to_tsvector('simple', coalesce(region,'') || ' ' || coalesce(region_en,'')), 'B') ||
      setweight(to_tsvector('simple', coalesce(article,'') || ' ' || coalesce(article_en,'')), 'C')
    ) STORED;
    CREATE INDEX stories_search_gin ON stories USING gin (search);
  `);

  // Original-API auth sessions (cookie tokens), kept for contract compatibility.
  await knex.schema.createTable('auth_sessions', (t) => {
    t.string('id', 24).primary();
    t.string('user_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.string('access_token', 64).notNullable().unique();
    t.string('refresh_token', 64).notNullable().unique();
    t.timestamp('access_valid_until', { useTz: true }).notNullable();
    t.timestamp('refresh_valid_until', { useTz: true }).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('user_favorites', (t) => {
    t.string('user_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.string('story_id', 24).notNullable().references('stories.id').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'story_id']);
  });

  // Anonymous saves: one vote per visitor hash and story, so favoriteCount cannot be pumped.
  await knex.schema.createTable('anon_favorites', (t) => {
    t.string('visitor', 64).notNullable();
    t.string('story_id', 24).notNullable().references('stories.id').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['visitor', 'story_id']);
  });

  // Booking: services and slots per traveller, bookings per slot.
  await knex.schema.createTable('services', (t) => {
    t.increments('id');
    t.string('user_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.string('kind', 16).notNullable(); // call | tour
    t.string('title', 120).notNullable();
    t.string('title_en', 120);
    t.string('title_es', 120);
    t.text('description');
    t.integer('duration_min').notNullable();
    t.string('price_label', 40).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('slots', (t) => {
    t.increments('id');
    t.string('user_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.timestamp('starts_at', { useTz: true }).notNullable();
    t.integer('duration_min').notNullable().defaultTo(60);
    t.timestamps(true, true);
    t.unique(['user_id', 'starts_at']);
  });

  await knex.schema.createTable('bookings', (t) => {
    t.increments('id');
    t.integer('slot_id').notNullable().references('slots.id').onDelete('CASCADE');
    t.integer('service_id').references('services.id').onDelete('SET NULL');
    t.string('user_id', 24).notNullable().references('users.id').onDelete('CASCADE');
    t.string('name', 80).notNullable();
    t.string('email', 120).notNullable();
    t.text('message');
    t.string('locale', 5).notNullable().defaultTo('uk');
    t.string('status', 12).notNullable().defaultTo('new'); // new | confirmed | cancelled
    t.timestamps(true, true);
  });
  // A slot can hold only one live booking; a cancelled one frees it again.
  await knex.raw(`CREATE UNIQUE INDEX bookings_one_live_per_slot ON bookings (slot_id) WHERE status <> 'cancelled'`);
  await knex.raw('CREATE INDEX bookings_status_idx ON bookings (status, created_at DESC)');

  // Own analytics: raw page views and search events.
  await knex.schema.createTable('page_views', (t) => {
    t.bigIncrements('id');
    t.string('path', 300).notNullable();
    t.string('kind', 20).notNullable().defaultTo('page');
    t.string('entity_id', 24);
    t.string('locale', 5);
    t.string('visitor', 64);
    t.string('referrer_host', 120);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX page_views_created_idx ON page_views (created_at)');
  await knex.raw('CREATE INDEX page_views_entity_idx ON page_views (kind, entity_id)');

  await knex.schema.createTable('search_events', (t) => {
    t.bigIncrements('id');
    t.string('kind', 10).notNullable(); // nl | filter
    t.text('query');
    t.jsonb('facets');
    t.integer('results');
    t.string('parser', 12);
    t.string('locale', 5);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX search_events_created_idx ON search_events (kind, created_at)');

  await knex.schema.createTable('settings', (t) => {
    t.string('key', 60).primary();
    t.jsonb('value');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // express-session store (connect-pg-simple layout).
  await knex.raw(`
    CREATE TABLE "session" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid"));
    CREATE INDEX "IDX_session_expire" ON "session" ("expire");
  `);
};

exports.down = async (knex) => {
  for (const t of ['session', 'settings', 'search_events', 'page_views', 'bookings', 'slots', 'services',
    'anon_favorites', 'user_favorites', 'auth_sessions', 'stories', 'users', 'facet_values', 'countries', 'categories']) {
    await knex.schema.dropTableIfExists(t);
  }
};
