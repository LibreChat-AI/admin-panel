import type * as t from '@/types';

/** Endpoint choices grouped: built-in providers, then custom endpoints. */
export function endpointGroups(
  options: t.SpecOptions,
  localize: t.LocalizeFn,
): t.SpecOptionGroup[] {
  const builtIn = options.endpoints.filter((option) => !options.customEndpoints.has(option.value));
  const custom = options.endpoints.filter((option) => options.customEndpoints.has(option.value));
  return [
    { label: localize('com_config_specs_endpoints_builtin'), options: builtIn },
    { label: localize('com_config_specs_endpoints_custom'), options: custom },
  ];
}

/** One group of MCP server choices. */
export function mcpGroups(options: t.SpecOptions, localize: t.LocalizeFn): t.SpecOptionGroup[] {
  return [{ label: localize('com_config_specs_mcp_servers'), options: options.mcpServers }];
}
