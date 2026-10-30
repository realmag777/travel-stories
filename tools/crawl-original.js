// Read-only reconnaissance of the original Travel Stories frontend.
// Takes full-page screenshots, extracts design tokens (CSS variables, computed
// styles, hover states), saves DOM snapshots and downloads public assets.
// Never creates accounts and never submits forms.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SITE = process.env.ORIGINAL_SITE || 'https://travel-stories-frontend.vercel.app';
const API = process.env.ORIGINAL_API || 'https://travel-stories-backend.onrender.com';
const OUT = path.join(__dirname, 'reference');
const WIDTHS = (process.env.WIDTHS || '320,375,768,1440,1920').split(',').map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

// Selectors whose computed styles define the design system.
const KEY_SELECTORS = [
  'body', 'header', 'header a', 'header nav a', 'header button', 'header img', 'header svg',
  'main', 'h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'input', 'textarea', 'select', 'label',
  'section', 'footer', 'footer a', 'footer p', 'ul li', 'article', 'img', 'form',
];
const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'max-width', 'margin', 'padding', 'gap',
  'font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing', 'text-transform',
  'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow',
  'opacity', 'transition', 'grid-template-columns', 'flex-direction', 'justify-content', 'align-items',
  'text-align', 'object-fit', 'cursor', 'text-decoration-line', 'outline',
];

async function getIds() {
  const j = async (p) => (await fetch(API + p)).json();
  const cats = await j('/api/categories');
  const st = await j('/api/stories?page=1&perPage=20');
  // Prefer a story with a long article so the detail page is representative.
  const story = st.data.stories.sort((a, b) => b.article.length - a.article.length)[0];
  const users = await j('/api/users?page=1&limit=4');
  return { category: cats.data[0]._id, story: process.env.STORY_ID || story._id, user: users.data.users[0]._id };
}

async function extractTokens(page) {
  return page.evaluate(({ KEY_SELECTORS, STYLE_PROPS }) => {
    const vars = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => {
        for (const r of Array.from(list)) {
          if (r.cssRules) walk(r.cssRules);
          if (r.style && /(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText || '')) {
            for (const n of Array.from(r.style)) if (n.startsWith('--')) vars[n] = r.style.getPropertyValue(n).trim();
          }
        }
      };
      walk(rules);
    }
    const styles = {};
    for (const sel of KEY_SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel)).slice(0, 4);
      styles[sel] = els.map((el) => {
        const cs = getComputedStyle(el);
        const cls = typeof el.className === 'string' ? el.className : '';
        const o = { _text: (el.innerText || el.getAttribute('alt') || '').trim().slice(0, 60), _class: cls };
        for (const p of STYLE_PROPS) o[p] = cs.getPropertyValue(p);
        const r = el.getBoundingClientRect();
        o._rect = [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)];
        return o;
      });
    }
    const fonts = Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.style} ${f.status}`);
    return { vars, styles, fonts };
  }, { KEY_SELECTORS, STYLE_PROPS });
}

// Hover every visible link/button and record which computed properties change.
async function extractHovers(page) {
  const handles = await page.$$('a, button, [role="button"], label');
  const result = [];
  for (const h of handles.slice(0, 60)) {
    try {
      if (!(await h.isVisible())) continue;
      const read = () => h.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, shadow: cs.boxShadow, deco: cs.textDecorationLine, opacity: cs.opacity, transform: cs.transform, cursor: cs.cursor, transition: cs.transition };
      });
      const before = await read();
      await h.hover({ timeout: 1500 });
      await page.waitForTimeout(350);
      const after = await read();
      const diff = {};
      for (const k of Object.keys(before)) if (before[k] !== after[k]) diff[k] = [before[k], after[k]];
      const label = await h.evaluate((el) => `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(' ').join('.')} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`);
      result.push({ el: label, cursor: before.cursor, transition: before.transition, diff });
    } catch { /* element detached or covered */ }
  }
  await page.mouse.move(0, 0);
  return result;
}

async function scrollThrough(page) {
  // Trigger lazy images before the full-page screenshot.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

(async () => {
  mkdir(OUT);
  const ids = await getIds();
  const PAGES = [
    ['home', '/'],
    ['stories', '/stories'],
    ['stories-category', `/stories?category=${ids.category}`],
    ['story', `/stories/${ids.story}`],
    ['travellers', '/travellers'],
    ['traveller', `/travellers/${ids.user}`],
    ['login', '/auth/login'],
    ['register', '/auth/register'],
    ['create', '/stories/create'],
    ['not-found', '/this-page-does-not-exist'],
  ].filter(([n]) => !ONLY || ONLY.includes(n));

  // PW_CHANNEL=chrome uses the system Chrome when the bundled Chromium has no network.
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const assets = new Map();
  const tokens = { site: SITE, ids, crawledAt: new Date().toISOString(), pages: {} };
  const notes = {};

  for (const [name, url] of PAGES) {
    const dir = path.join(OUT, name);
    mkdir(dir);
    tokens.pages[name] = { url };
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 800 : 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('response', async (res) => {
        const t = res.request().resourceType();
        const u = res.url();
        if (!['image', 'font', 'stylesheet'].includes(t) && !/\.(svg|ico|webp|png|jpe?g)(\?|$)/.test(u)) return;
        if (assets.has(u)) return;
        try { assets.set(u, { type: t, body: await res.body(), ct: res.headers()['content-type'] }); } catch { /* redirects have no body */ }
      });
      await page.goto(SITE + url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await scrollThrough(page);
      if (name === 'create') notes.createWithoutLogin = { requested: url, finalUrl: page.url(), title: await page.title() };
      await page.screenshot({ path: path.join(dir, `${w}.png`), fullPage: true });
      if (w === 1440 || w === 375) {
        tokens.pages[name][w] = await extractTokens(page);
        fs.writeFileSync(path.join(dir, `${w}.html`), await page.content());
        if (w === 1440 || name === 'home') tokens.pages[name][`hover${w}`] = await extractHovers(page);
        tokens.pages[name][`meta${w}`] = await page.evaluate(() => ({
          title: document.title,
          description: document.querySelector('meta[name=description]')?.content,
          scrollHeight: document.documentElement.scrollHeight,
        }));
      }
      // Open the burger menu below desktop to capture the mobile navigation.
      if (name === 'home' && w === 375) {
        const burger = await page.$('header button');
        if (burger) {
          await burger.click().catch(() => {});
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(dir, '375-menu.png') });
          fs.writeFileSync(path.join(dir, '375-menu.html'), await page.content());
        }
      }
      await ctx.close();
      console.log('shot', name, w);
    }
  }
  await browser.close();

  const adir = path.join(OUT, 'assets');
  mkdir(adir);
  const index = [];
  for (const [u, a] of assets) {
    const clean = u.split('?')[0];
    let file = decodeURIComponent(clean.replace(/^https?:\/\//, '')).replace(/[^\w.\-]+/g, '_');
    // Short names keep Windows clones under the 260-character path limit; index.json keeps the URL.
    if (file.length > 48 || /_next\/image/.test(clean)) {
      const inner = /_next\/image/.test(clean) ? new URL(u).searchParams.get('url') || '' : clean;
      const ext = (inner.match(/\.(css|svg|ico|jpe?g|png|webp|woff2)(?:$|\?)/i) || [, 'bin'])[1].toLowerCase();
      file = require('crypto').createHash('sha1').update(u).digest('hex').slice(0, 12) + '.' + ext;
    }
    fs.writeFileSync(path.join(adir, file), a.body);
    index.push({ url: u, file, type: a.type, contentType: a.ct, bytes: a.body.length });
  }
  const idxFile = path.join(adir, 'index.json');
  const prevIndex = ONLY && fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
  const merged = [...prevIndex.filter((a) => !index.some((b) => b.url === a.url)), ...index];
  fs.writeFileSync(idxFile, JSON.stringify(merged, null, 1));
  // A partial run (ONLY=...) merges into the previous full crawl instead of replacing it.
  const tokFile = path.join(OUT, 'tokens.json');
  if (ONLY && fs.existsSync(tokFile)) {
    const prev = JSON.parse(fs.readFileSync(tokFile, 'utf8'));
    Object.assign(prev.pages, tokens.pages);
    Object.assign(prev.notes || (prev.notes = {}), notes);
    prev.ids = { ...prev.ids, ...ids };
    fs.writeFileSync(tokFile, JSON.stringify(prev, null, 1));
  } else {
    tokens.notes = notes;
    fs.writeFileSync(tokFile, JSON.stringify(tokens, null, 1));
  }
  console.log('assets', index.length, 'notes', JSON.stringify(notes));
})();
