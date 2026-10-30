// Shared E2E helpers: admin credentials come from E2E_ADMIN_PASS or the "# ADMIN_PASS=" note in .env.
const fs = require('fs');
const path = require('path');

function adminCredentials() {
  let pass = process.env.E2E_ADMIN_PASS;
  if (!pass) {
    const env = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    const m = env.match(/^#\s*ADMIN_PASS=(.+)$/m);
    pass = m && m[1].trim();
  }
  return { user: process.env.ADMIN_USER || 'admin', pass };
}

async function adminLogin(page) {
  const { user, pass } = adminCredentials();
  await page.goto('/admin/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await Promise.all([page.waitForURL(/\/admin\/?$/), page.click('button[type=submit]')]);
}

module.exports = { adminCredentials, adminLogin };
