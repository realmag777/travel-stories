// Visual diff against the original at 375 / 768 / 1440 with pixelmatch.
// Both sites are captured live with the same masking, so different content does not count:
//   - photos and avatars become flat boxes, all text becomes transparent (layout, backgrounds,
//     borders, buttons, spacing and fonts' line boxes are compared);
//   - on our side blocks of new features ([data-extra]) are hidden, the catalog falls back to
//     the original grid.
// A second "raw" number compares the stored reference screenshots without masking.
// Usage: APP_URL=http://localhost:8350 PW_CHANNEL=chrome node tools/visual-diff.js [--pages=home,stories]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

const ORIGINAL = process.env.ORIGINAL_SITE || 'https://travel-stories-frontend.vercel.app';
const OURS = (process.env.APP_URL || 'http://localhost:8350').replace(/\/$/, '');
const WIDTHS = [375, 768, 1440];
const OUT = path.join(__dirname, 'reference', 'diff');
const REF = path.join(__dirname, 'reference');
const STORY = '68498236a100312bea07901c';
const USER = '6881563901add19ee16fcff5';
const CATEGORY = '68fb50c80ae91338641121f0';
const ONLY = (process.argv.find((a) => a.startsWith('--pages=')) || '').slice(8).split(',').filter(Boolean);

const PAGES = [
  ['home', '/'],
  ['stories', '/stories'],
  ['stories-category', `/stories?category=${CATEGORY}`],
  ['story', `/stories/${STORY}`],
  ['travellers', '/travellers'],
  ['traveller', `/travellers/${USER}`],
  ['login', '/auth/login'],
  ['register', '/auth/register'],
].filter(([n]) => !ONLY.length || ONLY.includes(n));

const MASK_CSS = `
  *, *::before, *::after { color: transparent !important; text-shadow: none !important; caret-color: transparent !important;
    transition: none !important; animation: none !important; -webkit-text-fill-color: transparent !important; }
  img:not([src*="logo"]) { opacity: 0 !important; }
  svg use[href*="logo"] { opacity: 1; }
  input::placeholder, textarea::placeholder { color: transparent !important; }
`;
const OURS_CSS = `[data-extra] { display: none !important; }`;

async function capture(page, url, width, ours) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: MASK_CSS + (ours ? OURS_CSS : '') });
  if (ours) await page.evaluate(() => document.querySelectorAll('.catalog').forEach((el) => el.classList.remove('catalog')));
  // Lazy images and fonts settle before the shot.
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 300)); window.scrollTo(0, 0); });
  await page.waitForTimeout(400);
  return PNG.sync.read(await page.screenshot({ fullPage: true }));
}

function crop(png, w, h) {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
  return out;
}

/** Compare the overlapping area; the height difference is reported separately. */
function compare(a, b, file) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const ca = crop(a, w, h);
  const cb = crop(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold: 0.12, includeAA: false });
  if (file) fs.writeFileSync(file, PNG.sync.write(diff));
  return { pct: (n / (w * h)) * 100, heightOriginal: a.height, heightOurs: b.height };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ deviceScaleFactor: 1, extraHTTPHeaders: { 'x-no-track': '1' } });
  const page = await ctx.newPage();
  const rows = [];
  for (const [name, url] of PAGES) {
    for (const w of WIDTHS) {
      const a = await capture(page, ORIGINAL + url, w, false);
      const b = await capture(page, OURS + url, w, true);
      fs.writeFileSync(path.join(OUT, `${name}-${w}-original.png`), PNG.sync.write(a));
      fs.writeFileSync(path.join(OUT, `${name}-${w}-ours.png`), PNG.sync.write(b));
      const masked = compare(a, b, path.join(OUT, `${name}-${w}-diff.png`));
      // Raw: stored reference screenshot vs ours without masks (content differences included).
      let raw = null;
      const refFile = path.join(REF, name, `${w}.png`);
      if (fs.existsSync(refFile)) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(OURS + url, { waitUntil: 'networkidle' }).catch(() => {});
        await page.addStyleTag({ content: OURS_CSS });
        await page.evaluate(() => document.querySelectorAll('.catalog').forEach((el) => el.classList.remove('catalog')));
        await page.waitForTimeout(500);
        const ours = PNG.sync.read(await page.screenshot({ fullPage: true }));
        raw = compare(PNG.sync.read(fs.readFileSync(refFile)), ours, null).pct;
      }
      rows.push({ page: name, width: w, masked: +masked.pct.toFixed(2), raw: raw === null ? null : +raw.toFixed(2), heightOriginal: masked.heightOriginal, heightOurs: masked.heightOurs });
      console.log(`${name.padEnd(17)} ${String(w).padStart(4)}  masked ${masked.pct.toFixed(2).padStart(6)}%  raw ${raw === null ? '   -  ' : raw.toFixed(2).padStart(6) + '%'}  h ${masked.heightOriginal}/${masked.heightOurs}`);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(REF, 'visual-diff.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  const avg = rows.reduce((s, r) => s + r.masked, 0) / rows.length;
  console.log(`\naverage masked diff: ${avg.toFixed(2)}%`);
})();
