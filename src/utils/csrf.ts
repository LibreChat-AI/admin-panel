import type { CsrfMiddlewareOptions } from '@tanstack/react-start';

function toOrigin(value: string): string | undefined {
  try {
    const { origin } = new URL(value);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** The origins of a comma-separated list of URLs, skipping blank and unparseable entries. */
export function parseOrigins(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return raw.split(',').reduce((origins, entry) => {
    const origin = toOrigin(entry.trim());
    if (origin) origins.add(origin);
    return origins;
  }, new Set<string>());
}

/** The non-blank entries of a comma-separated list that name no origin (a host without its scheme, say). */
export function invalidOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && toOrigin(entry) === undefined);
}

/**
 * TanStack Start's default CSRF check on server functions, also accepting the
 * `trusted` origins. Without `Sec-Fetch-Site` (plain HTTP off localhost) the
 * check compares `Origin`/`Referer` with the URL the server saw, which differs
 * from the browser's when a proxy rewrites `Host` or drops its port.
 */
export function csrfOptions(trusted: ReadonlySet<string>): CsrfMiddlewareOptions {
  return {
    filter: (ctx) => ctx.handlerType === 'serverFn',
    origin: (origin, ctx) => trusted.has(origin) || origin === new URL(ctx.request.url).origin,
  };
}
