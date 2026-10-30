// README screenshots from a running instance: APP_URL=http://localhost:8350 node tools/screenshots.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { adminCredentials } = require('../tests/e2e/helpers');

const APP = (process.env.APP_URL || 'http://localhost:8350').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-no-track': '1' } });
  const page = await ctx.newPage();
  const shot = async (name, url, { full = false, before, clip } = {}) => {
    await page.goto(APP + url, { waitUntil: 'networkidle' });
    if (before) await before();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full, clip });
    console.log('saved', name);
  };
  await shot('home-1440', '/');
  await shot('stories-filter-1440', '/stories/filter/season-summer/budget-low,medium?sort=popular');
  await shot('search-1440', '/stories/search?q=' + encodeURIComponent('куди поїхати в травні з дітьми недорого'));
  await shot('map-1440', '/map', { before: () => page.waitForSelector('.marker-cluster') });
  const story = await (await page.request.get(APP + '/api/v2/stories?country=JP&perPage=1')).json();
  await shot('story-1440', `/stories/${story.data.stories[0].id}`, { before: () => page.evaluate(() => window.scrollTo(0, 1150)) });

  // A guide profile with the booking block.
  await page.goto(APP + '/travellers');
  let href = null;
  for (let i = 0; i < 8 && !href; i++) {
    const link = page.locator('.traveller-card:has(.traveller-card__badge) a.traveller-card__link').first();
    if (await link.count()) href = await link.getAttribute('href'); else await page.locator('[data-load-more-travellers]').click();
  }
  if (href) {
    await shot('booking-1440', href, {
      before: async () => {
        await page.locator('.calendar__day--available').first().click();
        await page.locator('[data-slot]').first().click();
        await page.locator('#booking').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -20));
      },
    });
  }

  // Admin dashboard and story editor.
  const { user, pass } = adminCredentials();
  await page.goto(APP + '/admin/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await Promise.all([page.waitForURL(/\/admin\/?$/), page.click('button[type=submit]')]);
  await shot('admin-dashboard', '/admin');
  await shot('admin-story-editor', `/admin/stories/${story.data.stories[0].id}`);

  // Mobile.
  const m = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, extraHTTPHeaders: { 'x-no-track': '1' } });
  const mp = await m.newPage();
  for (const [name, url] of [['mobile-home', '/'], ['mobile-stories', '/stories']]) {
    await mp.goto(APP + url, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(500);
    await mp.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('saved', name);
  }
  await mp.locator('[data-open-filters]').click();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: path.join(OUT, 'mobile-filters.png') });
  await browser.close();
})();
