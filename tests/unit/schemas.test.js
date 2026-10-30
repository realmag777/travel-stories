import { describe, it, expect } from 'vitest';
import schemas from '../../src/shared/schemas.js';
import http from '../../src/core/http.js';

const { v1, booking, adminStory, nlFacets, fieldErrors } = schemas;

describe('v1 query validation (original limits)', () => {
  it('applies defaults', () => {
    expect(v1.storiesQuery.parse({})).toEqual({ page: 1, perPage: 9 });
    expect(v1.usersQuery.parse({})).toEqual({ page: 1, limit: 12 });
    expect(v1.popularQuery.parse({})).toEqual({ page: 1, perPage: 3 });
  });
  it('enforces the original maxima', () => {
    expect(v1.storiesQuery.safeParse({ perPage: '21' }).success).toBe(false);
    expect(v1.usersQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(v1.popularQuery.safeParse({ perPage: '13' }).success).toBe(false);
  });
  it('produces Joi-style messages like the original backend', () => {
    const issue = (schema, v) => schema.safeParse(v).error.issues[0];
    expect(http.joiMessage(issue(v1.storiesQuery, { page: '0' }))).toBe('"page" must be greater than or equal to 1');
    expect(http.joiMessage(issue(v1.usersQuery, { limit: '51' }))).toBe('"limit" must be less than or equal to 50');
    expect(http.joiMessage(issue(v1.storyIdParam, { storyId: 'abc' }))).toBe('"storyId" length must be 24 characters long');
    expect(http.joiMessage(issue(v1.storiesQuery, { foo: '1' }))).toBe('"foo" is not allowed');
  });
  it('normalizes auth input', () => {
    expect(v1.login.parse({ email: '  User@Example.COM ', password: 'password1' }).email).toBe('user@example.com');
    expect(v1.register.safeParse({ name: '   ', email: 'a@b.co', password: 'password1' }).success).toBe(false);
  });
});

describe('booking form', () => {
  it('accepts a valid booking and trims fields', () => {
    const r = booking.parse({ serviceId: '1', slotId: '2', name: '  Олена ', email: 'OLENA@EXAMPLE.COM' });
    expect(r).toEqual({ serviceId: 1, slotId: 2, name: 'Олена', email: 'olena@example.com', message: '' });
  });
  it('returns field errors with i18n keys', () => {
    const r = booking.safeParse({ serviceId: 1, slotId: 1, name: 'A', email: 'bad', message: 'x'.repeat(1001) });
    const e = fieldErrors(r.error);
    expect(e.name.key).toBe('validation.min');
    expect(e.email.key).toBe('validation.email');
    expect(e.message.key).toBe('validation.max');
  });
});

describe('admin story form', () => {
  const base = { title: 'Title', article: 'Text', category_id: 'a'.repeat(24), owner_id: 'b'.repeat(24), date: '2026-05-01' };
  it('accepts minimal stories with empty optional facets', () => {
    const r = adminStory.parse({ ...base, budget: '', trip_type: '', lat: '', lng: '' });
    expect(r.seasons).toEqual([]);
    expect(r.budget).toBe('');
  });
  it('rejects out-of-dictionary facet values and bad coordinates', () => {
    expect(adminStory.safeParse({ ...base, budget: 'cheap' }).success).toBe(false);
    expect(adminStory.safeParse({ ...base, seasons: ['monsoon'] }).success).toBe(false);
    expect(adminStory.safeParse({ ...base, lat: '91' }).success).toBe(false);
    expect(adminStory.safeParse({ ...base, title: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('NL facets schema', () => {
  it('fills defaults and rejects unknown enums', () => {
    expect(nlFacets.parse({ season: ['spring'] }).budget).toEqual([]);
    expect(nlFacets.safeParse({ trip: ['business'] }).success).toBe(false);
  });
});
