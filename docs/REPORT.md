# Check report

Date: 2026-10-30. All measurements were taken on the production build in Docker (`docker compose down -v && docker compose up -d`, then the tests).

## Clean run

`docker compose down -v && docker compose up -d` → the container is `healthy` after ~2.7 min: migrations, dictionaries, live import of the original (10 categories, 168 stories, 167 users, 168 covers, 42 avatars), moderation (64 test/duplicate stories hidden, 104 visible), demo content (80 travellers, 250 stories), booking demo (16 guides, 1536 slots; later reworked to 25 guides, see below).

## Tests

| Suite | Where | Result |
|---|---|---|
| Vitest: unit (filter, schemas, query parser, facets against a brute-force count, booking race) + API contract against the original + v2 + MCP | Linux container `docker compose --profile test run --rm test` | **52 / 52** |
| Playwright E2E: home page, story, profile, 404/sitemap, saves, filter with URL and "back", empty options, «Показати ще» (Show more), search (with and without JS), map and bbox, booking and a repeated booking (409), languages, admin (login, story CRUD with a cover, hiding, deleting, dictionaries, guides/services/slots, bookings, settings, demo cleanup guard), mobile | host, Chrome | **23 / 23** |

## Visual diff (pixelmatch, masked content)

On both sides images are hidden and text is transparent; on our side the new-feature blocks (`data-extra`) are hidden. "raw" compares without masks against the stored screenshots of the original (different content).

| Page | 375 | 768 | 1440 | raw 1440 |
|---|---|---|---|---|
| home | 0% | 0% | 0.01% | 6.64% |
| stories | 0% | 0% | 0% | 25.18% |
| stories-category | 0.02% | 0.01% | 0.01% | 24.24% |
| story | 0% | 0% | 0% | 31.58% |
| travellers | 0% | 0% | 0% | 5.51% |
| traveller | 0% | 0% | 0% | 14.34% |
| login | 10.96% | 6.01% | 3.17% | 3.3% |
| register | 10.96% | 5.4% | 3.17% | 3.7% |

The auth pages differ by design: instead of the login/sign-up form there is the «Історії публікує редакція» ("Stories are published by the editors") notice (tabs, title, subtitle and header match).

## Lighthouse (mobile)

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| home | 96 | 100 | 100 | 100 | 2.7 s | 0 | 0 ms |
| stories | 99 | 100 | 100 | 100 | 2.0 s | 0 | 0 ms |
| story | 100 | 100 | 100 | 100 | 1.7 s | 0 | 0 ms |

## Faceted filter on 10,000 stories

A separate DB, 60 runs per scenario; time = counts for all facets + one page of results (two queries in parallel).

| Scenario | Found | p50 | p95 | max |
|---|---|---|---|---|
| no filter | 10000 | 37.9 ms | 40.1 ms | 58.7 ms |
| 1 facet (season) | 3428 | 22.8 ms | 23.9 ms | 27.1 ms |
| 3 facets | 539 | 16.6 ms | 21 ms | 23.6 ms |
| 5 facets + category | 9 | 20.3 ms | 22.3 ms | 22.4 ms |
| bbox (Europe) | 27 | 3.9 ms | 4.7 ms | 5.4 ms |
| sort popular | 2455 | 18.8 ms | 21.2 ms | 22.3 ms |

The "< 100 ms" requirement is met with a wide margin. How: B-tree indexes on category, country, region, budget, trip type and duration; GIN on the season and tag arrays; the fully filtered set is materialized once (`WITH base AS MATERIALIZED`), inactive facets are grouped from it, and only active facets need their own scan.

## Guides and booking (31.10.2026)

Vitest **57 / 57** (one-time cancellation, guide filters and `/api/v2/guides` added), Playwright **27 / 27**. New E2E journey: home page → «Гіди» (Guides) → profile → book a slot → confirmation page → the booking is visible in the admin → one-time cancellation. The visual diff did not change (0.00% on the original pages): new elements are marked `data-extra`.

## One-command demo: check from a clean clone

| Check | Result |
|---|---|
| Clone from GitHub into an empty folder, without the working copy, volumes or the demo image | 3286 files; `.git` 229 MB; working tree 274 MB |
| Start exactly as DEMO.md says (`scripts\demo.ps1`; port 8080 taken → the script suggested `APP_PORT=8090` → run again) | the site works **78 s** after cloning started (warm BuildKit cache on the machine); an uncached image build takes 33 s |
| Counts in the demo DB against `demo/db/manifest.json` (snapshot of the current DB) | all 13 values match: 418 stories (354 visible, 250 demo), 247 travellers, 25 guides, 51 services, 1046 slots, 10 bookings, 10 categories, 81 countries, 418 covers, 122 avatars. The working DB has 249 travellers: two accounts from the contract tests were left out of the snapshot |
| Requests to travel-stories-backend.onrender.com, Wikimedia, randomuser at start | 0 mentions in the logs; a cold start with these domains pointed at 0.0.0.0 succeeds (a request from inside the container gets ECONNREFUSED) |
| Playwright E2E against the demo | **27 / 27** |
| `scripts\demo-reset.ps1` after E2E (12 bookings before) | 22 s, back to 10 bookings / 418 stories / 25 guides, uploads 2334 files + marker |
| `bash scripts/demo.sh` (Git Bash) | works, prints the links |

Fixed during the check: long asset file names (a Windows clone failed on the 260-character path limit) and the port check right after `demo-reset` (Docker holds the port for another second).
