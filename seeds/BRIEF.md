# Seed content brief (for content-writing agents)

Project: «Подорожники+», a Ukrainian travel-stories site. You write demo content:
travellers (authors) and their travel stories, in Ukrainian (uk) and English (en).

## Output
Write ONLY into `seeds/data/` of `D:\projects\_claude\claude-travel-store`.
One file per batch of up to 10 stories: `seeds/data/batch-<agent>-<nn>.json`
(e.g. `batch-3-01.json`). The FIRST batch file of your agent also contains your
16 travellers. JSON shape:

```json
{
  "travellers": [
    {
      "key": "t-3-01",
      "gender": "female",
      "name": { "uk": "Оксана Мельник", "en": "Oksana Melnyk" },
      "description": { "uk": "Привіт! Я Оксана…", "en": "Hi! I'm Oksana…" },
      "style": "short note on HOW this person writes (for consistency only)"
    }
  ],
  "stories": [
    {
      "key": "s-3-001",
      "travellerKey": "t-3-01",
      "category": "Азія",
      "title": { "uk": "…", "en": "…" },
      "article": { "uk": "…", "en": "…" },
      "country": { "code": "JP", "uk": "Японія", "en": "Japan", "es": "Japón" },
      "region": { "uk": "Кансай", "en": "Kansai", "es": "Kansai" },
      "seasons": ["spring", "autumn"],
      "budget": "medium",
      "durationDays": 9,
      "tripType": "couple",
      "tags": ["culture", "food", "history"],
      "lat": 35.0116,
      "lng": 135.7681,
      "photoQuery": "Fushimi Inari Taisha"
    }
  ]
}
```

## Rules
- Keys: travellers `t-<agent>-01..16`, stories `s-<agent>-001..050`. Never reuse keys of other agents.
- category: exactly one of `Азія, Гори, Європа, Америка, Африка, Грузія, Пустелі, Балкани, Кавказ, Океанія`
  (pick the best fit; «Гори» for mountain trips anywhere, «Грузія» for Georgia the country).
- seasons ⊂ `spring, summer, autumn, winter` (when the trip happened / is best). budget ∈ `low, medium, high`.
  tripType ∈ `solo, couple, family, friends`. durationDays integer 1–60.
- tags: 2–6 slugs from: hiking, beach, food, city-break, history, nature, photography, road-trip, culture,
  wine, museums, architecture, islands, camping, skiing, diving, festivals, nightlife, with-kids, wildlife,
  desert, lakes, train, backpacking, slow-travel, national-parks, street-art, markets.
  Family trips with children should carry `with-kids`.
- Spread the facets: mix all budgets, trip types, seasons and durations across your stories.
- Real places only, real coordinates (lat/lng of the main place, 4 decimals). `photoQuery` = a short English
  name of a famous, photographable landmark/landscape of that place that surely has photos on Wikimedia Commons
  (e.g. "Kotor Bay", "Sossusvlei", "Ha Long Bay"), no adjectives.
- article: 800–2500 characters in EACH language (aim for 1100–1900). First-person travel story with concrete
  details: how they got there, what they saw, food, prices or tips, one honest downside. Paragraphs separated by
  "\n\n" (3–6 paragraphs). No markdown, no headings, no emojis, no lists.
- The en text is a natural English translation of the uk text (same facts), not a summary.
- Ukrainian must be natural, literate modern Ukrainian (not a calque from Russian). Never use Russian words.
- Each traveller has a distinct voice (`style`): e.g. ironic backpacker, calm family dad, foodie, photographer
  with technical notes, retired teacher, student on a budget, adventure climber, slow-travel couple, etc.
  Their stories must sound like them. Descriptions start like the original site: "Привіт! Я <Ім'я>. …" (80–400 chars).
- Names: Ukrainian names for most travellers; 2–3 per agent may be foreign residents of Ukraine. Gender must match the name.
- Every traveller gets 2–5 stories (total 50 per agent). No duplicate titles.
- Titles 10–80 characters, in the original site's manner: «Марокко: вулиці Марракеша», «Грузія на смак: винні підвали…».
- No politics, no war content, nothing offensive. Russia/Belarus are never destinations.

## Check
After each file run: `node tools/validate-seed.js seeds/data/batch-<agent>-*.json` and fix every error.
Measure lengths with the validator, do not guess. Do not touch any other files.
