// The public API must have the same shape as the original (fixtures were captured from
// https://travel-stories-backend.onrender.com by tools/probe-api.mjs, read-only).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const APP = (process.env.APP_URL || 'http://localhost:8350').replace(/\/$/, '');
const FIX = path.join(__dirname, '..', 'fixtures', 'original-api');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n + '.json'), 'utf8'));
const get = async (p) => { const r = await fetch(APP + p); return { status: r.status, body: await r.json() }; };

/** Structural signature: keys and JSON types, arrays by their first element. */
function shape(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
}

/** Every key of the original must exist in ours with the same type (ours may add keys). */
function expectCompatible(original, ours, where = '$') {
  if (original === 'null' || ours === 'null') return; // nullable fields
  if (Array.isArray(original)) {
    expect(Array.isArray(ours), `${where} is an array`).toBe(true);
    if (original.length && ours.length) expectCompatible(original[0], ours[0], where + '[0]');
    return;
  }
  if (typeof original === 'object') {
    expect(typeof ours, `${where} is an object`).toBe('object');
    for (const k of Object.keys(original)) {
      // createdAt/updatedAt are optional in the original contract (seeded records lack them).
      if (!(k in ours) && ['createdAt', 'updatedAt'].includes(k)) continue;
      expect(Object.keys(ours), `${where}.${k} exists`).toContain(k);
      expectCompatible(original[k], ours[k], `${where}.${k}`);
    }
    return;
  }
  expect(ours, `${where} type`).toBe(original);
}

const sid = fixture('story').body.data._id; // a story id from the original; imported with the same _id
const cat = fixture('categories').body.data[0]._id;

const CASES = [
  ['categories', '/api/categories'],
  ['stories', '/api/stories?page=1&perPage=3'],
  ['stories-cat', `/api/stories?page=1&perPage=2&category=${cat}`],
  ['popular', '/api/stories/popular?page=1&perPage=3'],
  ['users', '/api/users?page=1&limit=3'],
  ['user', '/api/users/6881563901add19ee16fcff5?page=1&limit=2'],
  ['story-404', '/api/stories/000000000000000000000000'],
  ['story-bad', '/api/stories/abc'],
  ['users-limit', '/api/users?page=1&limit=51'],
  ['stories-bad', '/api/stories?page=0&perPage=abc'],
];

describe('public API matches the original contract', () => {
  for (const [name, url] of CASES) {
    it(`${name}: ${url}`, async () => {
      const orig = fixture(name);
      const ours = await get(url);
      expect(ours.status).toBe(orig.status);
      expectCompatible(shape(orig.body), shape(ours.body));
      if (orig.body.message) expect(ours.body.message).toBe(orig.body.message);
    });
  }

  it('story by id keeps the original _id and envelope', async () => {
    const r = await get('/api/stories/68498236a100312bea07901c');
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('Successfully found story');
    expect(r.body.data._id).toBe('68498236a100312bea07901c');
    expect(r.body.data.category).toMatchObject({ _id: expect.stringMatching(/^[0-9a-f]{24}$/), name: expect.any(String) });
    expect(sid).toMatch(/^[0-9a-f]{24}$/);
  });

  it('pagination fields behave like the original', async () => {
    const r = await get('/api/stories?page=2&perPage=5');
    const d = r.body.data;
    expect(d).toMatchObject({ page: 2, perPage: 5, hasPreviousPage: true });
    expect(d.totalPages).toBe(Math.ceil(d.totalItems / 5));
    expect(d.stories).toHaveLength(5);
    const beyond = await get(`/api/stories?page=${d.totalPages + 5}&perPage=5`);
    expect(beyond.status).toBe(200);
    expect(beyond.body.data.stories).toEqual([]);
  });

  it('protected endpoints answer 401 without a session, like the original', async () => {
    for (const [method, url] of [['GET', '/api/users/me'], ['GET', '/api/stories/own'], ['GET', '/api/stories/saved'], ['PATCH', '/api/users'], ['POST', '/api/auth/logout']]) {
      const r = await fetch(APP + url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(r.status, url).toBe(401);
    }
  });

  it('auth flow: register, login (cookies), me, favorite, logout', async () => {
    const email = `contract-${Date.now()}@example.com`;
    const reg = await fetch(APP + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Contract Test', email, password: 'password123' }) });
    expect(reg.status).toBe(201);
    const login = await fetch(APP + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    expect(cookies).toMatch(/accessToken=/);
    const h = { cookie: cookies, 'content-type': 'application/json' };
    const me = await (await fetch(APP + '/api/users/me', { headers: h })).json();
    expect(me.data.favorites).toEqual([]);
    const add = await fetch(APP + '/api/stories/favorite/add/68498236a100312bea07901c', { method: 'PATCH', headers: h });
    expect(add.status).toBe(200);
    const again = await fetch(APP + '/api/stories/favorite/add/68498236a100312bea07901c', { method: 'PATCH', headers: h });
    expect(again.status).toBe(400);
    const rm = await fetch(APP + '/api/stories/favorite/remove/68498236a100312bea07901c', { method: 'PATCH', headers: h });
    expect(rm.status).toBe(200);
    const out = await fetch(APP + '/api/auth/logout', { method: 'POST', headers: h });
    expect(out.status).toBe(204);
    const session = await (await fetch(APP + '/api/auth/session', { headers: h })).json();
    expect(session.data).toBeNull();
  });
});

describe('v2 extensions', () => {
  it('facet counts respond under 100 ms server time', async () => {
    const r = await fetch(APP + '/api/v2/stories?season=spring,summer&budget=low&perPage=9');
    const timing = r.headers.get('server-timing');
    const body = await r.json();
    expect(body.data.facets.total).toBe(body.data.total);
    expect(Number(/dur=([\d.]+)/.exec(timing)[1])).toBeLessThan(100);
  });

  it('natural-language search returns facets and a shareable URL', async () => {
    const r = await get('/api/v2/search?q=' + encodeURIComponent('куди поїхати в травні з дітьми недорого'));
    expect(r.body.data.facets).toMatchObject({ season: ['spring'], budget: ['low'], trip: ['family'] });
    expect(r.body.data.url).toContain('/stories/filter/');
  });

  it('anonymous save counts once per visitor', async () => {
    const h = { 'content-type': 'application/json', 'user-agent': `contract-${Date.now()}` };
    const id = '68498236a100312bea07901c';
    const a = await (await fetch(APP + `/api/v2/stories/${id}/save`, { method: 'POST', headers: h, body: '{"action":"add"}' })).json();
    const b = await (await fetch(APP + `/api/v2/stories/${id}/save`, { method: 'POST', headers: h, body: '{"action":"add"}' })).json();
    expect(a.data.changed).toBe(true);
    expect(b.data.changed).toBe(false);
    expect(b.data.favoriteCount).toBe(a.data.favoriteCount);
    const c = await (await fetch(APP + `/api/v2/stories/${id}/save`, { method: 'POST', headers: h, body: '{"action":"remove"}' })).json();
    expect(c.data.favoriteCount).toBe(a.data.favoriteCount - 1);
  });

  it('map points carry coordinates', async () => {
    const r = await get('/api/v2/map?country=JP');
    expect(r.body.data.points.length).toBeGreaterThan(0);
    expect(r.body.data.points[0]).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it('OpenAPI document lists v1 and v2 paths', async () => {
    const r = await get('/docs/openapi.json');
    expect(Object.keys(r.body.paths)).toEqual(expect.arrayContaining(['/api/stories', '/api/auth/login', '/api/v2/stories', '/api/v2/search', '/api/v2/travellers/{id}/bookings']));
  });

  it('MCP requires the token and lists tools', async () => {
    const no = await fetch(APP + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    expect(no.status).toBe(401);
    if (!process.env.MCP_TOKEN) return;
    const ok = await (await fetch(APP + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MCP_TOKEN}` }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).json();
    const names = ok.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['stories_search', 'story_create', 'traveller_update', 'categories_list', 'bookings_list', 'booking_set_status', 'stats_overview']));
    const call = await (await fetch(APP + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.MCP_TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'stories_search', arguments: { query: 'острови влітку', perPage: 3 } } }) })).json();
    expect(call.result.structuredContent.total).toBeGreaterThan(0);
  });
});
