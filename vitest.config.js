// Unit and API tests. They talk to the real Postgres (DATABASE_URL or the host port from .env)
// and, for API contract tests, to a running app (APP_URL, default http://localhost:8350).
require('dotenv').config({ quiet: true });
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/api/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    pool: 'forks',
  },
});
