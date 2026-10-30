// MongoDB-compatible 24-hex identifiers, so imported records keep their original _id
// and new ones look the same to API clients.
const crypto = require('crypto');

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
let counter = crypto.randomInt(0, 0xffffff);
const processRandom = crypto.randomBytes(5).toString('hex');

/** New ObjectId: 4-byte timestamp + 5-byte process random + 3-byte counter. */
function objectId(date = new Date()) {
  const ts = Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0');
  counter = (counter + 1) % 0xffffff;
  return ts + processRandom + counter.toString(16).padStart(6, '0');
}

/** Stable ObjectId for seed records: timestamp part from the date, the rest from a hash of the key. */
function seedId(key, date = new Date('2026-01-01T00:00:00Z')) {
  const ts = Math.floor(new Date(date).getTime() / 1000).toString(16).padStart(8, '0');
  return ts + crypto.createHash('md5').update(String(key)).digest('hex').slice(0, 16);
}

const isObjectId = (v) => typeof v === 'string' && OBJECT_ID_RE.test(v);

module.exports = { objectId, seedId, isObjectId, OBJECT_ID_RE };
