// E2E tests against a running instance (APP_URL, default the Docker app on :8350).
// PW_CHANNEL=chrome uses the system Chrome when the bundled Chromium cannot be used.
const { defineConfig, devices } = require('@playwright/test');

const channel = process.env.PW_CHANNEL || undefined;

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:8350',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: { 'x-no-track': '1' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } }, testIgnore: /mobile.spec.js/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel, viewport: { width: 375, height: 800 } }, testMatch: /mobile\.spec\.js/ },
  ],
});
