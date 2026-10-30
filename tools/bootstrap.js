// First-start bootstrap, run by the container entrypoint before the server:
// migrations -> dictionaries -> original import -> demo content -> booking demo.
// Each step runs once; its flag is stored in settings.bootstrap so a deleted demo set
// is never re-created on restart.
require('dotenv').config({ quiet: true });
const db = require('../src/core/db');
const settings = require('../src/core/settings');
const seed = require('./load-seed');

async function waitForDb() {
  for (let i = 0; i < 60; i++) {
    try { await db.raw('select 1'); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error('database is not reachable');
}

/** Copy the demo uploads into the uploads volume once (marker file); later starts keep changes. */
function copyDemoUploads() {
  const fs = require('fs');
  const path = require('path');
  const { UPLOADS } = require('../src/core/images');
  const seed = path.join(__dirname, '..', 'demo-seed', 'uploads');
  const marker = path.join(UPLOADS, '.demo-ready');
  if (fs.existsSync(marker)) return console.log('[bootstrap] demo uploads already in place');
  if (!fs.existsSync(seed)) throw new Error('demo uploads are missing: ' + seed);
  fs.cpSync(seed, UPLOADS, { recursive: true, force: false, errorOnExist: false });
  fs.writeFileSync(marker, new Date().toISOString());
  console.log('[bootstrap] demo uploads copied into the volume');
}

async function main() {
  const t0 = Date.now();
  await waitForDb();
  const [batch, done] = await db.migrate.latest();
  console.log(`[bootstrap] migrations: batch ${batch}, ${done.length} applied`);

  // Demo mode: data comes only from demo/db/demo.dump (restored by Postgres on first start)
  // and demo/uploads. Nothing is imported or generated.
  if (process.env.DEMO_MODE === '1') {
    copyDemoUploads();
    const [{ n }] = await db('stories').count({ n: '*' });
    console.log(`[bootstrap] demo mode: ${n} stories from demo.dump, no import, no generation`);
    console.log(`[bootstrap] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await db.destroy();
    return;
  }

  const flags = (await settings.get('bootstrap')) || {};
  const save = async (k) => { flags[k] = new Date().toISOString(); await settings.set('bootstrap', flags); };

  if (!flags.dictionaries) {
    await seed.seedDictionaries();
    await save('dictionaries');
    console.log('[bootstrap] dictionaries seeded');
  }

  if (!flags.original) {
    if (process.env.IMPORT_ORIGINAL === '1') {
      try {
        // Refresh the snapshot from the live API when reachable; the committed snapshot is the fallback.
        await require('./import-original').run();
      } catch (e) {
        console.warn('[bootstrap] live import failed, using committed snapshot:', e.message);
      }
    }
    const r = await seed.loadOriginal();
    const m = await seed.moderateOriginal();
    console.log(`[bootstrap] moderation: ${m.hidden} test/duplicate stories hidden, ${m.visible} visible`);
    await save('original');
    console.log(`[bootstrap] original: ${r.stories} stories, ${r.users} users`);
  }

  if (!flags.demo) {
    const r = await seed.loadDemo();
    const b = await seed.loadBookingDemo(r.tIds);
    await save('demo');
    console.log(`[bootstrap] demo: ${r.travellers} travellers, ${r.stories} stories; booking: ${b.guides} guides, ${b.slots} slots`);
  }

  console.log(`[bootstrap] ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await db.destroy();
}

main().catch(async (e) => {
  console.error('[bootstrap] failed:', e);
  await db.destroy().catch(() => {});
  process.exit(1);
});
