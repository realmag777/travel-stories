// Booking confirmation page and one-time cancel links.
exports.up = async (knex) => {
  await knex.schema.alterTable('bookings', (t) => {
    t.string('public_token', 40).unique(); // opens the confirmation page
    t.string('cancel_token', 40).unique(); // one-time: cleared after use
    t.timestamp('cancelled_at', { useTz: true });
  });
  await knex.raw(`UPDATE bookings SET public_token = replace(gen_random_uuid()::text, '-', ''),
    cancel_token = CASE WHEN status <> 'cancelled' THEN replace(gen_random_uuid()::text, '-', '') END`);
  await knex.raw('ALTER TABLE bookings ALTER COLUMN public_token SET NOT NULL');
  await knex.raw('CREATE INDEX services_kind_idx ON services (kind, active)');
  await knex.raw('CREATE INDEX slots_user_time_idx ON slots (user_id, starts_at)');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS services_kind_idx');
  await knex.raw('DROP INDEX IF EXISTS slots_user_time_idx');
  await knex.schema.alterTable('bookings', (t) => {
    t.dropColumn('public_token');
    t.dropColumn('cancel_token');
    t.dropColumn('cancelled_at');
  });
};
