import { describe, it, expect, afterAll } from 'vitest';
import nl from '../../src/project/services/nlsearch.js';
import settings from '../../src/core/settings.js';
import db from '../../src/core/db.js';

// The rule parser is tested directly; it reads countries/regions from the seeded DB.
afterAll(() => db.destroy());

describe('rule-based query parser', () => {
  it('parses the reference query: May + kids + cheap', async () => {
    const f = await nl.parseRules('куди поїхати в травні з дітьми недорого');
    expect(f.season).toEqual(['spring']);
    expect(f.trip).toEqual(['family']);
    expect(f.budget).toEqual(['low']);
  });

  it('understands seasons, friends, duration and tags', async () => {
    const f = await nl.parseRules('гори взимку з друзями на тиждень, лижі');
    expect(f.season).toContain('winter');
    expect(f.trip).toContain('friends');
    expect(f.days).toContain('4-7');
    expect(f.tags).toContain('skiing');
    expect(f.category).not.toBeNull();
  });

  it('finds countries in Ukrainian case forms and in English', async () => {
    const a = await nl.parseRules('вино і гастрономія в Грузії');
    expect(a.country).toContain('GE');
    expect(a.tags).toEqual(expect.arrayContaining(['wine', 'food']));
    const b = await nl.parseRules('a romantic summer trip to Japan for two weeks');
    expect(b.country).toContain('JP');
    expect(b.trip).toContain('couple');
    expect(b.season).toContain('summer');
    expect(b.days).toContain('8-14');
  });

  it('maps explicit day counts and luxury budget', async () => {
    const f = await nl.parseRules('розкішна поїздка на 10 днів у вересні');
    expect(f.days).toEqual(['8-14']);
    expect(f.budget).toEqual(['high']);
    expect(f.season).toEqual(['autumn']);
  });

  it('does not confuse "недорого" with "дорого"', async () => {
    expect((await nl.parseRules('недорого')).budget).toEqual(['low']);
  });

  it('works without LLM through parse()', async () => {
    await settings.set('llm', { provider: '', apiKey: '', model: '', baseUrl: '' });
    const prev = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    const r = await nl.parse('острови влітку', 'uk');
    process.env.LLM_PROVIDER = prev || '';
    expect(r.parser).toBe('rules');
    expect(r.facets.tags).toContain('islands');
    expect(r.facets.season).toContain('summer');
  });
});
