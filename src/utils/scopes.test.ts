import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  isSameScope,
  applyScopeGates,
  formatScopeName,
  getScopeIndex,
  buildScopeIndex,
  findPriorityTies,
  findEntryOverrides,
  isCurrentSelection,
  countScopeOverrides,
  collectOverridePaths,
  compareScopePrecedence,
  scopeGateSkipReason,
  scopeOverrideEntries,
  isBasePrincipal,
  toScopeCandidate,
  listScopeOverrideItems,
  countDocumentOverrides,
} from './scopes';
import { resolveWriteRules, BUNDLED_CONFIG_FEATURES } from '@/constants';

function scope(overrides: Partial<t.ConfigScope> & Pick<t.ConfigScope, 'principalId'>) {
  return {
    principalType: PrincipalType.GROUP,
    name: overrides.principalId,
    priority: 20,
    isActive: true,
    overridePaths: [],
    tombstones: [],
    ...overrides,
  } satisfies t.ConfigScope;
}

describe('collectOverridePaths', () => {
  it('lists leaves, keeps arrays whole and skips emptied objects', () => {
    expect(
      collectOverridePaths({
        interface: { parameters: false, webSearch: { placeholder: 'x' } },
        endpoints: { custom: [{ name: 'a' }] },
        actions: {},
      }),
    ).toEqual(['interface.parameters', 'interface.webSearch.placeholder', 'endpoints.custom']);
  });
});

describe('countScopeOverrides', () => {
  it('counts leaves, tombstones, and each MCP server once', () => {
    const s = scope({
      principalId: 'eng',
      overridePaths: [
        'interface.parameters',
        'mcpServers.docs.url',
        'mcpServers.docs.type',
        'mcpServers.wiki.url',
      ],
      tombstones: ['balance.startBalance'],
    });
    expect(countScopeOverrides(s)).toBe(4);
  });

  it('is zero for a profile with nothing set', () => {
    expect(countScopeOverrides(scope({ principalId: 'empty', overridePaths: undefined }))).toBe(0);
  });

  it('counts each custom endpoint a profile overrides, as the tab badge does', () => {
    const s = scope({
      principalId: 'USER',
      overridePaths: ['endpoints.custom', 'interface.customWelcome'],
      overrideEntries: { 'endpoints.custom': ['Claude', 'Gemini'] },
    });
    expect(countScopeOverrides(s)).toBe(3);
    expect(listScopeOverrideItems(s).map((item) => [item.path, item.entry])).toEqual([
      ['endpoints.custom', 'Claude'],
      ['endpoints.custom', 'Gemini'],
      ['interface.customWelcome', undefined],
    ]);
  });

  it('lists each hide by key under its list, with the entry and the path inside it', () => {
    const s = scope({
      principalId: 'USER',
      tombstones: ['endpoints.custom["a.b"]', 'endpoints.custom["Gateway"].headers.X-Team'],
    });
    expect(listScopeOverrideItems(s).map(({ path, keyed }) => [path, keyed])).toEqual([
      ['endpoints.custom["a.b"]', { collection: 'endpoints.custom', name: 'a.b', rest: '' }],
      [
        'endpoints.custom["Gateway"].headers.X-Team',
        { collection: 'endpoints.custom', name: 'Gateway', rest: 'headers.X-Team' },
      ],
    ]);
  });
});

describe('scopeOverrideEntries', () => {
  it('names the entries stored in lists merged by entry, not in lists replaced whole', () => {
    expect(
      scopeOverrideEntries({
        endpoints: { custom: [{ name: 'Claude', modelDisplayLabel: 'C' }, { iconURL: 'x' }] },
        modelSpecs: { list: [{ name: 'spec-a', label: 'A' }] },
      }).overrideEntries,
    ).toEqual({ 'endpoints.custom': ['Claude'] });
  });

  it('names Azure groups one by one only where the panel edits them by name', () => {
    const overrides = {
      endpoints: { azureOpenAI: { groups: [{ group: 'eastus', models: { mini: true } }] } },
    };
    const inert = { ...BUNDLED_CONFIG_FEATURES, azureGroupMergeKey: true, azureGroupSecrets: true };
    expect(scopeOverrideEntries(overrides).overrideEntries).toEqual({});
    expect(scopeOverrideEntries(overrides, inert).overrideEntries).toEqual({});
    expect(
      scopeOverrideEntries(overrides, { ...inert, endpointRederive: true }).overrideEntryPaths,
    ).toEqual({ 'endpoints.azureOpenAI.groups': { eastus: ['models.mini'] } });
  });

  it('lists the settings each entry sets, its name left out', () => {
    expect(
      scopeOverrideEntries({
        endpoints: {
          custom: [
            { name: 'Claude', baseURL: 'https://c', addParams: { anthropicApiUrl: 'https://a' } },
            { name: 'Gemini' },
          ],
        },
      }).overrideEntryPaths,
    ).toEqual({
      'endpoints.custom': { Claude: ['baseURL', 'addParams.anthropicApiUrl'], Gemini: [] },
    });
  });
});

describe('formatScopeName', () => {
  it('appends the email of a user profile', () => {
    const bob = scope({
      principalType: PrincipalType.USER,
      principalId: 'u1',
      name: 'Bob Test',
      email: 'bob@test.local',
    });
    expect(formatScopeName(bob)).toBe('Bob Test (bob@test.local)');
  });

  it('shows just the name when there is no email or it is the name', () => {
    expect(formatScopeName(scope({ principalId: 'g', name: 'Design' }))).toBe('Design');
    expect(formatScopeName(scope({ principalId: 'u', name: 'a@b.c', email: 'a@b.c' }))).toBe(
      'a@b.c',
    );
  });
});

describe('isCurrentSelection / isSameScope', () => {
  const eng = scope({ principalId: 'eng' });
  it('treats the same principal as the same profile', () => {
    const renamed = scope({ ...eng, name: 'renamed', priority: 5 });
    expect(isSameScope(eng, renamed)).toBe(true);
    expect(isSameScope(eng, scope({ principalId: 'design' }))).toBe(false);
  });

  it('matches base to base and a profile to the same profile only', () => {
    expect(isCurrentSelection({ type: 'BASE' }, { type: 'BASE' })).toBe(true);
    expect(isCurrentSelection({ type: 'BASE' }, { type: 'SCOPE', scope: eng })).toBe(false);
    expect(isCurrentSelection({ type: 'SCOPE', scope: eng }, { type: 'BASE' })).toBe(false);
    expect(
      isCurrentSelection({ type: 'SCOPE', scope: eng }, { type: 'SCOPE', scope: { ...eng } }),
    ).toBe(true);
  });
});

describe('findPriorityTies', () => {
  const eng = scope({ principalId: 'eng', overridePaths: ['interface.parameters'] });
  const design = scope({ principalId: 'design', overridePaths: ['interface'] });
  const qa = scope({ principalId: 'qa', overridePaths: ['balance.startBalance'] });
  const low = scope({ principalId: 'low', priority: 10, overridePaths: ['interface.parameters'] });
  const off = scope({ principalId: 'off', isActive: false, overridePaths: ['interface'] });

  it('reports active same-priority profiles with the settings both change', () => {
    const ties = findPriorityTies(eng, [eng, design, qa, low, off]);
    expect(ties.map((tie) => [tie.scope.principalId, tie.sharedPaths])).toEqual([
      ['design', ['interface.parameters']],
      ['qa', []],
    ]);
  });

  it('ignores profiles that never apply to the same user', () => {
    const roleA = scope({ principalType: PrincipalType.ROLE, principalId: 'USER', priority: 10 });
    const roleB = scope({ principalType: PrincipalType.ROLE, principalId: 'ADMIN', priority: 10 });
    const user = scope({ principalType: PrincipalType.USER, principalId: 'u1', priority: 10 });
    expect(findPriorityTies(roleA, [roleA, roleB]).length).toBe(0);
    expect(findPriorityTies(roleA, [roleA, user]).map((tie) => tie.scope.principalId)).toEqual([
      'u1',
    ]);
  });

  it('reports nothing for an inactive profile', () => {
    expect(findPriorityTies(off, [eng, design, off])).toEqual([]);
  });

  it('says which profile applies last on equal priority (deterministicPrecedence)', () => {
    const role = scope({
      _id: 'b',
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      overridePaths: ['interface.parameters'],
    });
    const older = scope({ _id: 'a', principalId: 'older', overridePaths: ['interface'] });
    const newer = scope({ _id: 'c', principalId: 'newer', overridePaths: ['interface'] });
    const ties = findPriorityTies(older, [role, older, newer]);
    expect(ties.map((tie) => [tie.scope.principalId, tie.appliesAfter])).toEqual([
      ['USER', true],
      ['newer', false],
    ]);
    expect(findPriorityTies(role, [role, older])[0].appliesAfter).toBe(false);
  });
});

describe('compareScopePrecedence', () => {
  it('orders by priority, then roles before groups before users, then the older profile first', () => {
    const user = scope({ _id: 'a', principalType: PrincipalType.USER, principalId: 'u1' });
    const role = scope({ _id: 'z', principalType: PrincipalType.ROLE, principalId: 'USER' });
    const groupOld = scope({ _id: '6a00', principalId: 'old' });
    const groupNew = scope({ _id: '6a01', principalId: 'new' });
    const low = scope({
      _id: 'zz',
      principalType: PrincipalType.USER,
      principalId: 'u2',
      priority: 5,
    });
    const ordered = [user, groupNew, role, low, groupOld].sort(compareScopePrecedence);
    expect(ordered.map((s) => s.principalId)).toEqual(['u2', 'USER', 'old', 'new', 'u1']);
    expect(compareScopePrecedence(groupOld, { ...groupOld })).toBe(0);
  });
});

describe('buildScopeIndex', () => {
  it('indexes each override and hidden path with its ancestors, lowest priority first', () => {
    const user = scope({
      principalType: PrincipalType.USER,
      principalId: 'u1',
      priority: 100,
      overridePaths: ['interface.parameters'],
    });
    const role = scope({
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      priority: 10,
      overridePaths: ['interface.parameters', 'interface.presets'],
      tombstones: ['balance.startBalance'],
    });
    const { byPath, scopes } = buildScopeIndex([user, role]);
    expect(scopes.map((s) => s.principalId)).toEqual(['USER', 'u1']);
    expect(byPath.get('interface.parameters')?.map((s) => s.principalId)).toEqual(['USER', 'u1']);
    expect(byPath.get('interface')?.map((s) => s.principalId)).toEqual(['USER', 'u1']);
    expect(byPath.get('balance.startBalance')?.map((s) => s.principalId)).toEqual(['USER']);
    expect(byPath.get('interface.webSearch')).toBeUndefined();
  });
});

describe('findEntryOverrides', () => {
  const role = scope({
    principalType: PrincipalType.ROLE,
    principalId: 'USER',
    priority: 10,
    overridePaths: ['mcpServers.acme.title', 'endpoints.custom'],
    overrideEntries: { 'endpoints.custom': ['AcmeLLM'] },
    overrideEntryPaths: { 'endpoints.custom': { AcmeLLM: ['baseURL'] } },
    storedSecrets: [
      { path: 'mcpServers.acme.apiKey.key' },
      { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'AcmeLLM' } },
    ],
  });
  const keyOnly = scope({
    principalId: 'eng',
    storedSecrets: [
      { path: 'mcpServers.vault.oauth.client_secret' },
      { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'BetaLLM' } },
    ],
  });
  const hiding = scope({ principalId: 'ops', tombstones: ['mcpServers.acme'] });
  const partial = scope({ principalId: 'qa', tombstones: ['mcpServers.acme.headers.X-Team'] });
  const scopes = [role, keyOnly, hiding, partial];
  const found = (collection: string, identity: string) =>
    findEntryOverrides(scopes, collection, identity).map(({ scope: s, ...rest }) => [
      s.principalId,
      rest,
    ]);

  it('finds the profiles that override an MCP server by name, a stored secret, a hide or a hidden part', () => {
    expect(found('mcpServers', 'acme')).toEqual([
      ['USER', { overrides: true, secrets: ['apiKey.key'], settings: ['title'], hidden: false }],
      ['ops', { overrides: false, secrets: [], settings: [], hidden: true }],
      ['qa', { overrides: true, secrets: [], settings: [], hidden: false }],
    ]);
  });

  it('counts a secret alone as an override, its preview stripped from the override paths', () => {
    expect(found('mcpServers', 'vault')).toEqual([
      ['eng', { overrides: true, secrets: ['oauth.client_secret'], settings: [], hidden: false }],
    ]);
    expect(found('endpoints.custom', 'BetaLLM')).toEqual([
      ['eng', { overrides: true, secrets: ['apiKey'], settings: [], hidden: false }],
    ]);
  });

  it('finds custom endpoint overrides by entry name, and none for another name or a name sharing a prefix', () => {
    expect(found('endpoints.custom', 'AcmeLLM')).toEqual([
      ['USER', { overrides: true, secrets: ['apiKey'], settings: ['baseURL'], hidden: false }],
    ]);
    expect(found('endpoints.custom', 'Acme')).toEqual([]);
    expect(found('mcpServers', 'acm')).toEqual([]);
  });

  it('finds the profiles that hide a custom endpoint or remove a value in it by key (keyedTombstones)', () => {
    const hides = scope({ principalId: 'ops', tombstones: ['endpoints.custom["AcmeLLM"]'] });
    const trims = scope({
      principalId: 'qa',
      tombstones: ['endpoints.custom["AcmeLLM"].headers.X-Team'],
    });
    const byKey = (keyedTombstones: boolean) =>
      findEntryOverrides([hides, trims], 'endpoints.custom', 'AcmeLLM', keyedTombstones).map(
        ({ scope: s, ...rest }) => [s.principalId, rest],
      );
    expect(byKey(true)).toEqual([
      ['ops', { overrides: false, secrets: [], settings: [], hidden: true }],
      ['qa', { overrides: true, secrets: [], settings: [], hidden: false }],
    ]);
    expect(byKey(false)).toEqual([]);
  });

  it('counts a secret a server without `recordSecrets` reads back as a plain value', () => {
    const plain = scope({
      principalId: 'legacy',
      overridePaths: ['mcpServers.acme.apiKey.key', 'mcpServers.docs.title'],
    });
    const parts = (identity: string) =>
      findEntryOverrides([plain], 'mcpServers', identity).map(({ secrets }) => secrets);
    expect(parts('acme')).toEqual([['apiKey.key']]);
    expect(parts('docs')).toEqual([[]]);
  });

  it('finds nothing in a list a profile replaces whole', () => {
    const specs = scope({
      principalId: 'specs',
      overridePaths: ['modelSpecs.list'],
      overrideEntries: { 'modelSpecs.list': ['gpt'] },
    });
    expect(findEntryOverrides([specs], 'modelSpecs.list', 'gpt')).toEqual([]);
  });
});

describe('getScopeIndex', () => {
  it('builds the index once per scopes list', () => {
    const scopes = [scope({ principalId: 'eng', overridePaths: ['interface.parameters'] })];
    expect(getScopeIndex(scopes)).toBe(getScopeIndex(scopes));
    expect(getScopeIndex([...scopes])).not.toBe(getScopeIndex(scopes));
  });
});

describe('applyScopeGates', () => {
  const sections: t.ConfigSectionConfig[] = [
    { id: 'registration', titleKey: 'r', fields: [] },
    { id: 'filters', titleKey: 'f', fields: [], readOnlyReason: 'baseOnly' },
    { id: 'turnstile', titleKey: 't', fields: [] },
    { id: 'langfuse', titleKey: 'l', fields: [] },
    { id: 'balance', titleKey: 'b', fields: [] },
    { id: 'virtual', schemaKey: 'registration', titleKey: 'v', fields: [] },
  ];

  it('returns base-mode sections untouched', () => {
    expect(applyScopeGates(sections, false)).toBe(sections);
  });

  it('gates content filters, registration, Turnstile and Langfuse in a profile', () => {
    const gated = applyScopeGates(sections, true);
    expect(gated[0].tocItems).toEqual([]);
    expect(gated[4].tocItems).toBeUndefined();
    const gates = gated.map((s) => [s.id, s.scopeGate]);
    expect(gates).toEqual([
      ['registration', 'preAuth'],
      ['filters', 'baseOnly'],
      ['turnstile', 'yamlOnly'],
      ['langfuse', 'tenantWide'],
      ['balance', undefined],
      ['virtual', 'preAuth'],
    ]);
  });
});

describe('scopeGateSkipReason', () => {
  it('skips gated sections with the reason shown in the review', () => {
    expect(scopeGateSkipReason('registration.socialLogins')).toBe('baseScope');
    expect(scopeGateSkipReason('filters.messages.unattributedAssistantContent')).toBe('baseOnly');
    expect(scopeGateSkipReason('langfuse.baseUrl')).toBe('dedicated');
    expect(scopeGateSkipReason('balance.startBalance')).toBeUndefined();
  });

  it("gates the sections the server's rules make read-only", () => {
    const rules = resolveWriteRules(
      {
        baseOnlySections: ['filters', 'turnstile'],
        baseOnlyPaths: [],
        deploymentOnlyPaths: { includedTools: 'operator' },
        derivedPaths: [],
      },
      { ...BUNDLED_CONFIG_FEATURES, preAuthBaseOverrides: true },
    );
    expect(scopeGateSkipReason('includedTools', rules)).toBe('yamlOnly');
    expect(scopeGateSkipReason('rateLimits.fileUploads.ipMax', rules)).toBeUndefined();
    expect(scopeGateSkipReason('turnstile.siteKey', rules)).toBe('yamlOnly');
    expect(scopeGateSkipReason('registration.socialLogins', rules)).toBe('baseScope');
  });
});

describe('countDocumentOverrides', () => {
  it('counts each list entry, MCP server and leaf once, as a profile summary does', () => {
    expect(
      countDocumentOverrides({
        endpoints: { custom: [{ name: 'Ollama', baseURL: 'x' }, { name: 'ollama' }] },
        mcpServers: { github: { title: 'GitHub', timeout: 5 } },
        interface: { customWelcome: 'Hi', temporaryChatRetention: 48 },
      }),
    ).toBe(5);
  });

  it('counts a withheld secret by its preview, but not a preview beside a kept reference', () => {
    expect(
      countDocumentOverrides({
        webSearch: {
          searchProvider: 'serper',
          serperApiKey: '${SERPER_API_KEY}',
          serperApiKeyPreview: '',
          jinaApiKeyPreview: 'jina_...abcd',
        },
      }),
    ).toBe(3);
  });

  it('counts nothing for an empty document', () => {
    expect(countDocumentOverrides({})).toBe(0);
  });
});

describe('toScopeCandidate / isBasePrincipal', () => {
  it("lists a profile's principal with its name and a user's email", () => {
    expect(
      toScopeCandidate(
        scope({ principalType: PrincipalType.USER, principalId: 'u1', name: 'Jane', email: 'j@x' }),
      ),
    ).toEqual({ principalType: 'user', principalId: 'u1', name: 'Jane', email: 'j@x' });
    expect(toScopeCandidate(scope({ principalId: 'g1', name: 'Eng' }))).toEqual({
      principalType: 'group',
      principalId: 'g1',
      name: 'Eng',
    });
  });

  it('recognizes only the Base document', () => {
    expect(isBasePrincipal({ principalType: PrincipalType.ROLE, principalId: '__base__' })).toBe(
      true,
    );
    expect(isBasePrincipal({ principalType: PrincipalType.ROLE, principalId: 'USER' })).toBe(false);
    expect(isBasePrincipal({ principalType: PrincipalType.GROUP, principalId: '__base__' })).toBe(
      false,
    );
  });
});
