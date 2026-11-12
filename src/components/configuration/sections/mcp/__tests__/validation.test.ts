import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { ADMIN_API_KEY_FIELD, keepStoredPreviews, validateMcpCrossField } from '../validation';

describe('validateMcpCrossField', () => {
  it('needs a key for a new server whose API key the admin provides (a duplicate copies no stored key)', () => {
    const edits: Array<[string, string]> = [
      ['mcpServers.docs-copy.type', 'streamable-http'],
      ['mcpServers.docs-copy.url', 'https://docs.example.com/mcp'],
      ['mcpServers.docs-copy.apiKey.source', 'admin'],
      ['mcpServers.docs-copy.apiKey.authorization_type', 'bearer'],
    ];
    expect(validateMcpCrossField({}, edits)).toEqual([
      { entryKey: 'docs-copy', missingField: ADMIN_API_KEY_FIELD },
    ]);
    expect(validateMcpCrossField({}, [...edits, ['mcpServers.docs-copy.apiKey.key', 'k']])).toEqual(
      [],
    );
    expect(
      validateMcpCrossField({}, [
        ...edits.slice(0, 2),
        ['mcpServers.docs-copy.apiKey.source', 'user'],
      ]),
    ).toEqual([]);
  });

  it('accepts a stored key (its masked preview) and leaves other edits of a saved server alone', () => {
    const stored = {
      type: 'streamable-http',
      url: 'https://docs.example.com/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
    };
    expect(
      validateMcpCrossField({ docs: stored }, [['mcpServers.docs.apiKey.source', 'admin']]),
    ).toEqual([]);
    const keyless = { ...stored, apiKey: { source: 'user', authorization_type: 'bearer' } };
    expect(
      validateMcpCrossField({ docs: keyless }, [['mcpServers.docs.apiKey.source', 'admin']]),
    ).toEqual([{ entryKey: 'docs', missingField: ADMIN_API_KEY_FIELD }]);
    expect(validateMcpCrossField({ docs: keyless }, [['mcpServers.docs.timeout', 60000]])).toEqual(
      [],
    );
  });

  it('keeps a stored key whose holder the edits write again, as LibreChat keeps it', () => {
    const stored = {
      type: 'streamable-http',
      url: 'https://docs.example.com/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
    };
    const back: Array<[string, t.ConfigValue]> = [
      ['mcpServers.docs.apiKey', undefined],
      ['mcpServers.docs.apiKey.source', 'admin'],
      ['mcpServers.docs.apiKey.authorization_type', 'bearer'],
    ];
    expect(validateMcpCrossField({ docs: stored }, back)).toEqual([]);
    const rewritten: Array<[string, t.ConfigValue]> = [
      ['mcpServers.docs', undefined],
      ['mcpServers.docs.type', 'streamable-http'],
      ['mcpServers.docs.url', 'https://docs.example.com/mcp'],
      ['mcpServers.docs.apiKey.source', 'admin'],
    ];
    expect(validateMcpCrossField({ docs: stored }, rewritten)).toEqual([]);
  });

  it('takes a removed stored key away with its preview, leaving an admin key missing', () => {
    const stored = {
      type: 'streamable-http',
      url: 'https://docs.example.com/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
    };
    expect(
      validateMcpCrossField({ docs: stored }, [
        ['mcpServers.docs.apiKey.key', undefined],
        ['mcpServers.docs.apiKey.source', 'admin'],
      ]),
    ).toEqual([{ entryKey: 'docs', missingField: ADMIN_API_KEY_FIELD }]);
  });

  it('needs a renamed server to re-enter a secret its saved name stores (OAuth client secret)', () => {
    const saved = {
      docs: {
        type: 'streamable-http',
        url: 'https://docs.example.com/mcp',
        oauth: { client_id: 'id', client_secretPreview: 'sec...1234' },
      },
    };
    const renamed: Array<[string, t.ConfigValue]> = [
      ['mcpServers.docs', undefined],
      ['mcpServers.kb.type', 'streamable-http'],
      ['mcpServers.kb.url', 'https://docs.example.com/mcp'],
      ['mcpServers.kb.oauth.client_id', 'id'],
    ];
    const renames = { 'mcpServers.kb': 'mcpServers.docs' };
    expect(validateMcpCrossField(saved, renamed, undefined, renames)).toEqual([
      { entryKey: 'kb', missingField: 'oauth.client_secret', renamedFrom: 'docs' },
    ]);
    expect(
      validateMcpCrossField(
        saved,
        [...renamed, ['mcpServers.kb.oauth.client_secret', 'new-secret']],
        undefined,
        renames,
      ),
    ).toEqual([]);
    expect(validateMcpCrossField(saved, renamed)).toEqual([]);
  });

  it('asks for no secret of an authentication the renamed server no longer uses', () => {
    const saved = {
      docs: {
        type: 'streamable-http',
        url: 'https://docs.example.com/mcp',
        oauth: { client_id: 'id', client_secretPreview: 'sec...1234' },
      },
      kb: {
        type: 'streamable-http',
        url: 'https://kb.example.com/mcp',
        apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
      },
    };
    const renamedWithoutAuth: Array<[string, t.ConfigValue]> = [
      ['mcpServers.docs', undefined],
      ['mcpServers.docs2.type', 'streamable-http'],
      ['mcpServers.docs2.url', 'https://docs.example.com/mcp'],
    ];
    const renames = { 'mcpServers.docs2': 'mcpServers.docs', 'mcpServers.kb2': 'mcpServers.kb' };
    expect(validateMcpCrossField(saved, renamedWithoutAuth, undefined, renames)).toEqual([]);
    const userKey: Array<[string, t.ConfigValue]> = [
      ['mcpServers.kb', undefined],
      ['mcpServers.kb2.type', 'streamable-http'],
      ['mcpServers.kb2.url', 'https://kb.example.com/mcp'],
      ['mcpServers.kb2.apiKey.source', 'user'],
      ['mcpServers.kb2.apiKey.authorization_type', 'bearer'],
    ];
    expect(validateMcpCrossField(saved, userKey, undefined, renames)).toEqual([]);
    const adminKey = userKey.map(([path, value]): [string, t.ConfigValue] =>
      path.endsWith('.source') ? [path, 'admin'] : [path, value],
    );
    expect(validateMcpCrossField(saved, adminKey, undefined, renames)).toEqual([
      { entryKey: 'kb2', missingField: ADMIN_API_KEY_FIELD },
    ]);
  });

  it('flags an existing sse entry whose transport is changed to stdio without command/args', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.type', 'stdio']]);
    expect(errors.length).toBe(1);
    expect(errors[0].entryKey).toBe('foo');
    expect(errors[0].missingField).toBe('command');
  });

  it('passes when a transport switch is accompanied by the new required fields', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [
      ['mcpServers.foo.type', 'stdio'],
      ['mcpServers.foo.command', 'node'],
      ['mcpServers.foo.args', ['index.js']],
    ]);
    expect(errors).toEqual([]);
  });

  it('treats http as streamable-http and ignores entries with no edits', () => {
    const baseline = {
      foo: { type: 'streamable-http', url: 'https://x.example.com' },
      bar: { type: 'stdio', command: 'node', args: ['x.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.type', 'http']]);
    expect(errors).toEqual([]);
  });

  it('does not flag a deleted entry', () => {
    const baseline = {
      foo: { type: 'sse', url: 'https://x.example.com' },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo', undefined]]);
    expect(errors).toEqual([]);
  });

  it('treats a scope-mode leaf reset as revealing the inherited base value', () => {
    /** In scope mode: scopeBaseline has the scope-overridden url; configValues (base) has the inherited url. Resetting mcpServers.foo.url should reveal the base url, so the validator must not flag missing url. */
    const scopeBaseline = {
      foo: { type: 'sse', url: 'https://scope-override.example.com' },
    };
    const baseFallback = {
      foo: { type: 'sse', url: 'https://base.example.com' },
    };
    const errors = validateMcpCrossField(
      scopeBaseline,
      [['mcpServers.foo.url', undefined]],
      baseFallback,
    );
    expect(errors).toEqual([]);
  });

  it('still flags a scope reset when no base inheritance is available', () => {
    const scopeBaseline = {
      foo: { type: 'sse', url: 'https://scope-only.example.com' },
    };
    const baseFallback = {};
    const errors = validateMcpCrossField(
      scopeBaseline,
      [['mcpServers.foo.url', undefined]],
      baseFallback,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].missingField).toBe('url');
  });

  it('treats a base-mode leaf reset on a YAML-defined entry as revealing the YAML value when the YAML map is supplied as resetFallback', () => {
    /** In base mode the admin panel writes to the base config override doc; a DELETE on a field path reveals the underlying YAML value. With the YAML map fed in as resetFallback the validator should see the inherited value and not flag the field as missing. */
    const baseline = {
      kapa: { type: 'stdio', command: 'node-overridden', args: ['index.js'] },
    };
    const yamlFallback = {
      kapa: { type: 'stdio', command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(
      baseline,
      [['mcpServers.kapa.command', undefined]],
      yamlFallback,
    );
    expect(errors).toEqual([]);
  });

  it('accepts an empty array for stdio args (the Zod schema requires presence but allows []) without flagging it as missing', () => {
    const baseline = {
      foo: { type: 'stdio', command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.args', []]]);
    expect(errors).toEqual([]);
  });

  it('flags a stdio-by-inference entry whose command is cleared, falling back to the baseline transport when the merged entry loses its discriminator', () => {
    /** YAML can omit `type` for stdio (the backend Zod schema defaults it). The renderer's transport inference relies on `command` to identify stdio in that case. When the user clears `command`, the merged entry has no discriminator and the inferred transport is empty. Without a baseline fallback the validator skipped the required-field check and let the broken entry save. */
    const baseline = {
      foo: { command: 'node', args: ['index.js'] },
    };
    const errors = validateMcpCrossField(baseline, [['mcpServers.foo.command', '']]);
    expect(errors.length).toBe(1);
    expect(errors[0].entryKey).toBe('foo');
    expect(errors[0].missingField).toBe('command');
  });
});

describe('keepStoredPreviews', () => {
  const saved = {
    url: 'https://docs.example.com/mcp',
    apiKey: { source: 'admin', keyPreview: '...4321' },
    oauth: { client_id: 'id', client_secretPreview: '...1234' },
  };

  it('puts back the preview of a stored secret whose holder the server still writes', () => {
    expect(
      keepStoredPreviews(saved, {
        url: 'https://docs.example.com/mcp',
        apiKey: { source: 'admin' },
      }),
    ).toEqual({
      url: 'https://docs.example.com/mcp',
      apiKey: { source: 'admin', keyPreview: '...4321' },
    });
  });

  it('keeps nothing for a holder the server no longer writes, or a secret it enters', () => {
    const next = {
      url: 'https://docs.example.com/mcp',
      apiKey: { source: 'admin', key: 'sk-new' },
    };
    expect(keepStoredPreviews(saved, next)).toBe(next);
  });
});
