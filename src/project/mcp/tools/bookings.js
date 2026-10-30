// MCP tools: list bookings and change their status.
const booking = require('../../services/booking');

const tools = [
  {
    name: 'bookings_list',
    description: 'Bookings, newest first. Filter by status (new | confirmed | cancelled) and traveller.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['new', 'confirmed', 'cancelled'] }, travellerId: { type: 'string' }, page: { type: 'integer' }, perPage: { type: 'integer', maximum: 100 } } },
    async handler(a) {
      const { rows, total } = await booking.listBookings({ status: a.status, travellerId: a.travellerId, page: a.page || 1, perPage: Math.min(a.perPage || 20, 100) });
      return { total, bookings: rows.map((b) => ({ id: b.id, status: b.status, name: b.name, email: b.email, message: b.message, traveller: b.traveller_name, travellerId: b.user_id, service: b.service_title, startsAt: b.starts_at, createdAt: b.created_at })) };
    },
  },
  {
    name: 'booking_set_status',
    description: 'Confirm or cancel a booking; the client gets an e-mail (or a log line without SMTP).',
    write: true,
    inputSchema: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'integer' }, status: { type: 'string', enum: ['new', 'confirmed', 'cancelled'] } } },
    async handler({ id, status }) {
      const row = await booking.setStatus(Number(id), status);
      return { id: row.id, status: row.status };
    },
  },
];

module.exports = { tools };
