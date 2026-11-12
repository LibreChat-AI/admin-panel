import { useContext, useMemo } from 'react';
import { normalizeEndpointName } from 'librechat-data-provider';
import type * as t from '@/types';
import { stringItems, isConfigRecord, getValueAtPath } from '@/utils';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { BUILT_IN_ENDPOINTS, specEndpoint } from './validation';
import { useLocalize, useOptionSources } from '@/hooks';
import { labelForPath } from '../../meta';

/** Options with duplicate values dropped (the first label wins). */
export function uniqueOptions(options: t.SelectOption[]): t.SelectOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

/** An endpoint's name as the spec editor shows it ("Anthropic" for `anthropic`), else the name itself. */
export function endpointLabelOf(options: t.SpecOptions, name: string): string {
  return options.endpoints.find((option) => option.value === name)?.label ?? name;
}

/** Custom endpoints by the name LibreChat serves them under (`Ollama` as `ollama`). */
function customEndpointsOf(root: t.ConfigValue): Map<string, t.ConfigRecord> {
  const custom = getValueAtPath(root, 'endpoints.custom');
  const byName = new Map<string, t.ConfigRecord>();
  for (const entry of Array.isArray(custom) ? custom : []) {
    if (isConfigRecord(entry) && typeof entry.name === 'string' && entry.name.trim() !== '') {
      const served = normalizeEndpointName(entry.name);
      if (!byName.has(served)) byName.set(served, entry);
    }
  }
  return byName;
}

/**
 * Endpoint choices for a spec: the built-in endpoints by their provider
 * label, then what `useOptionSources('endpoints')` adds (the custom
 * endpoints the configuration defines, and any other endpoint LibreChat serves).
 */
function endpointOptions(
  localize: t.LocalizeFn,
  fromSource: readonly t.SelectOption[],
): t.SelectOption[] {
  return uniqueOptions([
    ...BUILT_IN_ENDPOINTS.map((name) => ({
      value: name,
      label: labelForPath(`endpoints.${name}`, localize),
    })),
    ...fromSource,
  ]);
}

/** Models to suggest for an endpoint: a custom endpoint's model list, then models other specs use with it. */
function modelSuggestions(
  endpoint: string,
  custom: t.ConfigRecord | undefined,
  items: t.ConfigValue[],
): t.SelectOption[] {
  const listed = isConfigRecord(custom?.models)
    ? stringItems(custom.models.default).filter((item) => item.trim() !== '')
    : [];
  const used = items.flatMap((spec) => {
    if (!isConfigRecord(spec) || specEndpoint(spec) !== endpoint) return [];
    const preset = isConfigRecord(spec.preset) ? spec.preset : {};
    return typeof preset.model === 'string' && preset.model.trim() !== '' ? [preset.model] : [];
  });
  return uniqueOptions([...listed, ...used].map((model) => ({ value: model, label: model })));
}

/** Group names the specs use, then endpoint names (a group named after an endpoint nests under it). */
function groupOptions(items: t.ConfigValue[], endpoints: t.SelectOption[]): t.SelectOption[] {
  const groups = items.flatMap((spec) =>
    isConfigRecord(spec) && typeof spec.group === 'string' && spec.group.trim() !== ''
      ? [{ value: spec.group, label: spec.group }]
      : [],
  );
  return uniqueOptions([...groups, ...endpoints]);
}

/**
 * Everything the spec editor offers to pick from: endpoints and MCP servers
 * from `useOptionSources` (the configuration shown on the page, pending edits
 * included, plus what LibreChat serves), and model and group suggestions from
 * the specs themselves.
 */
export function useSpecOptions(items: t.ConfigValue[]): t.SpecOptions {
  const localize = useLocalize();
  const root = useContext(ConfigValuesContext)?.configValues ?? null;
  const { options: endpointSource } = useOptionSources('endpoints');
  const { options: mcpServers } = useOptionSources('mcpServers');
  const customEndpoints = useMemo(() => customEndpointsOf(root), [root]);
  const endpoints = useMemo(
    () => endpointOptions(localize, endpointSource),
    [localize, endpointSource],
  );

  return useMemo(
    () => ({
      endpoints,
      knownEndpoints: new Set(endpoints.map((option) => option.value)),
      customEndpoints: new Set(customEndpoints.keys()),
      mcpServers,
      groups: groupOptions(items, endpoints),
      modelsFor: (endpoint: string) =>
        modelSuggestions(endpoint, customEndpoints.get(normalizeEndpointName(endpoint)), items),
      customEndpoint: (name: string) => customEndpoints.get(normalizeEndpointName(name)),
    }),
    [endpoints, customEndpoints, mcpServers, items],
  );
}
