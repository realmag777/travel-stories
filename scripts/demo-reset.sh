#!/usr/bin/env bash
# Throws away everything the demo changed (database and uploads volumes) and starts it again
# from demo/db/demo.dump and demo/uploads.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[demo] удаляю данные демо (тома базы и uploads)…"
docker compose -f docker-compose.demo.yml down -v --remove-orphans
exec "$(dirname "$0")/demo.sh"
