# Podorozhnyky+ — decisions

The work ran non-stop and open questions were settled without asking. This file records what was chosen and why.

## Sources and environment

1. **Reference engine.** `./reference-engine` was unpacked from `res/new-wolf-site.zip` (the FOX/WOLF Node engine). Ideas were taken, not code: the split between `src/core` (engine: DB, i18n, templates, images, security, analytics, mail, LLM) and `src/project` (site content), controllers with `register(app)`, Nunjucks, translations in `languages/*.json`, JSON-LD from data, MCP laid out as `mcp/index.js + protocol.js + tools/*`, own visit analytics. Storage is PostgreSQL instead of JSON files, so MCP needs no `pm2 restart` after writes.
2. **Network.** Playwright's bundled Chromium gets `ERR_NETWORK_ACCESS_DENIED` on this machine, so the crawler and visual diff run with `PW_CHANNEL=chrome` (system Chrome). In Docker and on a clean machine the variable is not needed.
3. **Docker subnet.** Docker's address pools on the machine are exhausted by other projects; `docker-compose.yml` sets an explicit subnet `10.77.31.0/24` (override with `COMPOSE_SUBNET`). Other projects' networks were not touched.
4. **Ports.** The app uses `8350`; Postgres is exposed only on `127.0.0.1:5440` (5432/3306 and nearby ports are taken).
5. **Repository.** As the user asked, the code goes to the existing `https://github.com/realmag777/travel-stories` instead of a new `podorozhnyky-plus` (`gh` is not installed on the machine; pushed with git). The repository is public — the owner decided to keep it that way (30.10.2026).

## API

6. **The v1 contract is the whole original.** Following the user's clarification, all 20 operations of the original Swagger are reproduced, including `auth/*`, `users/me`, `stories/own|saved`, creating/editing stories (multipart) and favourites. Same envelope `{status, message, data}`, same messages ("Successfully found stories!" etc.), limits (`perPage ≤ 20`, `limit ≤ 50`, popular `≤ 12`), celebrate/Joi validation error format (`statusCode/error/message/validation`), cookie sessions `accessToken/refreshToken/sessionId`. The original OpenAPI document is the base of `/docs`, with the v2 paths added.
7. **No registration in the UI, but it exists in the API.** The brief says "no registration", the clarification says "the REST API must be the same". The compromise: the `auth/register|login` endpoints work (API compatibility), while «Вхід/Реєстрація» (Log in / Sign up) on the site look like the original but lead to a page explaining that publishing goes through the editors.
8. **Extensions live only under `/api/v2`**: facets, search, map, anonymous saves, booking, "Where to stay" links.
9. **24-hex ids.** Imported records keep their `_id`; new ones are generated as ObjectIds (time + random part). Demo records get deterministic ids with the publication time inside, so a repeated bootstrap produces the same ids.

## Data

10. **Original import = a snapshot in the repository + a live refresh.** `tools/import-original.js` (GET only) writes `seeds/original/*.json` and the images (re-encoded to JPEG ≤1280 px, 26 MB instead of 52). On the first container start the snapshot is refreshed from the live API if it is reachable; otherwise the committed one is used. So `docker compose up -d` also works without the internet.
11. **Moderation of the import.** The original has many test records ("ТТТТ…", "ND_TEST_CREATE", 17 copies of one QA story). Nothing is deleted: such stories get `hidden = true` (rule in `tools/load-seed.js → moderateOriginal`), which removes them from public lists, counts, the API and the sitemap; they can be restored in the admin. 104 of the original's 168 stories stay visible. Users with no visible stories and no description, or with an e-mail instead of a name, are hidden too.
12. **Demo content** (80 travellers, 250 stories, uk + en) was written by five parallel agents from a shared brief `seeds/BRIEF.md` and checked with `tools/validate-seed.js` (800–2500 characters, facet dictionaries, coordinates, uniqueness). World regions were split between agents so that places do not repeat.
13. **Photos** come from the Wikimedia Commons API without a key, free licences only (CC BY / BY-SA / CC0 / PD), landscape ≥1200 px. Author, licence and links are stored in the DB and shown under the cover. Avatars come from `randomuser.me/api/portraits`. The media are committed (`seeds/media`, 49 MB) so a clean start does not depend on third-party services.
14. **Demo dates and popularity** are spread over the last 12 months deterministically (key hash); favoriteCount has a "long tail" (8% of stories have 40–85 saves, the rest 0–37).
15. **First booking demo** (superseded by decision 36): every 5th demo traveller was a guide with two services and slots for 6 weeks, plus three demo bookings so the admin had something to confirm.

## Filter and search

16. **Filter URLs:** `/stories/filter/country-it,jp/season-spring/budget-low/trip-family/days-4-7/tags-food`; category and sorting go into the query (`?category=` is compatible with the original). Segments and values are sorted so the URL is canonical; a non-canonical one gets a 301. The same module `src/shared/filter-state.js` is used by the server and the browser.
17. **Semantics:** OR within a facet, AND between facets. Counts are "disjunctive": for each facet they are computed with all other active filters, in one SQL query, arrays via GIN indexes. Options with zero results are disabled, selected ones are always shown.
18. **Instant updates** without an SPA: every option is a real link to an SSR page; JS intercepts the click, requests the same URL with an `X-Partial` header and swaps the fragments (results, facets, chips, categories), updating the address with `history.pushState`. Without JS everything works as ordinary navigation.
19. **Duration** uses buckets of 1–3 / 4–7 / 8–14 / 15+ days (the exact number of days is stored, the facet uses buckets). Season and tags are arrays. The region is a slug of its English name.
20. **Plain-language search:** with an LLM — a request to the model with a strict JSON schema and the lists of allowed values, the answer is validated with zod; on any error or without a key — the built-in rule parser (months→seasons, budget, trip type, duration, tags, categories, countries and regions from the DB with Ukrainian grammatical cases). `LLM_PROVIDER = anthropic | openai-compatible`, default model `claude-haiku-5-5`. Without JS the search form goes to `/stories/search`, which redirects to the filter URL.
21. **Map:** Leaflet + markercluster served locally, OSM tiles. «Шукати у видимій області» (Search in the visible area) adds `bbox` to the filter state — facet counts are recalculated for the area, while markers follow the other facets (so points do not disappear while panning).

## Layout

22. **Pixel parity** is checked by `tools/visual-diff.js` against the live original: images are made invisible and text transparent on both sides (the content differs), and our new-feature blocks (`data-extra`) are hidden. Result: 0.00% on every page except auth (where the form is replaced by the editorial notice).
23. **modern-normalize** is included as the brief requires, but it sets `line-height: 1.15` while the original uses `normal`; `normal` was restored, otherwise cards shifted by 2–20 px.
24. **Card counts as in the original:** /travellers shows 8 below 1440 px and 12 on desktop, a profile 4 and 6. The server renders the desktop set; on narrow screens JS trims it and switches «Показати ще» (Show more) to `offset/limit` (CSS hides the extra cards until the script runs).
25. **New blocks** use the same system: the filter panel and chips follow the original's category style, "List / Map" uses its segmented tabs, the admin confirm modal is its modal, field errors are its `errorMessage`, the loader is its spinner plus a progress bar.
26. **YouTube icon.** The original sprite has no `icon-youtube` (there is an empty spot); it was added — a deliberate visible difference in the footer.
27. **Fonts** are served locally from `@fontsource` (Nunito Sans 400–700, Inter 700, Sora) with the same metric-override fallbacks that next/font generated for the original.

## Security and the rest

28. **Sessions only for /admin** — public pages set no cookies. Anonymous saving: ids in localStorage, only the counter change reaches the server; one vote per visitor hash (IP+UA+secret) and story, plus rate limits per IP and per IP+storyId, plus an Origin check.
29. **CSRF** — a token in the session; multipart forms pass it in the query. Login uses bcrypt, `session.regenerate`, a 10 per 15 min rate limit.
30. **Analytics without external services:** an in-memory buffer flushed to `page_views` every 10 s; bots and automated tests (`HeadlessChrome`, `x-no-track`) are not counted, so the charts are honestly empty on a fresh installation.
31. **E-mail** without SMTP goes to the container log; an SMTP error never breaks a booking.
32. **Double booking** is ruled out twice: `SELECT … FOR UPDATE` on the slot in a transaction and a partial unique index `bookings(slot_id) WHERE status <> 'cancelled'` (tested with 8 parallel attempts).
33. **Content translations:** uk and en come from the seeds; es and new stories use the «Перекласти» (Translate) button (LLM). Without a translation the Ukrainian text is shown with a note and `lang="uk"`.
34. **Demo cleanup** deletes `is_demo` stories and demo travellers without real stories, their files and then orphaned countries; a flag in `settings.bootstrap` keeps bootstrap from re-creating the demo after a restart.
35. **The load test** runs in a separate database `<db>_load` (created and dropped by the script) so the site is not cluttered with 10,000 synthetic stories.

## Guides (the «Гіди» section)

36. **Who is a guide.** A traveller with the "accepts bookings" flag and at least one active service. In the demo these are 25 generated travellers chosen deterministically by key hash; travellers imported from the original never become guides. Services come from a catalogue: 30- and 60-minute consultation, walking tour, route planning, 1–3 per guide. The display price is in euros; slots cover 30 days on five different weekly schedules.
37. **A guide's country and region** are derived from their stories: the most frequent country, and the region of the latest story in that country (otherwise it produced "a region in Laos, country Indonesia").
38. **The «від …» ("from …") price** is the lowest number in the `price_label` of active services. Prices are display strings; there is no payment.
39. **Booking confirmation** is `/booking/<public_token>`: a 128-bit token, `noindex`, `no-store`. Cancelling uses a separate `cancel_token`. It is one-time: it is erased by the same UPDATE that cancels the booking, and also when the admin cancels. Confirming a booking in the admin issues a new cancel key. Cancelling is a POST with an Origin check; the GET only shows the confirmation screen.
40. **New elements in the header, on the home page and in profiles** are marked `data-extra`, so the visual diff against the original stays at 0.00%.

## One-command demo

41. **A snapshot, not a seed.** The demo starts from `demo/db/demo.dump` (`pg_dump -Fc`, 0.6 MB) and `demo/uploads`. On the first start Postgres restores the dump through `docker-entrypoint-initdb.d` — this only runs on an empty data directory, so a repeated start overwrites nothing. With `DEMO_MODE=1` the app only runs migrations (there are none on a fresh snapshot) and copies the images into its volume once. Import from the original, Wikimedia, randomuser and generation are never called.
42. **The snapshot is taken without changing the working DB.** `tools/demo-snapshot.js` dumps into a separate temporary database and cleans that. Admin sessions, API cookie sessions, anonymous vote hashes and accounts created by the contract tests are deleted. All bookings are anonymized: «Гість N» (Guest N) / `guestN@example.com`, message text replaced. LLM/SMTP secrets and partner IDs are blanked. Analytics (`page_views`, `search_events`) stay: they are admin state, not a service log. There are no rate-limit counters in the DB; they live in process memory.
43. **The admin password is not stored in the database.** The admin login is set by the `ADMIN_USER` and `ADMIN_PASS_HASH` variables, so the demo password `demo-admin-2026` and its bcrypt hash are in `.env.demo`. The dump has no admin passwords. Stored analytics refer only to visitor hashes.
44. **Images are in git, no Release.** Uploads take 158.5 MB (2334 files, the largest 403 KB) — below the 200 MB threshold, and every file is below 50 MB. Recompression and a GitHub Release archive were not needed; the demo script downloads nothing. The images are copied into a named volume rather than mounted directly, so uploads in the admin do not change the repository folder and `demo-reset` returns exactly the snapshot.
45. **Assets in the repository.** Fonts are in `public/fonts`, modern-normalize and Leaflet with markercluster in `public/vendor` together with their licences. The build takes them from there: an esbuild alias for Leaflet, CSS directly. No CDN. The image build only downloads the base Docker images and the server's npm dependencies. On the map, OpenStreetMap tiles are the only thing that needs the internet at runtime.
46. **Port and network.** The default port 8080 is changed with one variable `APP_PORT`, and `PUBLIC_URL` follows it (`http://localhost:${APP_PORT}`). The site listens on `127.0.0.1` only. The demo has its own compose project name (`podorozhnyky-demo`), its own volumes and subnet `10.77.32.0/24` (`DEMO_SUBNET`), so it does not clash with the working stack.
47. **`npm run demo`** calls `scripts/demo.js`, which runs `demo.ps1` on Windows and `demo.sh` elsewhere. The scripts themselves do not need Node.js. The `.ps1` files carry a UTF-8 BOM so Windows PowerShell 5.1 reads them as UTF-8.
48. **Short paths.** The clean-clone check on Windows failed: the crawler's asset names were up to 133 characters, and in a deep folder the path exceeded 260 characters. Assets are now named `<sha1-12>.<ext>`, with the original URL kept in `index.json`. The longest path in the repository is 69 characters.
49. **English documentation.** At the owner's request (31.10.2026) the repository documentation, `.env.demo` comments and demo script messages are in English. The site itself stays Ukrainian-first with `/en` and `/es` versions, so Ukrainian UI labels are quoted in the docs with an English gloss.
