// Outgoing mail via SMTP from settings/env. Without SMTP the message is written to the log,
// so booking flows work on a fresh install.
const nodemailer = require('nodemailer');
const settings = require('./settings');

async function send({ to, subject, text }) {
  const c = await settings.smtpConfig();
  if (!to) return { skipped: true };
  if (!c.host) {
    console.log(`[mail:log] to=${to} subject="${subject}"\n${text}\n[mail:log] end`);
    return { logged: true };
  }
  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  });
  try {
    await transport.sendMail({ from: c.from, to, subject, text });
    return { sent: true };
  } catch (e) {
    // A broken SMTP must never fail the booking itself.
    console.error('[mail] send failed:', e.message);
    return { error: e.message };
  }
}

module.exports = { send };
