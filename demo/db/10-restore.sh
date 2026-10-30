#!/bin/sh
# Runs once, on an empty data directory (postgres docker-entrypoint-initdb.d):
# restores the demo snapshot. A second start with existing data never gets here.
set -e
echo "[demo] restoring demo.dump into ${POSTGRES_DB}"
pg_restore --no-owner --no-privileges --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB" /docker-entrypoint-initdb.d/demo.dump
echo "[demo] restore finished"
