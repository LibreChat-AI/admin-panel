import type * as t from '@/types';
import { filledText, isConfigRecord, isEnvReference } from '@/utils';
import { SECRET_PREVIEW_MASK } from '@/constants';

function stringRecord(value: t.ConfigValue): Record<string, string> | undefined {
  if (!isConfigRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** The settings of a group the table and drawer place themselves; the rest are listed as they are. */
const GROUP_KEYS: ReadonlySet<string> = new Set([
  'group',
  'apiKey',
  'apiKeyPreview',
  'instanceName',
  'baseURL',
  'deploymentName',
  'version',
  'serverless',
  'assistants',
  'models',
  'additionalHeaders',
  'addParams',
  'dropParams',
]);
const MODEL_KEYS: ReadonlySet<string> = new Set(['deploymentName', 'version']);

/** The entries of `record` outside `placed`, blank text left out (LibreChat's unset). */
function othersOf(record: t.ConfigRecord, placed: ReadonlySet<string>): t.ConfigRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !placed.has(key) && value !== ''),
  );
}

/** A group's models: `name: true` (deployed under its own name) or per-model overrides. */
function toModels(value: t.ConfigValue): t.AzureGroupModel[] {
  if (!isConfigRecord(value)) return [];
  return Object.entries(value).map(([name, config]) => {
    if (!isConfigRecord(config)) return { name, others: {} };
    return {
      name,
      deploymentName: filledText(config.deploymentName),
      version: filledText(config.version),
      others: othersOf(config, MODEL_KEYS),
    };
  });
}

/**
 * The Azure OpenAI groups as the read-only table shows them (AP-1, D13),
 * from the normalized `endpoints.azureOpenAI.groups`. LibreChat fills unset
 * values with `''` and `false`; blank text reads as unset.
 */
export function toAzureGroups(value: t.ConfigValue): t.AzureGroupRow[] {
  if (!Array.isArray(value)) return [];
  const rows: t.AzureGroupRow[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isConfigRecord(entry) || typeof entry.group !== 'string') continue;
    rows.push({
      index,
      group: entry.group,
      apiKey: filledText(entry.apiKey),
      apiKeyPreview: filledText(entry.apiKeyPreview),
      instanceName: filledText(entry.instanceName),
      baseURL: filledText(entry.baseURL),
      deploymentName: filledText(entry.deploymentName),
      version: filledText(entry.version),
      serverless: entry.serverless === true,
      assistants: entry.assistants === true,
      models: toModels(entry.models),
      additionalHeaders: stringRecord(entry.additionalHeaders),
      addParams: isConfigRecord(entry.addParams) ? entry.addParams : undefined,
      dropParams: Array.isArray(entry.dropParams)
        ? entry.dropParams.filter((param): param is string => typeof param === 'string')
        : undefined,
      others: othersOf(entry, GROUP_KEYS),
    });
  }
  return rows;
}

const ENV_NAME = /^\$\{([A-Za-z0-9_]+)\}$/;

/**
 * How a credential is shown: an environment reference (`${EASTUS_API_KEY}`)
 * by its variable name, any literal value hidden. A key the server reads
 * back only as its preview (`azureGroupSecrets`) is set: a stored one shows
 * its preview, and the fixed mask (a librechat.yaml literal) reads as hidden.
 */
export function maskCredential(value: string | undefined, preview?: string): t.MaskedCredential {
  if (!value) {
    if (!preview) return { kind: 'none' };
    return preview === SECRET_PREVIEW_MASK ? { kind: 'masked' } : { kind: 'stored', preview };
  }
  const match = isEnvReference(value) ? ENV_NAME.exec(value) : null;
  if (match) return { kind: 'env', name: match[1] };
  return { kind: 'masked' };
}
