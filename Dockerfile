# --- Base ---
FROM oven/bun:1.4.2-alpine AS base
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

# --- Production dependencies (patches applied, then devDeps stripped) ---
FROM base AS prod-deps
COPY package.json bun.lock .npmrc ./
COPY patches/ patches/
COPY tools/ tools/
RUN bun install --frozen-lockfile \
    && bun install --frozen-lockfile --production

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
