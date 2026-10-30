// sitemap.xml (all locales with hreflang alternates) and robots.txt.
const db = require('../../core/db');
const { LOCALES, lurl, DEFAULT_LOCALE } = require('../../core/i18n');
const { asyncRoute } = require('../../core/http');

const site = () => (process.env.PUBLIC_URL || 'http://localhost:8350').replace(/\/$/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function urlEntry(p, lastmod) {
  const alts = LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(site() + lurl(p, l))}"/>`).join('')
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(site() + lurl(p, DEFAULT_LOCALE))}"/>`;
  return LOCALES.map((l) => `<url><loc>${esc(site() + lurl(p, l))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alts}</url>`).join('\n');
}

function register(app) {
  app.get('/sitemap.xml', asyncRoute(async (req, res) => {
    const [stories, users, cats] = await Promise.all([
      db('stories').where({ hidden: false }).select('id', 'updated_at').orderBy('date', 'desc'),
      db('users').where({ hidden: false }).select('id', 'updated_at'),
      db('categories').select('id'),
    ]);
    const day = (d) => new Date(d).toISOString().slice(0, 10);
    const parts = [
      urlEntry('/'), urlEntry('/stories'), urlEntry('/travellers'), urlEntry('/map'),
      ...cats.map((c) => urlEntry(`/stories?category=${c.id}`)),
      ...stories.map((s) => urlEntry(`/stories/${s.id}`, day(s.updated_at))),
      ...users.map((u) => urlEntry(`/travellers/${u.id}`, day(u.updated_at))),
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${parts.join('\n')}
</urlset>`);
  }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /mcp
Disallow: /saved
Disallow: /*/saved
Disallow: /stories/search

Sitemap: ${site()}/sitemap.xml
`);
  });
}

module.exports = { register };
