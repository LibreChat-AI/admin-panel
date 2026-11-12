import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { transportOf, isMcpFieldShown, planTransportSwitch } from '../transport';
import { authMethodOf, planAuthSwitch, lockedAuthMethod } from '../auth';
import { copyName, serverNameProblem } from '../names';
import { buildServerList, leafEntries } from '../list';

describe('transportOf', () => {
  it('reads the type, keeping YAML `http` as written', () => {
    expect(transportOf({ type: 'http', url: 'https://x.dev' })).toBe('http');
    expect(transportOf({ type: 'streamable-http', url: 'https://x.dev' })).toBe('streamable-http');
  });

  it("infers what LibreChat's schema union infers when the type is left out", () => {
    expect(transportOf({ command: 'npx', args: [] })).toBe('stdio');
    expect(transportOf({ url: 'wss://x.dev/ws' })).toBe('websocket');
    expect(transportOf({ url: 'https://x.dev/sse' })).toBe('sse');
    expect(transportOf({ title: 'nothing' })).toBe('');
    expect(transportOf('not an entry')).toBe('');
  });
});

describe('isMcpFieldShown (MCP-3)', () => {
  it('shows request headers, proxy and OBO only for SSE and Streamable HTTP', () => {
    for (const key of ['requestHeaders', 'proxy', 'obo', 'headers']) {
      expect(isMcpFieldShown(key, 'sse')).toBe(true);
      expect(isMcpFieldShown(key, 'streamable-http')).toBe(true);
      expect(isMcpFieldShown(key, 'http')).toBe(true);
      expect(isMcpFieldShown(key, 'websocket')).toBe(false);
      expect(isMcpFieldShown(key, 'stdio')).toBe(false);
    }
  });

  it('never shows process fields on remote servers (cwd on HTTP made saves fail)', () => {
    for (const key of ['command', 'args', 'env', 'cwd', 'stderr']) {
      expect(isMcpFieldShown(key, 'stdio')).toBe(true);
      expect(isMcpFieldShown(key, 'streamable-http')).toBe(false);
      expect(isMcpFieldShown(key, 'websocket')).toBe(false);
    }
  });

  it('shows authentication and its timeouts only for HTTP transports', () => {
    for (const key of [
      'oauth',
      'apiKey',
      'requiresOAuth',
      'sseReadTimeout',
      'oauthRefreshWaitTimeout',
    ]) {
      expect(isMcpFieldShown(key, 'sse')).toBe(true);
      expect(isMcpFieldShown(key, 'stdio')).toBe(false);
      expect(isMcpFieldShown(key, 'websocket')).toBe(false);
    }
  });

  it('shows display fields everywhere and inspector data nowhere', () => {
    expect(isMcpFieldShown('title', 'stdio')).toBe(true);
    expect(isMcpFieldShown('chatMenu', 'websocket')).toBe(true);
    expect(isMcpFieldShown('tools', 'sse')).toBe(false);
    expect(isMcpFieldShown('source', 'stdio')).toBe(false);
  });
});

describe('planTransportSwitch (MCP-2)', () => {
  const entry: t.ConfigRecord = {
    type: 'streamable-http',
    url: 'https://x.dev/mcp',
    headers: { 'X-Key': 'k' },
    oauth: { client_id: 'abc' },
    requestHeaders: {},
    title: 'X',
  };

  it('drops what the new transport does not read, never the type or display fields', () => {
    const plan = planTransportSwitch(entry, 'websocket', undefined);
    expect(plan.prune.sort()).toEqual(['headers', 'oauth']);
    expect(plan.set).toEqual([['type', 'websocket']]);
    expect(plan.locked).toEqual([]);
  });

  it('keeps headers and OAuth between SSE and Streamable HTTP', () => {
    expect(planTransportSwitch(entry, 'sse', undefined).prune).toEqual([]);
  });

  it('drops a leaked process field (stdio command) when a new server switches to HTTP', () => {
    const plan = planTransportSwitch(
      { type: 'stdio', command: 'npx' },
      'streamable-http',
      undefined,
    );
    expect(plan.prune).toEqual(['command']);
  });

  it('is blocked by fields the layer beneath sets', () => {
    const plan = planTransportSwitch(entry, 'websocket', { headers: { 'X-Key': 'k' } });
    expect(plan.locked).toEqual(['headers']);
  });
});

describe('auth methods (MCP-4)', () => {
  it('reads the method from the settings present', () => {
    expect(authMethodOf({ url: 'x' })).toBe('none');
    expect(authMethodOf({ apiKey: { source: 'admin', authorization_type: 'bearer' } })).toBe(
      'apiKey',
    );
    expect(authMethodOf({ oauth: { client_id: 'a' } })).toBe('oauth');
    expect(authMethodOf({ requiresOAuth: true })).toBe('oauth');
    expect(authMethodOf({ requiresOAuth: false })).toBe('none');
    expect(authMethodOf({ obo: { scopes: 'api://x/.default' } })).toBe('obo');
    expect(authMethodOf({ oauth: {} })).toBe('none');
  });

  it('starts an API key as the admin Bearer key and removes the other methods', () => {
    const plan = planAuthSwitch(
      { oauth: { client_id: 'a' }, requiresOAuth: true },
      'apiKey',
      undefined,
    );
    expect(plan.set).toEqual([['apiKey', { source: 'admin', authorization_type: 'bearer' }]]);
    expect(plan.prune.sort()).toEqual(['oauth', 'requiresOAuth']);
    expect(plan.locked).toEqual([]);
  });

  it('keeps an existing API key when it is chosen again', () => {
    const plan = planAuthSwitch(
      { apiKey: { source: 'user', authorization_type: 'basic' } },
      'apiKey',
      undefined,
    );
    expect(plan.set).toEqual([]);
  });

  it('keeps an inherited `requiresOAuth: false` without blocking another method', () => {
    const yaml = { url: 'https://mcp.example.com', requiresOAuth: false };
    for (const next of ['apiKey', 'obo', 'none'] as const) {
      const plan = planAuthSwitch(yaml, next, yaml);
      expect(plan.locked).toEqual([]);
      expect(plan.prune).toEqual([]);
    }
    expect(planAuthSwitch(yaml, 'apiKey', yaml).set).toEqual([
      ['apiKey', { source: 'admin', authorization_type: 'bearer' }],
    ]);
    expect(lockedAuthMethod(yaml)).toBeNull();
  });

  it('cannot switch away from settings librechat.yaml defines', () => {
    const yaml = { oauth: { client_id: '${ID}' } };
    expect(planAuthSwitch({ oauth: { client_id: '${ID}' } }, 'none', yaml).locked).toEqual([
      'oauth',
    ]);
    expect(lockedAuthMethod(yaml)).toBe('oauth');
    expect(lockedAuthMethod({ url: 'x' })).toBeNull();
    expect(lockedAuthMethod(undefined)).toBeNull();
  });
});

describe('server names', () => {
  const existing = ['github', 'Docs'];
  it('requires a safe, unique name', () => {
    expect(serverNameProblem('', existing)).toBe('com_config_server_name_required');
    expect(serverNameProblem('a.b', existing)).toBe('com_config_server_name_no_dots');
    expect(serverNameProblem('$x', existing)).toBe('com_config_server_name_no_dots');
    expect(serverNameProblem('__proto__', existing)).toBe('com_config_server_name_invalid');
    expect(serverNameProblem('my server', existing)).toBe('com_config_mcp_name_chars');
    expect(serverNameProblem('a_mcp_b', existing)).toBe('com_config_mcp_name_delimiter');
    expect(serverNameProblem('github', existing)).toBe('com_config_server_name_exists');
    expect(serverNameProblem('docs', existing)).toBe('com_config_mcp_name_case');
    expect(serverNameProblem('acme-docs_2', existing)).toBeNull();
  });

  it('names a copy after the original, with a free suffix', () => {
    expect(copyName('github', new Set(['github']))).toBe('github-copy');
    expect(copyName('github', new Set(['github-copy', 'github-copy-2']))).toBe('github-copy-3');
    expect(copyName('My Server', new Set())).toBe('My-Server-copy');
    expect(copyName('Docs', new Set(['Docs', 'docs-copy']))).toBe('Docs-copy-2');
    expect(
      serverNameProblem(copyName('Docs', new Set(['Docs', 'docs-copy'])), ['Docs', 'docs-copy']),
    ).toBeNull();
  });
});

describe('buildServerList', () => {
  const saved: t.ConfigRecord = {
    github: { type: 'http', url: 'https://gh', timeout: 45000 },
    acme: { type: 'sse', url: 'https://acme' },
  };
  const lower: t.ConfigRecord = { github: { type: 'http', url: 'https://gh', timeout: 60000 } };
  const build = (editedValues: t.FlatConfigMap) =>
    buildServerList({ saved, lower, editedValues, path: 'mcpServers' });

  it('returns the saved servers unchanged without edits', () => {
    const list = build({});
    expect(list.record).toBe(saved);
    expect(list.deleted).toEqual([]);
  });

  it('applies field edits in place, keeping the order', () => {
    const list = build({ 'mcpServers.acme.title': 'Acme' });
    expect(Object.keys(list.record)).toEqual(['github', 'acme']);
    expect(list.record.acme).toEqual({ type: 'sse', url: 'https://acme', title: 'Acme' });
  });

  it('shows the value beneath for a reset field (revert to librechat.yaml)', () => {
    const list = build({ 'mcpServers.github.timeout': undefined });
    expect((list.record.github as t.ConfigRecord).timeout).toBe(60000);
  });

  it('lists a deleted server the target added as pending deletion at its place (D9)', () => {
    const list = build({ 'mcpServers.acme': undefined });
    expect(list.record.acme).toBeUndefined();
    expect(list.deleted).toEqual([{ key: 'acme', index: 1, value: saved.acme }]);
  });

  it('reverts a server the layer beneath defines instead of deleting it', () => {
    const list = build({ 'mcpServers.github': undefined });
    expect(list.record.github).toEqual(lower.github);
    expect(list.reverted.has('github')).toBe(true);
    expect(list.deleted).toEqual([]);
  });

  it('appends new servers in the order they were created', () => {
    const list = build({ 'mcpServers.zeta.url': 'https://z', 'mcpServers.alpha.url': 'https://a' });
    expect(Object.keys(list.record)).toEqual(['github', 'acme', 'zeta', 'alpha']);
  });

  it('reads a delete followed by new fields as a recreated server', () => {
    const list = build({ 'mcpServers.acme': undefined, 'mcpServers.acme.url': 'https://new' });
    expect(list.record.acme).toEqual({ url: 'https://new' });
    expect(list.deleted).toEqual([]);
  });

  it('keeps an MCP server named like a number as a record key', () => {
    const list = buildServerList({
      saved: { '2024': { url: 'https://y' } },
      lower: {},
      editedValues: { 'mcpServers.2024.title': 'Year' },
      path: 'mcpServers',
    });
    expect(list.record['2024']).toEqual({ url: 'https://y', title: 'Year' });
  });
});

describe('leafEntries', () => {
  it('lists leaves, keeping arrays and empty objects whole', () => {
    expect(leafEntries({ a: { b: 1, c: [1, 2] }, d: {} })).toEqual([
      [['a', 'b'], 1],
      [
        ['a', 'c'],
        [1, 2],
      ],
      [['d'], {}],
    ]);
  });

  it('keeps an object with a dotted key whole, so no dot-path splits the key', () => {
    const headers = { 'X-Team': 'docs', 'x.api.version': '2024-10' };
    expect(leafEntries({ url: 'https://x.dev', headers, apiKey: { source: 'admin' } })).toEqual([
      [['url'], 'https://x.dev'],
      [['headers'], headers],
      [['apiKey', 'source'], 'admin'],
    ]);
  });
});
