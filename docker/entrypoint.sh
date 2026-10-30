#!/bin/sh
# Runs migrations, first-start seeding and import, then the given command.
set -e
node tools/bootstrap.js
exec "$@"
