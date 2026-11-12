import type * as t from '@/types';

const KNOWN_PROTOCOL = /^(https?|wss?):\/\//;
const ANY_PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//;
const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/;
const ENTRY_SEPARATOR = /[\s,;]+/;
/** A scheme with no host (`https://`, which `normalizeDomain` leaves as `https:`). */
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:\/*$/;

/** `https://Example.com/` → `https://example.com`: how an entry is stored and compared. */
export function normalizeDomain(entry: string): string {
  return entry.trim().toLowerCase().replace(/\/+$/, '');
}

function isValidHostname(hostname: string): boolean {
  if (IPV6_HOST.test(hostname)) return true;
  return hostname.split('.').every((label) => HOST_LABEL.test(label));
}

/**
 * Why LibreChat would not match anything with an allowlist entry, or null
 * when it is usable. Mirrors `parseDomainSpec` (packages/api/src/auth/domain.ts):
 * a host (`example.com`), optionally with a scheme (`https://example.com`), a
 * port (`:8443`) or a leading `*.` wildcard. Paths and other schemes are
 * rejected here rather than silently ignored.
 */
export function domainIssue(
  entry: string,
  protocols: readonly string[],
  existing: readonly string[] = [],
): t.DomainIssue | null {
  const normalized = normalizeDomain(entry);
  if (normalized === '' || /\s/.test(normalized) || SCHEME_ONLY.test(normalized)) return 'invalid';
  const scheme = KNOWN_PROTOCOL.exec(normalized)?.[1];
  if (!scheme && ANY_PROTOCOL.test(normalized)) return 'protocol';
  if (scheme && !protocols.includes(scheme)) return 'protocol';
  const withoutScheme = scheme ? normalized.slice(scheme.length + 3) : normalized;
  const wildcard = withoutScheme.startsWith('*.');
  const rest = wildcard ? withoutScheme.slice(2) : withoutScheme;
  if (rest.includes('*')) return 'wildcard';
  let url: URL;
  try {
    url = new URL(`https://${rest}`);
  } catch {
    return 'invalid';
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return 'path';
  if (url.username !== '' || url.password !== '') return 'invalid';
  if (!url.hostname || !isValidHostname(url.hostname)) return 'invalid';
  if (existing.some((item) => normalizeDomain(item) === normalized)) return 'duplicate';
  return null;
}

/** Entries typed or pasted together, split on commas, semicolons and whitespace. */
export function splitDomainEntries(text: string): string[] {
  return text.split(ENTRY_SEPARATOR).filter((entry) => entry !== '');
}
