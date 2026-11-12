import { z } from 'zod';
import { defaults, seal, unseal } from 'iron-webcrypto';
import { createServerOnlyFn } from '@tanstack/react-start';
import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { planChunkedCookie, readChunkedCookie } from './utils/cookies';

const DEV_SECRET = 'dev-only-session-secret-minimum-32-chars!';

const MIN_SESSION_SECRET_LENGTH = 32;
const REVALIDATION_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const SESSION_COOKIE_NAME = 'admin-session';
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

/**
 * Iron's defaults with `JSON.stringify`, exactly as h3 sealed sessions. The
 * seal carries no TTL: the cookie's sliding `Max-Age` is what expires it.
 */
const SEAL_OPTIONS = { ...defaults, encode: JSON.stringify };

const sessionRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  data: z.custom<t.SessionData>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  ),
});

/** One session per request, shared by every reader and writer within it. */
const requestSessions = new WeakMap<Request, Promise<t.SessionRecord>>();

function resolveSessionSecret(): string {
  const sessionSecret =
    process.env.SESSION_SECRET || (process.env.NODE_ENV === 'development' ? DEV_SECRET : undefined);

  if (!sessionSecret) {
    throw new Error(
      'SESSION_SECRET environment variable must be set for admin session encryption.',
    );
  }

  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters for admin session encryption.`,
    );
  }

  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'development') {
    console.warn(
      '[session] Using hardcoded DEV_SECRET — set SESSION_SECRET for production-like environments',
    );
  }

  return sessionSecret;
}

function resolveCookieOptions(): t.SessionCookieOptions {
  const secure =
    process.env.SESSION_COOKIE_SECURE !== undefined
      ? process.env.SESSION_COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production';

  return {
    path: process.env.VITE_BASE_PATH || '/',
    secure,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  };
}

async function readSession(password: string): Promise<t.SessionRecord | undefined> {
  const sealed = readChunkedCookie(SESSION_COOKIE_NAME, getCookie);
  if (!sealed) return undefined;
  try {
    const parsed = sessionRecordSchema.safeParse(await unseal(sealed, password, SEAL_OPTIONS));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeSession(record: t.SessionRecord, settings: t.SessionSettings): Promise<void> {
  const sealed = await seal(record, settings.password, SEAL_OPTIONS);
  const writes = planChunkedCookie(SESSION_COOKIE_NAME, sealed, getCookie(SESSION_COOKIE_NAME));
  for (const write of writes) {
    if (write.remove) {
      deleteCookie(write.name, settings.cookie);
      continue;
    }
    setCookie(write.name, write.value, settings.cookie);
  }
}

/** The request's sealed session, or a new one whose cookie is issued right away. */
async function loadSession(settings: t.SessionSettings): Promise<t.SessionRecord> {
  const existing = await readSession(settings.password);
  if (existing) return existing;
  const record: t.SessionRecord = { id: crypto.randomUUID(), createdAt: Date.now(), data: {} };
  await writeSession(record, settings);
  return record;
}

/**
 * `createServerOnlyFn`: this module is reachable from client-bundled routes
 * transitively (e.g. via server/utils/refresh.ts -> server/session.ts, even
 * though every real caller is server-only), so the bundler can't otherwise
 * prove these are safe to keep out of the client build. Every env-dependent
 * computation (including anything that can throw) has to live inside these
 * wrapped closures rather than at module scope — module-level code still
 * runs whenever the module is merely imported into the client bundle, even
 * though the wrapped function bodies themselves get stubbed out.
 */
export const getSessionConfig = createServerOnlyFn(() => {
  const envIdleTimeout = Number(process.env.ADMIN_SESSION_IDLE_TIMEOUT_MS);
  const idleTimeout =
    Number.isFinite(envIdleTimeout) && envIdleTimeout > 0
      ? envIdleTimeout
      : DEFAULT_IDLE_TIMEOUT_MS;

  return {
    revalidationInterval: REVALIDATION_INTERVAL_MS,
    idleTimeout,
  } as const;
});

/**
 * The admin session, kept in the same `admin-session` cookie TanStack Start's
 * former `useSession` wrote: an iron seal of `{ id, createdAt, data }` with
 * `SESSION_SECRET`, chunked like h3 when long, reissued with a 7-day `Max-Age`
 * on every update. Cookies issued before the switch keep working, and so do
 * the ones issued after it on a rollback.
 */
export const useAppSession = createServerOnlyFn(async (): Promise<t.SessionManager> => {
  const settings: t.SessionSettings = {
    password: resolveSessionSecret(),
    cookie: resolveCookieOptions(),
  };
  const request = getRequest();
  const pending = requestSessions.get(request) ?? loadSession(settings);
  requestSessions.set(request, pending);
  const record = await pending;

  return {
    get data() {
      return record.data;
    },
    update: async (update) => {
      Object.assign(record.data, update);
      await writeSession(record, settings);
    },
  };
});
