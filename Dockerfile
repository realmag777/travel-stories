# syntax=docker/dockerfile:1

# ---- deps: production dependencies only ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- build: full install, bundle client assets ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN node tools/build-assets.js

# ---- test: dev dependencies + sources, used by `docker compose run --rm test` ----
FROM build AS test
ENV NODE_ENV=test
CMD ["npx", "vitest", "run"]

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY package.json knexfile.js start.js ./
COPY src ./src
COPY views ./views
COPY languages ./languages
COPY migrations ./migrations
COPY seeds ./seeds
COPY tools/bootstrap.js tools/import-original.js tools/hash-password.js tools/load-seed.js tools/loadtest-seed.js ./tools/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "start.js"]
