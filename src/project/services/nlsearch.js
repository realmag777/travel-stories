// Natural-language search: "куди поїхати в травні з дітьми недорого" -> facet state.
// With an LLM configured the query goes to the model with a strict JSON schema; the answer is
// validated with zod and falls back to the rule parser on any problem. The rule parser covers
// months, seasons, budget, trip type, duration, tags, categories and every country/region in the DB.
const db = require('../../core/db');
const llm = require('../../core/llm');
const { nlFacets } = require('../../shared/schemas');
const { DURATIONS, TAGS } = require('../../shared/dictionaries');
const content = require('../content');

const norm = (s) => String(s || '').toLowerCase().replace(/[’ʼ`]/g, "'").replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// Month stems -> season (uk, en, es).
const MONTHS = [
  [/(^|\s)(січ\p{L}*|лют\p{L}*|груд\p{L}*|january|february|december|enero|febrero|diciembre)(?=\s|$|[.,!?])/u, 'winter'],
  [/(^|\s)(берез\p{L}*|квіт\p{L}*|трав(ень|ня|ні)|march|april|may|marzo|abril|mayo)(?=\s|$|[.,!?])/u, 'spring'],
  [/(^|\s)(черв(ень|ня|ні)|лип(ень|ня|ні)|серп(ень|ня|ні)|june|july|august|junio|julio|agosto)(?=\s|$|[.,!?])/u, 'summer'],
  [/(^|\s)(верес\p{L}*|жовт\p{L}*|листопад\p{L}*|september|october|november|septiembre|octubre|noviembre)(?=\s|$|[.,!?])/u, 'autumn'],
];
const SEASON_WORDS = [
  [/(^|\s)(весн\p{L}*|навесні|spring|primavera)/u, 'spring'],
  [/(^|\s)(літ(о|ом|і|ній|ня|нього|ньої)|влітку|summer|verano)(?=\s|$|[.,!?])/u, 'summer'],
  [/(^|\s)(осін\p{L}*|восени|осінн\p{L}*|autumn|fall|otoño|otono)(?=\s|$|[.,!?])/u, 'autumn'],
  [/(^|\s)(зим\p{L}*|взимку|winter|invierno)(?=\s|$|[.,!?])/u, 'winter'],
];
const BUDGET_WORDS = [
  [/(^|\s)(недорог\p{L}*|дешев\p{L}*|бюджетн\p{L}*|економ\p{L}*|за копійки|cheap\p{L}*|budget|low[- ]cost|inexpensive|barat\p{L}*|económic\p{L}*|economic\p{L}*)/u, 'low'],
  [/(^|\s)(середн\p{L}* бюджет\p{L}*|помірн\p{L}*|mid[- ]range|moderate|moderad\p{L}*)/u, 'medium'],
  [/(^|\s)(розкішн\p{L}*|розкіш\p{L}*|люкс\p{L}*|дорог(о|а|ий|у)|преміум|luxury|luxurious|expensive|lujo\p{L}*|car(o|a))(?=\s|$|[.,!?])/u, 'high'],
];
const TRIP_WORDS = [
  [/(з|із) (діть\p{L}*|дитин\p{L}*|малюк\p{L}*|син\p{L}*|доньк\p{L}*)|сім'\p{L}*|сімейн\p{L}*|родин\p{L}*|with (kids|children)|family|familia|con niños|con ninos/u, 'family'],
  [/(^|\s)(соло|сам(а|ому|ій)?|наодинці|одна|один|solo|alone|en solitario|sol[oa])(?=\s|$|[.,!?])/u, 'solo'],
  [/удвох|(з|із) (дружин\p{L}*|чолові\p{L}*|коханою|коханим|дівчин\p{L}*|хлопц\p{L}*)|романтичн\p{L}*|медов\p{L}* місяц\p{L}*|(^|\s)пар(а|ою|і)(?=\s|$)|couple|romantic|honeymoon|pareja|romántic\p{L}*/u, 'couple'],
  [/(з|із) друз\p{L}*|компані\p{L}*|with friends|friends|amigos/u, 'friends'],
];
const TAG_WORDS = [
  [/мор(е|я|і|ем)|пляж\p{L}*|beach|sea|playa|mar(?=\s|$)/u, 'beach'],
  [/гастроном\p{L}*|їж(а|і|у)|смачн\p{L}*|кухн\p{L}*|food|cuisine|comida|gastronom\p{L}*/u, 'food'],
  [/вин(о|а|ні|ом)|винн\p{L}*|wine|vino/u, 'wine'],
  [/музе\p{L}*|museum\p{L}*|museo\p{L}*/u, 'museums'],
  [/поход\p{L}*|похід|трек\p{L}*|hiking|trek\p{L}*|sendero\p{L}*|senderismo/u, 'hiking'],
  [/озер\p{L}*|lake\p{L}*|lago\p{L}*/u, 'lakes'],
  [/остр(ів|ов)\p{L}*|island\p{L}*|isla\p{L}*/u, 'islands'],
  [/лиж\p{L}*|ski\p{L}*|esquí|esqui/u, 'skiing'],
  [/дайв\p{L}*|діджінг|снорк\p{L}*|diving|snorkel\p{L}*|buceo/u, 'diving'],
  [/фестив\p{L}*|festival\p{L}*/u, 'festivals'],
  [/потяг\p{L}*|поїзд\p{L}*|train\p{L}*|tren(?=\s|$)/u, 'train'],
  [/фото\p{L}*|photo\p{L}*|fotograf\p{L}*/u, 'photography'],
  [/природ\p{L}*|nature|naturaleza/u, 'nature'],
  [/істор\p{L}*|history|historia|histórico/u, 'history'],
  [/архітект\p{L}*|architecture|arquitectura/u, 'architecture'],
  [/кемпінг\p{L}*|намет\p{L}*|camping|tent/u, 'camping'],
  [/нацпарк\p{L}*|національн\p{L}* парк\p{L}*|national park\p{L}*|parque nacional/u, 'national-parks'],
  [/ринк\p{L}*|ринок|базар\p{L}*|market\p{L}*|mercado\p{L}*/u, 'markets'],
  [/нічн\p{L}* житт\p{L}*|клуб\p{L}*|nightlife|vida nocturna/u, 'nightlife'],
  [/тварин\p{L}*|сафарі|wildlife|safari|fauna/u, 'wildlife'],
  [/автоподорож\p{L}*|на машин\p{L}*|на авто|road ?trip|en coche/u, 'road-trip'],
  [/стріт-арт|графіті|street art|graffiti/u, 'street-art'],
];
// Category words map to the original categories by Ukrainian name.
const CATEGORY_WORDS = [
  [/(^|\s)(гор(и|ах|ами|у)|гірськ\p{L}*|mountain\p{L}*|montaña\p{L}*)/u, 'Гори'],
  [/пустел\p{L}*|пустин\p{L}*|desert\p{L}*|desierto\p{L}*/u, 'Пустелі'],
  [/(^|\s)(азі(я|ю|ї)|азійськ\p{L}*|asia\p{L}*)/u, 'Азія'],
  [/(^|\s)(європ\p{L}*|europe\p{L}*|europa)/u, 'Європа'],
  [/(^|\s)(америк\p{L}*|america\p{L}*|américa)/u, 'Америка'],
  [/(^|\s)(африк\p{L}*|africa\p{L}*|áfrica)/u, 'Африка'],
  [/(^|\s)(балкан\p{L}*|balkan\p{L}*|balcanes)/u, 'Балкани'],
  [/(^|\s)(кавказ\p{L}*|caucas\p{L}*|cáucaso)/u, 'Кавказ'],
  [/(^|\s)(океані\p{L}*|oceania|oceanía)/u, 'Океанія'],
];

function durationBucket(days) {
  const d = DURATIONS.find((x) => days >= x.min && days <= x.max);
  return d ? d.slug : null;
}

function parseDuration(q) {
  const out = new Set();
  if (/вихідн\p{L}*|weekend|fin de semana|уїк-енд|вікенд/u.test(q)) out.add('1-3');
  const m = q.match(/(\d{1,3})\s*(дн\p{L}*|доб\p{L}*|days?|días?|dias?)/u);
  if (m) out.add(durationBucket(Number(m[1])));
  if (/(^|\s)(два|дві|2)\s*тижн\p{L}*|two weeks|dos semanas/u.test(q)) out.add('8-14');
  else if (/(^|\s)(на )?тижд(ень|ня)|a week|one week|una semana/u.test(q)) out.add('4-7');
  if (/(^|\s)(на )?місяць|a month|un mes/u.test(q)) out.add('15-plus');
  return [...out].filter(Boolean);
}

/** Stem used to match Ukrainian case forms: "Італія" also matches "Італії", "Італію". */
function stem(name) {
  const n = norm(name);
  if (n.length <= 4) return n;
  return n.replace(/(ія|ія|а|я|ь|и|і|о|у|ю)$/u, '');
}

let placeCache = null;
let placeAt = 0;
async function places() {
  if (placeCache && Date.now() - placeAt < 120_000) return placeCache;
  const d = await content.dicts();
  const countries = [];
  for (const c of d.countries) {
    for (const name of [c.name_uk, c.name_en, c.name_es]) {
      if (name && name.length >= 3) countries.push({ code: c.code, label: c.name_uk, stem: stem(name), exact: norm(name) });
    }
  }
  const regionRows = await db('stories').distinct('region_slug', 'region', 'region_en').whereNotNull('region_slug');
  const regions = [];
  for (const r of regionRows) {
    for (const name of [r.region, r.region_en]) {
      if (name && name.length >= 4) regions.push({ slug: r.region_slug, label: r.region, stem: stem(name), exact: norm(name) });
    }
  }
  placeCache = { countries, regions, categories: d.categories };
  placeAt = Date.now();
  return placeCache;
}

function wordMatch(q, p) {
  // Whole word for short names, stem prefix for longer ones.
  const re = p.stem.length >= 4
    ? new RegExp(`(^|[\\s,.;:!?(])${escapeRe(p.stem)}\\p{L}*`, 'u')
    : new RegExp(`(^|[\\s,.;:!?(])${escapeRe(p.exact)}(?=$|[\\s,.;:!?)])`, 'u');
  return re.test(q);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Deterministic rule parser. Always available. */
async function parseRules(query) {
  const q = norm(query);
  const f = { country: [], region: [], season: [], budget: [], trip: [], days: [], tags: [], category: null };
  const add = (k, v) => { if (v && !f[k].includes(v)) f[k].push(v); };

  for (const [re, s] of MONTHS) if (re.test(q)) add('season', s);
  for (const [re, s] of SEASON_WORDS) if (re.test(q)) add('season', s);
  for (const [re, b] of BUDGET_WORDS) if (re.test(q)) { add('budget', b); break; }
  for (const [re, t] of TRIP_WORDS) if (re.test(q)) add('trip', t);
  for (const [re, t] of TAG_WORDS) if (re.test(q) && TAGS.some((x) => x.slug === t)) add('tags', t);
  for (const d of parseDuration(q)) add('days', d);

  const p = await places();
  for (const c of p.countries) if (wordMatch(q, c)) add('country', c.code);
  for (const r of p.regions) if (wordMatch(q, r)) add('region', r.slug);
  // Category words only when no country matched (a country is the sharper filter).
  if (!f.country.length) {
    for (const [re, name] of CATEGORY_WORDS) {
      if (re.test(q)) {
        const cat = p.categories.find((c) => c.name === name);
        if (cat) { f.category = cat.id; break; }
      }
    }
  }
  // A region implies its country only through data; drop countries that duplicate a region match.
  return nlFacets.parse(f);
}

const llmCache = new Map();

async function parseLlm(query, locale) {
  const key = `${locale}|${norm(query)}`;
  if (llmCache.has(key)) return llmCache.get(key);
  const d = await content.dicts();
  const p = await places();
  const regionList = [...new Map(p.regions.map((r) => [r.slug, r.label])).entries()].map(([s, l]) => `${s}=${l}`).join('; ');
  const system = 'You convert a traveller\'s free-text request into search filters for a travel-stories site. ' +
    'Answer with ONE JSON object only, no prose. Use only values from the lists. Leave a field empty when the request does not mention it.';
  const prompt = `Request (${locale}): """${query.slice(0, 300)}"""

JSON fields:
- country: ISO alpha-2 codes from: ${d.countries.map((c) => `${c.code}=${c.name_en}`).join(', ')}
- region: slugs from: ${regionList}
- season: any of spring, summer, autumn, winter (months map to seasons)
- budget: any of low, medium, high ("cheap"=low, "luxury"=high)
- trip: any of solo, couple, family, friends ("with kids"=family)
- days: duration buckets ${DURATIONS.map((x) => x.slug).join(', ')}
- tags: any of ${TAGS.map((t) => t.slug).join(', ')}
- category: one id or null from ${d.categories.map((c) => `${c.id}=${c.name_en || c.name}`).join(', ')} (only if a world region/mountains/deserts is asked and no country)

Example: {"country":[],"region":[],"season":["spring"],"budget":["low"],"trip":["family"],"days":[],"tags":[],"category":null}`;
  const raw = await llm.completeJson({ system, prompt, maxTokens: 400, timeoutMs: 15000 });
  const parsed = nlFacets.parse({
    ...raw,
    country: (raw.country || []).map((c) => String(c).toUpperCase()).filter((c) => d.countryByCode[c]),
    region: (raw.region || []).filter((s) => p.regions.some((r) => r.slug === s)),
    tags: (raw.tags || []).filter((s) => TAGS.some((t) => t.slug === s)),
    category: raw.category && d.categoryById[raw.category] ? raw.category : null,
  });
  if (llmCache.size > 500) llmCache.clear();
  llmCache.set(key, parsed);
  return parsed;
}

/** Parse with LLM when configured, otherwise (or on error) with rules. */
async function parse(query, locale = 'uk') {
  if (!query || !query.trim()) return { facets: nlFacets.parse({}), parser: 'none' };
  if (await llm.isEnabled()) {
    try {
      return { facets: await parseLlm(query, locale), parser: 'llm' };
    } catch (e) {
      console.warn('[nlsearch] LLM failed, using rules:', e.message);
    }
  }
  return { facets: await parseRules(query), parser: 'rules' };
}

module.exports = { parse, parseRules, norm, stem, durationBucket, invalidate: () => { placeCache = null; } };
