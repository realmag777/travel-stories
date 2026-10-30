// Read-only import of the original Travel Stories API: every category, story and user,
// plus their images. Writes a snapshot to seeds/original/ (committed), which the bootstrap
// loads into Postgres. On first container start it refreshes the snapshot when the API is reachable.
// Usage: node tools/import-original.js [--if-missing] [--no-media]
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API = process.env.ORIGINAL_API || 'https://travel-stories-backend.onrender.com';
const OUT = path.join(__dirname, '..', 'seeds', 'original');
const IF_MISSING = process.argv.includes('--if-missing');
const NO_MEDIA = process.argv.includes('--no-media');
const DEFAULT_AVATAR = /default-avatar/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(API + p, { signal: AbortSignal.timeout(90000) });
      if (r.ok) return (await r.json()).data;
      if (r.status < 500) throw new Error(`${r.status} ${p}`);
    } catch (e) {
      if (i === 4) throw e;
    }
    await sleep(3000 * (i + 1)); // Render free tier wakes up slowly.
  }
  return null;
}

async function download(url, file) {
  if (fs.existsSync(file)) return true;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return false;
    // Re-encode to a 1280px JPEG so the committed snapshot stays small.
    const buf = Buffer.from(await r.arrayBuffer());
    await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(file);
    return true;
  } catch {
    return false;
  }
}

const extOf = (url) => (url.match(/\.(jpe?g|png|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase();

async function run() {
  if (IF_MISSING && fs.existsSync(path.join(OUT, 'stories.json'))) {
    console.log('[import] snapshot exists, skipping');
    return;
  }
  fs.mkdirSync(path.join(OUT, 'media', 'covers'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'media', 'avatars'), { recursive: true });

  const categories = await get('/api/categories');
  console.log(`[import] categories: ${categories.length}`);

  const stories = [];
  for (let page = 1; ; page++) {
    const d = await get(`/api/stories?page=${page}&perPage=20`);
    stories.push(...d.stories);
    if (!d.hasNextPage) break;
  }
  console.log(`[import] stories: ${stories.length}`);

  const users = [];
  for (let page = 1; ; page++) {
    const d = await get(`/api/users?page=${page}&limit=50`);
    users.push(...d.users);
    if (!d.hasNextPage) break;
  }
  console.log(`[import] users: ${users.length}`);

  // Story owners that are missing from /api/users still get a record.
  const byId = new Map(users.map((u) => [u._id, u]));
  for (const s of stories) {
    if (s.ownerId && typeof s.ownerId === 'object' && !byId.has(s.ownerId._id)) {
      byId.set(s.ownerId._id, { _id: s.ownerId._id, name: s.ownerId.name, avatarUrl: s.ownerId.avatarUrl, description: '' });
    }
  }
  const allUsers = [...byId.values()];

  if (!NO_MEDIA) {
    let n = 0;
    for (const s of stories) {
      if (!s.img) continue;
      const file = path.join(OUT, 'media', 'covers', `${s._id}.${extOf(s.img)}`);
      if (await download(s.img, file)) { s.localImg = path.basename(file); n++; }
    }
    let a = 0;
    for (const u of allUsers) {
      if (!u.avatarUrl || DEFAULT_AVATAR.test(u.avatarUrl)) continue;
      const file = path.join(OUT, 'media', 'avatars', `${u._id}.${extOf(u.avatarUrl)}`);
      if (await download(u.avatarUrl, file)) { u.localAvatar = path.basename(file); a++; }
    }
    console.log(`[import] media: ${n} covers, ${a} avatars`);
  }

  fs.writeFileSync(path.join(OUT, 'categories.json'), JSON.stringify(categories, null, 1));
  fs.writeFileSync(path.join(OUT, 'stories.json'), JSON.stringify(stories, null, 1));
  fs.writeFileSync(path.join(OUT, 'users.json'), JSON.stringify(allUsers, null, 1));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ source: API, importedAt: new Date().toISOString(), stories: stories.length, users: allUsers.length }, null, 1));
  console.log('[import] snapshot written to seeds/original');
}

module.exports = { run };
if (require.main === module) run().catch((e) => { console.error('[import] failed:', e.message); process.exit(1); });
