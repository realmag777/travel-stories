// Booking: travellers acting as guides. A slot holds at most one live booking — guaranteed by
// a row lock inside a transaction AND by the partial unique index bookings_one_live_per_slot.
const crypto = require('crypto');
const db = require('../../core/db');
const mailer = require('../../core/mailer');
const { t } = require('../../core/i18n');

const HORIZON_DAYS = 60;
const newToken = () => crypto.randomBytes(16).toString('hex');
const siteUrl = () => (process.env.PUBLIC_URL || 'http://localhost:8350').replace(/\/$/, '');
const prefix = (l) => (l && l !== 'uk' ? '/' + l : '');
/** Public confirmation URL and one-time cancel URL of a booking (paths, locale-prefixed). */
const confirmPath = (b) => `${prefix(b.locale)}/booking/${b.public_token}`;
const cancelPath = (b) => (b.cancel_token ? `${prefix(b.locale)}/booking/${b.public_token}/cancel?key=${b.cancel_token}` : null);

async function servicesFor(userId, { activeOnly = true } = {}) {
  const q = db('services').where({ user_id: userId }).orderBy([{ column: 'sort' }, { column: 'id' }]);
  if (activeOnly) q.andWhere({ active: true });
  return q;
}

/** Free future slots grouped by date (YYYY-MM-DD, Europe/Kyiv). */
async function freeSlots(userId, { from = new Date(), days = HORIZON_DAYS } = {}) {
  const until = new Date(from.getTime() + days * 86400000);
  const rows = await db('slots as sl')
    .select('sl.id', 'sl.starts_at', 'sl.duration_min')
    .where('sl.user_id', userId)
    .andWhere('sl.starts_at', '>', from)
    .andWhere('sl.starts_at', '<', until)
    .whereNotExists(db('bookings as b').whereRaw('b.slot_id = sl.id').andWhereNot('b.status', 'cancelled'))
    .orderBy('sl.starts_at');
  return rows.map((r) => ({ id: r.id, startsAt: r.starts_at.toISOString(), durationMin: r.duration_min, ...kyivParts(r.starts_at) }));
}

function kyivParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

class BookingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/**
 * Create a booking atomically. Throws BookingError(409, 'slot_taken') when someone was faster.
 * @returns {Promise<object>} the booking row
 */
async function create({ travellerId, serviceId, slotId, name, email, message, locale = 'uk' }) {
  const booking = await db.transaction(async (trx) => {
    const traveller = await trx('users').where({ id: travellerId }).first();
    if (!traveller || !traveller.accepts_bookings) throw new BookingError(404, 'not_bookable', 'Traveller does not accept bookings');
    const service = await trx('services').where({ id: serviceId, user_id: travellerId, active: true }).first();
    if (!service) throw new BookingError(404, 'service_not_found', 'Service not found');
    // Lock the slot row: concurrent requests for the same slot queue up here.
    const slot = await trx('slots').where({ id: slotId, user_id: travellerId }).forUpdate().first();
    if (!slot) throw new BookingError(404, 'slot_not_found', 'Slot not found');
    if (new Date(slot.starts_at) <= new Date()) throw new BookingError(409, 'slot_past', 'Slot is in the past');
    const live = await trx('bookings').where({ slot_id: slotId }).andWhereNot('status', 'cancelled').first();
    if (live) throw new BookingError(409, 'slot_taken', 'Slot is already booked');
    try {
      const [row] = await trx('bookings').insert({
        slot_id: slotId, service_id: serviceId, user_id: travellerId, name, email, message, locale, status: 'new',
        public_token: newToken(), cancel_token: newToken(),
      }).returning('*');
      return { ...row, service, slot, traveller };
    } catch (e) {
      // The unique index is the last line of defence.
      if (e.code === '23505') throw new BookingError(409, 'slot_taken', 'Slot is already booked');
      throw e;
    }
  });
  notify(booking).catch((e) => console.error('[booking] notify failed:', e.message));
  return booking;
}

async function notify(b) {
  const when = kyivParts(new Date(b.slot.starts_at));
  const loc = b.locale || 'uk';
  const smtp = await require('../../core/settings').smtpConfig();
  await mailer.send({
    to: b.email,
    subject: t('booking.mailSubject', loc, { name: b.traveller.name }),
    text: t('booking.mailBody', loc, { name: b.name, service: b.service.title, traveller: b.traveller.name, day: when.day, time: when.time })
      + `

${t('booking.mailLinks', loc, { confirm: siteUrl() + confirmPath(b), cancel: siteUrl() + cancelPath(b) })}`,
  });
  if (smtp.notify) {
    await mailer.send({
      to: smtp.notify,
      subject: `Нове бронювання #${b.id}: ${b.traveller.name}`,
      text: `${b.name} <${b.email}>\n${b.service.title}\n${when.day} ${when.time} (Київ)\n\n${b.message || ''}`,
    });
  }
}

async function setStatus(id, status) {
  if (!['new', 'confirmed', 'cancelled'].includes(status)) throw new BookingError(400, 'bad_status', 'Unknown status');
  const row = await db.transaction(async (trx) => {
    const b = await trx('bookings').where({ id }).forUpdate().first();
    if (!b) throw new BookingError(404, 'not_found', 'Booking not found');
    if (b.status === 'cancelled' && status !== 'cancelled') {
      // Re-activating a cancelled booking must not collide with a newer one on the same slot.
      const live = await trx('bookings').where({ slot_id: b.slot_id }).andWhereNot('status', 'cancelled').andWhereNot('id', id).first();
      if (live) throw new BookingError(409, 'slot_taken', 'Slot already has another booking');
    }
    const patch = { status, updated_at: trx.fn.now() };
    if (status === 'cancelled') Object.assign(patch, { cancel_token: null, cancelled_at: trx.fn.now() });
    else if (!b.cancel_token) patch.cancel_token = newToken();
    const [u] = await trx('bookings').where({ id }).update(patch).returning('*');
    return u;
  });
  const full = await db('bookings as b').join('users as u', 'u.id', 'b.user_id').join('slots as sl', 'sl.id', 'b.slot_id')
    .leftJoin('services as s', 's.id', 'b.service_id').where('b.id', id)
    .select('b.*', 'u.name as traveller_name', 'sl.starts_at', 's.title as service_title').first();
  if (status !== 'new') {
    const when = kyivParts(new Date(full.starts_at));
    mailer.send({
      to: full.email,
      subject: t(`booking.mail_${status}_subject`, full.locale),
      text: t(`booking.mail_${status}_body`, full.locale, { name: full.name, service: full.service_title || '', traveller: full.traveller_name, day: when.day, time: when.time }),
    }).catch(() => {});
  }
  return row;
}

/** Booking with everything the confirmation page needs, by its public token. */
async function getByToken(token) {
  if (!/^[0-9a-f]{32}$/.test(String(token))) return null;
  return db('bookings as b').join('users as u', 'u.id', 'b.user_id').join('slots as sl', 'sl.id', 'b.slot_id')
    .leftJoin('services as s', 's.id', 'b.service_id').where('b.public_token', token)
    .select('b.*', 'u.name as traveller_name', 'u.name_en as traveller_name_en', 'u.avatar_key', 'u.avatar_url',
      'sl.starts_at', 'sl.duration_min as slot_duration', 's.title as service_title', 's.title_en as service_title_en',
      's.title_es as service_title_es', 's.kind as service_kind', 's.duration_min as service_duration', 's.price_label')
    .first();
}

/** One-time cancellation: the key must match and is cleared in the same statement. */
async function cancelByToken(token, key) {
  if (!/^[0-9a-f]{32}$/.test(String(token)) || !/^[0-9a-f]{32}$/.test(String(key))) throw new BookingError(404, 'link_invalid', 'Cancel link is invalid or already used');
  const [row] = await db('bookings').where({ public_token: token, cancel_token: key }).whereNot('status', 'cancelled')
    .update({ status: 'cancelled', cancel_token: null, cancelled_at: db.fn.now(), updated_at: db.fn.now() }).returning('*');
  if (!row) throw new BookingError(404, 'link_invalid', 'Cancel link is invalid or already used');
  return row;
}

async function listBookings({ status, travellerId, page = 1, perPage = 20 } = {}) {
  const q = db('bookings as b').join('users as u', 'u.id', 'b.user_id').join('slots as sl', 'sl.id', 'b.slot_id')
    .leftJoin('services as s', 's.id', 'b.service_id');
  if (status) q.where('b.status', status);
  if (travellerId) q.where('b.user_id', travellerId);
  const [{ n }] = await q.clone().count({ n: '*' });
  const rows = await q.select('b.*', 'u.name as traveller_name', 'sl.starts_at', 'sl.duration_min', 's.title as service_title', 's.price_label')
    .orderBy('b.created_at', 'desc').limit(perPage).offset((page - 1) * perPage);
  return { rows, total: Number(n) };
}

/** Generate weekly slots between dates for given weekdays and local Kyiv times; existing ones are skipped. */
async function generateSlots(userId, { from, to, weekdays, times, duration_min }) {
  const rows = [];
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end && rows.length < 2000; d = new Date(d.getTime() + 86400000)) {
    if (!weekdays.includes(d.getUTCDay())) continue;
    const ymd = d.toISOString().slice(0, 10);
    for (const tm of times) rows.push({ user_id: userId, starts_at: kyivToUtc(ymd, tm), duration_min });
  }
  if (!rows.length) return 0;
  const inserted = await db('slots').insert(rows).onConflict(['user_id', 'starts_at']).ignore().returning('id');
  return inserted.length;
}

/** Convert a Europe/Kyiv wall-clock time to a UTC Date (handles DST). */
function kyivToUtc(ymd, hm) {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  for (let i = 0; i < 2; i++) {
    const p = kyivParts(guess);
    const diff = (new Date(`${p.day}T${p.time}:00Z`) - new Date(`${ymd}T${hm}:00Z`));
    guess.setTime(guess.getTime() - diff);
  }
  return guess;
}

module.exports = { servicesFor, freeSlots, create, setStatus, listBookings, getByToken, cancelByToken, confirmPath, cancelPath, generateSlots, kyivParts, kyivToUtc, BookingError };
