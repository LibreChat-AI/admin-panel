import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { findRemovedSecrets, findStoredSecrets } from './removals';
import { planConfigChanges } from './changes';

const batch: t.ConfigFeatures = {
  ...BUNDLED_CONFIG_FEATURES,
  changesBatch: true,
  expectedRevision: true,
  recordSecrets: true,
};
const patchOnly: t.ConfigFeatures = { ...BUNDLED_CONFIG_FEATURES, recordSecrets: true };

/** What Base stores: an MCP server and a custom endpoint with encrypted keys, and a web search key. */
const stored: t.ConfigRecord = {
  mcpServers: {
    vault: {
      type: 'streamable-http',
      url: 'https://mcp.vault.dev/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
    },
  },
  endpoints: {
    custom: [
      {
        name: 'Acme',
        baseURL: 'https://api.acme.dev/v1',
        models: { default: ['a'] },
        apiKeyPreview: '...7890',
      },
    ],
  },
  webSearch: { tavilyApiKeyPreview: '...5555' },
};
const snapshot: t.WriteSnapshot = { stored, tombstones: [], lower: {}, lowerKind: 'yaml' };

const removedBy = (ops: t.ConfigChange[], features: t.ConfigFeatures = batch) =>
  findRemovedSecrets(stored, planConfigChanges(ops, snapshot, features));

describe('findStoredSecrets', () => {
  it('lists each stored secret by its previewed location, an entry key by the entry name', () => {
    expect(findStoredSecrets(stored)).toEqual([
      { path: 'mcpServers.vault.apiKey.key' },
      { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Acme' } },
      { path: 'webSearch.tavilyApiKey' },
    ]);
  });

  it('finds no secret where only an empty preview or a value of another name is stored', () => {
    expect(
      findStoredSecrets({
        mcpServers: { a: { apiKey: { keyPreview: '' }, title: 'keyPreview' } },
        webSearch: { jinaApiKey: '${JINA_API_KEY}' },
      }),
    ).toEqual([]);
  });
});

describe('findRemovedSecrets', () => {
  it('finds nothing removed by an edit beside the secrets', () => {
    expect(removedBy([{ op: 'set', path: 'mcpServers.vault.title', value: 'Vault' }])).toEqual([]);
  });

  it('finds the key of a deleted server, a removed holder and a removed scalar key', () => {
    expect(removedBy([{ op: 'reset', path: 'mcpServers.vault' }])).toEqual([
      { path: 'mcpServers.vault.apiKey.key' },
    ]);
    expect(removedBy([{ op: 'reset', path: 'mcpServers.vault.apiKey' }])).toEqual([
      { path: 'mcpServers.vault.apiKey.key' },
    ]);
    expect(removedBy([{ op: 'reset', path: 'webSearch.tavilyApiKey' }])).toEqual([
      { path: 'webSearch.tavilyApiKey' },
    ]);
  });

  it('keeps a key whose holder the save writes again without it, as LibreChat does', () => {
    const ops: t.ConfigChange[] = [
      { op: 'reset', path: 'mcpServers.vault.apiKey' },
      { op: 'set', path: 'mcpServers.vault.apiKey.source', value: 'admin' },
    ];
    expect(removedBy(ops)).toEqual([]);
  });

  it('keeps a key a rename moves (a batch rename or a PATCH hint)', () => {
    const ops: t.ConfigChange[] = [
      { op: 'set', path: 'mcpServers.vault-kb.type', value: 'streamable-http' },
      { op: 'set', path: 'mcpServers.vault-kb.url', value: 'https://mcp.vault.dev/mcp' },
      { op: 'set', path: 'mcpServers.vault-kb.apiKey.source', value: 'admin' },
      { op: 'reset', path: 'mcpServers.vault' },
      { op: 'carry', path: 'mcpServers', from: 'vault', to: 'vault-kb' },
    ];
    expect(removedBy(ops, batch)).toEqual([]);
    expect(removedBy(ops, patchOnly)).toEqual([]);
    expect(removedBy(ops.slice(0, 4), batch)).toEqual([{ path: 'mcpServers.vault.apiKey.key' }]);
  });

  it("keeps a list entry's key while the entry stays, and finds it when the entry goes", () => {
    const acme = (stored.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
    const edited = { ...acme[0], baseURL: 'https://api.acme.dev/v2' };
    expect(
      removedBy([
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Acme',
          identity: 'Acme',
          value: edited,
          baseline: acme[0],
        },
      ]),
    ).toEqual([]);
    expect(
      removedBy([{ op: 'removeEntry', path: 'endpoints.custom', key: 'Acme', identity: 'Acme' }]),
    ).toEqual([{ path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Acme' } }]);
  });
});
