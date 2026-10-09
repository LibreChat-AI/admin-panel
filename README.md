# LibreChat Admin Panel

A browser-based management interface for [LibreChat](https://github.com/danny-avila/LibreChat). It proxies admin operations through the **LibreChat Admin API** (`/api/admin/*`) and provides a GUI for tasks that would otherwise require editing `librechat.yaml` directly or using raw API calls.

## Features

- **Configuration management** — View and edit all LibreChat settings through a dynamic, schema-driven form. New fields added to the schema appear automatically.
- **Role and group overrides** — Apply configuration overrides scoped to specific roles or groups, with a priority-based cascade that determines the final resolved value for each user.
- **User and group administration** — Create and manage groups, assign roles, and control access.
- **Capability grants** — Assign fine-grained system capabilities to roles and groups, with an audit log.
- **Authentication** — Supports username/password login and OpenID SSO when enabled on the LibreChat instance.
- **Localization** — Full multi-language support for all UI strings.
- **Accessibility** — Keyboard navigable with ARIA regions, focus management, and screen reader support.

## How it works

```
Browser  →  Admin Panel (TanStack Start, port 3000)
                 ↓  server functions (BFF)
            LibreChat Admin API (default port 3080)
                 ↓
            MongoDB / config store
```

The admin panel does **not** connect to the database directly. Every read and write goes through a running LibreChat instance that exposes the admin API. You need either a real LibreChat server or the included mock backend (UI exploration only).

## Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | **≥ 22.12** (required by Vite 8 and TanStack Start) |
| Package manager | [Bun](https://bun.sh) (preferred), pnpm, or npm |

If using npm and install fails on peer dependencies, retry with `npm install --legacy-peer-deps`.

For full functionality, a LibreChat instance with the admin API enabled and an account that holds the `access:admin` capability.

## Getting started

### Option A — Explore the UI without LibreChat (mock backend)

Use this when you want to browse the interface without credentials or a running LibreChat server. Data is in-memory sample content and is **not persisted**.

**Terminal 1** — mock API on port 3081:

```bash
cp .env.example .env
# Add these lines to .env (or use the values below):
#   VITE_API_BASE_URL=http://localhost:3081
#   API_SERVER_URL=http://localhost:3081
#   ADMIN_SSO_ENABLED=false

bun install          # or: npm install --legacy-peer-deps
bun run mock:backend
```

**Terminal 2** — admin panel on port 3000:

```bash
bun dev              # or: npm run dev
```

Open http://localhost:3000 and sign in with **any** email and password, for example:

| Email | Password | Notes |
| ----- | -------- | ----- |
| `admin@test.com` | anything | Standard login |
| `rejected@test.com` | anything | Simulates invalid credentials |
| `2fa@test.com` | anything | Triggers 2FA step (use code `123456`) |

The mock backend ships sample users, groups (Engineering, Marketing), roles (ADMIN, USER, Billing), config, and grants. See [`e2e/mock-backend.mjs`](e2e/mock-backend.mjs) for the full handler list.

### Option B — Connect to a real LibreChat instance

**Terminal 1** — start LibreChat (default http://localhost:3080).

**Terminal 2** — admin panel:

```bash
cp .env.example .env
bun install
bun dev                 # http://localhost:3000
```

By default the panel targets `http://localhost:3080`. Override in `.env` if LibreChat runs elsewhere:

```bash
VITE_API_BASE_URL=http://localhost:3080
API_SERVER_URL=http://localhost:3080
```

Sign in with a LibreChat account that has admin privileges.

> **Development secrets:** When running `bun dev` / `npm run dev`, `SESSION_SECRET` is optional — a hardcoded dev fallback is used automatically. Production (`bun run start`) and Docker **require** a real `SESSION_SECRET` (min 32 characters).

## Scripts

| Command | Description |
| ------- | ----------- |
| `bun dev` | Start the Vite dev server on port 3000 |
| `bun run mock:backend` | Start the mock LibreChat API on port 3081 |
| `bun run build` | Production build |
| `bun run start` | Serve the production build (requires `SESSION_SECRET`) |
| `bun run test` | Run Vitest unit tests |
| `bun run test:e2e` | Run Playwright end-to-end tests |
| `bun run test:e2e:ui` | Playwright with interactive UI |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` | Prettier |

## Testing

### Unit tests

```bash
bun run test
```

Vitest tests live alongside source files (`*.test.ts`, `*.test.tsx`).

### End-to-end tests

Playwright spins up the dev server and mock backend automatically (see [`playwright.config.ts`](playwright.config.ts)).

Login/accessibility specs use the mock backend and need no credentials:

```bash
bun run test:e2e -- e2e/login.spec.ts
```

Specs that exercise authenticated pages against a **real** LibreChat backend require admin credentials:

```bash
E2E_ADMIN_EMAIL=you@example.com \
E2E_ADMIN_PASSWORD=your-password \
bun run test:e2e
```

## Project structure

```
src/
├── components/     # UI by feature (configuration, access, grants, users, shared)
├── hooks/          # React hooks (i18n, capabilities, etc.)
├── locales/        # i18n translation files
├── routes/         # TanStack Router file-based routes
├── server/         # Server functions (TanStack Start createServerFn)
├── test/           # Test fixtures and setup
├── types/          # Local TypeScript types
└── utils/          # Pure utility functions
```

See [`AGENTS.md`](AGENTS.md) for coding conventions, import rules, and architecture notes.

## Docker

```bash
cp .env.example .env
# Set SESSION_SECRET (min 32 chars)
# Set VITE_API_BASE_URL=http://host.docker.internal:3080

docker compose up -d    # builds and starts on http://localhost:3000
docker compose down     # stop
```

> **Note:** Inside Docker, `localhost` refers to the container, not your machine.
> Use `http://host.docker.internal:3080` for `VITE_API_BASE_URL` to reach
> LibreChat running on the host.

### Environment variables

| Variable                        | Required                            | Default                                                                          | Description                                                                                     |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PORT`                          | No                                  | `3000`                                                                           | Port the admin panel listens on                                                                 |
| `SESSION_SECRET`                | **Yes** (always required in Docker) | Dev fallback only when running `bun dev` locally; no default in the Docker image | Encryption key for sessions (min 32 chars)                                                      |
| `VITE_API_BASE_URL`             | **Yes** (Docker)                    | `http://localhost:3080` (local dev only)                                         | LibreChat API server URL; use `http://host.docker.internal:<port>` in Docker                    |
| `VITE_BASE_PATH`                | No                                  | `/`                                                                              | URL subpath to serve the panel under (e.g., `/adminpanel`). Must match at build time and runtime |
| `API_SERVER_URL`                | No                                  | Falls back to `VITE_API_BASE_URL`                                                | Server-side LibreChat API URL when the container reaches LibreChat differently than the browser |
| `ADMIN_SSO_ONLY`                | No                                  | `false`                                                                          | Hide email/password form, SSO only                                                              |
| `ADMIN_SSO_ENABLED`             | No                                  | `true`                                                                           | Set `false` to hide the SSO button (and auto-redirect) while keeping email/password login       |
| `ADMIN_SESSION_IDLE_TIMEOUT_MS` | No                                  | `1800000` (30 min)                                                               | Session idle timeout in ms                                                                      |
| `SESSION_COOKIE_SECURE`         | No                                  | `true` in production, `false` otherwise                                          | Set `false` only for plain-HTTP deployments so the browser keeps the admin session cookie       |
| `ADMIN_PANEL_METRICS_SECRET`      | No                                  | unset                                                                            | Bearer token required to scrape the `/metrics` (Prometheus) endpoint                            |

For OpenID SSO, the admin panel stores a short-lived PKCE verifier in the
`admin-session` cookie before redirecting to LibreChat. If the admin panel is
served over plain HTTP while running in production mode, browsers reject a
`Secure` session cookie and the callback cannot complete the PKCE exchange. In
that deployment shape, set `SESSION_COOKIE_SECURE=false` on the admin panel.
Set the same override on LibreChat itself when LibreChat is also reached over
plain HTTP, so its OAuth and auth cookies are not dropped either.

### Standalone Docker build

```bash
docker build -t librechat-admin-panel .
docker run -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e SESSION_SECRET=your-secret-here-at-least-32-characters \
  -e VITE_API_BASE_URL=http://host.docker.internal:3080 \
  -e SESSION_COOKIE_SECURE=false \
  librechat-admin-panel

# To serve under a subpath (e.g., /adminpanel):
docker build -t librechat-admin-panel --build-arg VITE_BASE_PATH=/adminpanel .
docker run -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e SESSION_SECRET=your-secret-here-at-least-32-characters \
  -e VITE_API_BASE_URL=http://host.docker.internal:3080 \
  -e VITE_BASE_PATH=/adminpanel \
  librechat-admin-panel
```
