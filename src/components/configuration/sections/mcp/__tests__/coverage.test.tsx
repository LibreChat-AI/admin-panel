import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { HiddenFields } from '@/test/coverage';
import type * as t from '@/types';
import {
  COVERAGE_TEST_TIMEOUT_MS,
  UNKNOWN_KEY,
  SYNTHETIC_FLAG,
  SYNTHETIC_TEXT,
  SYNTHETIC_GROUP,
  SYNTHETIC_VALUE,
  turnOn,
  typeInto,
  planWrites,
  sampleValue,
  staleHidden,
  objectFields,
  editSynthetic,
  missingLeaves,
  renderedLeaves,
  objectDataPath,
  findSchemaField,
  unknownSettingsAt,
  withSyntheticFields,
} from '@/test/coverage';
import { renderTab, PAGE_TREE, RAW_TREE } from '@/test/page';
import { setValueAtPath } from '@/utils';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

const SERVERS = findSchemaField(RAW_TREE, 'mcpServers')!;
const SETTINGS = findSchemaField(RAW_TREE, 'mcpSettings')!;
const ROOTS = [SERVERS, SETTINGS];
const ENTRY = sampleValue(SERVERS) as t.ConfigRecord;
const FULL: t.ConfigRecord = {
  ...(Object.values(ENTRY)[0] as t.ConfigRecord),
  url: 'https://mcp.example.com/mcp',
};

const PROCESS_KEYS = ['command', 'args', 'env', 'stderr', 'cwd'];
const HTTP_KEYS = ['url', 'headers', 'requestHeaders', 'proxy'];
const AUTH_KEYS = ['apiKey', 'oauth', 'oauth_headers', 'obo', 'requiresOAuth'];

/** A server with every setting but the keys of the other transports and auth methods. */
function server(type: string, omit: string[], extra: t.ConfigRecord = {}): t.ConfigRecord {
  return {
    ...Object.fromEntries(Object.entries(FULL).filter(([key]) => !omit.includes(key))),
    type,
    ...extra,
  };
}

const API_KEY_SERVER = server(
  'streamable-http',
  [...PROCESS_KEYS, 'oauth', 'oauth_headers', 'obo', 'requiresOAuth'],
  {
    apiKey: { ...(FULL.apiKey as t.ConfigRecord), source: 'admin', authorization_type: 'custom' },
  },
);
const OAUTH_SERVER = server('sse', [...PROCESS_KEYS, 'apiKey', 'obo']);
const OBO_SERVER = server('streamable-http', [
  ...PROCESS_KEYS,
  'apiKey',
  'oauth',
  'oauth_headers',
  'requiresOAuth',
]);
const STDIO_SERVER = server('stdio', [...HTTP_KEYS, ...AUTH_KEYS]);

/** One server per transport and auth method, so every method's form is open somewhere. */
const SERVERS_YAML: t.ConfigRecord = {
  mcpServers: {
    keyed: API_KEY_SERVER,
    oauthed: OAUTH_SERVER,
    delegated: OBO_SERVER,
    local: STDIO_SERVER,
  },
  mcpSettings: sampleValue(SETTINGS),
};

/** What each test server shows: the server the synthetic and unknown keys are added to. */
const SERVER_FOR: Readonly<Record<string, string>> = {
  'mcpServers.{}.oauth': 'oauthed',
  'mcpServers.{}.obo': 'delegated',
};

const HIDDEN: HiddenFields = {};

function renderMcp(options: Omit<Parameters<typeof renderTab>[0], 'tab'>) {
  return renderTab({ tab: 'mcp', expandAll: true, ...options });
}

describe('MCP tab: every schema field is reachable', () => {
  it('renders every leaf of the servers (each transport and auth method) and the settings', () => {
    renderMcp({ yaml: SERVERS_YAML });
    const shown = ROOTS.flatMap((root) => renderedLeaves(root, SERVERS_YAML));
    expect(ROOTS.flatMap((root) => missingLeaves(root, shown, HIDDEN))).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden(ROOTS, HIDDEN)).toEqual([]);
  });
});

/** The yaml with only the server a parent's settings show on, and its data path. */
function fixtureFor(field: t.SchemaField): { yaml: t.ConfigRecord; base: string } {
  if (!field.path.startsWith('mcpServers')) {
    const yaml = { mcpSettings: SERVERS_YAML.mcpSettings };
    return { yaml, base: objectDataPath(field, yaml) };
  }
  const name = SERVER_FOR[field.path] ?? 'keyed';
  const yaml = {
    mcpServers: { [name]: (SERVERS_YAML.mcpServers as t.ConfigRecord)[name] },
  };
  return { yaml, base: objectDataPath(field, yaml) };
}

const OBJECTS = ROOTS.flatMap(objectFields);

describe('MCP tab: settings a newer schema adds', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: get a control, and an edit is saved at their path',
    (_path, field) => {
      const { yaml, base } = fixtureFor(field);
      const view = renderMcp({ tree: withSyntheticFields(PAGE_TREE, field.path), yaml });
      expect(editSynthetic(base, view.plan)).toEqual([]);
    },
  );

  it('in Create MCP server: get a control, and the new server saves them', () => {
    const view = renderMcp({ tree: withSyntheticFields(PAGE_TREE, 'mcpServers') });
    fireEvent.click(screen.getByRole('button', { name: 'Create MCP server' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('#mcpDraft-name')!, { target: { value: 'fresh' } });
    typeInto('mcpDraft.url', 'https://mcp.example.com/mcp');
    typeInto(`mcpDraft.${SYNTHETIC_TEXT}`, SYNTHETIC_VALUE);
    turnOn(`mcpDraft.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const plan = view.plan();
    expect(planWrites(plan, `mcpServers.fresh.${SYNTHETIC_TEXT}`, SYNTHETIC_VALUE)).toBe(true);
    expect(planWrites(plan, `mcpServers.fresh.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`, true)).toBe(
      true,
    );
  });
});

describe('MCP tab: keys the schema does not know', () => {
  it.each(OBJECTS.map((field) => [field.path, field] as const))(
    'under %s: are listed read-only',
    (_path, field) => {
      const { yaml, base } = fixtureFor(field);
      renderMcp({ yaml: setValueAtPath(yaml, `${base}.${UNKNOWN_KEY}`, 'kept as is') });
      const list = unknownSettingsAt(base);
      expect(list).not.toBeNull();
      expect(list).toHaveTextContent(UNKNOWN_KEY);
      expect(list).toHaveTextContent('kept as is');
    },
  );
});
