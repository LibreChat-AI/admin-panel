import { describe, expect, it } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { collectImportEntries, planImport } from './import';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { extractSchemaTree } from '@/server/config';
import { collectFieldPaths } from './counts';

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const paths = new Set(collectFieldPaths(tree));
/** A LibreChat server that keeps dotted record keys (`dottedKeys`). */
const DOTTED: t.ConfigFeatures = { ...BUNDLED_CONFIG_FEATURES, dottedKeys: true };

describe('planImport', () => {
  it('writes exactly the snippet leaves and says why the others are left out', () => {
    const plan = planImport(
      {
        version: '1.3.3',
        balance: { startBalance: 777 },
        interface: { prompts: false, customWelcome: 'Hi' },
        filters: { messages: { pii: { action: 'mask' } } },
        brandNew: { flag: true },
      },
      tree,
      paths,
    );
    expect(plan.entries).toEqual([
      { fieldPath: 'balance.startBalance', value: 777 },
      { fieldPath: 'interface.customWelcome', value: 'Hi' },
      { fieldPath: 'brandNew.flag', value: true },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'interface.prompts', reason: 'permission' },
      { fieldPath: 'filters.messages.pii.action', reason: 'baseOnly' },
    ]);
    expect([...plan.unknown]).toEqual(['brandNew.flag']);
  });

  it('leaves out sections a profile cannot set when importing into one', () => {
    const config = {
      registration: { allowedDomains: ['evil.com'] },
      interface: { presets: false },
    };
    expect(planImport(config, tree, paths).entries).toHaveLength(2);
    const plan = planImport(config, tree, paths, true);
    expect(plan.entries).toEqual([{ fieldPath: 'interface.presets', value: false }]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'registration.allowedDomains', reason: 'baseScope' },
    ]);
  });

  it('does not block on dotted keys inside sections that are skipped anyway', () => {
    const plan = planImport(
      {
        balance: { startBalance: 5 },
        endpoints: {
          azureOpenAI: {
            groups: [{ group: 'eastus', apiKey: 'k', models: { 'gpt-4.1': true } }],
          },
          bedrock: { inferenceProfiles: { 'us.anthropic.claude': 'arn:x', plain: 'arn:y' } },
        },
      },
      tree,
      paths,
    );
    expect(plan.entries).toEqual([
      { fieldPath: 'balance.startBalance', value: 5 },
      { fieldPath: 'endpoints.bedrock.inferenceProfiles.plain', value: 'arn:y' },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'endpoints.azureOpenAI.groups', reason: 'yamlOnly' },
      {
        fieldPath: 'endpoints.bedrock.inferenceProfiles',
        reason: 'unsafeKey',
        key: 'us.anthropic.claude',
      },
    ]);
  });

  it('leaves out process-backed MCP servers once, and imports remote ones', () => {
    const plan = planImport(
      {
        mcpServers: {
          local: { command: 'npx', args: ['-y', 'server'], env: { 'A.B': '1' } },
          remote: { type: 'streamable-http', url: 'https://mcp.example' },
        },
      },
      tree,
      paths,
    );
    expect(plan.entries.map((e) => e.fieldPath)).toEqual([
      'mcpServers.remote.type',
      'mcpServers.remote.url',
    ]);
    expect(plan.skipped).toEqual([{ fieldPath: 'mcpServers.local', reason: 'processMcp' }]);
  });

  it('maps AppService aliases instead of reporting them unknown', () => {
    const plan = planImport({ interfaceConfig: { customWelcome: 'hi' } }, tree, paths);
    expect(plan.entries).toEqual([{ fieldPath: 'interface.customWelcome', value: 'hi' }]);
    expect(plan.unknown.size).toBe(0);
  });
});

describe('collectImportEntries', () => {
  it('never splits a dotted key into a nested path', () => {
    const { entries, skipped } = collectImportEntries(
      { endpoints: { bedrock: { inferenceProfiles: { 'us.a.b': 'arn' } } } },
      tree,
      paths,
    );
    expect(entries).toEqual([]);
    expect(skipped).toEqual([
      { fieldPath: 'endpoints.bedrock.inferenceProfiles', reason: 'unsafeKey', key: 'us.a.b' },
    ]);
  });
});

describe('planImport on a server that keeps dotted keys', () => {
  it('writes a record holding a dotted key whole, at its own path', () => {
    const profiles = { 'us.anthropic.claude': 'arn:x', plain: 'arn:y' };
    const plan = planImport(
      { balance: { startBalance: 5 }, endpoints: { bedrock: { inferenceProfiles: profiles } } },
      tree,
      paths,
      false,
      DOTTED,
    );
    expect(plan.entries).toEqual([
      { fieldPath: 'balance.startBalance', value: 5 },
      { fieldPath: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('leaves out a dotted key where a setting name belongs', () => {
    const plan = planImport(
      { 'webSearch.serperApiKey': 'x', balance: { 'start.Balance': 5, refillAmount: 1 } },
      tree,
      paths,
      false,
      DOTTED,
    );
    expect(plan.entries).toEqual([{ fieldPath: 'balance.refillAmount', value: 1 }]);
    expect(plan.skipped).toEqual([
      { fieldPath: '', reason: 'dottedKey', key: 'webSearch.serperApiKey' },
      { fieldPath: 'balance', reason: 'dottedKey', key: 'start.Balance' },
    ]);
  });

  it('leaves a $ key out of a record written whole and imports the rest', () => {
    const plan = planImport(
      {
        endpoints: {
          bedrock: { inferenceProfiles: { 'us.a.b': 'arn', $where: 'x', plain: 'arn:y' } },
        },
      },
      tree,
      paths,
      false,
      DOTTED,
    );
    expect(plan.entries).toEqual([
      {
        fieldPath: 'endpoints.bedrock.inferenceProfiles',
        value: { 'us.a.b': 'arn', plain: 'arn:y' },
      },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'endpoints.bedrock.inferenceProfiles', reason: 'reservedKey', key: '$where' },
    ]);
  });

  it('leaves the reserved keys out of MCP headers written whole, each with its reason', () => {
    const headers = JSON.parse(
      '{"x.api.version": "1", "$where": "bad", "__proto__": "p", "prototype": "q"}',
    ) as t.ConfigRecord;
    const plan = planImport({ mcpServers: { github: { headers } } }, tree, paths, false, DOTTED);
    expect(plan.entries).toEqual([
      { fieldPath: 'mcpServers.github.headers', value: { 'x.api.version': '1' } },
    ]);
    expect(Object.getPrototypeOf(plan.entries[0].value)).toBe(Object.prototype);
    expect(plan.skipped).toEqual(
      ['$where', '__proto__', 'prototype'].map((key) => ({
        fieldPath: 'mcpServers.github.headers',
        reason: 'reservedKey',
        key,
      })),
    );
  });

  it('reports a prototype name where a setting name belongs, as reserved', () => {
    const balance = JSON.parse('{"constructor": 1, "refillAmount": 2}') as t.ConfigRecord;
    const plan = planImport({ balance }, tree, paths, false, DOTTED);
    expect(plan.entries).toEqual([{ fieldPath: 'balance.refillAmount', value: 2 }]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'balance', reason: 'reservedKey', key: 'constructor' },
    ]);
  });

  it('keeps skipping a dotted key inside a section the panel never writes', () => {
    const plan = planImport(
      {
        endpoints: {
          azureOpenAI: { groups: [{ group: 'eastus', models: { 'gpt-4.1': true } }] },
        },
      },
      tree,
      paths,
      false,
      DOTTED,
    );
    expect(plan.skipped).toEqual([
      { fieldPath: 'endpoints.azureOpenAI.groups', reason: 'yamlOnly' },
    ]);
  });

  /** A YAML with a dotted MCP server name next to an override of another server. */
  const mcpImport: t.ConfigRecord = {
    mcpServers: {
      'my.server': { type: 'streamable-http', url: 'https://example.com/mcp' },
      cloudflare: { serverInstructions: 'Use carefully', headers: { 'x-team.id': 'a' } },
    },
  };

  it('imports MCP servers field by field and leaves a dotted server name out', () => {
    const plan = planImport(mcpImport, tree, paths, false, DOTTED);
    expect(plan.entries).toEqual([
      { fieldPath: 'mcpServers.cloudflare.serverInstructions', value: 'Use carefully' },
      { fieldPath: 'mcpServers.cloudflare.headers', value: { 'x-team.id': 'a' } },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'mcpServers', reason: 'dottedName', key: 'my.server' },
    ]);
  });

  it('leaves out a dotted name in any record of setting groups, by schema or by value', () => {
    const plan = planImport(
      {
        fileConfig: { endpoints: { 'my.endpoint': { fileLimit: 2 }, openAI: { fileLimit: 3 } } },
        mcpServers: { 'a.b': 'not a server' },
      },
      tree,
      paths,
      false,
      DOTTED,
    );
    expect(plan.entries).toEqual([
      { fieldPath: 'fileConfig.endpoints.openAI.fileLimit', value: 3 },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'fileConfig.endpoints', reason: 'dottedName', key: 'my.endpoint' },
      { fieldPath: 'mcpServers', reason: 'dottedName', key: 'a.b' },
    ]);
  });

  it('on an older server, leaves the dotted server name out as unsafe', () => {
    const plan = planImport(mcpImport, tree, paths);
    expect(plan.entries).toEqual([
      { fieldPath: 'mcpServers.cloudflare.serverInstructions', value: 'Use carefully' },
    ]);
    expect(plan.skipped).toEqual([
      { fieldPath: 'mcpServers', reason: 'unsafeKey', key: 'my.server' },
      { fieldPath: 'mcpServers.cloudflare.headers', reason: 'unsafeKey', key: 'x-team.id' },
    ]);
  });
});
