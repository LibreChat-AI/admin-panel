import type * as t from '@/types';

/** The locale key that words each reason a resolution gives for what it leaves out of a document. */
export const PREVIEW_IGNORE_REASON_KEYS: Readonly<Record<t.PreviewIgnoreReason, string>> = {
  unknown_section: 'com_config_preview_ignored_unknown_section',
  invalid_override: 'com_config_preview_ignored_invalid_override',
  base_only_section: 'com_config_preview_ignored_base_only_section',
  base_principal_section: 'com_config_preview_ignored_base_principal_section',
  base_only_path: 'com_config_preview_ignored_base_only_path',
  process_mcp_server: 'com_config_preview_ignored_process_mcp_server',
  interface_permission: 'com_config_preview_ignored_interface_permission',
  runtime_stop: 'com_config_preview_ignored_runtime_stop',
  azure_groups_unresolved: 'com_config_preview_ignored_azure_groups_unresolved',
  endpoint_rederive_off: 'com_config_preview_ignored_endpoint_rederive_off',
  azure_unserved: 'com_config_preview_ignored_azure_unserved',
  secret_rebinding: 'com_config_preview_ignored_secret_rebinding',
  destination_restored: 'com_config_preview_ignored_destination_restored',
  env_reference_not_allowed: 'com_config_preview_ignored_env_reference_not_allowed',
  invalid_theme: 'com_config_preview_ignored_invalid_theme',
  tenant_hidden: 'com_config_preview_ignored_tenant_hidden',
  unknown: 'com_config_preview_ignored_unknown',
};

/**
 * The locale key of a reason worded otherwise for a hidden value (a
 * tombstone): a hide inside an Azure group that leaves it unable to resolve
 * drops that group alone.
 */
export const PREVIEW_HIDDEN_IGNORE_REASON_KEYS: Readonly<
  Partial<Record<t.PreviewIgnoreReason, string>>
> = {
  azure_groups_unresolved: 'com_config_preview_ignored_azure_groups_unresolved_hidden',
};

/** The locale key that explains each reason the scope catalog gives for an endpoint it does not serve. */
export const CATALOG_ENDPOINT_REASON_KEYS: Readonly<Record<t.CatalogEndpointReason, string>> = {
  not_listed: 'com_config_providers_reason_not_listed',
  missing_credentials: 'com_config_providers_reason_missing_credentials',
  missing_api_key: 'com_config_providers_reason_missing_api_key',
  missing_base_url: 'com_config_providers_reason_missing_base_url',
  missing_models: 'com_config_providers_reason_missing_models',
  unknown: 'com_config_providers_status_disabled_desc',
};

/** The query key roots of the server-resolved reads: a scope's catalog, the env status and a principal's preview. */
export const CONFIG_CATALOG_QUERY_KEY = 'configCatalog';
export const ENV_STATUS_QUERY_KEY = 'envStatus';
export const CONFIG_PREVIEW_QUERY_KEY = 'configPreview';

/**
 * Query keys of the server-resolved reads that saves, and changes to
 * profiles or memberships, make stale: the scope catalogs, env status and
 * previews.
 */
export const RESOLVED_READ_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  [CONFIG_CATALOG_QUERY_KEY],
  [ENV_STATUS_QUERY_KEY],
  [CONFIG_PREVIEW_QUERY_KEY],
];
