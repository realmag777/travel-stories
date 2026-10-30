// URL slug from any Latin/diacritic text: "Côte d'Azur" -> "cote-dazur".
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

module.exports = { slugify };
