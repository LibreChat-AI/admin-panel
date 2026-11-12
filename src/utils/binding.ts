import { extractVariableName } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  isRelatedPath,
  isConfigRecord,
  getValueAtPath,
  asConfigRecord,
  removeValueAtPath,
  isConfigValueEqual,
} from './format';
import { isUserTemplate, isUserProvided, isEnvReference, toSecretPreviewKey } from './secrets';
import { getEntryKey, diffOverride, entriesByKey } from './collections';
import { AZURE_GROUPS_PATH } from '@/constants';

/** The secrets an MCP server stores, by the object that holds each (`apiKey.key`, `oauth.client_secret`). */
const MCP_SECRETS: readonly t.McpSecretKey[] = [
  { parent: 'apiKey', key: 'key', path: 'apiKey.key' },
  { parent: 'oauth', key: 'client_secret', path: 'oauth.client_secret' },
];

/** Each web search URL and the API key LibreChat sends to it. */
const WEB_SEARCH_URL_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['searxngInstanceUrl', 'searxngApiKey'],
  ['firecrawlApiUrl', 'firecrawlApiKey'],
  ['jinaApiUrl', 'jinaApiKey'],
  ['tavilySearchUrl', 'tavilyApiKey'],
  ['tavilyExtractUrl', 'tavilyApiKey'],
  ['keenableApiUrl', 'keenableApiKey'],
];

/** OCR's and each speech service's key, and the settings beside it that decide where it is sent. */
const SCALAR_SECRET_BINDINGS: readonly t.ScalarSecretBinding[] = [
  { path: 'ocr', secretKey: 'apiKey', bindingKeys: ['baseURL'] },
  { path: 'speech.tts.openai', secretKey: 'apiKey', bindingKeys: ['url'] },
  { path: 'speech.tts.azureOpenAI', secretKey: 'apiKey', bindingKeys: ['instanceName'] },
  { path: 'speech.tts.elevenlabs', secretKey: 'apiKey', bindingKeys: ['url', 'websocketUrl'] },
  { path: 'speech.tts.localai', secretKey: 'apiKey', bindingKeys: ['url'] },
  { path: 'speech.stt.openai', secretKey: 'apiKey', bindingKeys: ['url'] },
  { path: 'speech.stt.azureOpenAI', secretKey: 'apiKey', bindingKeys: ['instanceName'] },
];

/** OAuth binding fields an edit may leave out, read as unchanged then (LibreChat keeps them). */
const OMITTABLE_OAUTH_FIELDS = [
  'token_endpoint_auth_methods_supported',
  'revocation_endpoint',
  'revocation_endpoint_auth_methods_supported',
];

/**
 * Names of client options that choose where requests, and the key, go: a
 * custom endpoint's `addParams` reach its client (the native Anthropic client
 * sends to `anthropicApiUrl`). LibreChat's pattern errs strict.
 */
const DESTINATION_OPTION = /(?:url|endpoint|host|path|instancename|proxy|location|region)$/i;

/** Options named like a destination that only shape requests. */
const REQUEST_OPTIONS: ReadonlySet<string> = new Set(['firstPartyEndpoint']);

/** Client option groups a custom endpoint's `dropParams` can remove, destination included. */
const CLIENT_OPTION_GROUPS: ReadonlySet<string> = new Set(['clientOptions', 'configuration']);

/** Settings LibreChat leaves out of where a key a layer enters itself is sent: an MCP server's transport. */
const OWN_KEY_IGNORED_FIELDS: ReadonlySet<string> = new Set(['type']);

/** The settings of an MCP server that decide where it connects, which LibreChat sets back together. */
const SERVER_DESTINATION_KEYS = ['url', 'type', 'proxy'] as const;

/** A placeholder LibreChat fills with a credential of the user's: an OpenID or Graph token, or a custom variable. */
const USER_CREDENTIAL_PLACEHOLDER =
  /\{\{LIBRECHAT_(?:OPENID_(?:ACCESS_TOKEN|ID_TOKEN|TOKEN)|GRAPH_ACCESS_TOKEN)\}\}|\{\{(?!LIBRECHAT_)[^{}]+\}\}/;

const REENTRY_CODE = 'secret_reentry_required';
const CUSTOM_ENDPOINTS = 'endpoints.custom';

/** Where an Azure group sends its key: its own base URL, or its instance's Azure host. */
const AZURE_BINDING_KEYS = ['baseURL', 'instanceName'] as const;

function text(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A URL as LibreChat compares destinations: parsed and serialized, or as written when it isn't one. */
function normalizeUrl(value: t.ConfigValue, stripFragment = false): string | undefined {
  const raw = text(value);
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (stripFragment) url.hash = '';
    return url.href;
  } catch {
    return raw;
  }
}

function sortedList(value: t.ConfigValue): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return JSON.stringify([...new Set(value.map(String))].sort());
}

/** A destination option's value in the form two spellings of one destination share. */
function bindingText(value: t.ConfigValue): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return normalizeUrl(value, true);
  return JSON.stringify(value);
}

/** `user_provided` or a whole `{{VAR}}` template: a value each user enters for themselves. */
function isUserEntered(value: string): boolean {
  return isUserProvided(value) || isUserTemplate(value);
}

/** Where an MCP server's API key is sent: its URL, transport, proxy and the header it travels in. */
function apiKeyBinding(server: t.ConfigRecord): t.DestinationBinding {
  const apiKey = asConfigRecord(server.apiKey);
  const type = text(server.type);
  const custom = apiKey.authorization_type === 'custom';
  return {
    url: normalizeUrl(server.url, true),
    type: type === 'http' ? 'streamable-http' : type,
    proxy: normalizeUrl(server.proxy, true),
    'apiKey.authorization_type': text(apiKey.authorization_type),
    'apiKey.custom_header': custom
      ? (text(apiKey.custom_header) || 'X-Api-Key').toLowerCase()
      : undefined,
  };
}

/** Where an MCP server's OAuth client secret, and the token it obtains, is sent. */
function oauthBinding(server: t.ConfigRecord, oauth: t.ConfigRecord): t.DestinationBinding {
  return {
    url: normalizeUrl(server.url),
    proxy: normalizeUrl(server.proxy, true),
    'oauth.authorization_url': normalizeUrl(oauth.authorization_url),
    'oauth.token_url': normalizeUrl(oauth.token_url),
    'oauth.client_id': text(oauth.client_id),
    'oauth.token_exchange_method': text(oauth.token_exchange_method),
    'oauth.token_endpoint_auth_methods_supported': sortedList(
      oauth.token_endpoint_auth_methods_supported,
    ),
    'oauth.revocation_endpoint': normalizeUrl(oauth.revocation_endpoint),
    'oauth.revocation_endpoint_auth_methods_supported': sortedList(
      oauth.revocation_endpoint_auth_methods_supported,
    ),
  };
}

/** The settings of two bindings that differ. */
function changedFields(was: t.DestinationBinding, now: t.DestinationBinding): string[] {
  const fields = new Set([...Object.keys(was), ...Object.keys(now)]);
  return [...fields].filter((field) => was[field] !== now[field]);
}

/** The binding fields of `secret` that differ between where a server sent it and where it sends it now. */
function changedBinding(
  secret: t.McpSecretKey,
  before: t.ConfigRecord,
  after: t.ConfigRecord,
): string[] {
  if (secret.parent === 'apiKey') return changedFields(apiKeyBinding(before), apiKeyBinding(after));
  const wasOauth = before.oauth;
  const nowOauth = after.oauth;
  if (!isConfigRecord(wasOauth) || !isConfigRecord(nowOauth)) return [];
  const kept = OMITTABLE_OAUTH_FIELDS.filter(
    (field) => nowOauth[field] === undefined && wasOauth[field] !== undefined,
  );
  const oauth = { ...nowOauth, ...Object.fromEntries(kept.map((f) => [f, wasOauth[f]])) };
  return changedFields(oauthBinding(before, wasOauth), oauthBinding(after, oauth));
}

function isDestinationOption(key: string): boolean {
  return DESTINATION_OPTION.test(key) && !REQUEST_OPTIONS.has(key);
}

/** Each option named like a destination in `options`, at any depth (list items included), by its location. */
function collectDestinationOptions(
  options: t.ConfigValue,
  prefix: string,
  into: Record<string, string | undefined>,
): void {
  if (!Array.isArray(options) && !isConfigRecord(options)) return;
  for (const [key, value] of Object.entries(options)) {
    const location = `${prefix}.${key}`;
    if (isDestinationOption(key)) into[location] = bindingText(value);
    else collectDestinationOptions(value, location, into);
  }
}

/**
 * Where a custom endpoint sends its API key, as LibreChat binds it: its base
 * URL, its `provider` (the client that reads the rest), each option of
 * `addParams` named like a destination (`addParams.anthropicApiUrl`), and
 * each name in `dropParams` that removes one or the client options that hold
 * one (`dropParams.clientOptions`).
 */
function endpointBinding(entry: t.ConfigValue): t.DestinationBinding {
  const record = asConfigRecord(entry);
  const binding: Record<string, string | undefined> = {
    baseURL: normalizeUrl(record.baseURL, true),
    provider: text(record.provider),
  };
  collectDestinationOptions(record.addParams, 'addParams', binding);
  const dropped = Array.isArray(record.dropParams) ? record.dropParams : [];
  for (const name of dropped) {
    if (typeof name !== 'string') continue;
    if (isDestinationOption(name) || CLIENT_OPTION_GROUPS.has(name)) {
      binding[`dropParams.${name}`] = 'true';
    }
  }
  return binding;
}

/** A custom endpoint's binding fields that differ, as a write names them (`dropParams` whole). */
function changedEndpointFields(before: t.ConfigValue, after: t.ConfigValue): string[] {
  const changed = changedFields(endpointBinding(before), endpointBinding(after));
  return [
    ...new Set(changed.map((field) => (field.startsWith('dropParams.') ? 'dropParams' : field))),
  ];
}

/** An Azure group's destination setting as its client reads it: blank text is unset. */
function azureDestination(value: t.ConfigValue): string | undefined {
  const raw = text(value);
  return raw === undefined || raw.trim() === '' ? undefined : normalizeUrl(raw, true);
}

/**
 * The settings of an Azure group that decide where its key is sent
 * (`baseURL`, `instanceName`) and differ between two definitions of it.
 * LibreChat also compares deployment names a base URL takes its host from,
 * and destination options in `addParams`; it reports those itself.
 */
function changedAzureFields(before: t.ConfigValue, after: t.ConfigValue): string[] {
  const was = asConfigRecord(before);
  const now = asConfigRecord(after);
  return AZURE_BINDING_KEYS.filter(
    (key) => azureDestination(was[key]) !== azureDestination(now[key]),
  );
}

function groupsByName(root: t.ConfigValue): Map<string, t.ConfigValue> {
  return entriesByKey(getValueAtPath(root, AZURE_GROUPS_PATH), 'group');
}

/** `override` over `base` as the config merge layers them: objects merge, anything else replaces. */
function layer(base: t.ConfigValue, override: t.ConfigValue): t.ConfigValue {
  if (override === undefined) return base;
  if (!isConfigRecord(base) || !isConfigRecord(override)) return override;
  const merged: t.ConfigRecord = { ...base };
  for (const [key, value] of Object.entries(override)) merged[key] = layer(base[key], value);
  return merged;
}

function recordAt(root: t.ConfigValue, path: string): t.ConfigRecord {
  return asConfigRecord(getValueAtPath(root, path));
}

/** A secret the stored value keeps without holding it: only its masked preview is there. */
function keepsHidden(owner: t.ConfigValue, key: string): boolean {
  if (!isConfigRecord(owner)) return false;
  const preview = owner[toSecretPreviewKey(key)];
  const value = owner[key];
  return typeof preview === 'string' && preview !== '' && (value === undefined || value === '');
}

/** A credential a layer sets of its own: any value, or a stored secret's preview. */
function setsCredential(owner: t.ConfigValue, key: string): boolean {
  if (!isConfigRecord(owner)) return false;
  const value = owner[key];
  if (typeof value === 'string' && value.trim() !== '') return true;
  return keepsHidden(owner, key);
}

/**
 * A credential LibreChat binds to where it is sent: a value or a stored
 * secret's preview, but not one each user enters (`user_provided`, a whole
 * `{{VAR}}` template), which is never dropped.
 */
function holdsCredential(owner: t.ConfigValue, key: string): boolean {
  if (!isConfigRecord(owner)) return false;
  const value = owner[key];
  if (typeof value === 'string' && value.trim() !== '') return !isUserEntered(value);
  return keepsHidden(owner, key);
}

/** Whether a value sends a credential each user holds: a token or custom variable LibreChat fills in for them. */
function sendsUserCredential(value: t.ConfigValue): boolean {
  if (typeof value === 'string') return USER_CREDENTIAL_PLACEHOLDER.test(value);
  if (Array.isArray(value)) return value.some(sendsUserCredential);
  return isConfigRecord(value) && Object.values(value).some(sendsUserCredential);
}

function declaresUserVars(entry: t.ConfigRecord): boolean {
  return Object.keys(asConfigRecord(entry.customUserVars)).length > 0;
}

/**
 * Whether a custom endpoint sends what each user enters or holds (their own
 * key or URL, its `customUserVars`, a user token in its key or headers):
 * LibreChat then sets a move of it back rather than dropping its key.
 */
function endpointSendsUserValues(entry: t.ConfigRecord): boolean {
  const { apiKey, baseURL } = entry;
  return (
    (typeof apiKey === 'string' && isUserEntered(apiKey)) ||
    (typeof baseURL === 'string' && isUserProvided(baseURL)) ||
    declaresUserVars(entry) ||
    sendsUserCredential(apiKey) ||
    sendsUserCredential(entry.headers)
  );
}

/** Whether an MCP server sends what each user enters or holds (`customUserVars`, their own key, a user token). */
function serverSendsUserValues(server: t.ConfigRecord): boolean {
  const apiKey = asConfigRecord(server.apiKey);
  return (
    declaresUserVars(server) ||
    apiKey.source === 'user' ||
    sendsUserCredential(apiKey.key) ||
    sendsUserCredential(server.url) ||
    sendsUserCredential(server.headers)
  );
}

/**
 * The server LibreChat connects to when the layer beneath and the merged
 * server both send each user's own values: a move of its URL or proxy is set
 * back, with its transport.
 */
function connectedServer(below: t.ConfigRecord, merged: t.ConfigRecord): t.ConfigRecord {
  if (!serverSendsUserValues(below) || !serverSendsUserValues(merged)) return merged;
  const moved = ['url', 'proxy'].some(
    (key) => normalizeUrl(below[key], true) !== normalizeUrl(merged[key], true),
  );
  if (!moved) return merged;
  const restored: t.ConfigRecord = { ...merged };
  for (const key of SERVER_DESTINATION_KEYS) {
    if (below[key] === undefined) delete restored[key];
    else restored[key] = below[key];
  }
  return restored;
}

function reentryIssue(path: string, changed: string[]): t.ConfigIssue {
  return {
    path,
    code: REENTRY_CODE,
    message: 'must be entered again: LibreChat does not send a stored key to a new destination',
    params: { fieldPaths: changed.join('|') },
  };
}

/**
 * MCP servers whose stored secret the save keeps while changing where it is
 * sent (`recordSecrets`): LibreChat refuses that write until the secret is
 * entered again (`MCP_API_KEY_REENTRY_REQUIRED`). A renamed or copied server
 * is compared with the server it comes from.
 */
function mcpReentryIssues(input: t.CredentialBindingInput): t.ConfigIssue[] {
  const stored = recordAt(input.stored, 'mcpServers');
  const lower = recordAt(input.lower, 'mcpServers');
  return Object.entries(recordAt(input.storedAfter, 'mcpServers')).flatMap(([name, server]) => {
    const originName = input.origins.get(name) ?? name;
    const origin = stored[originName];
    if (!isConfigRecord(server) || !isConfigRecord(origin)) return [];
    const after = asConfigRecord(layer(lower[name], server));
    const before = asConfigRecord(layer(lower[originName], origin));
    return MCP_SECRETS.flatMap((secret) => {
      if (!keepsHidden(server[secret.parent], secret.key)) return [];
      const changed = changedBinding(secret, before, after);
      if (changed.length === 0) return [];
      return [
        reentryIssue(
          `mcpServers.${name}.${secret.path}`,
          changed.map((field) => `mcpServers.{}.${field}`),
        ),
      ];
    });
  });
}

/**
 * Web search keys the target stores while the save changes, blanks or
 * removes the URL they are sent to (`webSearchStoredKeys`): LibreChat
 * refuses that write until the key is entered again
 * (`CONFIG_SECRET_REENTRY_REQUIRED`).
 */
function webSearchReentryIssues(input: t.CredentialBindingInput): t.ConfigIssue[] {
  const before = recordAt(input.stored, 'webSearch');
  const after = recordAt(input.storedAfter, 'webSearch');
  const issues = new Map<string, string[]>();
  for (const [url, apiKey] of WEB_SEARCH_URL_KEYS) {
    if (!keepsHidden(after, apiKey)) continue;
    if (normalizeUrl(after[url]) === normalizeUrl(before[url])) continue;
    issues.set(apiKey, [...(issues.get(apiKey) ?? []), `webSearch.${url}`]);
  }
  return [...issues].map(([apiKey, urls]) => reentryIssue(`webSearch.${apiKey}`, urls));
}

/** A config's custom endpoints by name. */
function endpointsByName(root: t.ConfigValue): Map<string, t.ConfigValue> {
  return entriesByKey(getValueAtPath(root, CUSTOM_ENDPOINTS), 'name');
}

/**
 * Custom endpoints whose stored key the save keeps (the entry omits it)
 * while changing where it is sent: base URL, provider or a destination
 * option (`secretRebinding`). LibreChat refuses that write until the key is
 * entered again (`CONFIG_SECRET_REENTRY_REQUIRED`). Destinations are read
 * over the layer beneath, and a renamed endpoint is compared with the one it
 * comes from. Each issue names the entry, so it shows wherever it is listed.
 */
function endpointReentryIssues(input: t.CredentialBindingInput): t.ConfigIssue[] {
  const after = getValueAtPath(input.storedAfter, CUSTOM_ENDPOINTS);
  if (!Array.isArray(after)) return [];
  const stored = endpointsByName(input.stored);
  const lower = endpointsByName(input.lower);
  return after.flatMap((entry, index): t.ConfigIssue[] => {
    const name = getEntryKey(entry, 'name');
    if (name === undefined || !isConfigRecord(entry) || entry.apiKey !== undefined) return [];
    const originName = input.endpointOrigins.get(name) ?? name;
    const origin = stored.get(originName);
    if (!keepsHidden(origin, 'apiKey')) return [];
    const changed = changedEndpointFields(
      layer(lower.get(originName), origin),
      layer(lower.get(name), entry),
    );
    if (changed.length === 0) return [];
    const base = `${CUSTOM_ENDPOINTS}.${index}`;
    const issue = reentryIssue(
      `${base}.apiKey`,
      changed.map((field) => `${base}.${field}`),
    );
    return [{ ...issue, entryIdentity: name, entryPath: 'apiKey' }];
  });
}

/**
 * Azure groups whose stored key the save keeps (the group omits it) while
 * moving its instance or base URL (`secretRebinding`): LibreChat refuses
 * that write until the key is entered again, comparing each group over the
 * group of its name beneath.
 */
function azureReentryIssues(input: t.CredentialBindingInput): t.ConfigIssue[] {
  const after = getValueAtPath(input.storedAfter, AZURE_GROUPS_PATH);
  if (!Array.isArray(after)) return [];
  const stored = groupsByName(input.stored);
  const lower = groupsByName(input.lower);
  return after.flatMap((entry, index): t.ConfigIssue[] => {
    const name = getEntryKey(entry, 'group');
    if (name === undefined || !isConfigRecord(entry) || entry.apiKey !== undefined) return [];
    const origin = stored.get(name);
    if (!keepsHidden(origin, 'apiKey')) return [];
    const below = lower.get(name);
    const changed = changedAzureFields(layer(below, origin), layer(below, entry));
    if (changed.length === 0) return [];
    const base = `${AZURE_GROUPS_PATH}.${index}`;
    const issue = reentryIssue(
      `${base}.apiKey`,
      changed.map((field) => `${base}.${field}`),
    );
    return [{ ...issue, entryIdentity: name, entryPath: 'apiKey' }];
  });
}

/**
 * OCR and speech keys the target stores while the save changes the URL or
 * instance beside them (`secretRebinding`): LibreChat refuses that write
 * until the key is entered again (`CONFIG_SECRET_REENTRY_REQUIRED`).
 */
function scalarReentryIssues(input: t.CredentialBindingInput): t.ConfigIssue[] {
  return SCALAR_SECRET_BINDINGS.flatMap(({ path, secretKey, bindingKeys }) => {
    const after = recordAt(input.storedAfter, path);
    if (!keepsHidden(after, secretKey)) return [];
    const below = getValueAtPath(input.lower, path);
    const was = asConfigRecord(layer(below, recordAt(input.stored, path)));
    const now = asConfigRecord(layer(below, after));
    const changed = bindingKeys.filter(
      (key) => normalizeUrl(was[key], true) !== normalizeUrl(now[key], true),
    );
    if (changed.length === 0) return [];
    return [
      reentryIssue(
        `${path}.${secretKey}`,
        changed.map((key) => `${path}.${key}`),
      ),
    ];
  });
}

/**
 * Stored secrets a save keeps while changing where they are sent, which a
 * server that guards them refuses until they are entered again: MCP
 * servers' API keys and OAuth client secrets (`recordSecrets`), web search
 * keys (`webSearchStoredKeys`), and custom endpoint, OCR and speech keys
 * (`secretRebinding`). Each issue sits on the secret, naming the settings
 * that moved it (`fieldPaths`).
 */
export function findSecretReentryIssues(
  input: t.CredentialBindingInput,
  features: Pick<t.ConfigFeatures, 'recordSecrets' | 'webSearchStoredKeys' | 'secretRebinding'>,
): t.ConfigIssue[] {
  return [
    ...(features.recordSecrets ? mcpReentryIssues(input) : []),
    ...(features.webSearchStoredKeys ? webSearchReentryIssues(input) : []),
    ...(features.secretRebinding ? endpointReentryIssues(input) : []),
    ...(features.secretRebinding ? azureReentryIssues(input) : []),
    ...(features.secretRebinding ? scalarReentryIssues(input) : []),
  ];
}

/**
 * An MCP server as LibreChat stores it once a `renames` hint carries the
 * stored secrets of `source` to it: each secret the read hides that
 * `source` holds is copied, as its preview, into the server's holder
 * (`apiKey`, `oauth`) where the server writes one without that secret.
 */
export function withCarriedSecrets(server: t.ConfigValue, source: t.ConfigValue): t.ConfigValue {
  if (!isConfigRecord(server) || !isConfigRecord(source)) return server;
  return MCP_SECRETS.reduce<t.ConfigRecord>((result, { parent, key }) => {
    const holder = result[parent];
    const from = source[parent];
    if (!isConfigRecord(holder) || !isConfigRecord(from) || key in holder) return result;
    if (!keepsHidden(from, key)) return result;
    const previewKey = toSecretPreviewKey(key);
    return { ...result, [parent]: { ...holder, [previewKey]: from[previewKey] } };
  }, server);
}

/**
 * The secrets of MCP server `source` (as the target reads it) that a copy of
 * it uses without entering them: a duplicate the save doesn't carry them to
 * (no `renames` hint) is stored without them.
 */
export function findUncopiedSecrets(source: t.ConfigValue, copy: t.ConfigValue): string[] {
  return MCP_SECRETS.filter(({ parent, key }) => {
    const written = asConfigRecord(copy)[parent];
    if (!holdsCredential(asConfigRecord(source)[parent], key) || !isConfigRecord(written)) {
      return false;
    }
    return !(parent === 'apiKey' && written.source === 'user') && !setsCredential(written, key);
  }).map(({ path }) => path);
}

/** The key a credential is listed under (`PendingEdits.restates`): entry names may hold dots. */
export function credentialKey(ref: t.CredentialRef): string {
  return JSON.stringify([ref.path, ref.entry, ref.secret]);
}

/**
 * The credentials of an MCP server's own override that move what the layer
 * beneath holds (`below`) somewhere new without entering it: LibreChat drops
 * those at merge.
 */
function droppedMcpSecrets(
  name: string,
  below: t.ConfigValue,
  own: t.ConfigValue,
): t.DroppedCredential[] {
  if (!isConfigRecord(below) || !isConfigRecord(own)) return [];
  const sent = connectedServer(below, asConfigRecord(layer(below, own)));
  return MCP_SECRETS.flatMap((secret): t.DroppedCredential[] => {
    if (!holdsCredential(below[secret.parent], secret.key)) return [];
    if (setsCredential(own[secret.parent], secret.key)) return [];
    const moved = changedBinding(secret, below, sent);
    if (moved.length === 0) return [];
    return [{ path: 'mcpServers', entry: name, secret: secret.path, moved }];
  });
}

/**
 * The settings of a custom endpoint's own override that move the API key the
 * layer beneath holds somewhere new without entering it (`secretRebinding`):
 * LibreChat drops that key at merge. An endpoint that sends each user's own
 * values keeps its key: LibreChat sets the move back instead.
 */
export function findDroppedEndpointKey(below: t.ConfigValue, own: t.ConfigValue): string[] {
  if (!isConfigRecord(below) || !isConfigRecord(own)) return [];
  if (!holdsCredential(below, 'apiKey') || setsCredential(own, 'apiKey')) return [];
  const merged = asConfigRecord(layer(below, own));
  if (endpointSendsUserValues(below) && endpointSendsUserValues(merged)) return [];
  return changedEndpointFields(below, merged);
}

/**
 * Credentials the layer beneath holds that the target's own overrides stop
 * LibreChat from sending (`secretRebinding`): the target changes where an
 * inherited MCP server or custom endpoint sends its key without entering the
 * key itself, so the merge leaves the key out.
 */
export function findDroppedCredentials(
  own: t.ConfigRecord,
  lower: t.ConfigRecord,
): t.DroppedCredential[] {
  const below = recordAt(lower, 'mcpServers');
  const servers = Object.entries(recordAt(own, 'mcpServers')).flatMap(([name, server]) =>
    droppedMcpSecrets(name, below[name], server),
  );
  const lowerEndpoints = endpointsByName(lower);
  const endpoints = [...endpointsByName(own)].flatMap(([name, entry]): t.DroppedCredential[] => {
    const moved = findDroppedEndpointKey(lowerEndpoints.get(name), entry);
    if (moved.length === 0) return [];
    return [{ path: CUSTOM_ENDPOINTS, entry: name, secret: 'apiKey', moved }];
  });
  return [...servers, ...endpoints];
}

/** The Azure groups whose inherited key the target's overrides (`own`) drop, by name, with the settings that moved it. */
function droppedGroupKeys(own: t.ConfigRecord, lower: t.ConfigRecord): Map<string, string[]> {
  const below = groupsByName(lower);
  return new Map(
    [...groupsByName(own)].flatMap(([name, entry]): Array<[string, string[]]> => {
      const moved = findDroppedGroupKey(below.get(name), entry);
      return moved.length > 0 ? [[name, moved]] : [];
    }),
  );
}

/**
 * Azure groups whose inherited key a save stops LibreChat from sending: the
 * target moves the group's instance or base URL without entering a key
 * (`secretRebinding`). Each is a key to enter, since no save restates one.
 */
function groupRebindingWarnings(input: t.CredentialBindingInput): t.ConfigWarning[] {
  const before = droppedGroupKeys(input.stored, input.lower);
  return [...droppedGroupKeys(input.storedAfter, input.lower)]
    .filter(([name]) => !before.has(name))
    .map(([name, moved]) => ({
      path: AZURE_GROUPS_PATH,
      entryIdentity: name,
      warning: 'secretRebindingEnter',
      keys: moved,
    }));
}

/**
 * The settings by which an Azure group moves the key the group of its name
 * beneath holds (`below`) without entering one (`secretRebinding`):
 * LibreChat drops that key at merge.
 */
export function findDroppedGroupKey(below: t.ConfigValue, own: t.ConfigValue): string[] {
  if (!isConfigRecord(below) || !isConfigRecord(own)) return [];
  if (!holdsCredential(below, 'apiKey') || setsCredential(own, 'apiKey')) return [];
  return changedAzureFields(below, layer(below, own));
}

/**
 * An inherited credential the target can restate: a whole `${VAR}`
 * reference, which names the key without holding it. Anything else is never
 * copied into an override, whatever a server reads back for it: a literal
 * (a librechat.yaml key a server shows as is, without `yamlSecretPreview`),
 * a reference within other text, the fixed mask, a value each user enters.
 * Only entering a key sends one to the new destination then.
 */
function restatableValue(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' && isEnvReference(value) ? value : undefined;
}

/** The credential the layer beneath holds for `ref`, when the target can restate it. */
export function restatableCredential(
  lower: t.ConfigRecord,
  ref: t.CredentialRef,
): string | undefined {
  const entry =
    ref.path === CUSTOM_ENDPOINTS
      ? endpointsByName(lower).get(ref.entry)
      : recordAt(lower, 'mcpServers')[ref.entry];
  return restatableValue(getValueAtPath(entry, ref.secret));
}

/**
 * The inherited key of a custom endpoint the layer beneath defines (`lower`)
 * that the edited endpoint (`value`) moves without entering one
 * (`secretRebinding`), as the editor shows it. A key the target's own stored
 * override (`own`) already restates counts as entered while the edit leaves
 * it as it was, as Save keeps it.
 */
export function findMovedEndpointKey(
  lower: t.ConfigValue,
  value: t.ConfigRecord,
  own: t.ConfigValue,
  restates: Readonly<Record<string, t.CredentialRef>>,
): t.MovedCredential | undefined {
  const name = getEntryKey(lower, 'name');
  if (name === undefined) return undefined;
  const override = asConfigRecord(diffOverride(lower, value).value);
  const saved = asConfigRecord(own).apiKey;
  const keeps = typeof saved === 'string' && value.apiKey === saved;
  const moved = findDroppedEndpointKey(lower, keeps ? { ...override, apiKey: saved } : override);
  if (moved.length === 0) return undefined;
  const ref: t.CredentialRef = { path: CUSTOM_ENDPOINTS, entry: name, secret: 'apiKey' };
  return {
    ...ref,
    moved,
    restatable: restatableValue(asConfigRecord(lower).apiKey),
    restated: Object.hasOwn(restates, credentialKey(ref)),
  };
}

/**
 * The inherited MCP server credentials the target's own overrides
 * (`own`, pending edits applied) move without entering them
 * (`secretRebinding`), as each server's editor shows them: by server, then
 * by where the credential is in it (`apiKey.key`).
 */
export function findMovedServerCredentials(
  own: t.ConfigRecord,
  lower: t.ConfigRecord,
  restates: Readonly<Record<string, t.CredentialRef>>,
): Map<string, Map<string, t.MovedCredential>> {
  const byServer = new Map<string, Map<string, t.MovedCredential>>();
  const below = { mcpServers: lower };
  for (const dropped of findDroppedCredentials({ mcpServers: own }, below)) {
    const credentials = byServer.get(dropped.entry) ?? new Map<string, t.MovedCredential>();
    credentials.set(dropped.secret, {
      ...dropped,
      restatable: restatableCredential(below, dropped),
      restated: Object.hasOwn(restates, credentialKey(dropped)),
    });
    byServer.set(dropped.entry, credentials);
  }
  return byServer;
}

/** Whether a plan warning reports that the save restates `ref` (`secretRestated`). */
export function isRestateWarning(warning: t.ConfigWarning, ref: t.CredentialRef): boolean {
  if (warning.warning !== 'secretRestated') return false;
  if (warning.entryIdentity === undefined) {
    return warning.path === `${ref.path}.${ref.entry}.${ref.secret}`;
  }
  return warning.path === ref.path && warning.entryIdentity === ref.entry;
}

/**
 * Where the review shows a credential a save drops: the MCP setting that
 * moved it, or the endpoint's. One the target can't restate (a hidden key)
 * reads as one to enter (`secretRebindingEnter`).
 */
function rebindingWarning(dropped: t.DroppedCredential, lower: t.ConfigRecord): t.ConfigWarning {
  const warning =
    restatableCredential(lower, dropped) === undefined ? 'secretRebindingEnter' : 'secretRebinding';
  if (dropped.path === CUSTOM_ENDPOINTS) {
    return { path: CUSTOM_ENDPOINTS, entryIdentity: dropped.entry, warning, keys: dropped.moved };
  }
  return { path: `mcpServers.${dropped.entry}.${dropped.moved[0]}`, warning };
}

function isHidden(hidden: readonly string[], path: string): boolean {
  return hidden.some((tombstone) => path === tombstone || path.startsWith(`${tombstone}.`));
}

/** The layer beneath without what the target hides of it. */
function withoutHidden(lower: t.ConfigRecord, hidden: readonly string[]): t.ConfigRecord {
  return hidden.reduce((result, path) => removeValueAtPath(result, path), lower);
}

/**
 * OCR and speech keys the layer beneath holds that the target's override
 * moves (a URL or instance beside the key it sets or hides) without entering
 * one of its own: LibreChat's merge drops such a key (`secretRebinding`). A
 * key each user enters is never dropped.
 */
function droppedScalarKeys(
  own: t.ConfigRecord,
  lower: t.ConfigRecord,
  hidden: readonly string[],
): t.DroppedSettingKey[] {
  const floor = withoutHidden(lower, hidden);
  return SCALAR_SECRET_BINDINGS.flatMap(({ path, secretKey, bindingKeys }) => {
    const below = recordAt(lower, path);
    const mine = recordAt(own, path);
    if (!holdsCredential(below, secretKey) || setsCredential(mine, secretKey)) return [];
    const merged = asConfigRecord(layer(getValueAtPath(floor, path), mine));
    if (!holdsCredential(merged, secretKey)) return [];
    const moved = bindingKeys.filter(
      (key) => normalizeUrl(below[key], true) !== normalizeUrl(merged[key], true),
    );
    if (moved.length === 0) return [];
    return [{ secret: `${path}.${secretKey}`, moved: moved.map((key) => `${path}.${key}`) }];
  });
}

/**
 * A web search key LibreChat keeps from a URL another layer decides: one
 * stored in config (a literal, or a key stored encrypted), not a `${VAR}`
 * reference, which web search's runtime binds itself, nor one each user
 * enters.
 */
function storesWebSearchKey(owner: t.ConfigRecord, key: string): boolean {
  const value = owner[key];
  if (typeof value !== 'string') return keepsHidden(owner, key);
  const trimmed = value.trim();
  return trimmed !== '' && !isUserProvided(trimmed) && extractVariableName(trimmed) == null;
}

/**
 * Web search keys the layer beneath stores that the target's override
 * unbinds: it sets or hides the URL a key is sent to without setting the key
 * itself, whatever the new URL, so LibreChat withholds the key
 * (`unbindWebSearchKeys`, `webSearchStoredKeys`).
 */
function droppedWebSearchKeys(
  own: t.ConfigRecord,
  lower: t.ConfigRecord,
  hidden: readonly string[],
): t.DroppedSettingKey[] {
  const below = recordAt(lower, 'webSearch');
  const mine = recordAt(own, 'webSearch');
  const decides = (key: string) => mine[key] !== undefined || isHidden(hidden, `webSearch.${key}`);
  const moved = new Map<string, string[]>();
  for (const [url, apiKey] of WEB_SEARCH_URL_KEYS) {
    if (!storesWebSearchKey(below, apiKey) || decides(apiKey) || keepsHidden(mine, apiKey)) {
      continue;
    }
    if (decides(url)) moved.set(apiKey, [...(moved.get(apiKey) ?? []), `webSearch.${url}`]);
  }
  return [...moved].map(([apiKey, urls]) => ({ secret: `webSearch.${apiKey}`, moved: urls }));
}

/** The OCR, speech and web search keys the layer beneath holds that the target's override drops, by the server's flags. */
function droppedSettingKeys(
  own: t.ConfigRecord,
  lower: t.ConfigRecord,
  hidden: readonly string[],
  features: Pick<t.ConfigFeatures, 'secretRebinding' | 'webSearchStoredKeys'>,
): t.DroppedSettingKey[] {
  return [
    ...(features.secretRebinding ? droppedScalarKeys(own, lower, hidden) : []),
    ...(features.webSearchStoredKeys ? droppedWebSearchKeys(own, lower, hidden) : []),
  ];
}

/**
 * Credentials the layer beneath holds that a save stops LibreChat from
 * sending: an MCP server's or custom endpoint's (`secretRebinding`, see
 * `findDroppedCredentials`), OCR's and speech's (`secretRebinding`), and web
 * search's (`webSearchStoredKeys`), each on the setting that moved it. Only
 * those the save itself drops, not ones the stored overrides already did.
 */
export function findRebindingWarnings(
  input: t.CredentialBindingInput,
  features: Pick<t.ConfigFeatures, 'secretRebinding' | 'webSearchStoredKeys'>,
): t.ConfigWarning[] {
  const { before: hiddenBefore = [], after: hiddenAfter = [] } = input.hidden ?? {};
  const keptBefore = new Set(
    droppedSettingKeys(input.stored, input.lower, hiddenBefore, features).map(
      ({ secret }) => secret,
    ),
  );
  const settings = droppedSettingKeys(input.storedAfter, input.lower, hiddenAfter, features)
    .filter(({ secret }) => !keptBefore.has(secret))
    .flatMap(({ moved }) =>
      moved.map((path): t.ConfigWarning => ({ path, warning: 'secretRebindingEnter' })),
    );
  if (!features.secretRebinding) return settings;
  const before = new Set(findDroppedCredentials(input.stored, input.lower).map(credentialKey));
  const records = findDroppedCredentials(input.storedAfter, input.lower)
    .filter((dropped) => !before.has(credentialKey(dropped)))
    .map((dropped) => rebindingWarning(dropped, input.lower));
  return [...records, ...groupRebindingWarnings(input), ...settings];
}

/**
 * Where a change of an MCP server or custom endpoint in Base moves the keys a
 * profile may store there of its own, by each such secret (`apiKey.key`,
 * `oauth.client_secret`; an endpoint's `apiKey`): the settings deciding where
 * it is sent that differ between the entry as Base sends it `before` and
 * `after` (over librechat.yaml's entry, `lower`). LibreChat binds such a key
 * to where the entry sent it when it was entered, ignoring the transport,
 * and sets a move back where the entry sends each user's own values.
 */
export function entryKeyMoves(
  collection: string,
  { lower, before, after }: t.EntryKeyMoveInput,
): Record<string, string[]> {
  if (!isConfigRecord(before) || !isConfigRecord(after)) return {};
  const below = asConfigRecord(lower);
  if (collection === CUSTOM_ENDPOINTS) {
    if (endpointSendsUserValues(below) && endpointSendsUserValues(after)) return {};
    const moved = changedEndpointFields(before, after);
    return moved.length > 0 ? { apiKey: moved } : {};
  }
  if (collection !== 'mcpServers') return {};
  const was = connectedServer(below, before);
  const now = connectedServer(below, after);
  return Object.fromEntries(
    MCP_SECRETS.flatMap((secret) => {
      const moved = changedBinding(secret, was, now).filter(
        (field) => !OWN_KEY_IGNORED_FIELDS.has(field),
      );
      return moved.length > 0 ? [[secret.path, moved]] : [];
    }),
  );
}

/**
 * The profiles among `overrides` whose own key for an entry LibreChat stops
 * sending once Base moves where the entry sends it (`moves`, from
 * `entryKeyMoves`; `secretRebinding`): a key a profile stores there that a
 * moved setting it doesn't set itself sends somewhere else.
 */
export function findUnboundOverrides(
  moves: Readonly<Record<string, string[]>>,
  overrides: readonly t.EntryOverride[],
): t.EntryOverride[] {
  return overrides.filter(({ secrets, settings }) =>
    secrets.some((secret) =>
      (moves[secret] ?? []).some(
        (field) => !settings.some((setting) => isRelatedPath(setting, field)),
      ),
    ),
  );
}

/** The entries of one collection a change keeps under their names while moving where their keys go. */
function collectionKeyMoves(
  collection: string,
  lower: ReadonlyMap<string, t.ConfigValue>,
  before: ReadonlyMap<string, t.ConfigValue>,
  after: ReadonlyMap<string, t.ConfigValue>,
): t.EntryKeyMove[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].flatMap((identity): t.EntryKeyMove[] => {
    const was = before.get(identity);
    const now = after.get(identity);
    if (isConfigValueEqual(was, now)) return [];
    const below = lower.get(identity);
    const moves = entryKeyMoves(collection, {
      lower: below,
      before: layer(below, was),
      after: layer(below, now),
    });
    return Object.keys(moves).length > 0 ? [{ collection, identity, moves }] : [];
  });
}

function serversByName(root: t.ConfigValue): Map<string, t.ConfigValue> {
  return new Map(Object.entries(recordAt(root, 'mcpServers')));
}

/**
 * The MCP servers and custom endpoints a save in Base (`stored` →
 * `storedAfter`, over librechat.yaml's `lower`) keeps under their names
 * while moving where the keys profiles store there of their own are sent
 * (`entryKeyMoves`). With `secretRebinding`, LibreChat drops those keys.
 */
export function findEntryKeyMoves(
  input: Pick<t.CredentialBindingInput, 'lower' | 'stored' | 'storedAfter'>,
  features: Pick<t.ConfigFeatures, 'secretRebinding'>,
): t.EntryKeyMove[] {
  if (!features.secretRebinding) return [];
  const { lower, stored, storedAfter } = input;
  return [
    ...collectionKeyMoves(
      'mcpServers',
      serversByName(lower),
      serversByName(stored),
      serversByName(storedAfter),
    ),
    ...collectionKeyMoves(
      CUSTOM_ENDPOINTS,
      endpointsByName(lower),
      endpointsByName(stored),
      endpointsByName(storedAfter),
    ),
  ];
}
