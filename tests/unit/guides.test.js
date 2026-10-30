import { describe, it, expect, afterAll } from 'vitest';
import guides from '../../src/project/services/guides.js';
import db from '../../src/core/db.js';

afterAll(() => db.destroy());

describe('guides', () => {
  it('lists demo guides with place, nearest slot and the lowest price', async () => {
    const r = await guides.list({}, { limit: 50 });
    expect(r.total).toBeGreaterThanOrEqual(20);
    for (const g of r.rows) {
      expect(g.services.length).toBeGreaterThan(0);
      if (g.priceFrom) expect(guides.priceNumber(g.priceFrom)).toBe(Math.min(...g.services.map((s) => guides.priceNumber(s.price))));
    }
    expect(r.rows.some((g) => g.nextSlot)).toBe(true);
    const imported = await db('users').where({ accepts_bookings: true, source: 'original' }).pluck('id');
    expect(imported).toEqual([]); // only generated travellers are guides
  });

  it('filters by service kind, country and date', async () => {
    const all = await guides.list({}, { limit: 100 });
    const kind = all.facets.service.find((s) => s.count > 0).value;
    const byKind = await guides.list({ service: kind }, { limit: 100 });
    expect(byKind.total).toBeGreaterThan(0);
    expect(byKind.rows.every((g) => g.kinds.includes(kind))).toBe(true);
    const country = all.facets.country[0].value;
    const byCountry = await guides.list({ country }, { limit: 100 });
    expect(byCountry.rows.every((g) => g.countryCode === country)).toBe(true);
    const day = all.rows.find((g) => g.nextSlot).nextSlot.day;
    const byDate = await guides.list({ date: day }, { limit: 100 });
    expect(byDate.total).toBeGreaterThan(0);
    expect(byDate.rows.every((g) => g.nextSlot && g.nextSlot.day === day)).toBe(true);
  });

  it('ignores malformed filter values', () => {
    expect(guides.parseFilters({ country: 'xxx', service: 'spa', date: '31-12-2026' })).toEqual({ country: '', service: '', date: '' });
  });
});
