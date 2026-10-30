#!/usr/bin/env bash
# Throws away everything the demo changed (database and uploads volumes) and starts it again
# from demo/db/demo.dump and demo/uploads.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[demo] deleting the demo data (database and uploads volumes)…"
docker compose -f docker-compose.demo.yml down -v --remove-orphans
exec "$(dirname "$0")/demo.sh"
