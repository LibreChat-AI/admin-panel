# --- Base ---
FROM oven/bun:1.3.11-alpine AS base
WORKDIR /app

# --- Install ---
FROM base AS deps
ENV BUN_CONFIG_MAX_HTTP_REQUESTS=12
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN ok=0; for i in $(seq 1 12); do bun install --frozen-lockfile && ok=1 && break; echo "network retry $i"; done; [ "$ok" = 1 ]

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules node_modules
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV NODE_ENV=production
RUN bun run build

# --- Production dependencies (patches applied, then devDeps stripped) ---
FROM base AS prod-deps
ENV BUN_CONFIG_MAX_HTTP_REQUESTS=12
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN ok=0; for i in $(seq 1 12); do bun install --frozen-lockfile && bun install --frozen-lockfile --production && ok=1 && break; echo "network retry $i"; done; [ "$ok" = 1 ]

# --- Runtime ---
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/src/server src/server
COPY server.ts package.json ./

RUN chown -R bun:bun /app
USER bun

ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch(\`http://localhost:\${process.env.PORT}/health\`).then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

EXPOSE 3000
CMD ["bun", "run", "start"]
