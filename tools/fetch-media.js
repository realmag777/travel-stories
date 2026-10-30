// Downloads media for the generated demo content (run once by the developer, results are committed):
//   - a cover per story from Wikimedia Commons (free licenses only; author/license kept in credits.json)
//   - an avatar per traveller from randomuser.me portraits
// Usage: node tools/fetch-media.js [--force] [--only=s-1-001,...]
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'seeds', 'data');
const OUT = path.join(ROOT, 'seeds', 'media');
const UA = 'PodorozhnykyPlus/1.0 (educational project; https://github.com/realmag777/travel-stories)';
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const FREE = /^(cc[ -]?by(-sa)?([ -][\d.]+)?|cc0|public domain|pd|cc-pd|cc[ -]zero|attribution|copyrighted free use|fal)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error('retries exhausted ' + url);
}

async function getBuffer(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error('retries exhausted ' + url);
}

/** Search Commons for a free, landscape, large photo matching the query. */
async function findCommons(query, used) {
  const tries = [query, query.split(' ').slice(0, 2).join(' ')];
  for (const q of tries) {
    const api = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6',
      gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1600', origin: '*',
    });
    const j = await getJson(api);
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !/jpeg|png/.test(ii.mime)) continue;
      if (used.has(p.title)) continue;
      const m = ii.extmetadata || {};
      const license = strip(m.LicenseShortName && m.LicenseShortName.value);
      if (!FREE.test(license) || /non-?free|fair use/i.test(license)) continue;
      if (ii.width < 1200 || ii.width / ii.height < 1.25 || ii.width / ii.height > 2.4) continue;
      if (/map|logo|flag|coat of arms|diagram|panorama/i.test(p.title)) continue;
      return {
        title: p.title,
        url: ii.thumburl || ii.url,
        author: strip(m.Artist && m.Artist.value).slice(0, 200) || 'Unknown author',
        license,
        licenseUrl: (m.LicenseUrl && m.LicenseUrl.value) || '',
        sourceUrl: ii.descriptionurl,
      };
    }
    await sleep(400);
  }
  return null;
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'covers'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'avatars'), { recursive: true });
  const creditsFile = path.join(OUT, 'credits.json');
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : {};
  const used = new Set(Object.values(credits).map((c) => c.title));
  const batches = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')));
  const travellers = batches.flatMap((b) => b.travellers || []);
  const stories = batches.flatMap((b) => b.stories || []);

  // Avatars: deterministic portrait index per gender, no repeats.
  const next = { male: 0, female: 0 };
  for (const t of travellers) {
    const idx = next[t.gender]++ % 100;
    const file = path.join(OUT, 'avatars', `${t.key}.jpg`);
    if (fs.existsSync(file) && !FORCE) continue;
    const url = `https://randomuser.me/api/portraits/${t.gender === 'male' ? 'men' : 'women'}/${idx}.jpg`;
    try {
      fs.writeFileSync(file, await getBuffer(url));
      process.stdout.write('a');
    } catch (e) { console.error('\navatar failed', t.key, e.message); }
  }
  console.log(`\navatars done (${travellers.length})`);

  let ok = 0;
  let miss = [];
  for (const s of stories) {
    if (ONLY.length && !ONLY.includes(s.key)) continue;
    const file = path.join(OUT, 'covers', `${s.key}.jpg`);
    if (fs.existsSync(file) && credits[s.key] && !FORCE) { ok++; continue; }
    try {
      const found = await findCommons(s.photoQuery, used);
      if (!found) { miss.push(s.key + ' ' + s.photoQuery); continue; }
      const buf = await getBuffer(found.url);
      await sharp(buf).rotate().resize(1280, 854, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 80, mozjpeg: true }).toFile(file);
      credits[s.key] = found;
      used.add(found.title);
      ok++;
      process.stdout.write('.');
      if (ok % 10 === 0) fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 1));
      await sleep(350);
    } catch (e) {
      miss.push(`${s.key} ${s.photoQuery} (${e.message})`);
    }
  }
  fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 1));
  console.log(`\ncovers ok=${ok} missing=${miss.length}`);
  miss.forEach((m) => console.log('  miss', m));
})();
