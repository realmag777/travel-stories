// CSRF tokens bound to the session, rate limiters, visitor fingerprint and the admin guard.
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const SALT = process.env.SESSION_SECRET || 'dev-salt';

/** Anonymous, non-reversible visitor id: hash of IP + user agent + server secret. */
function visitorHash(req) {
  return crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}|${SALT}`).digest('hex').slice(0, 32);
}

function csrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

/** Rejects state-changing requests without a matching token (header X-CSRF-Token or body _csrf). */
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || (req.body && req.body._csrf) || (req.query && req.query._csrf);
  const expected = req.session && req.session.csrf;
  if (expected && sent && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return next();
  }
  if (req.accepts(['json', 'html']) === 'json' || req.xhr || req.path.startsWith('/api')) {
    return res.status(403).json({ status: 403, message: 'Invalid CSRF token' });
  }
  return res.status(403).send('Invalid CSRF token. Reload the page and try again.');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api') || req.xhr) {
    return res.status(401).json({ status: 401, message: 'Unauthorized' });
  }
  return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

const json429 = (req, res) => res.status(429).json({ status: 429, message: 'Too many requests, please try again later' });

const limiters = {
  login: rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true,
    handler: (req, res) => {
      if (req.accepts(['html', 'json']) === 'html') {
        return res.status(429).render('admin/login.njk', { error: 'Забагато спроб входу. Спробуйте через 15 хвилин.', next: '/admin' });
      }
      return res.status(429).json({ status: 429, message: 'Too many login attempts, try again in 15 minutes' });
    } }),
  favorite: rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429 }),
  booking: rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429 }),
  search: rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429 }),
  write: rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, handler: json429 }),
};

// Per IP + story key, so one visitor cannot hammer a single story's counter.
limiters.favoritePerStory = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.params.storyId || ''}`,
  handler: json429,
});

module.exports = { visitorHash, csrfToken, csrfProtect, requireAdmin, limiters };
