import { describe, it, expect, afterAll } from 'vitest';
import facets from '../../src/project/services/facets.js';
import fs from '../../src/shared/filter-state.js';
import db from '../../src/core/db.js';

afterAll(() => db.destroy());

// Brute-force reference: count matching stories in JS from all rows.
async function allRows() {
  return db('stories').where({ hidden: false }).select('id', 'category_id', 'country_code', 'seasons', 'budget', 'trip_type', 'tags', 'duration_days');
}
const match = (r, s) => (!s.category || r.category_id === s.category)
  && (!s.country.length || s.country.includes(r.country_code))
  && (!s.season.length || r.seasons.some((x) => s.season.includes(x)))
  && (!s.budget.length || s.budget.includes(r.budget))
  && (!s.trip.length || s.trip.includes(r.trip_type))
  && (!s.tags.length || r.tags.some((x) => s.tags.includes(x)));

describe('faceted counts', () => {
  it('total equals the brute-force count', async () => {
    const rows = await allRows();
    const s = fs.parse(['season-spring,summer', 'budget-low,medium'], {});
    const c = await facets.counts(s);
    expect(c.total).toBe(rows.filter((r) => match(r, s)).length);
  });

  it('counts inside a facet ignore that facet (OR semantics), other facets apply', async () => {
    const rows = await allRows();
    const s = fs.parse(['season-winter', 'trip-friends'], {});
    const c = await facets.counts(s);
    const withoutSeason = { ...s, season: [] };
    const expectedSummer = rows.filter((r) => match(r, withoutSeason) && r.seasons.includes('summer')).length;
    expect(c.season.summer || 0).toBe(expectedSummer);
    const withoutTrip = { ...s, trip: [] };
    const expectedFamily = rows.filter((r) => match(r, withoutTrip) && r.trip_type === 'family').length;
    expect(c.trip.family || 0).toBe(expectedFamily);
  });

  it('marks zero-result options disabled but keeps selected ones', async () => {
    const s = fs.parse(['country-jp'], {});
    const model = await facets.facetModel(s, 'uk');
    const jp = model.country.find((o) => o.value === 'JP');
    expect(jp.selected).toBe(true);
    const zero = model.tags.find((o) => o.count === 0 && !o.selected);
    if (zero) expect(zero.disabled).toBe(true);
    expect(model.total).toBeGreaterThan(0);
  });

  it('applies duration buckets and bbox', async () => {
    const rows = await db('stories').where({ hidden: false }).whereBetween('duration_days', [4, 7]).whereBetween('lat', [35, 60]).whereBetween('lng', [-10, 30]).count({ n: '*' });
    const c = await facets.counts(fs.parse(['days-4-7'], { bbox: '35,-10,60,30' }));
    expect(c.total).toBe(Number(rows[0].n));
  });

  it('sorts by popularity and paginates', async () => {
    const s = { ...fs.emptyState(), sort: 'popular' };
    const p1 = await facets.list(s, { perPage: 5, page: 1 });
    const p2 = await facets.list(s, { perPage: 5, page: 2 });
    expect(p1[0].favorite_count).toBeGreaterThanOrEqual(p1[4].favorite_count);
    expect(p1[4].favorite_count).toBeGreaterThanOrEqual(p2[0].favorite_count);
    expect(new Set([...p1, ...p2].map((r) => r.id)).size).toBe(10);
  });
});
