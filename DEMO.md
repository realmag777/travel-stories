# Podorozhnyky+ demo with one command

## For Claude Code / an AI agent

Clone the repository, run `scripts/demo.sh` (on Windows `scripts/demo.ps1`), do not generate anything and do not change the code; after it starts, open the links from the script output and check that the home page, `/stories` with a filter, `/map`, `/guides` and `/admin` open.

```bash
git clone https://github.com/realmag777/travel-stories.git && cd travel-stories && bash scripts/demo.sh
```

Windows (PowerShell):

```powershell
git clone https://github.com/realmag777/travel-stories.git; cd travel-stories; powershell -ExecutionPolicy Bypass -File scripts\demo.ps1
```

## Requirements

- Docker Desktop (Windows, macOS) or Docker Engine with the compose v2 plugin (Linux). Node.js is not needed.
- A free port **8080** on localhost (another one is set with one line, see "Common problems").
- About 1.5 GB of disk space for the image and the data.

## Start

1. Clone the repository and go into the folder.
2. Run `bash scripts/demo.sh` (Linux/macOS) or `powershell -ExecutionPolicy Bypass -File scripts\demo.ps1` (Windows). With Node.js you can also use `npm run demo`.
3. Wait for the output with the links. First start: 2–5 minutes on a new machine (the base images are pulled, the app image builds in about 35 s, Postgres restores the snapshot, the images are copied into a volume). On a machine with a Docker cache it takes about 80 s from cloning to a working site. Later starts take seconds.

The script checks Docker, creates `.env` from `.env.demo` (if there is no `.env`), starts `docker-compose.demo.yml`, waits for the healthcheck and prints the links.

The data comes only from the repository: the database from `demo/db/demo.dump`, the images from `demo/uploads`. Nothing is imported from the original and nothing is generated at start. A repeated start does not overwrite the data.

## Links and login

| What | Address |
|---|---|
| Site | http://localhost:8080 |
| Admin | http://localhost:8080/admin — login `admin`, password `demo-admin-2026` |
| API (Swagger) | http://localhost:8080/docs |
| Map | http://localhost:8080/map |
| Guides | http://localhost:8080/guides |

The login and password are set in `.env.demo` (`ADMIN_USER`, `DEMO_ADMIN_PASS`). They are for the local demo only.

## What to show in 5 minutes

The site interface is Ukrainian; English and Spanish are linked at the bottom of every page.

1. **Home page** — the same layout as the original «Подорожники». Further down there is the «Популярні гіди» (Popular guides) section.
2. **Filter** — «Історії» (Stories) → in the left panel pick season «Весна» (Spring) and budget «Низький» (Low). Results and counts update without a reload; the address is a readable URL like `/stories/filter/season-spring/budget-low` that can be shared.
3. **Plain-language search** — in the box above the filter type «куди поїхати в травні з дітьми недорого» ("where to go in May with kids on a budget"). The query turns into the chips Весна · Низький · Сім'я (Spring · Low · Family); remove any of them with the cross. No LLM is needed, the rule parser does the work.
4. **Map** — the «Карта» (Map) switch in the catalogue or `/map`: clusters, a preview in the popup, the «Шукати у видимій області» (Search in the visible area) checkbox recalculates the filter.
5. **Booking a guide** — «Гіди» (Guides) → a card → «Забронювати» (Book) → service, day, time, name and e-mail → a confirmation page with the details and a one-time cancel link. In the demo the e-mail goes to the log: `docker compose -f docker-compose.demo.yml logs app`.
6. **Admin** — `/admin`: the dashboard, the booking you just made under «Бронювання» (Bookings; confirm or cancel it), the story editor with a map and translations, the dictionaries, the demo content cleanup.
7. **Languages** — English / Español at the bottom of the page.

## Reset to the snapshot

Everything changed in the demo (bookings, admin edits, uploaded images) is deleted and the demo starts again from the snapshot:

```bash
bash scripts/demo-reset.sh
```

Windows: `powershell -ExecutionPolicy Bypass -File scripts\demo-reset.ps1`; with Node.js: `npm run demo:reset`.

To stop without losing data: `docker compose -f docker-compose.demo.yml down`.

## Internet

Map tiles are loaded from OpenStreetMap, so the map needs the internet. Everything else works offline: fonts, Leaflet, styles and images are in the repository, no CDN is used. The internet is needed once more — for the first image build, to pull the Docker images and npm packages.

## Common problems

- **Port 8080 is taken.** The script says so. Open `.env` (or `.env.demo` if `.env` does not exist yet), change `APP_PORT=8080` to a free port, for example `APP_PORT=8090`, and run the script again. The links in the output change accordingly.
- **Docker is not running.** The script says Docker is not running. Start Docker Desktop, wait for the green status and try again.
- **No snapshot (`demo/db/demo.dump` or `demo/uploads`).** Most likely the clone is incomplete. Clone again without `--depth`/`--filter`. There are no archives to download: the images are in the repository itself.
- **Docker network error "all predefined address pools have been fully subnetted".** The demo uses its own subnet `10.77.32.0/24`. If it clashes with your network, set another one in `.env`, for example `DEMO_SUBNET=10.99.12.0/24`.
- **"Waiting for the app" takes long.** Look at `docker compose -f docker-compose.demo.yml logs app db`. Reset to a clean snapshot with `scripts/demo-reset`.
