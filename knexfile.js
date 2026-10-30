// Knex configuration. DATABASE_URL wins; otherwise the host-mapped port from .env is used
// so tools and tests can run outside Docker.
require('dotenv').config({ quiet: true });

const e = process.env;
const connection = e.DATABASE_URL || {
  host: e.PGHOST || '127.0.0.1',
  port: Number(e.PGPORT || e.POSTGRES_HOST_PORT || 5440),
  user: e.POSTGRES_USER,
  password: e.POSTGRES_PASSWORD,
  database: e.POSTGRES_DB,
};

module.exports = {
  client: 'pg',
  connection,
  pool: { min: 0, max: Number(e.DB_POOL_MAX || 10) },
  migrations: { directory: __dirname + '/migrations', tableName: 'knex_migrations' },
};
