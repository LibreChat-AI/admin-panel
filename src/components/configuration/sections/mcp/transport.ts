import type * as t from '@/types';
import { isConfigRecord, hasConfigValue } from '@/utils';
import { PROCESS_MCP_FIELDS } from '@/constants';

/** Transports in the order the type choice lists them: Streamable HTTP is the default and recommended. */
export const TRANSPORTS = ['streamable-http', 'sse', 'websocket', 'stdio'] as const;

/** Inspector-populated fields; admin overrides for these are silently ignored, so they are never shown. */
export const INSPECTOR_DERIVED: ReadonlySet<string> = new Set([
  'tools',
  'capabilities',
  'initDuration',
  'inspectionFailed',
  'updatedAt',
  'dbId',
  'source',
]);

/** A stdio server's process fields: only librechat.yaml can set them (D10). */
export const PROCESS_FIELDS: ReadonlySet<string> = new Set(PROCESS_MCP_FIELDS);

/** Fields only one kind of transport reads. */
const TRANSPORT_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  stdio: PROCESS_FIELDS,
  sse: new Set(['url', 'headers', 'requestHeaders', 'proxy', 'obo']),
  'streamable-http': new Set(['url', 'headers', 'requestHeaders', 'proxy', 'obo']),
  http: new Set(['url', 'headers', 'requestHeaders', 'proxy', 'obo']),
  websocket: new Set(['url']),
};

const TRANSPORT_KEYS: ReadonlySet<string> = new Set(
  Object.values(TRANSPORT_FIELDS).flatMap((keys) => [...keys]),
);

/** Authentication and its tuning: LibreChat uses them for SSE and Streamable HTTP connections only. */
const HTTP_AUTH_FIELDS: ReadonlySet<string> = new Set([
  'requiresOAuth',
  'apiKey',
  'oauth',
  'oauth_headers',
  'sseReadTimeout',
  'oauthRefreshWaitTimeout',
  'oauthRefreshCoordination',
  'oauthPersistenceWaitTimeout',
]);

const HTTP_TRANSPORTS: ReadonlySet<string> = new Set(['sse', 'streamable-http', 'http']);

/**
 * The transport an entry uses: its `type`, else what LibreChat's schema union
 * infers (a `command` is stdio, a `ws://` URL WebSocket, another URL SSE).
 */
export function transportOf(entry: t.ConfigValue): t.McpTransport {
  if (!isConfigRecord(entry)) return '';
  const { type, command, url } = entry;
  if (typeof type === 'string' && isTransport(type)) return type;
  if (typeof command === 'string' && command !== '') return 'stdio';
  if (typeof url !== 'string' || url === '') return '';
  return /^wss?:/i.test(url.trim()) ? 'websocket' : 'sse';
}

function isTransport(value: string): value is Exclude<t.McpTransport, ''> {
  return value === 'http' || (TRANSPORTS as readonly string[]).includes(value);
}

/** SSE or Streamable HTTP (`http` included): the transports with headers and authentication. */
export function isHttpTransport(transport: t.McpTransport): boolean {
  return HTTP_TRANSPORTS.has(transport);
}

/** Whether a server field applies to its transport, so it is shown, searched and kept on save. */
export function isMcpFieldShown(key: string, transport: string): boolean {
  if (INSPECTOR_DERIVED.has(key)) return false;
  if (TRANSPORT_KEYS.has(key)) return TRANSPORT_FIELDS[transport]?.has(key) ?? false;
  if (HTTP_AUTH_FIELDS.has(key)) return HTTP_TRANSPORTS.has(transport);
  return true;
}

/**
 * What switching an entry to `next` does (MCP-2): every field with a value
 * the new transport doesn't read goes, so nothing hidden is saved with it.
 * Keys the layer beneath sets can't be removed (D3), so they block the switch.
 */
export function planTransportSwitch(
  entry: t.ConfigRecord,
  next: t.McpTransport,
  lower: t.ConfigRecord | undefined,
): t.McpSwitchPlan {
  const prune = Object.keys(entry).filter(
    (key) => key !== 'type' && hasConfigValue(entry[key]) && !isMcpFieldShown(key, next),
  );
  const locked = prune.filter((key) => lower != null && hasConfigValue(lower[key]));
  return { prune, set: [['type', next]], locked };
}

/** Locale key of a transport's name ("Streamable HTTP", "stdio (local process)"). */
export function transportLabelKey(transport: t.McpTransport): string {
  if (transport === 'http') return 'com_config_mcp_transport_http';
  if (transport === '') return 'com_config_mcp_transport_unknown';
  return `com_config_mcp_transport_${transport.replace('-', '_')}`;
}
