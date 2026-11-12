import type * as t from '@/types';
import { isConfigRecord, hasConfigValue } from '@/utils';

/** Methods in the order the selector lists them. */
export const AUTH_METHODS: readonly t.McpAuthMethod[] = ['none', 'apiKey', 'oauth', 'obo'];

/** The entry keys each method writes; choosing another method removes them. */
const AUTH_METHOD_KEYS: Readonly<Record<t.McpAuthMethod, readonly string[]>> = {
  none: [],
  apiKey: ['apiKey'],
  oauth: ['oauth', 'oauth_headers', 'requiresOAuth'],
  obo: ['obo'],
};

/** An API key starts as one the admin enters for everyone, sent as a Bearer token (MCP-4). */
const API_KEY_DEFAULTS: t.ConfigRecord = { source: 'admin', authorization_type: 'bearer' };

/**
 * The method an entry uses: On-behalf-of, an API key or OAuth when their
 * settings are present (`requiresOAuth: true` alone is OAuth found by
 * discovery), else none. LibreChat still detects OAuth on a 401 when none is set.
 */
export function authMethodOf(entry: t.ConfigValue): t.McpAuthMethod {
  if (!isConfigRecord(entry)) return 'none';
  if (hasConfigValue(entry.obo)) return 'obo';
  if (hasConfigValue(entry.apiKey)) return 'apiKey';
  if (
    hasConfigValue(entry.oauth) ||
    hasConfigValue(entry.oauth_headers) ||
    entry.requiresOAuth === true
  ) {
    return 'oauth';
  }
  return 'none';
}

/**
 * Whether `record` holds a setting of a method: `requiresOAuth: false` only
 * turns OAuth discovery off, which every other method keeps.
 */
function holdsMethodKey(record: t.ConfigRecord | undefined, key: string): boolean {
  if (!record) return false;
  return key === 'requiresOAuth' ? record[key] === true : hasConfigValue(record[key]);
}

/**
 * What choosing `next` writes (MCP-4): the other methods' settings go, and
 * an API key starts with its defaults; `next`'s own settings the entry lacks
 * may come back as saved (`restore`). Settings the layer beneath defines
 * can't be removed (D3), so they block the switch.
 */
export function planAuthSwitch(
  entry: t.ConfigRecord,
  next: t.McpAuthMethod,
  lower: t.ConfigRecord | undefined,
): t.McpSwitchPlan {
  const prune = AUTH_METHODS.filter((method) => method !== next)
    .flatMap((method) => AUTH_METHOD_KEYS[method])
    .filter((key) => holdsMethodKey(entry, key));
  const locked = prune.filter((key) => holdsMethodKey(lower, key));
  const set: Array<[string, t.ConfigValue]> =
    next === 'apiKey' && !hasConfigValue(entry.apiKey) ? [['apiKey', { ...API_KEY_DEFAULTS }]] : [];
  const restore = AUTH_METHOD_KEYS[next].filter((key) => !holdsMethodKey(entry, key));
  return { prune, set, locked, restore };
}

/** Methods the layer beneath pins: when it sets a method's keys, only that method can be shown. */
export function lockedAuthMethod(lower: t.ConfigRecord | undefined): t.McpAuthMethod | null {
  if (!lower) return null;
  const method = authMethodOf(lower);
  return method === 'none' ? null : method;
}
