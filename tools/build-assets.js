// Builds public/build: hashed CSS bundles (one source file per component, concatenated),
// JS bundles (esbuild), local fonts, Leaflet assets and responsive hero/join/OG images.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'build');
const WATCH = process.argv.includes('--watch');

const CSS_ORDER = [
  'node_modules/modern-normalize/modern-normalize.css',
  'public/css/tokens.css',
  'public/css/base.css',
  ...['header', 'nav', 'button', 'footer', 'hero', 'about', 'story-card', 'popular', 'travellers-block', 'join',
    'stories-page', 'travellers-page', 'story-page', 'auth', 'filters', 'search', 'booking', 'feedback']
    .map((n) => `public/css/components/${n}.css`),
];

const hashName = (name, buf) => {
  const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const ext = path.extname(name);
  return name.slice(0, -ext.length) + '.' + h + ext;
};

function minifyCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}

async function buildCss(manifest) {
  const css = CSS_ORDER.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const out = Buffer.from(minifyCss(css));
  const name = hashName('app.css', out);
  fs.writeFileSync(path.join(OUT, name), out);
  manifest['app.css'] = name;

  const mapCss = ['node_modules/leaflet/dist/leaflet.css', 'node_modules/leaflet.markercluster/dist/MarkerCluster.css',
    'node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css', 'public/css/components/map.css']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n').replace(/url\(images\//g, 'url(/build/leaflet/');
  const mapBuf = Buffer.from(minifyCss(mapCss));
  manifest['map.css'] = hashName('map.css', mapBuf);
  fs.writeFileSync(path.join(OUT, manifest['map.css']), mapBuf);

  const adminCss = ['node_modules/modern-normalize/modern-normalize.css', 'public/css/tokens.css', 'public/css/components/feedback.css', 'public/css/components/button.css', 'public/css/admin.css']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const adminBuf = Buffer.from(minifyCss(adminCss));
  manifest['admin.css'] = hashName('admin.css', adminBuf);
  fs.writeFileSync(path.join(OUT, manifest['admin.css']), adminBuf);
}

async function buildJs(manifest) {
  const entries = { app: 'src/client/main.js', booking: 'src/client/booking.js', map: 'src/client/map.js', admin: 'src/client/admin.js' };
  for (const [name, entry] of Object.entries(entries)) {
    const r = await esbuild.build({
      entryPoints: [path.join(ROOT, entry)], bundle: true, minify: true, format: 'iife', target: ['es2020'],
      write: false, legalComments: 'none', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
    });
    const buf = Buffer.from(r.outputFiles[0].contents);
    manifest[`${name}.js`] = hashName(`${name}.js`, buf);
    fs.writeFileSync(path.join(OUT, manifest[`${name}.js`]), buf);
  }
}

function copyFonts() {
  const dir = path.join(PUB, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const want = [
    ['nunito-sans', ['cyrillic', 'latin', 'latin-ext'], [400, 500, 600, 700]],
    ['inter', ['cyrillic', 'latin'], [700]],
    ['sora', ['latin'], [400, 600]],
  ];
  for (const [fam, subsets, weights] of want) {
    for (const s of subsets) for (const w of weights) {
      const f = `${fam}-${s}-${w}-normal.woff2`;
      fs.copyFileSync(path.join(ROOT, 'node_modules', '@fontsource', fam, 'files', f), path.join(dir, f));
    }
  }
}

function copyLeafletImages() {
  const dir = path.join(OUT, 'leaflet');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'node_modules/leaflet/dist/images'))) {
    fs.copyFileSync(path.join(ROOT, 'node_modules/leaflet/dist/images', f), path.join(dir, f));
  }
}

async function buildImages() {
  const hero = path.join(PUB, 'images', 'hero_2x.jpg');
  for (const w of [768, 1440, 1920, 2880]) {
    const f = path.join(OUT, `hero-${w}.webp`);
    if (!fs.existsSync(f)) await sharp(hero).resize({ width: w }).webp({ quality: w > 1440 ? 62 : 70 }).toFile(f);
  }
  const join = path.join(PUB, 'images', 'join_2x.jpg');
  for (const w of [704, 1312, 2624]) {
    const f = path.join(OUT, `join-${w}.webp`);
    if (!fs.existsSync(f)) await sharp(join).resize({ width: w }).webp({ quality: 70 }).toFile(f);
  }
  const og = path.join(OUT, 'og-default.jpg');
  if (!fs.existsSync(og)) await sharp(hero).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true }).toFile(og);
}

async function build() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  // Drop old hashed bundles (images are kept, they are content-addressed by size).
  for (const f of fs.readdirSync(OUT)) if (/\.[a-f0-9]{10}\.(css|js)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const manifest = {};
  copyFonts();
  copyLeafletImages();
  await Promise.all([buildCss(manifest), buildJs(manifest), buildImages()]);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`[build] ${Object.keys(manifest).length} bundles in ${Date.now() - t0} ms`);
}

build().then(() => {
  if (!WATCH) return;
  console.log('[build] watching public/css and src/client');
  let timer = null;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => build().catch((e) => console.error(e.message)), 150); };
  for (const d of ['public/css', 'public/css/components', 'src/client', 'src/shared']) fs.watch(path.join(ROOT, d), again);
}).catch((e) => { console.error(e); process.exit(1); });
