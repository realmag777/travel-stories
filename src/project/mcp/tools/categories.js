// MCP tools: categories CRUD (deleting a used category is refused).
const db = require('../../../core/db');
const { objectId } = require('../../../core/ids');
const schemas = require('../../../shared/schemas');
const content = require('../../content');

const tools = [
  {
    name: 'categories_list',
    description: 'All categories with story counts.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const rows = await db('categories as c').select('c.*', db.raw('(SELECT count(*) FROM stories s WHERE s.category_id = c.id)::int AS stories')).orderBy('c.sort');
      return { categories: rows };
    },
  },
  {
    name: 'category_create',
    description: 'Create a category.',
    write: true,
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, name_en: { type: 'string' }, name_es: { type: 'string' }, sort: { type: 'integer' } } },
    async handler(a) {
      const v = schemas.adminCategory.parse(a);
      const id = objectId();
      await db('categories').insert({ id, ...v });
      content.invalidateDicts();
      return { id };
    },
  },
  {
    name: 'category_update',
    description: 'Rename or reorder a category.',
    write: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, name_en: { type: 'string' }, name_es: { type: 'string' }, sort: { type: 'integer' } } },
    async handler(a) {
      const c = await db('categories').where({ id: a.id }).first();
      if (!c) throw new Error('Category not found');
      const v = schemas.adminCategory.parse({ name: a.name ?? c.name, name_en: a.name_en ?? c.name_en ?? '', name_es: a.name_es ?? c.name_es ?? '', sort: a.sort ?? c.sort });
      await db('categories').where({ id: a.id }).update({ ...v, updated_at: db.fn.now() });
      content.invalidateDicts();
      return { id: a.id, updated: true };
    },
  },
  {
    name: 'category_delete',
    description: 'Delete an unused category.',
    write: true,
    destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    async handler({ id }) {
      const [{ n }] = await db('stories').where({ category_id: id }).count({ n: '*' });
      if (Number(n) > 0) throw new Error(`Category is used by ${n} stories`);
      if (!(await db('categories').where({ id }).del())) throw new Error('Category not found');
      content.invalidateDicts();
      return { id, deleted: true };
    },
  },
];

module.exports = { tools };
