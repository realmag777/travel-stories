// Original Travel Stories REST API, endpoint for endpoint (see /docs): same paths, query limits,
// envelopes, messages and cookie-based auth (accessToken / refreshToken / sessionId).
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../../core/db');
const { objectId } = require('../../core/ids');
const { ok, fail, validate, validationError, joiMessage, asyncRoute } = require('../../core/http');
const images = require('../../core/images');
const { v1 } = require('../../shared/schemas');
const content = require('../content');
const { limiters, visitorHash } = require('../../core/security');

const ACCESS_TTL = 15 * 60 * 1000;
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1, fields: 10 } });

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// ---- auth helpers ----
function cookieOpts(req, maxAge) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return { httpOnly: true, sameSite: secure ? 'none' : 'lax', secure, maxAge, path: '/' };
}

async function createSession(req, res, userId) {
  const now = Date.now();
  const row = {
    id: objectId(),
    user_id: userId,
    access_token: crypto.randomBytes(30).toString('base64url'),
    refresh_token: crypto.randomBytes(30).toString('base64url'),
    access_valid_until: new Date(now + ACCESS_TTL),
    refresh_valid_until: new Date(now + REFRESH_TTL),
  };
  await db('auth_sessions').insert(row);
  res.cookie('accessToken', row.access_token, cookieOpts(req, ACCESS_TTL));
  res.cookie('refreshToken', row.refresh_token, cookieOpts(req, REFRESH_TTL));
  res.cookie('sessionId', row.id, cookieOpts(req, REFRESH_TTL));
  return row;
}

function clearAuthCookies(req, res) {
  for (const c of ['accessToken', 'refreshToken', 'sessionId']) res.clearCookie(c, cookieOpts(req, 0));
}

function readCookies(req) {
  const out = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function sessionUser(req) {
  const c = readCookies(req);
  const token = c.accessToken || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const s = await db('auth_sessions').where({ access_token: token }).first();
  if (!s || new Date(s.access_valid_until) < new Date()) return null;
  return content.usersWithCounts().where('u.id', s.user_id).first();
}

const authenticate = asyncRoute(async (req, res, next) => {
  const user = await sessionUser(req);
  if (!user) return fail(res, 401, 'Unauthorized');
  req.user = user;
  next();
});

/** Multer errors and missing files mapped onto the original 400 contract. */
function fileField(name, required) {
  const mw = upload.single(name);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message);
    if (required && !req.file) return validationError(res, 'body', [name], `"${name}" is required`);
    next();
  });
}

function pageMeta(page, perPage, totalItems, withPages) {
  const totalPages = Math.ceil(totalItems / perPage);
  const meta = { page, perPage, totalItems, hasNextPage: page * perPage < totalItems };
  if (withPages) Object.assign(meta, { totalPages, hasPreviousPage: page > 1 });
  return meta;
}

const publicStories = () => content.storyBase().where('s.hidden', false);
const publicUsers = () => content.usersWithCounts().where('u.hidden', false);

function register(app) {
  const r = express.Router();

  // ---------- Categories ----------
  r.get('/categories', asyncRoute(async (req, res) => {
    const d = await content.dicts();
    ok(res, 200, 'Successfully found categories!', d.categories.map((c) => ({ _id: c.id, name: c.name })));
  }));

  // ---------- Stories ----------
  r.get('/stories', validate('query', v1.storiesQuery), asyncRoute(async (req, res) => {
    const { page, perPage, category } = req.valid.query;
    const q = publicStories();
    if (category) q.where('s.category_id', category);
    const [{ n }] = await q.clone().clearSelect().count({ n: '*' });
    const rows = await q.orderBy([{ column: 's.date', order: 'desc' }, { column: 's.created_at', order: 'desc' }, { column: 's.id', order: 'desc' }])
      .limit(perPage).offset((page - 1) * perPage);
    const d = await content.dicts();
    ok(res, 200, 'Successfully found stories!', {
      stories: rows.map((s) => content.apiStory(s, baseUrl(req), { d })),
      ...pageMeta(page, perPage, Number(n), true),
    });
  }));

  r.get('/stories/popular', validate('query', v1.popularQuery), asyncRoute(async (req, res) => {
    const { page, perPage } = req.valid.query;
    const [{ n }] = await db('stories').where({ hidden: false }).count({ n: '*' });
    const rows = await publicStories().orderBy([{ column: 's.favorite_count', order: 'desc' }, { column: 's.date', order: 'desc' }, { column: 's.id' }])
      .limit(perPage).offset((page - 1) * perPage);
    const d = await content.dicts();
    ok(res, 200, 'Successfully found popular stories', {
      stories: rows.map((s) => content.apiStory(s, baseUrl(req), { d })),
      ...pageMeta(page, perPage, Number(n), false),
    });
  }));

  r.get('/stories/own', authenticate, validate('query', v1.ownQuery), asyncRoute(async (req, res) => {
    const { page, perPage } = req.valid.query;
    const q = content.storyBase().where('s.owner_id', req.user.id);
    const [{ n }] = await q.clone().clearSelect().count({ n: '*' });
    const rows = await q.orderBy('s.created_at', 'desc').limit(perPage).offset((page - 1) * perPage);
    const d = await content.dicts();
    ok(res, 200, 'Successfully found own stories', {
      stories: rows.map((s) => content.apiStory(s, baseUrl(req), { d })),
      ...pageMeta(page, perPage, Number(n), false),
    });
  }));

  r.get('/stories/saved', authenticate, validate('query', v1.ownQuery), asyncRoute(async (req, res) => {
    const { page, perPage } = req.valid.query;
    const q = content.storyBase().join('user_favorites as f', 'f.story_id', 's.id').where('f.user_id', req.user.id);
    const [{ n }] = await q.clone().clearSelect().count({ n: '*' });
    const rows = await q.orderBy('f.created_at', 'desc').limit(perPage).offset((page - 1) * perPage);
    const d = await content.dicts();
    ok(res, 200, 'Successfully found saved stories', {
      stories: rows.map((s) => content.apiStory(s, baseUrl(req), { d })),
      ...pageMeta(page, perPage, Number(n), false),
    });
  }));

  r.post('/stories', limiters.write, authenticate, fileField('cover', true), validate('body', v1.storyCreate), asyncRoute(async (req, res) => {
    const { title, article, category } = req.valid.body;
    const d = await content.dicts();
    if (!d.categoryById[category]) return fail(res, 404, 'Category not found');
    try { await images.assertImage(req.file.buffer, 2097152); } catch (e) { return fail(res, 400, e.message); }
    const id = objectId();
    const coverKey = await images.processCover(req.file.buffer, id);
    await db('stories').insert({
      id, title, article, category_id: category, owner_id: req.user.id, cover_key: coverKey,
      date: new Date().toISOString().slice(0, 10), source: 'api',
    });
    const row = await content.getStory(id);
    ok(res, 201, 'Successfully created a story!', content.apiStory(row, baseUrl(req), { populate: false, d }));
  }));

  r.patch('/stories/favorite/add/:storyId', limiters.write, authenticate, validate('params', v1.storyIdParam), asyncRoute(async (req, res) => {
    const id = req.valid.params.storyId;
    const story = await db('stories').where({ id }).first();
    if (!story) return fail(res, 404, 'Story not found');
    if (story.owner_id === req.user.id) return fail(res, 403, 'You cannot save your own story');
    const inserted = await db('user_favorites').insert({ user_id: req.user.id, story_id: id }).onConflict(['user_id', 'story_id']).ignore().returning('story_id');
    if (!inserted.length) return fail(res, 400, 'Story is already in favorites');
    await db('stories').where({ id }).increment('favorite_count', 1);
    const [row, d] = [await content.getStory(id), await content.dicts()];
    ok(res, 200, 'Story added to favorites', { user: content.apiUser(req.user, baseUrl(req)), story: content.apiStory(row, baseUrl(req), { populate: false, d }) });
  }));

  r.patch('/stories/favorite/remove/:storyId', limiters.write, authenticate, validate('params', v1.storyIdParam), asyncRoute(async (req, res) => {
    const id = req.valid.params.storyId;
    const story = await db('stories').where({ id }).first();
    if (!story) return fail(res, 404, 'Story not found');
    const removed = await db('user_favorites').where({ user_id: req.user.id, story_id: id }).del();
    if (!removed) return fail(res, 404, 'Story is not in favorites');
    await db('stories').where({ id }).andWhere('favorite_count', '>', 0).decrement('favorite_count', 1);
    const [row, d] = [await content.getStory(id), await content.dicts()];
    ok(res, 200, 'Story removed from favorites', { user: content.apiUser(req.user, baseUrl(req)), story: content.apiStory(row, baseUrl(req), { populate: false, d }) });
  }));

  r.get('/stories/:storyId', validate('params', v1.storyIdParam), asyncRoute(async (req, res) => {
    const row = await publicStories().where('s.id', req.valid.params.storyId).first();
    if (!row) return fail(res, 404, 'Story not found');
    const d = await content.dicts();
    ok(res, 200, 'Successfully found story', content.apiStory(row, baseUrl(req), { d }));
  }));

  r.patch('/stories/:storyId', limiters.write, authenticate, validate('params', v1.storyIdParam), fileField('cover', false), validate('body', v1.storyPatch), asyncRoute(async (req, res) => {
    const id = req.valid.params.storyId;
    const body = req.valid.body;
    if (!req.file && !Object.keys(body).length) return validationError(res, 'body', [], '"value" must have at least 1 key');
    const story = await db('stories').where({ id, owner_id: req.user.id }).first();
    if (!story) return fail(res, 404, 'Story not found');
    const d = await content.dicts();
    if (body.category && !d.categoryById[body.category]) return fail(res, 404, 'Category not found');
    const patch = { updated_at: db.fn.now() };
    if (body.title) patch.title = body.title;
    if (body.article) patch.article = body.article;
    if (body.category) patch.category_id = body.category;
    if (req.file) {
      try { await images.assertImage(req.file.buffer, 2097152); } catch (e) { return fail(res, 400, e.message); }
      patch.cover_key = await images.processCover(req.file.buffer, id);
      if (story.cover_key) images.removeKey(story.cover_key);
    }
    await db('stories').where({ id }).update(patch);
    const row = await content.getStory(id);
    ok(res, 200, 'Successfully updated a story!', content.apiStory(row, baseUrl(req), { populate: false, d }));
  }));

  // ---------- Users ----------
  r.get('/users', validate('query', v1.usersQuery), asyncRoute(async (req, res) => {
    const { page, limit } = req.valid.query;
    const [{ n }] = await db('users').where({ hidden: false }).count({ n: '*' });
    const rows = await publicUsers().orderBy('u.id').limit(limit).offset((page - 1) * limit);
    ok(res, 200, 'Successfully found travellers', {
      users: rows.map((u) => content.apiUser(u, baseUrl(req))),
      ...pageMeta(page, limit, Number(n), false),
    });
  }));

  r.get('/users/me', authenticate, asyncRoute(async (req, res) => {
    const favs = await db('user_favorites').where({ user_id: req.user.id }).orderBy('created_at').pluck('story_id');
    ok(res, 200, 'Successfully found current user profile', { ...content.apiUser(req.user, baseUrl(req)), favorites: favs });
  }));

  r.patch('/users', limiters.write, authenticate, validate('body', v1.userPatch), asyncRoute(async (req, res) => {
    const body = req.valid.body;
    if (body.email) {
      const taken = await db('users').where({ email: body.email }).whereNot({ id: req.user.id }).first();
      if (taken) return fail(res, 409, 'Email is already in use');
    }
    await db('users').where({ id: req.user.id }).update({ ...body, updated_at: db.fn.now() });
    const u = await content.usersWithCounts().where('u.id', req.user.id).first();
    ok(res, 200, 'Successfully updated user profile', content.apiUser(u, baseUrl(req)));
  }));

  r.patch('/users/avatar', limiters.write, authenticate, fileField('avatar', true), asyncRoute(async (req, res) => {
    try { await images.assertImage(req.file.buffer, 512000); } catch (e) { return fail(res, 400, e.message); }
    const key = await images.processAvatar(req.file.buffer, req.user.id);
    if (req.user.avatar_key) images.removeKey(req.user.avatar_key);
    await db('users').where({ id: req.user.id }).update({ avatar_key: key, updated_at: db.fn.now() });
    ok(res, 200, 'Avatar updated successfully', { url: content.absolute(baseUrl(req), images.variantUrl(key, 256)) });
  }));

  r.get('/users/:id', validate('params', v1.idParam), validate('query', v1.userQuery), asyncRoute(async (req, res) => {
    const { page, limit } = req.valid.query;
    const user = await publicUsers().where('u.id', req.valid.params.id).first();
    if (!user) return fail(res, 404, 'User not found');
    const q = publicStories().where('s.owner_id', user.id);
    const [{ n }] = await q.clone().clearSelect().count({ n: '*' });
    const rows = await q.orderBy([{ column: 's.date', order: 'desc' }, { column: 's.id', order: 'desc' }]).limit(limit).offset((page - 1) * limit);
    ok(res, 200, 'Successfully found traveller profile and stories', {
      traveller: content.apiUser(user, baseUrl(req)),
      stories: rows.map((s) => content.apiStory(s, baseUrl(req), { populate: false })),
      ...pageMeta(page, limit, Number(n), false),
    });
  }));

  // ---------- Auth ----------
  r.post('/auth/register', limiters.login, validate('body', v1.register), asyncRoute(async (req, res) => {
    const { name, email, password } = req.valid.body;
    if (await db('users').where({ email }).first()) return fail(res, 409, 'Email in use');
    const id = objectId();
    await db('users').insert({ id, name, email, password_hash: await bcrypt.hash(password, 10), source: 'api' });
    const u = await content.usersWithCounts().where('u.id', id).first();
    ok(res, 201, 'Successfully registered a user', content.apiUser(u, baseUrl(req)));
  }));

  r.post('/auth/login', limiters.login, validate('body', v1.login), asyncRoute(async (req, res) => {
    const { email, password } = req.valid.body;
    const u = await content.usersWithCounts().where('u.email', email).first();
    if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash))) return fail(res, 401, 'Invalid email or password');
    await createSession(req, res, u.id);
    ok(res, 200, 'Successful login', content.apiUser(u, baseUrl(req)));
  }));

  r.post('/auth/refresh', asyncRoute(async (req, res) => {
    const c = readCookies(req);
    const s = c.refreshToken && await db('auth_sessions').where({ refresh_token: c.refreshToken, id: c.sessionId || '' }).first();
    if (!s || new Date(s.refresh_valid_until) < new Date()) {
      clearAuthCookies(req, res);
      return fail(res, 401, 'Session not found or expired');
    }
    await db('auth_sessions').where({ id: s.id }).del();
    await createSession(req, res, s.user_id);
    ok(res, 200, 'Successfully refreshed a session', null);
  }));

  r.get('/auth/session', asyncRoute(async (req, res) => {
    const u = await sessionUser(req);
    ok(res, 200, 'Successfully found current session user', u ? content.apiUser(u, baseUrl(req)) : null);
  }));

  r.post('/auth/logout', authenticate, asyncRoute(async (req, res) => {
    const c = readCookies(req);
    await db('auth_sessions').where({ access_token: c.accessToken || '' }).orWhere({ id: c.sessionId || '' }).del();
    clearAuthCookies(req, res);
    res.status(204).end();
  }));

  // Unknown /api/* routes answer in the same envelope.
  r.use((req, res) => fail(res, 404, 'Route not found'));

  app.use('/api', r);
}

module.exports = { register, sessionUser, visitorHash, joiMessage };
