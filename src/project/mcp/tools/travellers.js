// MCP tools: search and CRUD for travellers (guides included).
const db = require('../../../core/db');
const { objectId } = require('../../../core/ids');
const schemas = require('../../../shared/schemas');

const props = {
  name: { type: 'string', maxLength: 32 }, name_en: { type: 'string' }, description: { type: 'string', maxLength: 400 },
  description_en: { type: 'string' }, description_es: { type: 'string' }, accepts_bookings: { type: 'boolean' },
  booking_intro: { type: 'string' }, is_demo: { type: 'boolean' },
};

const tools = [
  {
    name: 'travellers_search',
    description: 'List travellers, optionally filtered by name and booking flag.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, acceptsBookings: { type: 'boolean' }, page: { type: 'integer' }, perPage: { type: 'integer', maximum: 50 } } },
    async handler(a) {
      const perPage = Math.min(a.perPage || 20, 50);
      const page = Math.max(1, a.page || 1);
      const q = db('users as u');
      if (a.q) q.whereILike('u.name', `%${a.q}%`);
      if (typeof a.acceptsBookings === 'boolean') q.where('u.accepts_bookings', a.acceptsBookings);
      const [{ n }] = await q.clone().count({ n: '*' });
      const rows = await q.select('u.id', 'u.name', 'u.name_en', 'u.is_demo', 'u.hidden', 'u.accepts_bookings', db.raw('(SELECT count(*) FROM stories s WHERE s.owner_id = u.id)::int AS stories'))
        .orderBy('u.id').limit(perPage).offset((page - 1) * perPage);
      return { total: Number(n), page, travellers: rows };
    },
  },
  {
    name: 'traveller_get',
    description: 'Traveller with services and upcoming free slot count.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    async handler({ id }) {
      const u = await db('users').where({ id }).first();
      if (!u) throw new Error('Traveller not found');
      delete u.password_hash;
      const services = await db('services').where({ user_id: id });
      const [{ n }] = await db('slots').where({ user_id: id }).andWhere('starts_at', '>', db.fn.now()).count({ n: '*' });
      return { ...u, services, upcomingSlots: Number(n) };
    },
  },
  {
    name: 'traveller_create',
    description: 'Create a traveller (author / guide).',
    write: true,
    inputSchema: { type: 'object', required: ['name'], properties: props },
    async handler(a) {
      const v = schemas.adminTraveller.parse(a);
      const id = objectId();
      await db('users').insert({ id, ...v, source: 'local' });
      return { id };
    },
  },
  {
    name: 'traveller_update',
    description: 'Update traveller fields (pass only what changes).',
    write: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, hidden: { type: 'boolean' }, ...props } },
    async handler(a) {
      const u = await db('users').where({ id: a.id }).first();
      if (!u) throw new Error('Traveller not found');
      const v = schemas.adminTraveller.parse({
        name: a.name ?? u.name, name_en: a.name_en ?? u.name_en ?? '', description: a.description ?? u.description ?? '',
        description_en: a.description_en ?? u.description_en ?? '', description_es: a.description_es ?? u.description_es ?? '',
        accepts_bookings: a.accepts_bookings ?? u.accepts_bookings, booking_intro: a.booking_intro ?? u.booking_intro ?? '', is_demo: a.is_demo ?? u.is_demo,
      });
      const patch = { ...v, updated_at: db.fn.now() };
      if (typeof a.hidden === 'boolean') patch.hidden = a.hidden;
      await db('users').where({ id: a.id }).update(patch);
      return { id: a.id, updated: true };
    },
  },
  {
    name: 'traveller_delete',
    description: 'Delete a traveller without stories.',
    write: true,
    destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    async handler({ id }) {
      const [{ n }] = await db('stories').where({ owner_id: id }).count({ n: '*' });
      if (Number(n) > 0) throw new Error(`Traveller has ${n} stories; reassign or delete them first`);
      const del = await db('users').where({ id }).del();
      if (!del) throw new Error('Traveller not found');
      return { id, deleted: true };
    },
  },
];

module.exports = { tools };
