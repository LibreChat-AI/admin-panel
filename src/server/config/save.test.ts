import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as t from '@/types';
import { createFakeAdminApi } from '@/test/admin';

const yaml: t.ConfigRecord = {
  balance: { enabled: true, startBalance: 1000000, refillAmount: 1000000 },
  endpoints: {
    custom: [
      {
        name: 'Moonshot',
        apiKey: '${MOONSHOT_API_KEY}',
        baseURL: 'https://api.moonshot.ai/v1',
        models: { default: ['kimi-k2'], fetch: false },
      },
      {
        name: 'GPT',
        apiKey: '${OPENAI_API_KEY}',
        baseURL: 'https://api.openai.com/v1',
        models: { default: ['gpt-4o'] },
      },
      { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai.example.com' },
    ],
  },
  mcpServers: {
    cloudflare: { type: 'streamable-http', url: 'https://mcp.cloudflare.com/mcp' },
  },
};

const api = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createFakeAdminApi> | undefined,
}));

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => api.current!.fetch(path, init),
  extractApiError: async (_response: unknown, message: string) => {
    throw new Error(message);
  },
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({ handler: (fn: (...args: unknown[]) => unknown) => fn }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({ queryOptions: (opts: unknown) => opts }));

import { applyConfigChanges } from './save';
import { issueDisplayPath } from '@/components/configuration/issues';
import { getKeyedCollection } from '@/utils';

const base: t.WriteTargetRef = { type: 'base' };
const customEntries = (yaml.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
const models = { default: ['m'] };

function upsert(
  key: string,
  identity: string | null,
  value: t.ConfigValue,
  baseline?: t.ConfigValue,
): t.ConfigChange {
  return { op: 'upsertEntry', path: 'endpoints.custom', key, identity, value, baseline };
}

beforeEach(() => {
  api.current = createFakeAdminApi(yaml);
});

describe('applyConfigChanges — keyed collections (SV-1)', () => {
  it('stores exactly one partial entry when one Moonshot field changes', async () => {
    const moonshot = customEntries[0];
    const result = await applyConfigChanges(base, [
      upsert(
        'Moonshot',
        'Moonshot',
        { ...moonshot, baseURL: 'https://api.moonshot.cn/v1' },
        moonshot,
      ),
    ]);
    expect(result).toMatchObject({ applied: 1, issues: [], failed: [] });
    expect(api.current!.stored()).toEqual({
      endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' }] },
    });
  });

  it('refuses to delete or rename a YAML endpoint and writes nothing', async () => {
    const result = await applyConfigChanges(base, [
      { op: 'removeEntry', path: 'endpoints.custom', key: 'Zai 2', identity: 'Zai 2' },
      upsert('Zai', 'Zai 2', { ...customEntries[2], name: 'Zai' }, customEntries[2]),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'YAML_ENTRY_IMMUTABLE',
      'YAML_ENTRY_IMMUTABLE',
    ]);
    expect(result.applied).toBe(0);
    expect(api.current!.writes()).toEqual([]);
  });

  it('deletes and renames DB-only endpoints, keeping the other stored entries', async () => {
    const adminA = { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models };
    const adminB = { name: 'AdminB', apiKey: 'user_provided', baseURL: 'https://b', models };
    api.current!.seed('role/__base__', {
      endpoints: { custom: [adminA, adminB, { name: 'Moonshot', titleModel: 'kimi' }] },
    });
    await applyConfigChanges(base, [
      { op: 'removeEntry', path: 'endpoints.custom', key: 'AdminA', identity: 'AdminA' },
      upsert('AdminC', 'AdminB', { ...adminB, name: 'AdminC' }, adminB),
    ]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [
          { ...adminB, name: 'AdminC' },
          { name: 'Moonshot', titleModel: 'kimi' },
        ],
      },
    });
  });

  it('fails with a conflict instead of editing another entry after a concurrent delete', async () => {
    const adminA = { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models };
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'AdminB', apiKey: 'user_provided', baseURL: 'https://b', models }],
      },
    });
    const result = await applyConfigChanges(base, [
      upsert('AdminA', 'AdminA', { ...adminA, baseURL: 'https://a2' }, adminA),
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['ENTRY_NOT_FOUND']);
    expect(api.current!.writes()).toEqual([]);
  });

  it('requires a new key to rename an endpoint with a stored secret (SV-10)', async () => {
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v', models }],
      },
    });
    const baseline = { name: 'Vault', baseURL: 'https://v', apiKeyPreview: 'sk-...', models };
    const blocked = await applyConfigChanges(base, [
      upsert('Vault 2', 'Vault', { ...baseline, name: 'Vault 2' }, baseline),
    ]);
    expect(blocked.issues.map((issue) => issue.code)).toEqual(['SECRET_REQUIRED_FOR_RENAME']);
    const allowed = await applyConfigChanges(base, [
      upsert('Vault 2', 'Vault', { ...baseline, name: 'Vault 2', apiKey: 'sk-new' }, baseline),
    ]);
    expect(allowed.issues).toEqual([]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [{ name: 'Vault 2', apiKey: 'enc:sk-new', baseURL: 'https://v', models }],
      },
    });
  });

  it('keeps a stored secret by name when another field of the entry changes', async () => {
    api.current!.seed('role/__base__', {
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v', models }],
      },
    });
    const baseline = { name: 'Vault', baseURL: 'https://v', apiKeyPreview: 'sk-...', models };
    await applyConfigChanges(base, [
      upsert('Vault', 'Vault', { ...baseline, baseURL: 'https://v2' }, baseline),
    ]);
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [{ name: 'Vault', apiKey: 'enc:sk-secret', baseURL: 'https://v2', models }],
      },
    });
  });
});

describe('applyConfigChanges — validated, ordered, compensated (SV-2)', () => {
  it('writes nothing when a rename comes with an invalid title', async () => {
    api.current!.seed('role/__base__', {
      mcpServers: {
        renamer: { type: 'sse', url: 'https://sse.example.com/sse', title: 'Renamer' },
      },
    });
    const result = await applyConfigChanges(base, [
      { op: 'reset', path: 'mcpServers.renamer' },
      { op: 'set', path: 'mcpServers.final-server.type', value: 'sse' },
      { op: 'set', path: 'mcpServers.final-server.url', value: 'https://sse.example.com/sse' },
      { op: 'set', path: 'mcpServers.final-server.title', value: 'Bad_Title!' },
    ]);
    expect(result.issues.map((issue) => issue.path)).toContain('mcpServers.final-server.title');
    expect(api.current!.writes()).toEqual([]);
    expect(api.current!.stored()).toHaveProperty('mcpServers.renamer');
  });

  it('writes the new entry before deleting the old one', async () => {
    api.current!.seed('role/__base__', {
      mcpServers: { renamer: { type: 'sse', url: 'https://sse.example.com/sse' } },
    });
    await applyConfigChanges(base, [
      { op: 'reset', path: 'mcpServers.renamer' },
      { op: 'set', path: 'mcpServers.renamed.type', value: 'sse' },
      { op: 'set', path: 'mcpServers.renamed.url', value: 'https://sse.example.com/sse' },
    ]);
    expect(api.current!.writes().map((r) => r.method)).toEqual(['PATCH', 'DELETE']);
    expect(api.current!.stored()).toEqual({
      mcpServers: { renamed: { type: 'sse', url: 'https://sse.example.com/sse' } },
    });
  });

  it('rolls the written sets back when a later reset fails', async () => {
    const before = { balance: { startBalance: 5 }, interface: { customWelcome: 'hi' } };
    api.current!.seed('role/__base__', before);
    let failed = false;
    api.current!.setOverride((request) => {
      if (request.method !== 'DELETE' || failed) return undefined;
      failed = true;
      return { status: 500, body: { error: 'boom' } };
    });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 7 },
      { op: 'reset', path: 'interface.customWelcome' },
    ]);
    expect(result).toMatchObject({
      applied: 0,
      compensated: true,
      failed: [{ code: 'WRITE_FAILED', message: 'boom' }],
    });
    expect(api.current!.stored()).toEqual(before);
  });

  it('reports a save LibreChat refuses until the admin accepts its terms, with where to accept them', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 403,
            body: {
              code: 'terms_not_accepted',
              message: 'Terms of service must be accepted before using this feature',
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.tokenLimit', value: 5000 },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: '',
        code: 'TERMS_NOT_ACCEPTED',
        params: { url: expect.any(String) },
      }),
    ]);
  });

  it('keeps the admin API message of a refused write that names no issues', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? { status: 409, body: { message: 'Config was changed by someone else' } }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.tokenLimit', value: 5000 },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        code: 'WRITE_FAILED',
        message: 'Config was changed by someone else',
      }),
    ]);
  });

  it('maps backend issues on the sent array back to the entry name (SV-3)', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Invalid config override',
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [{ path: 'endpoints.custom.0.titleMethod', code: 'invalid_enum_value' }],
            },
          }
        : undefined,
    );
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, titleModel: 'gpt-4o-mini' }, gpt),
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom.0.titleMethod',
        code: 'invalid_enum_value',
        entryIdentity: 'GPT',
        entryPath: 'titleMethod',
      }),
    ]);
    expect(api.current!.stored()).toBeUndefined();
  });

  it('words a backend issue it gets no parameters for without placeholders', async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Invalid config override',
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [{ path: 'balance.startBalance', code: 'too_small' }],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(result.failed).toEqual([
      { path: 'balance.startBalance', code: 'too_small', message: 'is too small' },
    ]);
  });

  it('blocks provider: openai with the field and entry named', async () => {
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, provider: 'openai' }, gpt),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid_literal',
        message: 'must be "anthropic"',
        entryIdentity: 'GPT',
        entryPath: 'provider',
      }),
    ]);
  });
});

describe('applyConfigChanges — clear/reset and verification (SV-4, SV-5, SV-7)', () => {
  it('sends nothing for clearing a librechat.yaml value with no override', async () => {
    const result = await applyConfigChanges(base, [{ op: 'reset', path: 'balance.refillAmount' }]);
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlValue' }]);
    expect(api.current!.writes()).toEqual([]);
  });

  it('removes the emptied section instead of leaving {}', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    await applyConfigChanges(base, [{ op: 'reset', path: 'balance.startBalance' }]);
    expect(api.current!.writes()).toMatchObject([
      { method: 'DELETE', path: expect.stringContaining('fieldPath=balance') },
    ]);
    expect(api.current!.writes()[0].path).not.toContain('startBalance');
    expect(api.current!.stored()).toEqual({});
  });

  it('keeps a stored tombstone when removing an override would empty its section (BE-11)', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } }, ['balance.refillAmount']);
    await applyConfigChanges(base, [{ op: 'reset', path: 'balance.startBalance' }]);
    expect(api.current!.writes()).toMatchObject([
      { method: 'DELETE', path: expect.stringContaining('fieldPath=balance.startBalance') },
    ]);
    expect(api.current!.tombstones()).toEqual(['balance.refillAmount']);
  });

  it('leaves no {} behind when a union switches back to its librechat.yaml key', async () => {
    api.current!.seed(
      'role/__base__',
      { memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } } },
      ['memory.agent.id'],
    );
    const result = await applyConfigChanges(base, [
      { op: 'reset', path: 'memory.agent.provider' },
      { op: 'reset', path: 'memory.agent.model' },
      { op: 'untombstone', path: 'memory.agent.id' },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], skipped: [] });
    expect(api.current!.writes().map((r) => r.path)).toEqual([
      expect.stringMatching(/fieldPath=memory\.agent\.id$/),
      expect.stringMatching(/fieldPath=memory$/),
    ]);
    expect(api.current!.stored()).toEqual({});
    expect(api.current!.tombstones()).toEqual([]);
  });

  it('reports a value LibreChat dropped as not stored', async () => {
    api.current!.stripSection('speech');
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 9 },
      { op: 'set', path: 'speech.speechTab.advancedMode', value: true },
    ]);
    expect(result.skipped).toContainEqual({
      fieldPath: 'speech.speechTab.advancedMode',
      reason: 'notStored',
    });
    expect(result.applied).toBe(1);
  });

  it('reports YAML keys a record write cannot remove', async () => {
    const yamlWithHeaders = {
      ...yaml,
      mcpServers: {
        github: { type: 'streamable-http', url: 'https://gh', headers: { Authorization: 'x' } },
      },
    };
    api.current = createFakeAdminApi(yamlWithHeaders);
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.github.headers', value: { 'X-Other': 'abc' } },
    ]);
    expect(result.warnings).toEqual([
      { path: 'mcpServers.github.headers', warning: 'yamlOnly', keys: ['Authorization'] },
    ]);
    expect(result.skipped).toContainEqual({
      fieldPath: 'mcpServers.github.headers.Authorization',
      reason: 'yamlMerged',
    });
  });
});

describe('applyConfigChanges — profiles (SV-9)', () => {
  const scope: t.WriteTargetRef = {
    type: 'scope',
    scope: { principalType: 'group' as t.ConfigScope['principalType'], principalId: 'eng' },
  };

  it('removing a profile override of an inherited server only deletes the override', async () => {
    api.current!.seed('group/eng', {
      mcpServers: { cloudflare: { url: 'https://eng-cloudflare.example.com/mcp' } },
    });
    await applyConfigChanges(scope, [{ op: 'reset', path: 'mcpServers.cloudflare' }]);
    expect(api.current!.writes().map((r) => r.method)).toEqual(['DELETE']);
    expect(api.current!.tombstones('group/eng')).toEqual([]);
  });

  it('hides an inherited value only on an explicit tombstone', async () => {
    api.current!.seed('group/eng', {});
    await applyConfigChanges(scope, [{ op: 'tombstone', path: 'mcpServers.cloudflare' }]);
    expect(api.current!.tombstones('group/eng')).toEqual(['mcpServers.cloudflare']);
  });

  it('keeps an edit inside a server shown again in the same save', async () => {
    const url = 'https://eng-cloudflare.example.com/mcp';
    api.current!.seed('group/eng', {}, ['mcpServers.cloudflare']);
    const result = await applyConfigChanges(scope, [
      { op: 'untombstone', path: 'mcpServers.cloudflare' },
      { op: 'set', path: 'mcpServers.cloudflare.url', value: url },
    ]);
    expect(result).toMatchObject({ applied: 2, issues: [], failed: [], skipped: [] });
    expect(api.current!.writes().map((r) => r.method)).toEqual(['DELETE', 'PATCH']);
    expect(api.current!.stored('group/eng')).toEqual({ mcpServers: { cloudflare: { url } } });
    expect(api.current!.tombstones('group/eng')).toEqual([]);
  });

  it('keeps a server hidden when a field inside it is edited in the same save', async () => {
    api.current!.seed('group/eng', {
      mcpServers: { cloudflare: { url: 'https://eng-cloudflare.example.com/mcp' } },
    });
    const result = await applyConfigChanges(scope, [
      { op: 'set', path: 'mcpServers.cloudflare.url', value: 'https://other.example.com/mcp' },
      { op: 'tombstone', path: 'mcpServers.cloudflare' },
    ]);
    expect(result).toMatchObject({
      applied: 1,
      issues: [],
      failed: [],
      skipped: [{ fieldPath: 'mcpServers.cloudflare.url', reason: 'hiddenBySave' }],
    });
    expect(api.current!.writes().map((r) => r.method)).toEqual(['POST']);
    expect(api.current!.stored('group/eng')).toEqual({ mcpServers: {} });
    expect(api.current!.tombstones('group/eng')).toEqual(['mcpServers.cloudflare']);
  });

  it('diffs a profile entry edit against the inherited base entry', async () => {
    const moonshot = customEntries[0];
    api.current!.seed('group/eng', {});
    await applyConfigChanges(scope, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-latest' }, moonshot),
    ]);
    expect(api.current!.stored('group/eng')).toEqual({
      endpoints: { custom: [{ name: 'Moonshot', titleModel: 'kimi-latest' }] },
    });
  });
});

describe('applyConfigChanges — switching a union away from a librechat.yaml key (WS13)', () => {
  const memoryYaml: t.ConfigRecord = { ...yaml, memory: { agent: { id: 'agent_yaml' } } };

  /** LibreChat validates a PATCH against librechat.yaml minus the stored tombstones (`union_dropped_key`). */
  function rejectInlineAgentWhileIdShows() {
    api.current!.setOverride((request) => {
      const writesInline = request.body?.entries?.some((entry) =>
        entry.fieldPath.startsWith('memory.agent.provider'),
      );
      if (request.method !== 'PATCH' || !writesInline) return undefined;
      if (api.current!.tombstones().includes('memory.agent.id')) return undefined;
      return {
        status: 400,
        body: {
          code: 'CONFIG_OVERRIDE_INVALID',
          issues: [{ path: 'memory.agent.provider', code: 'union_dropped_key' }],
        },
      };
    });
  }

  it('writes the tombstone of the YAML agent ID before the inline provider and model', async () => {
    api.current = createFakeAdminApi(memoryYaml);
    rejectInlineAgentWhileIdShows();
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'set', path: 'memory.agent.model', value: 'gpt-4o-mini' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ]);
    expect(result).toMatchObject({ failed: [], issues: [] });
    expect(api.current.writes().map((request) => request.method)).toEqual(['POST', 'PATCH']);
    expect(api.current.stored()).toEqual({
      memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } },
    });
    expect(api.current.tombstones()).toEqual(['memory.agent.id']);
  });

  it('validates the result without the hidden key, so an incomplete inline agent is blocked', async () => {
    api.current = createFakeAdminApi(memoryYaml);
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.path.startsWith('memory.agent'))).toBe(true);
    expect(api.current.writes()).toEqual([]);
  });
});

describe('applyConfigChanges — the server contract (GET /api/admin/config/meta)', () => {
  const profiles = { 'us.anthropic.claude-sonnet-4-6': 'arn:aws:bedrock:us:1:profile/x' };

  it('blocks a dotted record key on a server without the contract (it would drop the key)', async () => {
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['UNSAFE_KEY']);
    expect(api.current!.writes()).toEqual([]);
    expect(api.current!.requests.map((request) => request.path)).toContain(
      '/api/admin/config/meta',
    );
  });

  it('writes a dotted record whole when the server keeps dotted keys', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], applied: 1, skipped: [] });
    expect(api.current!.writes()).toMatchObject([
      {
        method: 'PATCH',
        body: { entries: [{ fieldPath: 'endpoints.bedrock.inferenceProfiles', value: profiles }] },
      },
    ]);
  });

  it('still refuses a $ key when the server keeps dotted keys', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: { $where: 'x' } },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['RESERVED_KEY']);
    expect(api.current!.writes()).toEqual([]);
  });

  it("splits sets into PATCHes of the server's maxPatchEntries", async () => {
    api.current!.reportMeta({ limits: { maxPatchEntries: 2 } });
    await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'balance.refillAmount', value: 6 },
      { op: 'set', path: 'balance.refillIntervalValue', value: 7 },
    ]);
    expect(api.current!.writes().map((request) => request.body?.entries?.length)).toEqual([2, 1]);
  });
});

describe('applyConfigChanges — write reports, structured issues and codes', () => {
  const skippedPart = {
    path: 'interface.prompts',
    segments: ['interface', 'prompts'],
    reason: 'interface_permission',
  };
  const skippedWhole = {
    path: 'balance.refillAmount',
    segments: ['balance', 'refillAmount'],
    reason: 'deployment_only_path',
  };

  it('reports what the server did not store, counting only whole changes as not applied', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.reportWrites(() => ({ applied: [], skipped: [skippedWhole, skippedPart] }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'balance.refillAmount', value: 6 },
      { op: 'set', path: 'interface.modelSelect', value: false },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], applied: 2 });
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
    expect(result.reported).toEqual([{ fieldPath: 'interface.prompts', reason: 'permission' }]);
  });

  it('does not report a part of a section the save did not change', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.reportWrites(() => ({ applied: [], skipped: [skippedPart] }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], applied: 1, skipped: [], reported: [] });
  });

  it('leaves the report alone on a server without writeReport', async () => {
    api.current!.reportWrites(() => ({ skipped: [skippedWhole] }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 6 },
    ]);
    expect(result).toMatchObject({ applied: 1, skipped: [] });
  });

  it('reports a whole PATCH the server skipped, without a second not-stored finding', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.stripSection('balance');
    api.current!.reportWrites((request) =>
      request.method === 'PATCH' ? { applied: [], skipped: [skippedWhole] } : {},
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 6 },
    ]);
    expect(result).toMatchObject({ applied: 0 });
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
  });

  it('reports a tombstone the server skipped', async () => {
    api.current!.reportMeta({ features: { writeReport: true } });
    api.current!.reportWrites((request) =>
      request.path.endsWith('/tombstone')
        ? { skipped: [{ path: 'balance.refillAmount', reason: 'deployment_only_path' }] }
        : {},
    );
    const result = await applyConfigChanges(base, [
      { op: 'tombstone', path: 'balance.refillAmount' },
    ]);
    expect(result.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlOnly' }]);
    expect(result.applied).toBe(0);
  });

  it('reports a credential the merge leaves out once the server rebinds credentials', async () => {
    const ignored = [
      {
        path: 'endpoints.custom.Moonshot.apiKey',
        segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
        reason: 'secret_rebinding',
      },
    ];
    api.current!.reportWrites(() => ({ ignored }));
    const moonshot = customEntries[0];
    const change = upsert(
      'Moonshot',
      'Moonshot',
      { ...moonshot, baseURL: 'https://proxy.example.com/v1' },
      moonshot,
    );
    expect(await applyConfigChanges(base, [change])).toMatchObject({ skipped: [], reported: [] });
    api.current = createFakeAdminApi(yaml);
    api.current.reportMeta({ features: { secretRebinding: true } });
    api.current.reportWrites(() => ({ ignored }));
    const result = await applyConfigChanges(base, [change]);
    expect(result).toMatchObject({ applied: 1, failed: [], skipped: [] });
    expect(result.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
    const unrelated = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(unrelated).toMatchObject({ applied: 1, skipped: [], reported: [] });
  });

  it('notes a dropped credential once, apart from the changes, however many PATCHes repeat it', async () => {
    api.current!.reportMeta({
      features: { secretRebinding: true },
      limits: { maxPatchEntries: 1 },
    });
    api.current!.reportWrites(() => ({
      ignored: [
        {
          path: 'endpoints.custom.Moonshot.apiKey',
          segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
          reason: 'secret_rebinding',
        },
      ],
    }));
    const moonshot = customEntries[0];
    const result = await applyConfigChanges(base, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-k2' }, moonshot),
      { op: 'set', path: 'balance.startBalance', value: 5 },
    ]);
    expect(api.current!.writes()).toHaveLength(2);
    expect(result).toMatchObject({ applied: 2, failed: [], skipped: [] });
    expect(result.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  it("does not repeat a dropped credential on a later save of another endpoint's settings", async () => {
    api.current!.reportMeta({ features: { secretRebinding: true } });
    api.current!.reportWrites(() => ({
      ignored: [
        {
          path: 'endpoints.custom.Moonshot.apiKey',
          segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
          reason: 'secret_rebinding',
        },
      ],
    }));
    const [moonshot, gpt] = customEntries;
    const title = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.openAI.titleModel', value: 'gpt-5-nano' },
    ]);
    expect(title).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
    const other = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, titleModel: 'gpt-4o-mini' }, gpt),
    ]);
    expect(other).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
    expect(api.current!.writes().at(-1)).toMatchObject({
      body: { entries: [{ fieldPath: 'endpoints.custom' }] },
    });
    const same = await applyConfigChanges(base, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, titleModel: 'kimi-k2' }, moonshot),
    ]);
    expect(same.reported).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  it('words a backend issue by its params on a server with issueParams', async () => {
    const issue = {
      path: 'balance.startBalance',
      segments: ['balance', 'startBalance'],
      code: 'too_small',
      params: { minimum: 1, inclusive: true, exact: false, type: 'number' },
    };
    const refuse = (request: { method: string }) =>
      request.method === 'PATCH'
        ? { status: 400, body: { code: 'CONFIG_OVERRIDE_INVALID', issues: [issue] } }
        : undefined;
    api.current!.setOverride(refuse);
    const before = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 0 },
    ]);
    expect(before.failed).toEqual([
      { path: 'balance.startBalance', code: 'too_small', message: 'is too small' },
    ]);
    api.current!.reportMeta({ features: { issueParams: true } });
    const after = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 0 },
    ]);
    expect(after.failed).toEqual([
      {
        path: 'balance.startBalance',
        code: 'too_small',
        message: 'must be at least 1',
        params: { minimum: 1 },
      },
    ]);
  });

  it('locates an issue by its segments: a dotted record key stays one key', async () => {
    const profiles = { 'us.anthropic.claude-sonnet-4-6': 'arn' };
    api.current!.reportMeta({ features: { dottedKeys: true, issueParams: true } });
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [
                {
                  path: 'endpoints.bedrock.inferenceProfiles.us.anthropic.claude-sonnet-4-6',
                  segments: [
                    'endpoints',
                    'bedrock',
                    'inferenceProfiles',
                    'us.anthropic.claude-sonnet-4-6',
                  ],
                  code: 'too_small',
                  params: { minimum: 20, inclusive: true, exact: false, type: 'string' },
                },
              ],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'endpoints.bedrock.inferenceProfiles', value: profiles },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.failed).toEqual([
      {
        path: 'endpoints.bedrock.inferenceProfiles',
        code: 'too_small_length',
        message: 'must be at least 20 characters',
        params: { minimum: 20 },
      },
    ]);
  });

  it('maps an entry issue by segments to the entry name', async () => {
    api.current!.reportMeta({ features: { dottedKeys: true } });
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              code: 'CONFIG_OVERRIDE_INVALID',
              issues: [
                {
                  path: 'endpoints.custom.0.headers.x-portkey.config',
                  segments: ['endpoints', 'custom', '0', 'headers', 'x-portkey.config'],
                  code: 'invalid_type',
                },
              ],
            },
          }
        : undefined,
    );
    const gpt = customEntries[1];
    const result = await applyConfigChanges(base, [
      upsert('GPT', 'GPT', { ...gpt, headers: { 'x-portkey.config': 'x' } }, gpt),
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({ entryIdentity: 'GPT', entryPath: 'headers' }),
    ]);
  });

  it("words a refused write by the admin API's code", async () => {
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: {
              error: 'Process-backed MCP servers are configured in librechat.yaml',
              code: 'PROCESS_MCP_SERVER_OVERRIDE',
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.cloudflare.title', value: 'Cloudflare' },
    ]);
    expect(result.failed).toEqual([
      {
        path: 'mcpServers.cloudflare.title',
        code: 'WRITE_FAILED',
        message:
          'This MCP server runs a local process defined in librechat.yaml, so LibreChat applies no overrides to it.',
      },
    ]);
  });
});

describe('applyConfigChanges — change batches (changesBatch, expectedRevision)', () => {
  const batchMeta = (limits: Partial<t.ConfigLimits> = {}): t.AdminConfigMetaBody => ({
    features: {
      changesBatch: true,
      expectedRevision: true,
      prunesEmptyParents: true,
      awaitedInvalidation: true,
    },
    limits: { maxChangeOps: 1000, ...limits },
  });
  const posts = () => api.current!.writes().filter((request) => request.path.endsWith('/changes'));

  beforeEach(() => {
    api.current!.reportMeta(batchMeta());
  });

  it('writes every change as one batch named by the revision it was planned against', async () => {
    api.current!.seed('role/__base__', { balance: { refillAmount: 7 } });
    const revision = api.current!.revision();
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'reset', path: 'balance.refillAmount' },
      { op: 'tombstone', path: 'mcpServers.cloudflare' },
    ]);
    expect(result).toMatchObject({ applied: 3, issues: [], failed: [], skipped: [] });
    expect(api.current!.writes()).toEqual([
      {
        method: 'POST',
        path: '/api/admin/config/role/__base__/changes',
        body: {
          ops: [
            { op: 'tombstone', fieldPath: 'mcpServers.cloudflare' },
            { op: 'set', fieldPath: 'balance.startBalance', value: 5 },
            { op: 'unset', fieldPath: 'balance.refillAmount' },
          ],
          priority: 0,
          expectedRevision: revision,
        },
      },
    ]);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 5 } });
    expect(api.current!.tombstones()).toEqual(['mcpServers.cloudflare']);
  });

  it('creates the base document only while it has none', async () => {
    await applyConfigChanges(base, [{ op: 'set', path: 'balance.startBalance', value: 5 }]);
    expect(posts()[0].body?.expectedRevision).toBe('absent');
  });

  it('sends a reset as planned, without widening it: the server prunes emptied parents', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    await applyConfigChanges(base, [{ op: 'reset', path: 'balance.startBalance' }]);
    expect(posts()[0].body?.ops).toEqual([{ op: 'unset', fieldPath: 'balance.startBalance' }]);
    expect(api.current!.stored()).toEqual({});
  });

  it('writes nothing and reports a conflict when the target changed since the edits were loaded', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    const loaded = api.current!.revision();
    api.current!.seed('role/__base__', { balance: { startBalance: 6 } });
    const result = await applyConfigChanges(
      base,
      [{ op: 'set', path: 'balance.refillAmount', value: 9 }],
      loaded!,
    );
    expect(result).toMatchObject({ conflict: true, applied: 0 });
    expect(result.failed.map((issue) => issue.code)).toEqual(['CONFIG_VERSION_CONFLICT']);
    expect(api.current!.writes()).toEqual([]);
  });

  it('saves against the revision the edits were loaded at', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    const loaded = api.current!.revision();
    const result = await applyConfigChanges(
      base,
      [{ op: 'set', path: 'balance.refillAmount', value: 9 }],
      loaded!,
    );
    expect(result).toMatchObject({ applied: 1, failed: [] });
    expect(result.conflict).toBeUndefined();
    expect(posts()[0].body?.expectedRevision).toBe(loaded);
  });

  it('reports a conflict when another save lands between the read and the batch (409)', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    const loaded = api.current!.revision();
    let raced = false;
    api.current!.setOverride((request) => {
      if (!request.path.endsWith('/changes') || raced) return undefined;
      raced = true;
      api.current!.seed('role/__base__', { balance: { startBalance: 8 } });
      return undefined;
    });
    const result = await applyConfigChanges(
      base,
      [{ op: 'set', path: 'balance.refillAmount', value: 9 }],
      loaded!,
    );
    expect(result).toMatchObject({ conflict: true, applied: 0 });
    expect(posts()).toHaveLength(1);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 8 } });
  });

  it('plans once more when a save without a loaded revision (an import) loses that race', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    let raced = false;
    api.current!.setOverride((request) => {
      if (!request.path.endsWith('/changes') || raced) return undefined;
      raced = true;
      api.current!.seed('role/__base__', { balance: { startBalance: 8 } });
      return undefined;
    });
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 9 },
    ]);
    expect(result).toMatchObject({ applied: 1, failed: [] });
    expect(posts()).toHaveLength(2);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 8, refillAmount: 9 } });
  });

  it('refuses a batch whole and sends nothing to roll it back', async () => {
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes')
        ? {
            status: 400,
            body: {
              error: 'Config change cannot be applied to the stored config',
              code: 'CONFIG_PATH_INVALID',
              opIndex: 1,
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 6 },
      { op: 'set', path: 'speech.speechTab.advancedMode', value: true },
    ]);
    expect(result.failed).toEqual([
      {
        path: 'speech.speechTab.advancedMode',
        code: 'WRITE_FAILED',
        message: 'Config change cannot be applied to the stored config',
      },
    ]);
    expect(result.compensated).toBeUndefined();
    expect(api.current!.writes()).toHaveLength(1);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 5 } });
  });

  it('reports what the batch did not store, counting only whole changes as not applied', async () => {
    api.current!.stripSection('speech');
    api.current!.reportWrites(() => ({
      skipped: [
        {
          opIndex: 1,
          segments: ['speech', 'speechTab', 'advancedMode'],
          reason: 'base_only_section',
        },
        { opIndex: 2, segments: ['interface', 'prompts'], reason: 'interface_permission' },
      ],
    }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 6 },
      { op: 'set', path: 'speech.speechTab.advancedMode', value: true },
      { op: 'set', path: 'interface', value: { prompts: false, modelSelect: true } },
    ]);
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual([
      { fieldPath: 'speech.speechTab.advancedMode', reason: 'baseOnly' },
    ]);
    expect(result.reported).toEqual([{ fieldPath: 'interface.prompts', reason: 'permission' }]);
  });

  it('reports a change the runtime merge does not use', async () => {
    api.current!.reportWrites(() => ({
      ignored: [
        {
          opIndex: 0,
          segments: ['mcpServers', 'cloudflare', 'title'],
          reason: 'process_mcp_server',
        },
      ],
    }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.cloudflare.title', value: 'Cloudflare' },
    ]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([
      { fieldPath: 'mcpServers.cloudflare.title', reason: 'processServer' },
    ]);
  });

  describe('a dropped credential or a partial report, for the changes a batch made', () => {
    const dropped = {
      path: 'endpoints.custom.Moonshot.apiKey',
      segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
      reason: 'secret_rebinding',
    };
    const noted = { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' };
    const [moonshot, gpt] = customEntries;
    const editMoonshot = upsert(
      'Moonshot',
      'Moonshot',
      { ...moonshot, titleModel: 'kimi-k2' },
      moonshot,
    );

    it('is noted apart from the count when the batch changed its entry', async () => {
      api.current!.reportWrites(() => ({ ignored: [dropped] }));
      const result = await applyConfigChanges(base, [
        editMoonshot,
        { op: 'set', path: 'balance.startBalance', value: 5 },
      ]);
      expect(result).toMatchObject({ applied: 2, failed: [], skipped: [] });
      expect(result.reported).toEqual([noted]);
    });

    it('is not repeated by an unrelated save, or one of another entry the batch sends whole', async () => {
      api.current!.reportWrites(() => ({ ignored: [dropped] }));
      const unrelated = await applyConfigChanges(base, [
        { op: 'set', path: 'endpoints.openAI.titleModel', value: 'gpt-5-nano' },
      ]);
      expect(unrelated).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
      const other = await applyConfigChanges(base, [
        upsert('GPT', 'GPT', { ...gpt, titleModel: 'gpt-4o-mini' }, gpt),
      ]);
      expect(posts().at(-1)?.body?.ops).toEqual([
        expect.objectContaining({ op: 'set', fieldPath: 'endpoints.custom' }),
      ]);
      expect(other).toMatchObject({ applied: 1, failed: [], skipped: [], reported: [] });
      expect((await applyConfigChanges(base, [editMoonshot])).reported).toEqual([noted]);
    });

    it('is noted once however many batches repeat it', async () => {
      api.current!.reportMeta(batchMeta({ maxChangeOps: 1 }));
      api.current!.reportWrites(() => ({ ignored: [dropped] }));
      const result = await applyConfigChanges(base, [
        editMoonshot,
        { op: 'set', path: 'balance.startBalance', value: 5 },
      ]);
      expect(posts()).toHaveLength(2);
      expect(result).toMatchObject({ applied: 2, failed: [], skipped: [] });
      expect(result.reported).toEqual([noted]);
    });

    it('keeps a part reported inside the entry the batch changed, not inside another', async () => {
      const part = (name: string) => ({
        opIndex: 0,
        segments: ['endpoints', 'custom', name, 'headers'],
        reason: 'base_only_path',
      });
      api.current!.reportWrites(() => ({ skipped: [part('GPT'), part('Moonshot')] }));
      const result = await applyConfigChanges(base, [editMoonshot]);
      expect(result).toMatchObject({ applied: 1, failed: [], skipped: [] });
      expect(result.reported).toEqual([
        { fieldPath: 'endpoints.custom.Moonshot.headers', reason: 'baseOnly' },
      ]);
    });
  });

  it("splits a plan above maxChangeOps into batches, each named by the previous one's revision", async () => {
    api.current!.reportMeta(batchMeta({ maxChangeOps: 2 }));
    await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'memory.tokenLimit', value: 6 },
      { op: 'set', path: 'interface.presets', value: false },
    ]);
    expect(posts().map((request) => request.body?.ops?.length)).toEqual([2, 1]);
    expect(posts().map((request) => request.body?.expectedRevision)).toEqual([
      'absent',
      'role-__base__:1',
    ]);
    expect(api.current!.stored()).toEqual({
      balance: { startBalance: 5 },
      memory: { tokenLimit: 6 },
      interface: { presets: false },
    });
  });

  describe('a split save, by sections', () => {
    const switchAgent: t.ConfigChange[] = [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'set', path: 'memory.agent.model', value: 'gpt-4o-mini' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ];

    beforeEach(() => {
      api.current = createFakeAdminApi({ ...yaml, memory: { agent: { id: 'agent_yaml' } } });
      api.current.judgeEndStates();
    });

    it("keeps a section's changes in one batch, so each batch's end state is valid", async () => {
      api.current!.reportMeta(batchMeta({ maxChangeOps: 3 }));
      const result = await applyConfigChanges(base, [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        ...switchAgent,
      ]);
      expect(result).toMatchObject({ applied: 4, failed: [], issues: [], skipped: [] });
      expect(posts().map((request) => request.body?.ops)).toEqual([
        [
          { op: 'tombstone', fieldPath: 'memory.agent.id' },
          { op: 'set', fieldPath: 'memory.agent.provider', value: 'openAI' },
          { op: 'set', fieldPath: 'memory.agent.model', value: 'gpt-4o-mini' },
        ],
        [{ op: 'set', fieldPath: 'balance.startBalance', value: 5 }],
      ]);
      expect(api.current!.stored()).toEqual({
        balance: { startBalance: 5 },
        memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } },
      });
      expect(api.current!.tombstones()).toEqual(['memory.agent.id']);
    });

    it('judges a batch that hides the agent ID alone, the end state a split must avoid', async () => {
      const response = await api.current!.fetch('/api/admin/config/role/__base__/changes', {
        method: 'POST',
        body: JSON.stringify({ ops: [{ op: 'tombstone', fieldPath: 'memory.agent.id' }] }),
      });
      expect(response.status).toBe(400);
      expect(api.current!.stored()).toBeUndefined();
    });

    it('refuses a section with more changes than one batch takes, writing nothing', async () => {
      api.current!.reportMeta(batchMeta({ maxChangeOps: 2 }));
      const result = await applyConfigChanges(base, [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        ...switchAgent,
      ]);
      expect(result).toMatchObject({ applied: 0, issues: [] });
      expect(result.partiallyWritten).toBeUndefined();
      expect(result.failed).toEqual([
        {
          path: 'memory',
          code: 'TOO_MANY_CHANGES',
          message:
            'has 3 changes, more than the 2 LibreChat takes in one save: save some of them first, then the rest',
          params: { count: 3, limit: 2 },
        },
      ]);
      expect(api.current!.writes()).toEqual([]);
    });
  });

  it('reports a split save that failed after an earlier batch was written', async () => {
    api.current!.reportMeta(batchMeta({ maxChangeOps: 1 }));
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes') && request.body?.expectedRevision !== 'absent'
        ? { status: 500, body: { error: 'Failed to apply config changes' } }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'memory.tokenLimit', value: 6 },
    ]);
    expect(result).toMatchObject({ partiallyWritten: true, applied: 0 });
    expect(result.failed.map((issue) => issue.message)).toEqual(['Failed to apply config changes']);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 5 } });
  });

  it('reports a conflict on a later batch as a partial write, not as nothing saved', async () => {
    api.current!.reportMeta(batchMeta({ maxChangeOps: 1 }));
    const loaded = api.current!.revision();
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes') && request.body?.expectedRevision !== 'absent'
        ? {
            status: 409,
            body: {
              error: 'Config was modified by another request',
              code: 'CONFIG_VERSION_CONFLICT',
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(
      base,
      [
        { op: 'set', path: 'balance.startBalance', value: 5 },
        { op: 'set', path: 'memory.tokenLimit', value: 6 },
      ],
      loaded ?? 'absent',
    );
    expect(result).toMatchObject({ partiallyWritten: true, applied: 0 });
    expect(result.conflict).toBeUndefined();
    expect(result.failed.map((issue) => issue.code)).toEqual(['CONFIG_VERSION_CONFLICT']);
    expect(api.current!.stored()).toEqual({ balance: { startBalance: 5 } });
  });

  it('keeps an edit inside a server shown again in the same batch', async () => {
    const url = 'https://eng-cloudflare.example.com/mcp';
    const scope: t.WriteTargetRef = {
      type: 'scope',
      scope: { principalType: 'role' as t.ConfigScope['principalType'], principalId: 'USER' },
    };
    api.current!.seed('role/USER', {}, ['mcpServers.cloudflare']);
    const result = await applyConfigChanges(
      scope,
      [
        { op: 'untombstone', path: 'mcpServers.cloudflare' },
        { op: 'set', path: 'mcpServers.cloudflare.url', value: url },
      ],
      api.current!.revision('role/USER')!,
    );
    expect(result).toMatchObject({ applied: 2, issues: [], failed: [], skipped: [] });
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body?.ops).toEqual([
      { op: 'unset', fieldPath: 'mcpServers.cloudflare' },
      { op: 'set', fieldPath: 'mcpServers.cloudflare.url', value: url },
    ]);
    expect(api.current!.stored('role/USER')).toEqual({ mcpServers: { cloudflare: { url } } });
    expect(api.current!.tombstones('role/USER')).toEqual([]);
  });

  it('keeps a server hidden when a field inside it is edited in the same batch', async () => {
    api.current!.seed('role/USER', {
      mcpServers: { cloudflare: { url: 'https://user-cloudflare.example.com/mcp' } },
    });
    const result = await applyConfigChanges(
      {
        type: 'scope',
        scope: { principalType: 'role' as t.ConfigScope['principalType'], principalId: 'USER' },
      },
      [
        { op: 'set', path: 'mcpServers.cloudflare.url', value: 'https://other.example.com/mcp' },
        { op: 'tombstone', path: 'mcpServers.cloudflare' },
      ],
      api.current!.revision('role/USER')!,
    );
    expect(result).toMatchObject({
      applied: 1,
      issues: [],
      failed: [],
      skipped: [{ fieldPath: 'mcpServers.cloudflare.url', reason: 'hiddenBySave' }],
    });
    expect(posts()[0].body?.ops).toEqual([{ op: 'tombstone', fieldPath: 'mcpServers.cloudflare' }]);
    expect(api.current!.stored('role/USER')).toEqual({});
    expect(api.current!.tombstones('role/USER')).toEqual(['mcpServers.cloudflare']);
  });

  it('keeps separate field writes on a server without changesBatch', async () => {
    api.current!.reportMeta({ features: { expectedRevision: true, prunesEmptyParents: true } });
    api.current!.seed('role/__base__', { balance: { startBalance: 5 } });
    await applyConfigChanges(base, [
      { op: 'set', path: 'balance.refillAmount', value: 6 },
      { op: 'reset', path: 'balance.startBalance' },
    ]);
    expect(api.current!.writes().map((request) => request.method)).toEqual(['PATCH', 'DELETE']);
    expect(api.current!.writes()[1].path).toContain('fieldPath=balance.startBalance');
  });

  it('writes a union switch as one batch, validated on its end state', async () => {
    api.current = createFakeAdminApi({ ...yaml, memory: { agent: { id: 'agent_yaml' } } });
    api.current.reportMeta(batchMeta());
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'memory.agent.provider', value: 'openAI' },
      { op: 'set', path: 'memory.agent.model', value: 'gpt-4o-mini' },
      { op: 'tombstone', path: 'memory.agent.id' },
    ]);
    expect(result).toMatchObject({ failed: [], issues: [] });
    expect(posts()).toHaveLength(1);
    expect(api.current.tombstones()).toEqual(['memory.agent.id']);
  });

  it('blocks hiding a librechat.yaml value alone when the section is left invalid', async () => {
    api.current = createFakeAdminApi({ ...yaml, memory: { agent: { id: 'agent_yaml' } } });
    api.current.reportMeta(batchMeta());
    const result = await applyConfigChanges(base, [{ op: 'tombstone', path: 'memory.agent.id' }]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.path.startsWith('memory.agent'))).toBe(true);
    expect(api.current.writes()).toEqual([]);
  });
});

describe('applyConfigChanges — secrets of renamed and duplicated entries', () => {
  const vault = {
    type: 'streamable-http',
    url: 'https://mcp.vault.dev/mcp',
    apiKey: { source: 'admin', authorization_type: 'bearer', key: 'enc:sk-vault' },
  };
  const renameOps: t.ConfigChange[] = [
    { op: 'set', path: 'mcpServers.vault-kb.type', value: 'streamable-http' },
    { op: 'set', path: 'mcpServers.vault-kb.url', value: 'https://mcp.vault.dev/mcp' },
    { op: 'set', path: 'mcpServers.vault-kb.apiKey.source', value: 'admin' },
    { op: 'set', path: 'mcpServers.vault-kb.apiKey.authorization_type', value: 'bearer' },
    { op: 'reset', path: 'mcpServers.vault' },
    { op: 'carry', path: 'mcpServers', from: 'vault', to: 'vault-kb' },
  ];

  it('renames a stored MCP server in one batch, moving its encrypted key', async () => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, recordSecrets: true },
    });
    api.current!.seed('role/__base__', { mcpServers: { vault } });
    const result = await applyConfigChanges(base, renameOps);
    expect(result).toMatchObject({ issues: [], failed: [] });
    expect(api.current!.writes().map((request) => request.body?.ops)).toEqual([
      [
        { op: 'rename', fieldPath: 'mcpServers', from: 'vault', to: 'vault-kb' },
        {
          op: 'set',
          fieldPath: 'mcpServers.vault-kb',
          value: {
            type: 'streamable-http',
            url: 'https://mcp.vault.dev/mcp',
            apiKey: { source: 'admin', authorization_type: 'bearer' },
          },
        },
      ],
    ]);
    expect(api.current!.stored()).toEqual({ mcpServers: { 'vault-kb': vault } });
  });

  it.each([
    ['in a batch', { changesBatch: true, expectedRevision: true, recordSecrets: true }],
    ['through field PATCHes', { recordSecrets: true }],
  ])(
    'reads a replaced MCP key as stored from the preview the read returns (%s)',
    async (_, features) => {
      api.current!.reportMeta({ features });
      api.current!.seed('role/__base__', { mcpServers: { vault } });
      const result = await applyConfigChanges(base, [
        { op: 'set', path: 'mcpServers.vault.apiKey.key', value: 'sk-replaced-3333' },
      ]);
      expect(result).toMatchObject({ applied: 1, issues: [], failed: [], skipped: [] });
      expect(api.current!.stored()).toEqual({
        mcpServers: {
          vault: { ...vault, apiKey: { ...vault.apiKey, key: 'enc:sk-replaced-3333' } },
        },
      });
    },
  );

  it('reads an endpoint whose key and base URL change as stored, beside an entry whose key LibreChat keeps', async () => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, secretRebinding: true },
    });
    const alpha = { name: 'Alpha', baseURL: 'https://a.example.com', models, apiKey: 'enc:sk-a' };
    const beta = { name: 'Beta', baseURL: 'https://b.example.com', models, apiKey: 'enc:sk-b' };
    api.current!.seed('role/__base__', { endpoints: { custom: [alpha, beta] } });
    const loaded = {
      name: 'Alpha',
      baseURL: 'https://a.example.com',
      models,
      apiKeyPreview: 'sk-...',
    };
    const result = await applyConfigChanges(base, [
      upsert(
        'Alpha',
        'Alpha',
        { ...loaded, baseURL: 'https://a2.example.com', apiKey: 'sk-a2' },
        loaded,
      ),
    ]);
    expect(result).toMatchObject({ applied: 1, issues: [], failed: [], skipped: [] });
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [{ ...alpha, baseURL: 'https://a2.example.com', apiKey: 'enc:sk-a2' }, beta],
      },
    });
  });

  it('carries the key through a PATCH hint on a server without change batches', async () => {
    api.current!.reportMeta({ features: { recordSecrets: true } });
    api.current!.seed('role/__base__', { mcpServers: { vault } });
    const result = await applyConfigChanges(base, renameOps);
    expect(result).toMatchObject({ issues: [], failed: [] });
    const [patch, remove] = api.current!.writes();
    expect(patch.body?.renames).toEqual([
      { path: 'mcpServers', previousName: 'vault', name: 'vault-kb' },
    ]);
    expect(remove).toMatchObject({ method: 'DELETE' });
    expect(api.current!.stored()).toEqual({ mcpServers: { 'vault-kb': vault } });
  });

  it('sends no hint, and so no key, on a server without recordSecrets', async () => {
    api.current!.seed('role/__base__', { mcpServers: { vault } });
    await applyConfigChanges(base, renameOps);
    expect(api.current!.writes().some((request) => request.body?.renames)).toBe(false);
    expect(api.current!.stored()).toEqual({
      mcpServers: {
        'vault-kb': { ...vault, apiKey: { source: 'admin', authorization_type: 'bearer' } },
      },
    });
  });

  it('renames a custom endpoint with a stored key in a batch, keeping the key', async () => {
    api.current!.reportMeta({ features: { changesBatch: true, expectedRevision: true } });
    const stored = { name: 'Secret EP', baseURL: 'https://s', models, apiKey: 'enc:sk-ep' };
    api.current!.seed('role/__base__', { endpoints: { custom: [stored] } });
    const loaded = { name: 'Secret EP', baseURL: 'https://s', models, apiKeyPreview: 'sk-...' };
    const result = await applyConfigChanges(base, [
      upsert('Renamed EP', 'Secret EP', { ...loaded, name: 'Renamed EP' }, loaded),
    ]);
    expect(result).toMatchObject({ issues: [], failed: [] });
    expect(api.current!.writes()[0].body?.ops?.[0]).toEqual({
      op: 'rename',
      fieldPath: 'endpoints.custom',
      from: 'Secret EP',
      to: 'Renamed EP',
    });
    expect(api.current!.stored()).toEqual({
      endpoints: { custom: [{ ...stored, name: 'Renamed EP' }] },
    });
  });
});

describe('applyConfigChanges — dropped credentials reported for what a save renames or restates', () => {
  const vault = {
    type: 'streamable-http',
    url: 'https://mcp.vault.dev/mcp',
    apiKey: { source: 'admin', authorization_type: 'bearer', key: 'enc:sk-vault' },
  };
  const dropped = (...segments: string[]) => ({
    path: segments.join('.'),
    segments,
    reason: 'secret_rebinding',
  });
  const noted = (fieldPath: string) => ({ fieldPath, reason: 'secretRebinding' });
  const unrelated = dropped('endpoints', 'custom', 'GPT', 'apiKey');

  it('keeps one for a server renamed in a batch, under its new name, and drops the rest', async () => {
    api.current!.reportMeta({
      features: {
        changesBatch: true,
        expectedRevision: true,
        recordSecrets: true,
        secretRebinding: true,
      },
    });
    api.current!.seed('role/__base__', { mcpServers: { vault } });
    api.current!.reportWrites(() => ({
      ignored: [dropped('mcpServers', 'vault-kb', 'apiKey', 'key'), unrelated],
    }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.vault-kb.type', value: 'streamable-http' },
      { op: 'set', path: 'mcpServers.vault-kb.url', value: 'https://mcp.vault.dev/mcp' },
      { op: 'reset', path: 'mcpServers.vault' },
      { op: 'carry', path: 'mcpServers', from: 'vault', to: 'vault-kb' },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], skipped: [] });
    expect(result.reported).toEqual([noted('mcpServers.vault-kb.apiKey.key')]);
  });

  it('keeps one for a server renamed through a PATCH hint', async () => {
    api.current!.reportMeta({ features: { recordSecrets: true, secretRebinding: true } });
    api.current!.seed('role/__base__', { mcpServers: { vault } });
    api.current!.reportWrites(() => ({
      ignored: [dropped('mcpServers', 'vault-kb', 'apiKey', 'key'), unrelated],
    }));
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.vault-kb.type', value: 'streamable-http' },
      { op: 'set', path: 'mcpServers.vault-kb.url', value: 'https://mcp.vault.dev/mcp' },
      { op: 'reset', path: 'mcpServers.vault' },
      { op: 'carry', path: 'mcpServers', from: 'vault', to: 'vault-kb' },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [] });
    expect(result.reported).toEqual([noted('mcpServers.vault-kb.apiKey.key')]);
  });

  it('keeps one for a custom endpoint renamed in a batch, and for one a restate alone writes', async () => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, secretRebinding: true },
    });
    const stored = { name: 'Secret EP', baseURL: 'https://s', models, apiKey: 'enc:sk-ep' };
    api.current!.seed('role/__base__', {
      endpoints: { custom: [stored, { name: 'Moonshot', baseURL: 'https://proxy.ms/v1' }] },
    });
    api.current!.reportWrites(() => ({
      ignored: [
        dropped('endpoints', 'custom', 'Renamed EP', 'apiKey'),
        dropped('endpoints', 'custom', 'Moonshot', 'apiKey'),
        unrelated,
      ],
    }));
    const loaded = { name: 'Secret EP', baseURL: 'https://s', models, apiKeyPreview: 'sk-...' };
    const renamed = await applyConfigChanges(base, [
      upsert('Renamed EP', 'Secret EP', { ...loaded, name: 'Renamed EP' }, loaded),
    ]);
    expect(renamed.reported).toEqual([noted('endpoints.custom.Renamed EP.apiKey')]);
    const restated = await applyConfigChanges(base, [
      { op: 'restate', path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' },
    ]);
    expect(restated).toMatchObject({ issues: [], failed: [] });
    expect(restated.reported).toEqual([noted('endpoints.custom.Moonshot.apiKey')]);
  });
});

describe('applyConfigChanges — secrets sent to a new destination', () => {
  const acme = {
    type: 'streamable-http',
    url: 'https://mcp.acme.dev/mcp',
    apiKey: { source: 'admin', authorization_type: 'bearer', key: 'enc:sk-acme' },
  };

  beforeEach(() => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, recordSecrets: true },
    });
    api.current!.seed('role/__base__', { mcpServers: { acme } });
  });

  it('asks for a stored MCP key again before sending a URL change, and writes nothing', async () => {
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.acme.url', value: 'https://evil.example/mcp' },
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        path: 'mcpServers.acme.apiKey.key',
        code: 'secret_reentry_required',
        params: { fieldPaths: 'mcpServers.{}.url' },
      }),
    ]);
    expect(api.current!.writes()).toEqual([]);
  });

  it("shows the server's MCP re-entry refusal on the secret it names", async () => {
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes')
        ? {
            status: 400,
            body: {
              error: 'Enter the API key again',
              code: 'MCP_OAUTH_SECRET_REENTRY_REQUIRED',
              server: 'acme',
              fields: ['oauth.token_url'],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'mcpServers.acme.title', value: 'Acme' },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'mcpServers.acme.oauth.client_secret',
        code: 'secret_reentry_required',
        params: { fieldPaths: 'mcpServers.{}.oauth.token_url' },
      }),
    ]);
  });

  it('shows a web search re-entry refusal on the key beside the URL', async () => {
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes')
        ? {
            status: 400,
            body: {
              error: 'Enter the stored API key again when changing the URL it is sent to',
              code: 'CONFIG_SECRET_REENTRY_REQUIRED',
              issues: [
                {
                  path: 'webSearch.searxngInstanceUrl',
                  segments: ['webSearch', 'searxngInstanceUrl'],
                  code: 'secret_reentry_required',
                  secretPath: 'webSearch.searxngApiKey',
                },
              ],
            },
          }
        : undefined,
    );
    const result = await applyConfigChanges(base, [
      { op: 'set', path: 'webSearch.searxngInstanceUrl', value: 'https://other.dev' },
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'webSearch.searxngApiKey',
        params: { fieldPaths: 'webSearch.searxngInstanceUrl' },
      }),
    ]);
  });
});

describe('applyConfigChanges — custom endpoint keys sent to a new destination', () => {
  const acme = {
    name: 'AcmeLLM',
    baseURL: 'https://api.acme.dev/v1',
    models,
    apiKey: 'enc:sk-acme',
  };
  const loaded = {
    name: 'AcmeLLM',
    baseURL: 'https://api.acme.dev/v1',
    models,
    apiKeyPreview: 'sk-...',
  };
  const moved = upsert(
    'AcmeLLM',
    'AcmeLLM',
    { ...loaded, baseURL: 'https://api.acme-eu.dev/v1' },
    loaded,
  );
  const refusal = {
    status: 400,
    body: {
      error: 'Enter the stored API key again when changing where it is sent',
      code: 'CONFIG_SECRET_REENTRY_REQUIRED',
      issues: [
        {
          path: 'endpoints.custom.0.baseURL',
          segments: ['endpoints', 'custom', '0', 'baseURL'],
          code: 'secret_reentry_required',
          secretPath: 'endpoints.custom.0.apiKey',
        },
      ],
    },
  };

  beforeEach(() => {
    api.current!.seed('role/__base__', { endpoints: { custom: [acme] } });
  });

  it("places the server's refusal on the endpoint it names, not the page's entry at that index", async () => {
    api.current!.reportMeta({ features: { changesBatch: true, expectedRevision: true } });
    api.current!.setOverride((request) =>
      request.path.endsWith('/changes') ? refusal : undefined,
    );
    const result = await applyConfigChanges(base, [moved]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom.0.apiKey',
        code: 'secret_reentry_required',
        entryIdentity: 'AcmeLLM',
        entryPath: 'apiKey',
        params: { fieldPaths: 'endpoints.custom.0.baseURL' },
      }),
    ]);
    const shown = [...customEntries, { ...loaded, baseURL: 'https://api.acme-eu.dev/v1' }];
    const collections: t.PendingCollection[] = [
      {
        collection: getKeyedCollection('endpoints.custom')!,
        items: shown,
        edit: { baseline: shown, origins: [] },
      },
    ];
    expect(issueDisplayPath(result.failed[0], collections)).toBe('endpoints.custom.3.apiKey');
  });

  it('asks for the key again before sending a base URL change where the server guards it', async () => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, secretRebinding: true },
    });
    const result = await applyConfigChanges(base, [moved]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom.0.apiKey',
        entryIdentity: 'AcmeLLM',
        entryPath: 'apiKey',
      }),
    ]);
    expect(api.current!.writes()).toEqual([]);
  });

  it('restates an inherited librechat.yaml key with the new base URL', async () => {
    api.current!.reportMeta({
      features: { changesBatch: true, expectedRevision: true, secretRebinding: true },
    });
    const moonshot = customEntries[0];
    const result = await applyConfigChanges(base, [
      upsert('Moonshot', 'Moonshot', { ...moonshot, baseURL: 'https://proxy.ms/v1' }, moonshot),
      { op: 'restate', path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' },
    ]);
    expect(result).toMatchObject({ issues: [], failed: [] });
    expect(api.current!.stored()).toEqual({
      endpoints: {
        custom: [
          acme,
          { name: 'Moonshot', baseURL: 'https://proxy.ms/v1', apiKey: '${MOONSHOT_API_KEY}' },
        ],
      },
    });
  });

  it.each([
    ['reads it back as is (no yamlSecretPreview)', false],
    ['reads it back as the fixed mask (yamlSecretPreview)', true],
  ])(
    'never writes a librechat.yaml literal key into an override where the server %s',
    async (_label, yamlSecretPreview) => {
      const literal = 'sk-yaml-literal-0123456789';
      const vault = { name: 'Vault', baseURL: 'https://vault.dev/v1', models };
      const read = yamlSecretPreview
        ? { ...vault, apiKeyPreview: '********' }
        : { ...vault, apiKey: literal };
      api.current = createFakeAdminApi({ endpoints: { custom: [read] } });
      api.current.reportMeta({
        features: {
          changesBatch: true,
          expectedRevision: true,
          secretRebinding: true,
          yamlSecretPreview,
        },
      });
      const result = await applyConfigChanges(base, [
        upsert('Vault', 'Vault', { ...read, baseURL: 'https://proxy.dev/v1' }, read),
        { op: 'restate', path: 'endpoints.custom', entry: 'Vault', secret: 'apiKey' },
      ]);
      expect(result).toMatchObject({ issues: [], failed: [] });
      expect(api.current.stored()).toEqual({
        endpoints: { custom: [{ name: 'Vault', baseURL: 'https://proxy.dev/v1' }] },
      });
      expect(JSON.stringify(api.current.writes())).not.toContain(literal);
    },
  );
});

describe('applyConfigChanges — custom endpoints by key (keyedTombstones, renameHints)', () => {
  const scope: t.WriteTargetRef = {
    type: 'scope',
    scope: { principalType: 'group' as t.ConfigScope['principalType'], principalId: 'eng' },
  };
  const keyedMeta = (batch: boolean): t.AdminConfigMetaBody => ({
    features: {
      changesBatch: batch,
      expectedRevision: batch,
      prunesEmptyParents: true,
      keyedTombstones: true,
      renameHints: true,
    },
    limits: { maxChangeOps: 1000 },
  });
  const gptHide = 'endpoints.custom["GPT"]';
  const header = 'endpoints.custom["Moonshot"].headers.X-Team';
  const moonshot = customEntries[0];

  it('hides an inherited endpoint by key in one batch, removing the profile own override of it', async () => {
    api.current!.reportMeta(keyedMeta(true));
    api.current!.seed('group/eng', {
      endpoints: { custom: [{ name: 'GPT', titleModel: 'gpt-4o-mini' }] },
    });
    const result = await applyConfigChanges(scope, [{ op: 'tombstone', path: gptHide }]);
    expect(result).toMatchObject({ applied: 1, issues: [], failed: [] });
    expect(api.current!.writes()[0].body?.ops).toEqual([{ op: 'tombstone', fieldPath: gptHide }]);
    expect(api.current!.tombstones('group/eng')).toEqual([gptHide]);
    expect(api.current!.stored('group/eng')).toEqual({ endpoints: { custom: [] } });
  });

  it('removes and restores an inherited header by key through field writes before change batches', async () => {
    api.current!.reportMeta(keyedMeta(false));
    api.current!.seed('group/eng', {});
    await applyConfigChanges(scope, [{ op: 'tombstone', path: header }]);
    expect(api.current!.writes()[0]).toMatchObject({
      method: 'POST',
      path: '/api/admin/config/group/eng/fields/tombstone',
      body: { fieldPath: header },
    });
    expect(api.current!.tombstones('group/eng')).toEqual([header]);
    const restored = await applyConfigChanges(scope, [{ op: 'untombstone', path: header }]);
    expect(restored).toMatchObject({ issues: [], failed: [] });
    expect(api.current!.writes()[1]).toMatchObject({
      method: 'DELETE',
      path: `/api/admin/config/group/eng/fields?fieldPath=${encodeURIComponent(header)}`,
    });
    expect(api.current!.tombstones('group/eng')).toEqual([]);
  });

  it('takes the removals inside a reverted endpoint back by key, keeping the other hides', async () => {
    api.current!.reportMeta(keyedMeta(true));
    api.current!.seed('group/eng', {}, [header, gptHide]);
    const withHeader = { ...moonshot, headers: { 'X-Team': 'blue' } };
    api.current!.seed('role/__base__', { endpoints: { custom: [withHeader] } });
    const result = await applyConfigChanges(scope, [
      upsert('Moonshot', 'Moonshot', withHeader, moonshot),
    ]);
    expect(result).toMatchObject({ issues: [], failed: [] });
    expect(api.current!.writes().at(-1)?.body?.ops).toEqual([{ op: 'unset', fieldPath: header }]);
    expect(api.current!.tombstones('group/eng')).toEqual([gptHide]);
  });

  it.each([
    ['one batch', true],
    ['field writes', false],
  ])(
    'keeps a removal inside an endpoint whose last own setting is cleared (%s)',
    async (_label, batch) => {
      api.current!.reportMeta(keyedMeta(batch));
      api.current!.seed(
        'group/eng',
        { endpoints: { custom: [{ name: 'Moonshot', titleModel: 'm' }] } },
        [header, gptHide],
      );
      const withHeader = { ...moonshot, headers: { 'X-Team': 'blue' } };
      api.current!.seed('role/__base__', { endpoints: { custom: [withHeader] } });
      const result = await applyConfigChanges(scope, [
        upsert('Moonshot', 'Moonshot', moonshot, { ...moonshot, titleModel: 'm' }),
      ]);
      expect(result).toMatchObject({ applied: 1, issues: [], failed: [], skipped: [] });
      expect(api.current!.tombstones('group/eng').sort()).toEqual([gptHide, header].sort());
      expect(api.current!.stored('group/eng')).not.toHaveProperty('endpoints.custom.0');
    },
  );

  it('rolls a reset by key back with the removals inside it when writing one again fails', async () => {
    api.current!.reportMeta(keyedMeta(false));
    const own = { endpoints: { custom: [{ name: 'Moonshot', titleModel: 'm' }] } };
    api.current!.seed('group/eng', own, [header, gptHide]);
    const withHeader = { ...moonshot, headers: { 'X-Team': 'blue' } };
    api.current!.seed('role/__base__', { endpoints: { custom: [withHeader] } });
    let failed = false;
    api.current!.setOverride((request) => {
      if (failed || request.method !== 'POST' || !request.path.endsWith('/tombstone')) return;
      failed = true;
      return { status: 500, body: { error: 'boom' } };
    });
    const result = await applyConfigChanges(scope, [
      upsert('Moonshot', 'Moonshot', moonshot, { ...moonshot, titleModel: 'm' }),
    ]);
    expect(result).toMatchObject({ compensated: true, failed: [{ code: 'WRITE_FAILED' }] });
    expect(api.current!.stored('group/eng')).toEqual(own);
    expect(api.current!.tombstones('group/eng').sort()).toEqual([gptHide, header].sort());
  });

  it('rolls an unhide by key back with the own value it reset when a later write fails', async () => {
    api.current!.reportMeta(keyedMeta(false));
    const own = {
      endpoints: { custom: [{ name: 'Moonshot', titleModel: 'm', headers: { 'X-Team': 'red' } }] },
    };
    api.current!.seed('group/eng', own, [header]);
    const withHeader = { ...moonshot, headers: { 'X-Team': 'blue' } };
    api.current!.seed('role/__base__', { endpoints: { custom: [withHeader] } });
    api.current!.setOverride((request) => {
      if (request.method !== 'POST' || !request.path.endsWith('/tombstone')) return;
      if (request.body?.fieldPath !== gptHide) return;
      return { status: 500, body: { error: 'boom' } };
    });
    const result = await applyConfigChanges(scope, [
      { op: 'untombstone', path: header },
      { op: 'tombstone', path: gptHide },
    ]);
    expect(result).toMatchObject({ compensated: true, failed: [{ code: 'WRITE_FAILED' }] });
    expect(api.current!.stored('group/eng')).toEqual(own);
    expect(api.current!.tombstones('group/eng')).toEqual([header]);
  });

  it("carries a renamed endpoint's stored key through the PATCH hint before change batches", async () => {
    api.current!.reportMeta(keyedMeta(false));
    const stored = { name: 'Secret EP', baseURL: 'https://s', models, apiKey: 'enc:sk-ep' };
    api.current!.seed('role/__base__', { endpoints: { custom: [stored] } });
    const loaded = { name: 'Secret EP', baseURL: 'https://s', models, apiKeyPreview: 'sk-...' };
    const result = await applyConfigChanges(base, [
      upsert('Renamed EP', 'Secret EP', { ...loaded, name: 'Renamed EP' }, loaded),
    ]);
    expect(result).toMatchObject({ issues: [], failed: [], skipped: [] });
    const [patch] = api.current!.writes();
    expect(patch.body?.renames).toEqual([
      { path: 'endpoints.custom', previousName: 'Secret EP', name: 'Renamed EP' },
    ]);
    expect(api.current!.stored()).toEqual({
      endpoints: { custom: [{ ...stored, name: 'Renamed EP' }] },
    });
  });

  it.each([
    ['duplicate_source', 'rename_duplicate_source'],
    ['duplicate_target', 'rename_duplicate_target'],
    ['target_exists', 'rename_target_exists'],
    ['something_new', 'rename_invalid'],
  ])('shows a refused hint (%s) on the renamed endpoint name', async (reason, code) => {
    api.current!.reportMeta(keyedMeta(false));
    const stored = { name: 'Secret EP', baseURL: 'https://s', models, apiKey: 'enc:sk-ep' };
    api.current!.seed('role/__base__', { endpoints: { custom: [stored] } });
    api.current!.setOverride((request) =>
      request.method === 'PATCH'
        ? {
            status: 400,
            body: { error: 'Invalid rename hint', code: 'CONFIG_RENAME_INVALID', reason },
          }
        : undefined,
    );
    const loaded = { name: 'Secret EP', baseURL: 'https://s', models, apiKeyPreview: 'sk-...' };
    const result = await applyConfigChanges(base, [
      upsert('Renamed EP', 'Secret EP', { ...loaded, name: 'Renamed EP' }, loaded),
    ]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom',
        code,
        entryIdentity: 'Renamed EP',
        entryPath: 'name',
        params: { name: 'Renamed EP', previous: 'Secret EP' },
      }),
    ]);
    expect(api.current!.stored()).toEqual({ endpoints: { custom: [stored] } });
  });
});
