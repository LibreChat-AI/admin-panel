import type * as t from '@/types';
import {
  ENV_DEFAULT_PATHS,
  ENV_ALLOWED_SOURCES,
  ENV_LITERAL_TEXT_PATHS,
  AZURE_URL_TEMPLATE_NAMES,
  AZURE_URL_TEMPLATE_PATHS,
  ENV_LITERAL_TEXT_SECTIONS,
} from '@/constants';

/** `${NAME}`, as LibreChat resolves env references anywhere in a string (`extractEnvVariable`). */
const ENV_REFERENCE = /\$\{([^}]+)\}/g;

function bucketKey(first: string, last: string): string {
  return `${first}\u0000${last}`;
}

/** `ENV_LITERAL_TEXT_PATHS` by first and last segment, so a lookup compares only a few. */
const LITERAL_PATHS_BY_BUCKET = ENV_LITERAL_TEXT_PATHS.reduce((buckets, pattern) => {
  const key = bucketKey(pattern[0], pattern[pattern.length - 1]);
  buckets.set(key, [...(buckets.get(key) ?? []), pattern]);
  return buckets;
}, new Map<string, ReadonlyArray<readonly string[]>>());

/** Whether `segments` is the place `pattern` names, where `*` is any one segment. */
function matchesPath(segments: readonly string[], pattern: readonly string[]): boolean {
  return (
    segments.length === pattern.length &&
    pattern.every((segment, index) => segment === '*' || segment === segments[index])
  );
}

/**
 * Whether no reader env-expands the string at `segments` (librechat.yaml
 * keys, list items by index), as LibreChat's `isLiteralTextPath` judges it:
 * anything in interface copy or model specs, and exactly the prompt and
 * instruction fields of `ENV_LITERAL_TEXT_PATHS`.
 */
export function isLiteralTextPath(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  if (ENV_LITERAL_TEXT_SECTIONS.has(segments[0])) return true;
  const patterns = LITERAL_PATHS_BY_BUCKET.get(
    bucketKey(segments[0], segments[segments.length - 1]),
  );
  return patterns?.some((pattern) => matchesPath(segments, pattern)) ?? false;
}

/** Whether `name` at `segments` is an Azure base URL template the Azure client fills, not an env reference. */
function isAzureURLTemplate(name: string, segments: readonly string[]): boolean {
  return (
    AZURE_URL_TEMPLATE_NAMES.has(name) &&
    AZURE_URL_TEMPLATE_PATHS.some((pattern) => matchesPath(segments, pattern))
  );
}

function collectAt(value: t.ConfigValue, segments: string[], into: t.EnvReferenceSites): void {
  if (typeof value === 'string') {
    if (!value.includes('${') || isLiteralTextPath(segments)) return;
    const site = segments.join('.');
    for (const match of value.matchAll(ENV_REFERENCE)) {
      const name = match[1].trim();
      if (isAzureURLTemplate(name, segments)) continue;
      const sites = into.get(name);
      if (sites) sites.push(site);
      else into.set(name, [site]);
    }
    return;
  }
  if (segments.length > 0 && ENV_LITERAL_TEXT_SECTIONS.has(segments[0])) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAt(item, [...segments, String(index)], into));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) collectAt(child, [...segments, key], into);
}

/**
 * Each env name a value references with `${NAME}`, in order of first use,
 * with the dot-paths of the strings that reference it; strings inside
 * objects and lists count. `path` is where `value` is, so what LibreChat
 * does not expand there is skipped as it skips it: literal text
 * (`isLiteralTextPath`) and Azure base URL templates. `into` collects across calls.
 */
export function collectEnvReferences(
  value: t.ConfigValue,
  path = '',
  into: t.EnvReferenceSites = new Map(),
): t.EnvReferenceSites {
  collectAt(value, path === '' ? [] : path.split('.'), into);
  return into;
}

/**
 * Whether a server that applies its override allowlist (`envAllowlist`)
 * resolves an override's `${name}` at each of `sites`, as LibreChat's env
 * reference policy decides: a name librechat.yaml references, a built-in
 * endpoint reads or the operator allowlists resolves anywhere; one only
 * loading librechat.yaml fills in (`default`) only where it fills it in
 * (`ENV_DEFAULT_PATHS`); one only stored profiles use resolves to nothing. A
 * site that is not known (`''`), or a status without sources, says nothing
 * either way.
 */
function allowedInOverrides(
  name: string,
  { sources }: t.EnvVarStatus,
  sites: readonly string[],
): boolean {
  if (sources.length === 0) return true;
  if (sources.some((source) => ENV_ALLOWED_SOURCES.has(source))) return true;
  if (!sources.includes('default')) return false;
  const filled = ENV_DEFAULT_PATHS.get(name);
  return sites.every((site) => site === '' || site === filled);
}

/**
 * How a referenced env name reads on the server, by what `GET /env-status`
 * reports of it and, where the server applies its override allowlist
 * (`policed`), whether an override may reference it at `sites`.
 */
export function envReferenceState(
  name: string,
  status: t.EnvVarStatus | undefined,
  sites: readonly string[] = [],
  policed = false,
): t.EnvReferenceState {
  if (!status) return 'unreported';
  if (policed && !allowedInOverrides(name, status, sites)) return 'notAllowed';
  if (status.userProvided) return 'userProvided';
  return status.set ? 'set' : 'unset';
}

/** Each referenced name with how it reads on the server (see `envReferenceState`). */
export function readEnvReferences(
  references: t.EnvReferenceSites,
  status: t.EnvStatusMap,
  policed: boolean,
): t.EnvReference[] {
  return Array.from(references, ([name, sites]) => ({
    name,
    state: envReferenceState(name, status[name], sites, policed),
  }));
}
