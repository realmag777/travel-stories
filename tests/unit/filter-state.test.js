import { describe, it, expect } from 'vitest';
import fs from '../../src/shared/filter-state.js';

describe('filter state <-> URL', () => {
  it('parses path segments and query into a normalized state', () => {
    const s = fs.parse(['country-jp,it', 'season-spring', 'days-4-7', 'tags-food,history'], { sort: 'popular', page: '2', category: '68FB50C80AE91338641121F0' });
    expect(s.country).toEqual(['IT', 'JP']);
    expect(s.season).toEqual(['spring']);
    expect(s.days).toEqual(['4-7']);
    expect(s.tags).toEqual(['food', 'history']);
    expect(s.sort).toBe('popular');
    expect(s.page).toBe(2);
    expect(s.category).toBe('68fb50c80ae91338641121f0');
  });

  it('builds a canonical URL with sorted facets and values', () => {
    const s = fs.parse(['tags-history,food', 'country-it'], {});
    expect(fs.toUrl(s)).toBe('/stories/filter/country-it/tags-food,history');
  });

  it('round-trips through toUrl and parse', () => {
    const s = fs.parse(['budget-low', 'trip-family', 'season-spring,summer'], { sort: 'duration-asc', bbox: '40,-10,60,30', q: 'море' });
    const url = fs.toUrl(s);
    const [p, q] = url.split('?');
    const again = fs.parse(p.replace('/stories/filter/', '').split('/'), Object.fromEntries(new URLSearchParams(q)));
    expect(again).toEqual(s);
  });

  it('rejects garbage values and unknown facets', () => {
    const s = fs.parse(['country-xyz,UA', 'evil-1', 'tags-<script>'], { sort: 'drop', page: '-3', bbox: '1,2,3' });
    expect(s.country).toEqual(['UA']);
    expect(s.tags).toEqual([]);
    expect(s.sort).toBe('new');
    expect(s.page).toBe(1);
    expect(s.bbox).toBeNull();
  });

  it('toggles values and resets the page', () => {
    let s = { ...fs.emptyState(), page: 3 };
    s = fs.toggle(s, 'season', 'winter');
    expect(s.season).toEqual(['winter']);
    expect(s.page).toBe(1);
    s = fs.toggle(s, 'season', 'winter');
    expect(s.season).toEqual([]);
    s = fs.toggle(s, 'category', 'a'.repeat(24));
    expect(s.category).toBe('a'.repeat(24));
    expect(fs.toggle(s, 'category', 'a'.repeat(24)).category).toBeNull();
  });

  it('counts active filters', () => {
    expect(fs.activeCount(fs.parse(['season-spring,summer', 'budget-low'], { bbox: '1,2,3,4' }))).toBe(4);
  });
});
