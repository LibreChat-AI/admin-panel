import type * as t from '@/types';

const SERVER = 'mcpServers.{}';

/** Plain-language labels of server fields, where the schema key alone reads poorly. */
const LABELS: Readonly<Record<string, string>> = {
  type: 'com_config_mcp_label_type',
  url: 'com_config_mcp_label_url',
  startup: 'com_config_mcp_label_startup',
  chatMenu: 'com_config_mcp_label_chatMenu',
  iconPath: 'com_config_mcp_label_iconPath',
  timeout: 'com_config_mcp_label_timeout',
  initTimeout: 'com_config_mcp_label_initTimeout',
  sseReadTimeout: 'com_config_mcp_label_sseReadTimeout',
  requiresOAuth: 'com_config_mcp_label_requiresOAuth',
  requestHeaders: 'com_config_mcp_label_requestHeaders',
  proxy: 'com_config_mcp_label_proxy',
  oauth_headers: 'com_config_mcp_label_oauth_headers',
  customUserVars: 'com_config_mcp_label_customUserVars',
  'apiKey.key': 'com_config_mcp_label_apiKey_key',
  'apiKey.source': 'com_config_mcp_label_apiKey_source',
  'apiKey.authorization_type': 'com_config_mcp_label_apiKey_authorization_type',
  'apiKey.custom_header': 'com_config_mcp_label_apiKey_custom_header',
  'obo.scopes': 'com_config_mcp_label_obo_scopes',
};

const ENUM_LABELS: t.FieldMetaRegistry = {
  [`${SERVER}.type`]: {
    enumLabels: {
      'streamable-http': 'com_config_mcp_transport_streamable_http',
      http: 'com_config_mcp_transport_http',
      sse: 'com_config_mcp_transport_sse',
      websocket: 'com_config_mcp_transport_websocket',
      stdio: 'com_config_mcp_transport_stdio',
    },
  },
  [`${SERVER}.apiKey.source`]: {
    enumLabels: {
      admin: 'com_config_mcp_enum_source_admin',
      user: 'com_config_mcp_enum_source_user',
    },
  },
  [`${SERVER}.apiKey.authorization_type`]: {
    enumLabels: {
      bearer: 'com_config_mcp_enum_auth_bearer',
      basic: 'com_config_mcp_enum_auth_basic',
      custom: 'com_config_mcp_enum_auth_custom',
    },
  },
  [`${SERVER}.oauth.token_exchange_method`]: {
    enumLabels: {
      default_post: 'com_config_mcp_enum_exchange_post',
      basic_auth_header: 'com_config_mcp_enum_exchange_basic',
    },
  },
};

/** What LibreChat's MCP connection uses when a server sets no timeout (`connection.ts`). */
const RUNTIME_DEFAULTS: t.FieldMetaRegistry = {
  [`${SERVER}.timeout`]: { runtimeDefault: 60_000 },
  [`${SERVER}.initTimeout`]: { runtimeDefault: 30_000 },
};

const CONTROLS: t.FieldMetaRegistry = {
  [`${SERVER}.description`]: { multiline: true },
  [`${SERVER}.oauth.client_secret`]: { secret: true },
  [`${SERVER}.url`]: { width: 'L' },
  [`${SERVER}.proxy`]: { width: 'L' },
  [`${SERVER}.iconPath`]: { width: 'L' },
};

/** The create dialog's draft root, named in the tri-states it holds ("New server: Startup"). */
const DRAFT: t.FieldMetaRegistry = {
  mcpDraft: { labelKey: 'com_config_mcp_draft_label' },
};

/** Catalog recovery numbers whose label repeated the unit the input already shows. */
const CATALOG_NUMBERS = [
  'discoveryTimeoutMs',
  'discoverySettleGraceMs',
  'reauthRetryMs',
  'generationReadTimeoutMs',
  'authorizationFenceTimeoutMs',
  'authorizationFenceRetryIntervalMs',
];

/** MCP settings (MCP-13): an operational-tuning label and help for catalog recovery, plain labels for its knobs. */
function settingsMeta(): t.FieldMetaRegistry {
  const entries: t.FieldMetaRegistry = {
    'mcpSettings.allowedAddresses': { descriptionKey: 'com_config_mcp_settings_addresses_desc' },
    'mcpSettings.catalogRecovery': {
      labelKey: 'com_config_mcp_label_catalogRecovery',
      descriptionKey: 'com_config_desc_mcpSettings_catalogRecovery',
    },
  };
  for (const key of CATALOG_NUMBERS) {
    entries[`mcpSettings.catalogRecovery.${key}`] = {
      labelKey: `com_config_mcp_label_${key}`,
      unit: 'ms',
    };
  }
  return entries;
}

function labelMeta(): t.FieldMetaRegistry {
  return Object.fromEntries(
    Object.entries(LABELS).map(([key, labelKey]) => [`${SERVER}.${key}`, { labelKey }]),
  );
}

/**
 * MCP server and MCP settings metadata (WS12): plain labels, enum labels,
 * runtime defaults, multiline and secret inputs, and control widths. Merged
 * after the generic registry, so its entries win.
 */
export const MCP_FIELD_META: t.FieldMetaRegistry = [
  labelMeta(),
  ENUM_LABELS,
  RUNTIME_DEFAULTS,
  CONTROLS,
  DRAFT,
  settingsMeta(),
].reduce<t.FieldMetaRegistry>((merged, registry) => {
  for (const [pattern, meta] of Object.entries(registry)) {
    merged[pattern] = { ...merged[pattern], ...meta };
  }
  return merged;
}, {});
