// Validates generated seed batches in seeds/data/*.json.
// Usage: node tools/validate-seed.js [file ...]   (no args = every batch file)
// Exit code 1 when any record is invalid.
const fs = require('fs');
const path = require('path');
const { CATEGORIES, SEASONS, BUDGETS, TRIP_TYPES, TAGS } = require('../src/shared/dictionaries');

const DIR = path.join(__dirname, '..', 'seeds', 'data');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => path.join(DIR, f));

const errors = [];
const seenKeys = new Set();
const seenTitles = new Set();
const travellerKeys = new Set();
let stories = 0;
let travellers = 0;

const len = (s) => (typeof s === 'string' ? s.length : 0);
const err = (f, k, m) => errors.push(`${path.basename(f)} ${k}: ${m}`);

const all = files.map((f) => [f, JSON.parse(fs.readFileSync(f, 'utf8'))]);

for (const [f, j] of all) for (const t of j.travellers || []) travellerKeys.add(t.key);

for (const [f, j] of all) {
  for (const t of j.travellers || []) {
    travellers++;
    if (seenKeys.has(t.key)) err(f, t.key, 'duplicate key');
    seenKeys.add(t.key);
    if (!/^t-\d-\d{2}$/.test(t.key)) err(f, t.key, 'traveller key must look like t-1-01');
    for (const l of ['uk', 'en']) {
      if (len(t.name?.[l]) < 5) err(f, t.key, `name.${l} missing`);
      if (len(t.description?.[l]) < 80 || len(t.description?.[l]) > 400) err(f, t.key, `description.${l} must be 80-400 chars (${len(t.description?.[l])})`);
    }
    if (!['male', 'female'].includes(t.gender)) err(f, t.key, 'gender must be male|female');
    if (!t.style || len(t.style) < 10) err(f, t.key, 'style missing');
  }
  for (const s of j.stories || []) {
    stories++;
    if (seenKeys.has(s.key)) err(f, s.key, 'duplicate key');
    seenKeys.add(s.key);
    if (!/^s-\d-\d{3}$/.test(s.key)) err(f, s.key, 'story key must look like s-1-001');
    if (!travellerKeys.has(s.travellerKey)) err(f, s.key, `unknown travellerKey ${s.travellerKey}`);
    if (!CATEGORIES.some((c) => c.name === s.category)) err(f, s.key, `unknown category ${s.category}`);
    for (const l of ['uk', 'en']) {
      if (len(s.title?.[l]) < 10 || len(s.title?.[l]) > 80) err(f, s.key, `title.${l} must be 10-80 chars`);
      const a = len(s.article?.[l]);
      if (a < 800 || a > 2500) err(f, s.key, `article.${l} must be 800-2500 chars (${a})`);
    }
    if (s.title?.uk && seenTitles.has(s.title.uk)) err(f, s.key, 'duplicate title');
    seenTitles.add(s.title?.uk);
    if (!/^[A-Z]{2}$/.test(s.country?.code || '')) err(f, s.key, 'country.code must be ISO alpha-2');
    for (const l of ['uk', 'en', 'es']) {
      if (!s.country?.[l]) err(f, s.key, `country.${l} missing`);
      if (!s.region?.[l]) err(f, s.key, `region.${l} missing`);
    }
    if (!Array.isArray(s.seasons) || !s.seasons.length || s.seasons.some((x) => !SEASONS.includes(x))) err(f, s.key, `seasons must be a non-empty subset of ${SEASONS}`);
    if (!BUDGETS.includes(s.budget)) err(f, s.key, `budget must be one of ${BUDGETS}`);
    if (!Number.isInteger(s.durationDays) || s.durationDays < 1 || s.durationDays > 60) err(f, s.key, 'durationDays must be integer 1-60');
    if (!TRIP_TYPES.includes(s.tripType)) err(f, s.key, `tripType must be one of ${TRIP_TYPES}`);
    if (!Array.isArray(s.tags) || s.tags.length < 2 || s.tags.length > 6 || s.tags.some((x) => !TAGS.some((t) => t.slug === x))) err(f, s.key, 'tags: 2-6 slugs from the TAGS dictionary');
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number' || Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180) err(f, s.key, 'lat/lng must be numbers');
    if (len(s.photoQuery) < 3) err(f, s.key, 'photoQuery missing');
  }
}

console.log(`files=${files.length} travellers=${travellers} stories=${stories} errors=${errors.length}`);
errors.slice(0, 80).forEach((e) => console.log('  ' + e));
process.exit(errors.length ? 1 : 0);
