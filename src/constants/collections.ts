import { EModelEndpoint, normalizeEndpointName } from 'librechat-data-provider';
import type * as t from '@/types';
import { editsAzureGroups } from './config';

/** Names LibreChat keeps for its built-in endpoints (`openAI`, `anthropic`, …): no custom endpoint can take one. */
export const RESERVED_ENDPOINT_NAMES: ReadonlySet<string> = new Set<string>(
  Object.values(EModelEndpoint),
);

/** Where the Azure OpenAI groups are configured. */
export const AZURE_GROUPS_PATH = 'endpoints.azureOpenAI.groups';

/**
 * Array settings whose entries have an identity. Edits to them are saved as
 * per-entry operations keyed by that identity, never by array position, so
 * an entry added or removed elsewhere meanwhile cannot shift an edit onto a
 * different entry. `byKey` mirrors LibreChat's `ARRAY_MERGE_KEYS`; a list
 * with a `gate` is edited entry by entry only on a server it lets.
 */
export const KEYED_COLLECTIONS: ReadonlyMap<string, t.KeyedCollection> = new Map(
  (
    [
      {
        path: 'endpoints.custom',
        key: 'name',
        merge: 'byKey',
        secret: { key: 'apiKey', preview: 'apiKeyPreview' },
        servedName: normalizeEndpointName,
        reservedNames: RESERVED_ENDPOINT_NAMES,
      },
      { path: 'modelSpecs.list', key: 'name', merge: 'replace' },
      {
        path: AZURE_GROUPS_PATH,
        key: 'group',
        merge: 'byKey',
        secret: { key: 'apiKey', preview: 'apiKeyPreview' },
        gate: editsAzureGroups,
      },
    ] satisfies t.KeyedCollection[]
  ).map((collection): [string, t.KeyedCollection] => [collection.path, collection]),
);

/**
 * Records of named entries that each hold a credential beside the destination
 * it is sent to, where LibreChat drops a credential whose destination changed
 * (`secretRebinding`): the record it reports an entry in → the one the panel
 * edits it in (Azure groups are reported in the `groupMap` that `groups`
 * resolves to). Elsewhere a credential is bound to the object holding it
 * (`ocr.apiKey` to `ocr.baseURL`).
 */
export const CREDENTIAL_ENTRY_RECORDS: ReadonlyMap<string, string> = new Map([
  ['endpoints.custom', 'endpoints.custom'],
  ['mcpServers', 'mcpServers'],
  ['endpoints.azureOpenAI.groupMap', 'endpoints.azureOpenAI.groups'],
]);
