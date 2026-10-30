# Подорожники+

> **Готовое демо одной командой → [DEMO.md](DEMO.md)** (`scripts/demo.sh` / `scripts/demo.ps1`, те же данные и картинки, ничего не генерируется).

Учебный ремейк дипломного проекта **Travel Stories / «Подорожники»** на Node.js.
Снаружи — тот же сайт: та же дизайн-система, те же страницы, те же отступы и шрифты (проверено попиксельно).
Внутри — серверный рендеринг, PostgreSQL и набор возможностей, которых у оригинала не было:
фасетный фильтр, поиск обычным языком, карта, бронирование гидов, три языка, админка со статистикой и MCP-сервер.

- Оригинал: <https://travel-stories-frontend.vercel.app/> · API: <https://travel-stories-backend.onrender.com/docs/>
- Стек: Node.js 22, Express 5, Nunjucks (SSR), PostgreSQL 16, Knex, express-session + connect-pg-simple, sharp, zod (общие схемы для клиента и сервера), Leaflet, Vitest, Playwright, Docker.

![Главная](docs/screenshots/home-1440.png)

| Фильтр | Поиск обычным языком | Карта |
|---|---|---|
| ![Фильтр](docs/screenshots/stories-filter-1440.png) | ![Поиск](docs/screenshots/search-1440.png) | ![Карта](docs/screenshots/map-1440.png) |
| **История** | **Бронирование** | **Мобильный фильтр** |
| ![История](docs/screenshots/story-1440.png) | ![Бронирование](docs/screenshots/booking-1440.png) | ![Фильтр на телефоне](docs/screenshots/mobile-filters.png) |
| **Админка: дашборд** | **Админка: редактор** | **Телефон** |
| ![Дашборд](docs/screenshots/admin-dashboard.png) | ![Редактор](docs/screenshots/admin-story-editor.png) | ![Главная на телефоне](docs/screenshots/mobile-home.png) |

Результаты проверок (тесты, visual diff, Lighthouse, нагрузка) — в [docs/REPORT.md](docs/REPORT.md), принятые решения — в [DECISIONS.md](DECISIONS.md).

## Чем отличается от оригинала

| | Оригинал | Подорожники+ |
|---|---|---|
| Рендеринг | Next.js, данные грузятся в браузере | SSR на Nunjucks, JS только для интерактива, всё работает и без JS |
| Хранилище | MongoDB | PostgreSQL 16 + Knex-миграции |
| REST API | `/api/*`, 20 операций | те же 20 операций с тем же конвертом, сообщениями, лимитами и ошибками + `/api/v2/*` |
| Документация API | Swagger | Swagger UI на `/docs` (контракт оригинала + v2), `/docs/openapi.json` |
| Фильтр | чипы категорий | чипы категорий + фасеты: страна, регион, сезон, бюджет, длительность, тип поездки, теги; счётчики у каждого варианта, нулевые неактивны, ЧПУ, SSR, сортировки |
| Поиск | — | обычным языком: «куди поїхати в травні з дітьми недорого» → чипы фасетов (LLM или встроенные правила) |
| Карта | — | `/map` и вид «Карта» в каталоге, кластеры, превью карточки, «шукати у видимій області» |
| Бронирование | — | раздел «Гіди» в меню, `/guides` с фильтрами, бейдж «Гід», блок бронирования на профиле, CTA на страницах историй, страница подтверждения с одноразовой ссылкой отмены |
| «Де зупинитися / Як дістатися» | — | ссылки на отели, билеты, маршрут; партнёрские ID из админки |
| Сохранение историй | только для залогиненных | анонимно: список в localStorage, на сервер — только счётчик (с rate limit) |
| Языки | uk | uk (без префикса), `/en`, `/es`: интерфейс полностью, контент uk+en, es — через «перекласти» |
| SEO | title | title + description везде, OG, JSON-LD (Article, ProfilePage/Person, BreadcrumbList, WebSite), hreflang, sitemap.xml по всем языкам, robots.txt |
| Изображения | Cloudinary | sharp: WebP 400–1280 px, srcset/sizes, lazy, width/height, OG-JPEG, плейсхолдер |
| Контент | ~160 историй, много тестовых | импорт оригинала (тестовые и дубли скрыты модерацией) + 250 новых историй и 80 мандрівників, фото Wikimedia Commons с лицензиями |
| Админка | — | `/admin`: дашборд статистики, истории, мандрівники, словари, брони, настройки, очистка демо |
| MCP | — | `/mcp`: поиск и CRUD историй/мандрівників/категорий, брони, статистика |
| Страницы ошибок | стандартная 404 Next.js | свои 404 и 500 в дизайне сайта |

## Запуск за 2 команды

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

Перед вторым шагом впишите в `.env` пароль БД, `SESSION_SECRET` и хэш пароля админа (см. ниже).
Первый старт сам выполнит миграции, загрузит словари, импортирует оригинал (если API доступен — свежий, иначе снапшот из репозитория), демо-контент и демо-бронирования, нарежет картинки. Это занимает 2–4 минуты; готовность — `docker compose ps` показывает `healthy`.

Сайт: <http://localhost:8350> · админка: <http://localhost:8350/admin> · API: <http://localhost:8350/docs> · карта: <http://localhost:8350/map>

Полный сброс до чистого состояния:

```bash
docker compose down -v && docker compose up -d
```

## Переменные `.env`

| Переменная | Назначение |
|---|---|
| `APP_PORT` / `APP_BIND` | внешний порт сайта (8350) и адрес привязки (`0.0.0.0`; на VPS — `127.0.0.1`) |
| `PUBLIC_URL` | публичный адрес — для canonical, hreflang, sitemap, OG и абсолютных URL в API |
| `SESSION_SECRET` | секрет сессий админки и хэша посетителя |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | база данных; `POSTGRES_HOST_PORT` — порт на `127.0.0.1` для инструментов и тестов (5440) |
| `ADMIN_USER` / `ADMIN_PASS_HASH` | вход в админку; хэш bcrypt в одинарных кавычках |
| `MCP_TOKEN` | токен MCP-сервера |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | LLM для поиска и переводов (необязательно) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `BOOKING_NOTIFY_EMAIL` | почта бронирований (необязательно) |
| `IMPORT_ORIGINAL` | `1` — при первом старте обновить снапшот оригинала из живого API |
| `COMPOSE_SUBNET` | подсеть docker-сети, если стандартная занята |

## Вход в админку

Логин — `ADMIN_USER` (по умолчанию `admin`). Пароль задаётся хэшем:

```bash
docker compose run --rm --no-deps app node tools/hash-password.js 'новий-пароль'
```

Полученную строку `ADMIN_PASS_HASH='…'` вставьте в `.env` и перезапустите `docker compose up -d`.
В локальной установке, собранной при разработке, пароль сгенерирован автоматически и записан комментарием `# ADMIN_PASS=` в `.env` (файл не попадает в git).

Вход защищён: bcrypt, httpOnly-сессия в PostgreSQL, CSRF-токен на всех формах и записывающих запросах, rate limit 10 попыток за 15 минут.

## LLM, SMTP и партнёрские ID

Всё настраивается либо в `.env`, либо в админке → «Налаштування» (значения из админки главнее).

- **LLM.** `LLM_PROVIDER=anthropic` + `LLM_API_KEY` (модель по умолчанию `claude-haiku-5-5`) или `LLM_PROVIDER=openai-compatible` + `LLM_BASE_URL` (OpenAI, OpenRouter, локальная Ollama `http://ollama:11434/v1` и т.п.). Используется в поиске обычным языком (строгая JSON-схема, ответ проверяется zod) и в кнопке «Перекласти» (en/es). Без ключа поиск работает на встроенном разборщике правил, а непереведённые истории показываются на украинском с пометкой.
- **SMTP.** Клиент получает письмо о получении брони, подтверждении и отмене; администратор — уведомление на `BOOKING_NOTIFY_EMAIL`. Без SMTP письма видны в `docker compose logs app`.
- **Партнёрские ID.** Booking.com `aid`, Skyscanner associate id, Tripadvisor partner id. Без них блок «Де зупинитися / Як дістатися» даёт обычные поисковые ссылки.

## Бронирование гидов

Гид — это мандрівник, у которого в админке включено «Приймає бронювання» и есть хотя бы одна активная услуга. В демо-данных гидами сделаны 25 сгенерированных мандрівників (импортированные из оригинала не участвуют). У каждого 1–3 услуги из набора «Онлайн-консультація 30/60 хв», «Пішохідна екскурсія», «Планування маршруту» с ценой для показа и свободные слоты на ближайшие 30 дней. Всё это создаёт сид при чистом запуске (`tools/load-seed.js → loadBookingDemo`).

Где видно на сайте:

- **Меню «Гіди»** стоит после «Мандрівники» в шапке, бургер-меню и футере на всех языках.
- **`/guides`** — сетка карточек: аватар, имя, страна и регион (по историям гида), ближайший свободный слот, цена «від …», кнопка «Забронювати». Фильтры по стране, типу услуги и дате (есть свободный слот в этот день), «Показати ще». Страница рендерится на сервере, работает и без JS, у неё есть мета- и OG-теги и JSON-LD `ItemList`.
- **Главная** — секция «Популярні гіди» между «Наші Мандрівники» и CTA: 4 карточки и «Переглянути всіх».
- **Бейдж «Гід»** — на карточках мандрівників и в профиле. В профиле блок бронирования стоит выше списка историй, а на телефоне снизу закреплена кнопка «Забронювати».
- **Страница истории** — если автор гид, после текста идёт блок «Хочете так само? Забронюйте консультацію з автором» со ссылкой на его блок бронирования.

Как проходит бронирование:

1. Посетитель выбирает услугу, день и время (время по Києву) и заполняет имя, e-mail и сообщение. Поля проверяются той же zod-схемой, что и на сервере.
2. Бронь создаётся со статусом «нова». Двойная бронь одного слота невозможна: строка слота блокируется в транзакции, а частичный уникальный индекс разрешает только одну живую бронь на слот.
3. Посетитель попадает на страницу подтверждения `/booking/<токен>` с деталями. Там же есть ссылка на отмену с отдельным одноразовым ключом: после использования ключ стирается и ссылка перестаёт работать.
4. Клиенту уходит письмо с обеими ссылками, администратору — уведомление на `BOOKING_NOTIFY_EMAIL`. Без SMTP письма пишутся в лог контейнера.
5. В админке («Бронювання») бронь можно подтвердить или отменить, клиент получит письмо. Услуги и расписание слотов гида настраиваются в его карточке в админке.

API: `GET /api/v2/guides?country&service&date&offset&limit`, `GET /api/v2/travellers/:id/booking`, `POST /api/v2/travellers/:id/bookings`. В ответе POST есть `confirmUrl` и `cancelUrl`. MCP: `bookings_list`, `booking_set_status`.

## Демо-контент и как его удалить

Все сгенерированные записи помечены `isDemo` (в админке — фильтр «Тільки демо» в историях и мандрівниках).
Удалить всё разом: админка → «Налаштування» → «Видалити весь демо-контент» (нужно ввести `DELETE`).
Импорт оригинала и созданное вручную не затрагиваются; после очистки демо не пересоздаётся при рестартах.

## Деплой на VPS (docker compose + nginx + https)

1. Установите Docker и плагин compose, склонируйте репозиторий, заполните `.env` (`PUBLIC_URL=https://ваш-домен`, `APP_PORT=8350`).
2. В `.env` добавьте `APP_BIND=127.0.0.1`, чтобы сайт слушал только локально, и запустите `docker compose up -d`. Наружу смотрит только nginx.
3. nginx:

```nginx
server {
    listen 80;
    server_name example.com;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:8350;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

4. Сертификат: `certbot certonly --webroot -w /var/www/certbot -d example.com`, затем `systemctl reload nginx`; продление — `certbot renew` по таймеру.
5. Бэкап: `docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql` и том `uploads`.

Приложение доверяет первому прокси (`trust proxy`), так что IP для rate limit и `secure`-cookie за nginx работают правильно.

## Тесты и проверки

```bash
docker compose --profile test run --rm test
```

Запускает Vitest в контейнере (Linux): юнит-тесты (схемы, ЧПУ фильтра, разборщик запросов, фасеты против полного перебора, гонка бронирования) и контракт API с оригиналом. На хосте:

| Команда | Что делает |
|---|---|
| `npm test` | Vitest (нужен Postgres на 5440 и запущенный сайт, `APP_URL`) |
| `npx playwright test` | E2E: главная, фильтр с URL, поиск, карта, бронирование, CRUD в админке, языки, мобильная версия |
| `node tools/visual-diff.js` | попиксельное сравнение с оригиналом на 375/768/1440 (pixelmatch, контент маскируется) |
| `node tools/lighthouse.js` | Lighthouse mobile для главной, `/stories` и страницы истории |
| `node tools/loadtest-seed.js` | 10 000 синтетических историй в отдельной БД и замер фасетного запроса |
| `node tools/crawl-original.js` | разведка оригинала: скриншоты, токены, ассеты (только чтение) |
| `node tools/import-original.js` | снапшот API оригинала (только чтение) |

Если встроенный Chromium Playwright не имеет сети, добавьте `PW_CHANNEL=chrome`.
Результаты последнего прогона — в `docs/REPORT.md`.

## Структура

```
start.js                 точка входа: middleware, маршруты, 404/500
knexfile.js, migrations/ схема PostgreSQL
src/core/                «движок»: db, ids, i18n, views, images (sharp), security, stats, mailer, llm, settings, http
src/shared/              общее для сервера и браузера: zod-схемы, словари фасетов, ЧПУ фильтра, slug
src/project/content.js   запросы и сериализация историй/мандрівників (в т.ч. формат API оригинала)
src/project/services/    facets (SQL-счётчики), nlsearch, booking, translate, affiliate
src/project/routes/      pages (SSR), api-v1 (контракт оригинала), api-v2, admin, admin-content, seo, docs
src/project/mcp/         MCP: protocol, index, tools/{stories,travellers,categories,bookings,stats}
src/project/openapi/     v1.json (контракт оригинала) + v2.js
src/client/              браузерный JS (esbuild): main, catalog, saved, booking, map, admin
views/                   Nunjucks: layouts, partials, pages, admin
public/css/              tokens, base, components/*.css (один файл на компонент, БЭМ), admin.css
languages/               uk.json, en.json, es.json
seeds/                   original/ (снапшот оригинала), data/ (демо-тексты), media/ (фото + credits.json)
tools/                   bootstrap, load-seed, import-original, crawl-original, visual-diff, lighthouse, loadtest-seed, fetch-media…
tests/                   unit/, api/, e2e/
reference-engine/        образец движка (не в git)
```

## API

- **v1 (как в оригинале):** `GET /api/categories`, `GET /api/stories?page&perPage&category`, `GET /api/stories/popular`, `GET /api/stories/:id`, `GET /api/users?page&limit`, `GET /api/users/:id`, а также `auth/register|login|refresh|session|logout`, `users/me`, `PATCH /api/users`, `PATCH /api/users/avatar`, `POST|PATCH /api/stories`, `stories/own|saved`, `stories/favorite/add|remove/:id`. Конверт `{ status, message, data }`, id — 24-hex, импортированные записи сохраняют свои `_id`.
- **v2:** `GET /api/v2/stories` (фасеты + счётчики), `/api/v2/facets`, `/api/v2/search?q=`, `/api/v2/map`, `/api/v2/stories/by-ids`, `POST /api/v2/stories/:id/save`, `/api/v2/stories/:id/travel-links`, `GET /api/v2/travellers/:id/booking`, `POST /api/v2/travellers/:id/bookings`.

Подробно — в Swagger UI на `/docs`.

## MCP

`POST /mcp`, JSON-RPC 2.0, заголовок `Authorization: Bearer <MCP_TOKEN>`. Подключение, например, в Claude Code:

```bash
claude mcp add --transport http podorozhnyky http://localhost:8350/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Инструменты: `stories_search` (в т.ч. обычным языком), `story_get`, `story_create`, `story_update`, `story_delete`, `story_translate`, `travellers_search`, `traveller_get|create|update|delete`, `categories_list`, `category_create|update|delete`, `bookings_list`, `booking_set_status`, `stats_overview`.

## Чьё это

- **Дизайн и исходная идея** принадлежат авторам дипломного проекта «Подорожники» / Travel Stories: <https://travel-stories-frontend.vercel.app/>, API <https://travel-stories-backend.onrender.com/docs/>. Вёрстка повторена по их сайту для учебных целей; ассеты (логотип, спрайт, hero, join) — их.
- **Импортированные истории и профили** — из открытого API оригинала, со своими `_id`.
- **Фото демо-историй** — Wikimedia Commons, только свободные лицензии; автор и лицензия каждой фотографии сохранены в БД и подписаны под обложкой (`seeds/media/credits.json`). Аватары демо-мандрівників — <https://randomuser.me>.
- **Демо-контент** (80 мандрівників, 250 историй на украинском и английском) сгенерирован и помечен `isDemo`. Люди и истории вымышлены, места реальные.
- Карта — © участники OpenStreetMap.

Автор ремейка: Rostislav Sofronov (realmag777).
