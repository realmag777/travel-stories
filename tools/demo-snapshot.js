// Builds the ready-to-run demo from the RUNNING dev stack (docker compose, services db + app):
//   1. pg_dump of the live DB -> restored into a scratch DB inside the db container
//   2. cleanup in the scratch DB: sessions and auth tokens, anonymous vote hashes, test API
//      accounts; bookings anonymized (Гість N / guestN@example.com); LLM/SMTP secrets blanked
//   3. pg_dump -Fc of the scratch DB -> demo/db/demo.dump, counts -> demo/db/manifest.json
//   4. /app/uploads of the app container -> demo/uploads (same paths the DB expects)
// The live DB is never modified. Usage: node tools/demo-snapshot.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ quiet: true });

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'demo');
const USER = process.env.POSTGRES_USER;
const DB = process.env.POSTGRES_DB;
const SCRATCH = `${DB}_snapshot`;

const dc = (args, opts = {}) => execFileSync('docker', ['compose', ...args], { cwd: ROOT, stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', maxBuffer: 1 << 28 });
const psql = (db, sql) => dc(['exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', USER, '-d', db, '-Atc', sql], { capture: true }).toString().trim();

const CLEANUP = `
TRUNCATE "session";
DELETE FROM auth_sessions;
DELETE FROM anon_favorites;
-- Accounts registered by API contract tests (no stories, example.com e-mails).
DELETE FROM users u WHERE u.source = 'api' AND u.email LIKE '%@example.com'
  AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = u.id);
-- Every booking becomes an anonymous guest with a stable number.
WITH n AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM bookings)
UPDATE bookings b SET name = 'Гість ' || n.rn, email = 'guest' || n.rn || '@example.com',
  message = CASE WHEN coalesce(b.message, '') = '' THEN '' ELSE 'Тестове повідомлення гостя ' || n.rn END
FROM n WHERE n.id = b.id;
-- No secrets in the snapshot: LLM and SMTP off, partner IDs empty.
UPDATE settings SET value = '{"provider":"","apiKey":"","model":"","baseUrl":""}' WHERE key = 'llm';
UPDATE settings SET value = '{"host":"","port":587,"user":"","pass":"","from":"","notify":""}' WHERE key = 'smtp';
UPDATE settings SET value = '{"bookingAid":"","skyscannerAssociateId":"","tripadvisorPartnerId":""}' WHERE key = 'affiliate';
UPDATE settings SET value = value || '{"snapshot": true}'::jsonb WHERE key = 'bootstrap';
`;

const COUNTS = `SELECT json_build_object(
  'stories', (SELECT count(*) FROM stories),
  'storiesVisible', (SELECT count(*) FROM stories WHERE NOT hidden),
  'storiesDemo', (SELECT count(*) FROM stories WHERE is_demo),
  'travellers', (SELECT count(*) FROM users),
  'travellersVisible', (SELECT count(*) FROM users WHERE NOT hidden),
  'guides', (SELECT count(*) FROM users WHERE accepts_bookings AND NOT hidden),
  'services', (SELECT count(*) FROM services),
  'slots', (SELECT count(*) FROM slots),
  'bookings', (SELECT count(*) FROM bookings),
  'categories', (SELECT count(*) FROM categories),
  'countries', (SELECT count(*) FROM countries),
  'coverKeys', (SELECT count(*) FROM stories WHERE cover_key IS NOT NULL),
  'avatarKeys', (SELECT count(*) FROM users WHERE avatar_key IS NOT NULL)
)`;

(async () => {
  fs.mkdirSync(path.join(OUT, 'db'), { recursive: true });
  console.log('[snapshot] dumping the live DB into a scratch DB');
  psql('postgres', `DROP DATABASE IF EXISTS ${SCRATCH}`);
  psql('postgres', `CREATE DATABASE ${SCRATCH}`);
  dc(['exec', '-T', 'db', 'sh', '-c', `pg_dump -U ${USER} -d ${DB} -Fc --no-owner --no-privileges -f /tmp/live.dump && pg_restore -U ${USER} -d ${SCRATCH} --no-owner --no-privileges /tmp/live.dump && rm /tmp/live.dump`]);

  console.log('[snapshot] cleaning and anonymizing');
  psql(SCRATCH, CLEANUP);
  psql(SCRATCH, 'VACUUM ANALYZE');
  const counts = JSON.parse(psql(SCRATCH, COUNTS));

  console.log('[snapshot] writing demo/db/demo.dump');
  dc(['exec', '-T', 'db', 'sh', '-c', `pg_dump -U ${USER} -d ${SCRATCH} -Fc -Z 9 --no-owner --no-privileges -f /tmp/demo.dump`]);
  const dbId = dc(['ps', '-q', 'db'], { capture: true }).toString().trim();
  execFileSync('docker', ['cp', `${dbId}:/tmp/demo.dump`, path.join(OUT, 'db', 'demo.dump')], { stdio: 'inherit' });
  dc(['exec', '-T', 'db', 'rm', '-f', '/tmp/demo.dump']);
  psql('postgres', `DROP DATABASE ${SCRATCH}`);

  console.log('[snapshot] copying uploads');
  const up = path.join(OUT, 'uploads');
  fs.rmSync(up, { recursive: true, force: true });
  const appId = dc(['ps', '-q', 'app'], { capture: true }).toString().trim();
  execFileSync('docker', ['cp', `${appId}:/app/uploads/.`, up], { stdio: 'inherit' });

  let files = 0;
  let bytes = 0;
  let largest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = fs.statSync(p).size; files++; bytes += s; largest = Math.max(largest, s); }
    }
  };
  walk(up);
  const manifest = {
    createdAt: new Date().toISOString(),
    counts,
    uploads: { files, megabytes: +(bytes / 1048576).toFixed(1), largestKb: Math.round(largest / 1024) },
    dumpMegabytes: +(fs.statSync(path.join(OUT, 'db', 'demo.dump')).size / 1048576).toFixed(1),
  };
  fs.writeFileSync(path.join(OUT, 'db', 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log('[snapshot] done', JSON.stringify(manifest));
})().catch((e) => { console.error('[snapshot] failed:', e.message); process.exit(1); });
