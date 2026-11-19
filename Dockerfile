# --- Base ---
FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# --- Install ---
FROM base AS deps
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN bun install --frozen-lockfile

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules node_modules
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV NODE_ENV=production
RUN bun run build

# --- Production dependencies ---
FROM base AS prod-deps
COPY package.json bun.lock .npmrc ./
COPY tools/ tools/
RUN bun install --frozen-lockfile --production --ignore-scripts

# --- Runtime ---
FROM base AS runtime
ENV NODE_ENV=production

RUN chown bun:bun /app
COPY --chown=bun:bun --from=prod-deps /app/node_modules node_modules
COPY --chown=bun:bun --from=build /app/dist dist
COPY --chown=bun:bun --from=build /app/src/server/logging.ts /app/src/server/metrics.ts src/server/
COPY --chown=bun:bun server.ts package.json ./

USER bun

ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch(\`http://localhost:\${process.env.PORT}/health\`).then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

EXPOSE 3000
CMD ["bun", "run", "start"]
