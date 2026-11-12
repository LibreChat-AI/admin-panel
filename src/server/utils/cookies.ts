import type * as t from '@/types';

/**
 * h3's chunked cookies, which the admin session has used since it ran on
 * TanStack Start's `useSession`: a value longer than one cookie holds is split
 * into `<name>.1` … `<name>.N`, and `<name>` carries the `__chunked__N` marker.
 */
const CHUNK_MARKER = '__chunked__';
const CHUNK_MAX_LENGTH = 4000;
const MAX_CHUNKS = 100;

/** The chunk count a `__chunked__N` marker announces; `undefined` for a plain value or an invalid marker. */
function countChunks(marker: string | undefined): number | undefined {
  if (!marker?.startsWith(CHUNK_MARKER)) return undefined;
  const count = Number.parseInt(marker.slice(CHUNK_MARKER.length), 10);
  if (Number.isNaN(count) || count < 0 || count > MAX_CHUNKS) return undefined;
  return count;
}

const chunkName = (name: string, index: number): string => `${name}.${index}`;

/** Reads a cookie written whole or in chunks; `undefined` when it is absent or a chunk is missing. */
export function readChunkedCookie(
  name: string,
  read: (cookieName: string) => string | undefined,
): string | undefined {
  const main = read(name);
  if (!main?.startsWith(CHUNK_MARKER)) return main;
  const count = countChunks(main);
  if (!count) return undefined;
  let value = '';
  for (let i = 1; i <= count; i++) {
    const chunk = read(chunkName(name, i));
    if (!chunk) return undefined;
    value += chunk;
  }
  return value;
}

/**
 * The cookies that store `value` under `name`, given the `previous` value of
 * `name` the request carried: chunks the new value no longer fills are
 * expired first, then the value is written whole or as marker plus chunks.
 */
export function planChunkedCookie(
  name: string,
  value: string,
  previous: string | undefined,
): t.CookieWrite[] {
  const count = Math.ceil(value.length / CHUNK_MAX_LENGTH);
  const kept = count > 1 ? count : 0;
  const previousCount = countChunks(previous) ?? 0;
  const removals = Array.from(
    { length: Math.max(previousCount - kept, 0) },
    (_, i): t.CookieWrite => ({ name: chunkName(name, kept + i + 1), value: '', remove: true }),
  );
  if (count <= 1) return [...removals, { name, value, remove: false }];
  const chunks = Array.from({ length: count }, (_, i): t.CookieWrite => ({
    name: chunkName(name, i + 1),
    value: value.slice(i * CHUNK_MAX_LENGTH, (i + 1) * CHUNK_MAX_LENGTH),
    remove: false,
  }));
  return [...removals, { name, value: `${CHUNK_MARKER}${count}`, remove: false }, ...chunks];
}
