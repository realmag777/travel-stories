// Shared Knex instance. Postgres arrays come back as JS arrays, dates as 'YYYY-MM-DD' strings.
const knex = require('knex');
const { types } = require('pg');
const config = require('../../knexfile');

// DATE columns stay plain strings so the API returns exactly 'YYYY-MM-DD' without timezone drift.
types.setTypeParser(1082, (v) => v);
// BIGINT counts fit into JS numbers for this project.
types.setTypeParser(20, (v) => Number(v));

const db = knex(config);

module.exports = db;
