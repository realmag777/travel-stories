import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../src/core/db.js';
import booking from '../../src/project/services/booking.js';
import ids from '../../src/core/ids.js';

let userId;
let serviceId;
let slotId;

beforeAll(async () => {
  userId = ids.objectId();
  await db('users').insert({ id: userId, name: 'Test Guide', accepts_bookings: true, hidden: true, source: 'test' });
  [{ id: serviceId }] = await db('services').insert({ user_id: userId, kind: 'call', title: 'Test call', duration_min: 30, price_label: '€10' }).returning('id');
  [{ id: slotId }] = await db('slots').insert({ user_id: userId, starts_at: new Date(Date.now() + 3 * 86400000) }).returning('id');
});

afterAll(async () => {
  await db('users').where({ id: userId }).del(); // cascades to services, slots, bookings
  await db.destroy();
});

describe('booking', () => {
  it('allows exactly one booking when many people book the same slot at once', async () => {
    const attempts = Array.from({ length: 8 }, (_, i) => booking.create({
      travellerId: userId, serviceId, slotId, name: `Person ${i}`, email: `p${i}@example.com`, message: '',
    }).then(() => 'ok', (e) => e.code));
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'slot_taken')).toHaveLength(7);
    const [{ n }] = await db('bookings').where({ slot_id: slotId }).count({ n: '*' });
    expect(Number(n)).toBe(1);
  });

  it('frees the slot after cancellation and re-books it', async () => {
    expect((await booking.freeSlots(userId)).find((s) => s.id === slotId)).toBeUndefined();
    const b = await db('bookings').where({ slot_id: slotId }).first();
    await booking.setStatus(b.id, 'cancelled');
    expect((await booking.freeSlots(userId)).find((s) => s.id === slotId)).toBeDefined();
    await booking.create({ travellerId: userId, serviceId, slotId, name: 'Second', email: 's@example.com', message: '' });
    // Re-activating the cancelled booking now collides with the new one.
    await expect(booking.setStatus(b.id, 'confirmed')).rejects.toMatchObject({ code: 'slot_taken' });
  });

  it('the database itself refuses a second live booking (unique partial index)', async () => {
    await expect(db('bookings').insert({ slot_id: slotId, service_id: serviceId, user_id: userId, name: 'Raw', email: 'r@example.com', status: 'new' }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('rejects bookings for guides that do not accept them and past slots', async () => {
    const [{ id: past }] = await db('slots').insert({ user_id: userId, starts_at: new Date(Date.now() - 86400000) }).returning('id');
    await expect(booking.create({ travellerId: userId, serviceId, slotId: past, name: 'Late', email: 'l@example.com' })).rejects.toMatchObject({ code: 'slot_past' });
    await db('users').where({ id: userId }).update({ accepts_bookings: false });
    await expect(booking.create({ travellerId: userId, serviceId, slotId, name: 'X', email: 'x@example.com' })).rejects.toMatchObject({ code: 'not_bookable' });
    await db('users').where({ id: userId }).update({ accepts_bookings: true });
  });

  it('converts Kyiv wall-clock time across DST', () => {
    expect(booking.kyivToUtc('2026-07-01', '10:00').toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(booking.kyivToUtc('2026-12-01', '10:00').toISOString()).toBe('2026-12-01T08:00:00.000Z');
  });

  it('generates weekly slots without duplicates', async () => {
    const from = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 23 * 86400000).toISOString().slice(0, 10);
    const n1 = await booking.generateSlots(userId, { from, to, weekdays: [1, 3], times: ['09:00', '15:30'], duration_min: 60 });
    const n2 = await booking.generateSlots(userId, { from, to, weekdays: [1, 3], times: ['09:00', '15:30'], duration_min: 60 });
    expect(n1).toBeGreaterThanOrEqual(4);
    expect(n2).toBe(0);
  });
});
