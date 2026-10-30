#!/usr/bin/env bash
# One-command local demo: checks Docker, prepares .env, starts docker-compose.demo.yml,
# waits for the healthcheck and prints the links.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.demo.yml)
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker not found. Install Docker Desktop (Windows/macOS) or Docker Engine with the compose plugin (Linux)."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop / the docker service and try again."
docker compose version >/dev/null 2>&1 || fail "'docker compose' (v2) is missing. Update Docker."

if [ ! -f .env ]; then
  cp .env.demo .env
  echo "[demo] .env created from .env.demo"
fi

# Values from .env (simple KEY=VALUE lines).
envval() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//"; }
PORT="$(envval APP_PORT)"; PORT="${PORT:-8080}"
ADMIN_USER="$(envval ADMIN_USER)"; ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="$(envval DEMO_ADMIN_PASS)"

[ -f demo/db/demo.dump ] || fail "demo/db/demo.dump is missing — the repository was not cloned completely."
[ -d demo/uploads/covers ] || fail "demo/uploads is missing — the repository was not cloned completely."

# Port check (skipped when our own demo already listens there).
running="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"
# Docker may hold a just-released port for a moment (after demo-reset), so retry for ~5 s.
if [ -z "$running" ]; then
  busy=1
  for i in 1 2 3 4 5 6; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then sleep 1; else busy=0; break; fi
  done
  if [ "$busy" = 1 ]; then fail "Port $PORT is taken. Set another one in .env, e.g. APP_PORT=8090, and run the script again."; fi
fi

echo "[demo] building and starting (first time 2–5 minutes: the image builds, the database is restored from the snapshot)…"
"${COMPOSE[@]}" up -d --build

echo -n "[demo] waiting for the app"
for i in $(seq 1 180); do
  id="$("${COMPOSE[@]}" ps -q app)"
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  [ "$status" = "unhealthy" ] && { echo; "${COMPOSE[@]}" logs --tail 50 app; fail "The app did not start (see the log above)."; }
  echo -n "."; sleep 5
done
[ "$status" = "healthy" ] || { echo; "${COMPOSE[@]}" logs --tail 50 app; fail "The app was not ready within 15 minutes."; }
echo

URL="http://localhost:$PORT"
cat <<EOF

  Podorozhnyky+ demo is running
  ─────────────────────────────────────────────
  Site:     $URL
  Admin:    $URL/admin   login: $ADMIN_USER   password: $ADMIN_PASS
  API:      $URL/docs
  Map:      $URL/map
  Guides:   $URL/guides
  ─────────────────────────────────────────────
  Reset to the snapshot: scripts/demo-reset.sh    Stop: docker compose -f docker-compose.demo.yml down

EOF
