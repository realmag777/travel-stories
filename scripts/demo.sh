#!/usr/bin/env bash
# One-command local demo: checks Docker, prepares .env, starts docker-compose.demo.yml,
# waits for the healthcheck and prints the links.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.demo.yml)
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker не найден. Установите Docker Desktop (Windows/macOS) или Docker Engine с плагином compose (Linux)."
docker info >/dev/null 2>&1 || fail "Docker не запущен. Запустите Docker Desktop / службу docker и повторите."
docker compose version >/dev/null 2>&1 || fail "Нет 'docker compose' (v2). Обновите Docker."

if [ ! -f .env ]; then
  cp .env.demo .env
  echo "[demo] .env создан из .env.demo"
fi

# Values from .env (simple KEY=VALUE lines).
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//"; }
PORT="$(envval APP_PORT)"; PORT="${PORT:-8080}"
ADMIN_USER="$(envval ADMIN_USER)"; ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="$(envval DEMO_ADMIN_PASS)"

[ -f demo/db/demo.dump ] || fail "Нет demo/db/demo.dump — репозиторий склонирован не полностью."
[ -d demo/uploads/covers ] || fail "Нет demo/uploads — репозиторий склонирован не полностью."

# Port check (skipped when our own demo already listens there).
running="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"
# Docker may hold a just-released port for a moment (after demo-reset), so retry for ~5 s.
if [ -z "$running" ]; then
  busy=1
  for i in 1 2 3 4 5 6; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then sleep 1; else busy=0; break; fi
  done
  if [ "$busy" = 1 ]; then fail "Порт $PORT занят. Укажите другой в .env: APP_PORT=8090 — и запустите скрипт снова."; fi
fi

echo "[demo] сборка и запуск (первый раз 3–6 минут: образ собирается, база восстанавливается из снимка)…"
"${COMPOSE[@]}" up -d --build

echo -n "[demo] жду готовности"
for i in $(seq 1 180); do
  id="$("${COMPOSE[@]}" ps -q app)"
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { echo; "${COMPOSE[@]}" logs --tail 50 app; fail "Приложение не поднялось (см. лог выше)."; }
  echo -n "."; sleep 5
done
[ "$status" = "healthy" ] || { echo; "${COMPOSE[@]}" logs --tail 50 app; fail "Не дождался готовности за 15 минут."; }
echo

URL="http://localhost:$PORT"
cat <<EOF

  Подорожники+ — демо запущено
  ─────────────────────────────────────────────
  Сайт:     $URL
  Админка:  $URL/admin   логин: $ADMIN_USER   пароль: $ADMIN_PASS
  API:      $URL/docs
  Карта:    $URL/map
  Гиды:     $URL/guides
  ─────────────────────────────────────────────
  Сброс к снимку: scripts/demo-reset.sh    Остановить: docker compose -f docker-compose.demo.yml down

EOF
