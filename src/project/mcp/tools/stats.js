// MCP tools: site statistics from the own page-view counter and search log.
const db = require('../../../core/db');

const tools = [
  {
    name: 'stats_overview',
    description: 'Totals, views per day, top stories, top searches and filters for the last N days (default 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 365 } } },
    async handler({ days = 30 } = {}) {
      const d = Math.min(Math.max(Number(days) || 30, 1), 365);
      const since = db.raw(`now() - (? || ' days')::interval`, [d]);
      const [totals, daily, top, searches, bookings] = await Promise.all([
        db.raw(`SELECT (SELECT count(*) FROM stories)::int AS stories, (SELECT count(*) FROM stories WHERE is_demo)::int AS demo_stories,
          (SELECT count(*) FROM users)::int AS travellers, (SELECT count(*) FROM users WHERE accepts_bookings)::int AS guides,
          (SELECT count(*) FROM page_views WHERE created_at > now() - (? || ' days')::interval)::int AS views,
          (SELECT count(DISTINCT visitor) FROM page_views WHERE created_at > now() - (? || ' days')::interval)::int AS visitors`, [d, d]),
        db('page_views').where('created_at', '>', since).select(db.raw("to_char(created_at::date, 'YYYY-MM-DD') AS day"), db.raw('count(*)::int AS views')).groupByRaw('1').orderBy('day'),
        db('page_views as p').join('stories as s', 's.id', 'p.entity_id').where('p.kind', 'story').andWhere('p.created_at', '>', since)
          .select('s.id', 's.title').count({ views: '*' }).groupBy('s.id', 's.title').orderBy('views', 'desc').limit(10),
        db('search_events').where('kind', 'nl').andWhere('created_at', '>', since).select(db.raw('lower(query) AS query')).count({ n: '*' }).groupByRaw('1').orderBy('n', 'desc').limit(10),
        db('bookings').select('status').count({ n: '*' }).groupBy('status'),
      ]);
      return { days: d, totals: totals.rows[0], daily, topStories: top, topSearches: searches, bookingsByStatus: bookings };
    },
  },
];

module.exports = { tools };
