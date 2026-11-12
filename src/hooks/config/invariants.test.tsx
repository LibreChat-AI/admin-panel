import '@/locales/i18n';
import { useEffect, useMemo, useRef } from 'react';
import { Button, createToast } from '@clickhouse/click-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configSchema, PrincipalType } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  flattenObject,
  isConfigRecord,
  withScopeLayer,
  mergeScopeLayer,
  collectLeafPaths,
  createBaseLayers,
} from '@/utils';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { useChangeReview, useBaseOverrides } from './review';
import { createServerContract } from '@/test/fixtures';
import { applyConfigChangesFn } from '@/server';
import { getWriteRules } from '@/constants';
import { useConfigEdits } from './edits';
import { useConfigSave } from './save';

vi.mock('@/server', () => ({ applyConfigChangesFn: vi.fn(), resetBaseConfigFn: vi.fn() }));

vi.mock('@clickhouse/click-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clickhouse/click-ui')>();
  return { ...actual, createToast: vi.fn() };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPathSet = getSchemaPathSet();
const applyMock = vi.mocked(applyConfigChangesFn);
const toastMock = vi.mocked(createToast);

const saved: t.ApplyConfigChangesResult = {
  applied: 1,
  failed: [],
  warnings: [],
  issues: [],
  skipped: [],
  reported: [],
};

/**
 * librechat.yaml: an OAuth server with no secret of its own, which a profile
 * may give one, and a server with a readable `${VAR}` key.
 */
const moonshot = {
  name: 'Moonshot',
  apiKey: '${KIMI}',
  baseURL: 'https://api.moonshot.ai/v1',
  models: { default: ['kimi-k2.5'] },
};

const yaml: t.ConfigRecord = {
  endpoints: { custom: [moonshot] },
  mcpServers: {
    salesforce: {
      type: 'streamable-http',
      url: 'https://api.salesforce.com/mcp',
      oauth: { client_id: '${SALESFORCE_CLIENT_ID}' },
    },
    kb: {
      type: 'streamable-http',
      url: 'https://kb.example.com/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', key: '${KB_KEY}' },
    },
  },
};

/**
 * What Base stores: an API key server and an OAuth server, both with
 * encrypted secrets, and a URL that sends `kb` somewhere new.
 */
const baseOverrides: t.ConfigRecord = {
  endpoints: {
    custom: [
      { name: 'Moonshot', apiKeyPreview: '...3333' },
      {
        name: 'AcmeLLM',
        baseURL: 'https://api.acme.dev/v1',
        models: { default: ['acme-1'] },
        apiKeyPreview: '...7890',
      },
    ],
  },
  mcpServers: {
    kb: { url: 'https://kb2.example.com/mcp' },
    acme: {
      type: 'streamable-http',
      url: 'https://mcp.acme.dev/mcp',
      title: 'Acme',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...1234' },
    },
    oauthy: {
      type: 'streamable-http',
      url: 'https://mcp.oauthy.dev/mcp',
      title: 'OAuthy',
      oauth: { client_id: 'cid-1', client_secretPreview: '...9876' },
    },
  },
};

const userRole: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
};

/** Role USER's profile: its own client secret and title for the librechat.yaml server. */
const userProfile: t.ResolvedConfigData = {
  resolvedConfig: {},
  changedPaths: ['mcpServers.salesforce.oauth.client_secret', 'mcpServers.salesforce.title'],
  overrides: {
    mcpServers: {
      salesforce: { title: 'SF Users', oauth: { client_secretPreview: '...1111' } },
    },
  },
  tombstones: [],
};

/** What the server holds: librechat.yaml, Base's overrides and Role USER's profile. */
interface Stored {
  yaml: t.ConfigRecord;
  base: t.ConfigRecord;
  profile: t.ResolvedConfigData;
  /** What the server says it merges (the bundled rules by default). */
  rules?: t.ConfigWriteRules;
}

const STORED: Stored = { yaml, base: baseOverrides, profile: userProfile };

/** A list's entries with the key redacted where the entry stores its own (its preview stays). */
function redactedEntries(list: t.ConfigValue): t.ConfigValue {
  if (!Array.isArray(list)) return list;
  return list.map((entry) => {
    if (!isConfigRecord(entry) || entry.apiKeyPreview === undefined) return entry;
    const { apiKey: _redacted, ...rest } = entry;
    return rest;
  });
}

/**
 * The base config as LibreChat reads it back: librechat.yaml with the base
 * overrides, an entry's key redacted where Base stores its own (its preview
 * stays).
 */
function baseConfig(stored: Stored = STORED): t.ConfigRecord {
  const merged = mergeScopeLayer(stored.yaml, stored.base, [], stored.rules);
  const endpoints = isConfigRecord(merged.endpoints) ? merged.endpoints : {};
  const azure = isConfigRecord(endpoints.azureOpenAI) ? endpoints.azureOpenAI : undefined;
  return {
    ...merged,
    endpoints: {
      ...endpoints,
      ...(endpoints.custom !== undefined && { custom: redactedEntries(endpoints.custom) }),
      ...(azure && { azureOpenAI: { ...azure, groups: redactedEntries(azure.groups) } }),
    },
  };
}

interface TargetProps {
  scope?: t.ConfigScope;
  targetRevision?: string | null;
}

/** No server read: the target's revision comes from the props. */
const unread = async (): Promise<string | null> => null;

/**
 * The page's edit, save and review hooks over Base or Role USER's profile, as
 * `ConfigPage` wires them: opening another target starts a new edit session
 * and closes the review. With `read`, Base's revision is what that server read
 * returns, loaded and re-read (Reload, a save) through the base config query.
 */
function renderTargets(
  contract: t.ConfigContract,
  initialProps: TargetProps = {},
  profiles: t.ConfigScope[] = [],
  read?: () => Promise<string | null>,
  stored: Stored = STORED,
) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  const config = baseConfig(stored);
  const baseLayers = createBaseLayers(
    {
      config,
      yamlConfig: stored.yaml,
      yamlPaths: collectLeafPaths(stored.yaml),
      dbOverrides: stored.base,
      dbTombstones: [],
      schemaDefaults: {},
    },
    schemaPathSet,
  );
  return renderHook(
    ({ scope, targetRevision }: TargetProps) => {
      const loaded = useQuery({
        queryKey: ['baseConfig'],
        queryFn: read ?? unread,
        enabled: read !== undefined,
      });
      const isEditingScope = scope !== undefined;
      const valueLayers = useMemo(
        () =>
          scope ? withScopeLayer(baseLayers, scope, stored.profile, schemaPathSet) : baseLayers,
        [scope],
      );
      const active = valueLayers.effective ?? {};
      const flat = useMemo(() => flattenObject(active), [active]);
      const edits = useConfigEdits({
        isEditingScope,
        flatBaseline: flat,
        scopeResolvedValues: isEditingScope ? flat : null,
        baseActiveConfigValues: active,
        schemaTree: tree,
        schemaPathSet,
      });
      const own = isEditingScope ? stored.profile.overrides : stored.base;
      const layers = {
        configValues: config,
        dbOverrides: stored.base,
        yamlConfig: stored.yaml,
        yamlMcpServers: isConfigRecord(stored.yaml.mcpServers) ? stored.yaml.mcpServers : {},
        schemaDefaults: {},
        schemaPathSet,
        overridePaths: new Set(Object.keys(flattenObject(own))),
        valueLayers,
        baseActiveConfigValues: active,
        targetRevision: read ? loaded.data : targetRevision,
      };
      const save = useConfigSave({
        schemaTree: tree,
        schemaPathSet,
        editingScope: scope,
        layers,
        edits,
      });
      const review = useChangeReview({
        schemaTree: tree,
        editingScope: scope,
        layers,
        edits,
        save,
        onTabChange: () => undefined,
        profiles,
      });
      const overrides = useBaseOverrides({ schemaTree: tree, layers, profiles });
      const key = scope?.principalId ?? 'base';
      const opened = useRef(key);
      const { resetEdits } = edits;
      const { cancelReview } = save;
      useEffect(() => {
        if (opened.current === key) return;
        opened.current = key;
        resetEdits();
        cancelReview();
      }, [key, resetEdits, cancelReview]);
      return { edits, save, review, overrides };
    },
    { wrapper, initialProps },
  );
}

/**
 * Role USER as the profile list reads it: its own key and title for Base's
 * `acme`, its own key for Base's `AcmeLLM`, and a hide of Base's `oauthy`.
 */
const userListed: t.ConfigScope = {
  ...userRole,
  overridePaths: ['mcpServers.acme.title', 'endpoints.custom'],
  overrideEntries: { 'endpoints.custom': ['AcmeLLM'] },
  tombstones: ['mcpServers.oauthy'],
  storedSecrets: [
    { path: 'mcpServers.acme.apiKey.key' },
    { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'AcmeLLM' } },
  ],
};

/** A row's notes on the profiles that override its entry by name: each change and, per profile, how it overrides the entry. */
function notesOf(row: t.ReviewRow) {
  return row.item.overrideNotes?.map(({ change, overrides }) => ({
    change,
    profiles: overrides.map(({ scope, overrides: sets, secrets, hidden }) => ({
      profile: scope.principalId,
      overrides: sets,
      secret: secrets.length > 0,
      hidden,
    })),
  }));
}

/** Base's custom endpoints as the page lists them, AcmeLLM renamed (or left out, with `name` undefined). */
function endpointsWith(name: string | undefined): t.ConfigValue[] {
  const list = (baseConfig().endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
  return list.flatMap((entry) => {
    if (entry.name !== 'AcmeLLM') return [entry];
    return name === undefined ? [] : [{ ...entry, name }];
  });
}

/** Whether a listed custom endpoint is Base's `AcmeLLM`. */
function isAcme(entry: t.ConfigValue): entry is t.ConfigRecord {
  return (
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.name === 'AcmeLLM'
  );
}

/** The rows of a review (or of what "Reset base config" removes), entry rows included. */ /** The rows of a review (or of what "Reset base config" removes), entry rows included. */
function reviewRows({ model }: Pick<t.ChangeReviewState, 'model'>): t.ReviewRow[] {
  return model.tabs.flatMap((tab) =>
    tab.sections.flatMap((section) => [
      ...section.rows,
      ...section.entries.flatMap((entry) => entry.rows),
    ]),
  );
}

/** Clicks the Undo of the last toast that offered one. */
function clickUndo() {
  const offers = toastMock.mock.calls.filter(([toast]) => (toast.actions?.length ?? 0) > 0);
  const undo = offers.at(-1)?.[0].actions?.[0];
  if (!undo) throw new Error('no Undo toast');
  const button = render(<Button htmlType="button" label={undo.label} onClick={undo.onClick} />);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  button.unmount();
}

/** A server storing Base at `revision`: it answers reads at once, or, after `hold()`, once `answer()` is called. */
function heldReads(initial: string) {
  let gate = Promise.resolve();
  let release: () => void = () => undefined;
  const server = {
    revision: initial,
    read: async (): Promise<string | null> => {
      await gate;
      return server.revision;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    answer: () => release(),
  };
  return server;
}

const sentOps = () =>
  applyMock.mock.calls.map(([call]) => (call as { data: t.ApplyConfigChangesRequest }).data);

const batch = createServerContract({
  recordSecrets: true,
  yamlMcpHide: true,
  secretRebinding: true,
  changesBatch: true,
  expectedRevision: true,
});

beforeEach(() => {
  applyMock.mockReset();
  applyMock.mockResolvedValue(saved);
  toastMock.mockClear();
});

describe('a hide in a profile (a): what it deletes, and edits under it', () => {
  it("lists the profile's own settings the hide deletes, its stored client secret by name", () => {
    const { result } = renderTargets(batch, { scope: userRole });
    act(() => result.current.edits.handleHideField('mcpServers.salesforce'));
    const { review } = result.current;
    expect(review.model.count).toBe(1);
    const [row] = reviewRows(review);
    expect(row.item).toMatchObject({ kind: 'hidden', warnings: ['hideDeletesOwn'] });
    expect(
      row.details?.map((detail) => [detail.label, detail.item.kind, detail.item.secret]),
    ).toEqual([
      ['Title', 'removed', undefined],
      ['OAuth › Client secret', 'removed', true],
    ]);
    expect(JSON.stringify(row)).not.toContain('...1111');
  });

  it('leaves an edit under the hidden server out of the rows and the count, listing it as not saved', async () => {
    const { result } = renderTargets(batch, { scope: userRole });
    act(() => {
      result.current.edits.handleFieldChange('mcpServers.salesforce.title', 'SF pending');
      result.current.edits.handleHideField('mcpServers.salesforce');
    });
    const { review, save } = result.current;
    expect(review.model.count).toBe(1);
    expect(reviewRows(review).map((row) => row.item.kind)).toEqual(['hidden']);
    expect(save.savePlan.saves).toEqual([]);
    expect(review.model.skipped.map((skip) => [skip.path, skip.reason])).toEqual([
      ['mcpServers.salesforce.title', 'not saved: this save hides the setting it belongs to'],
    ]);
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(sentOps()).toHaveLength(1);
  });

  it('brings the edit back as a change once the hide is reverted', () => {
    const { result } = renderTargets(batch, { scope: userRole });
    act(() => {
      result.current.edits.handleFieldChange('mcpServers.salesforce.title', 'SF pending');
      result.current.edits.handleHideField('mcpServers.salesforce');
    });
    act(() => result.current.review.revertRow(reviewRows(result.current.review)[0]));
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['changed', 'mcpServers.salesforce.title'],
    ]);
    expect(result.current.review.model.skipped).toEqual([]);
  });
});

describe('removals name the stored secrets they delete (a)', () => {
  it('lists the stored key of a deleted server under its row', () => {
    const { result } = renderTargets(batch);
    act(() => result.current.edits.handleFieldChange('mcpServers.acme', undefined));
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'removed', path: 'mcpServers.acme' });
    expect(row.details?.map((detail) => [detail.label, detail.item.secret])).toEqual([
      ['API key', true],
    ]);
  });

  it('lists the stored key of a deleted custom endpoint under its row', () => {
    const { result } = renderTargets(batch);
    const list = baseConfig().endpoints as t.ConfigRecord;
    const kept = (list.custom as t.ConfigRecord[]).filter((entry) => entry.name !== 'AcmeLLM');
    act(() => result.current.edits.handleFieldChange('endpoints.custom', kept));
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'removed', entryIdentity: 'AcmeLLM' });
    expect(row.details?.map((detail) => [detail.label, detail.item.secret])).toEqual([
      ['API key', true],
    ]);
  });

  it('reads a stored endpoint key reverted to the librechat.yaml reference as replaced, not as set', () => {
    const { result } = renderTargets(batch);
    act(() => result.current.edits.handleFieldChange('endpoints.custom.0', moonshot));
    expect(result.current.save.removedSecrets).toEqual([
      { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Moonshot' } },
    ]);
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => [row.item.path, row.item.kind, row.item.after])).toEqual([
      ['endpoints.custom.0.apiKey', 'changed', '${KIMI}'],
    ]);
    expect(rows[0].item.before).toBe('...3333');
  });

  it("lists the client secret a profile's removed overrides of a server take along", () => {
    const { result } = renderTargets(batch, { scope: userRole });
    act(() => result.current.edits.handleFieldChange('mcpServers.salesforce', undefined));
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'reverted', path: 'mcpServers.salesforce' });
    expect(row.details?.map((detail) => [detail.label, detail.item.secret])).toEqual([
      ['OAuth › Client secret', true],
    ]);
  });

  it('names the stored keys "Reset base config" deletes', () => {
    const { result } = renderTargets(batch);
    const secrets = reviewRows(result.current.overrides).flatMap((row) =>
      (row.details ?? []).map((detail) => `${row.label}: ${detail.label}`),
    );
    expect(secrets).toEqual(['AcmeLLM: API key', 'acme: API key', 'oauthy: OAuth › Client secret']);
  });

  it('lists the stored client secret OAuth takes along when it is switched off', () => {
    const { result } = renderTargets(batch);
    act(() => result.current.edits.handleFieldChange('mcpServers.oauthy.oauth', undefined));
    const [row] = reviewRows(result.current.review);
    expect(row.item.path).toBe('mcpServers.oauthy.oauth');
    expect(row.item.before).toEqual({ client_id: 'cid-1' });
    expect(row.details?.map((detail) => [detail.label, detail.item.kind])).toEqual([
      ['Client secret', 'removed'],
    ]);
  });
});

describe('a rename or removal in Base names the profile overrides it leaves behind (a)', () => {
  const user = { profile: 'USER', overrides: true, secret: true, hidden: false };

  it("names the profile whose override and stored key stay under a renamed server's old name", () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.acme', undefined);
      edits.handleFieldChange('mcpServers.acme-2.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.acme-2.url', 'https://mcp.acme.dev/mcp');
      edits.handleFieldChange('mcpServers.acme-2.title', 'Acme');
      edits.handleRenameEntry('mcpServers.acme', 'mcpServers.acme-2');
    });
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'renamed', previousIdentity: 'acme' });
    expect(notesOf(row)).toEqual([
      { change: { kind: 'renamed', name: 'acme', next: 'acme-2', taken: false }, profiles: [user] },
    ]);
  });

  it('names a hide that no longer hides the renamed server', () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.oauthy', undefined);
      edits.handleFieldChange('mcpServers.oauthy-2.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.oauthy-2.url', 'https://mcp.oauthy.dev/mcp');
      edits.handleFieldChange('mcpServers.oauthy-2.title', 'OAuthy');
      edits.handleRenameEntry('mcpServers.oauthy', 'mcpServers.oauthy-2');
    });
    const renamed = reviewRows(result.current.review).find((row) => row.item.kind === 'renamed');
    expect(renamed && notesOf(renamed)?.map(({ profiles }) => profiles)).toEqual([
      [{ profile: 'USER', overrides: false, secret: false, hidden: true }],
    ]);
  });

  it('names the profile that keeps its override and key of a deleted server or custom endpoint', () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() => result.current.edits.handleFieldChange('mcpServers.acme', undefined));
    expect(notesOf(reviewRows(result.current.review)[0])).toEqual([
      { change: { kind: 'removed', name: 'acme' }, profiles: [user] },
    ]);
    act(() => {
      result.current.edits.handleDiscardField('mcpServers.acme');
      result.current.edits.handleFieldChange('endpoints.custom', endpointsWith(undefined));
    });
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'removed', entryIdentity: 'AcmeLLM' });
    expect(notesOf(row)).toEqual([
      { change: { kind: 'removed', name: 'AcmeLLM' }, profiles: [user] },
    ]);
  });

  it('names the profile overrides a renamed custom endpoint leaves under its old name', () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() =>
      result.current.edits.handleFieldChange('endpoints.custom', endpointsWith('AcmeLLM2')),
    );
    const renamed = reviewRows(result.current.review).find((row) => row.item.kind === 'renamed');
    expect(renamed && notesOf(renamed)).toEqual([
      {
        change: { kind: 'renamed', name: 'AcmeLLM', next: 'AcmeLLM2', taken: false },
        profiles: [user],
      },
    ]);
  });

  it('names the profile overrides "Reset base config" leaves behind', () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    const left = reviewRows(result.current.overrides).flatMap((row) =>
      (notesOf(row) ?? []).map(({ change, profiles }) => [
        row.label,
        change.name,
        profiles.map(({ profile }) => profile),
      ]),
    );
    expect(left).toEqual([
      ['AcmeLLM', 'AcmeLLM', ['USER']],
      ['acme', 'acme', ['USER']],
    ]);
  });

  it('names no profile in a profile, for an edit beside the name, or where no profile overrides it', () => {
    const { result, rerender } = renderTargets(batch, {}, [userListed]);
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2'));
    expect(reviewRows(result.current.review).map(notesOf)).toEqual([undefined]);
    rerender({ scope: userRole });
    act(() => result.current.edits.handleFieldChange('mcpServers.salesforce', undefined));
    expect(reviewRows(result.current.review).map(notesOf)).toEqual([undefined]);
    const bare = renderTargets(batch);
    act(() => bare.result.current.edits.handleFieldChange('mcpServers.acme', undefined));
    expect(reviewRows(bare.result.current.review).map(notesOf)).toEqual([undefined]);
  });
});

describe('a Base change names the profiles whose own keys it stops or whose overrides it takes (review 4)', () => {
  const unbound = (row: t.ReviewRow | undefined) =>
    (row && notesOf(row)?.filter(({ change }) => change.kind === 'moved')) ?? [];
  const user = { profile: 'USER', overrides: true, secret: true, hidden: false };

  it("names the profile whose own key a server's new URL stops, on the URL's row", () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() =>
      result.current.edits.handleFieldChange('mcpServers.acme.url', 'https://mcp2.acme.dev/mcp'),
    );
    const rows = reviewRows(result.current.review);
    const url = rows.find((row) => row.item.path === 'mcpServers.acme.url');
    expect(unbound(url)).toEqual([{ change: { kind: 'moved', name: 'acme' }, profiles: [user] }]);
    expect(rows.filter((row) => row !== url).flatMap(unbound)).toEqual([]);
  });

  it("names the profile whose own key a custom endpoint's new base URL stops", () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    const list = endpointsWith('AcmeLLM').map((entry) =>
      isAcme(entry) ? { ...entry, baseURL: 'https://api2.acme.dev/v1' } : entry,
    );
    act(() => result.current.edits.handleFieldChange('endpoints.custom', list));
    const rows = reviewRows(result.current.review);
    const baseURL = rows.find((row) => row.item.path.endsWith('.baseURL'));
    expect(baseURL?.item.entryIdentity).toBe('AcmeLLM');
    expect(unbound(baseURL)).toEqual([
      { change: { kind: 'moved', name: 'AcmeLLM' }, profiles: [user] },
    ]);
  });

  it('names no profile that sets the moved setting itself, a change that moves no key, or a server without secretRebinding', () => {
    const ownUrl: t.ConfigScope = {
      ...userListed,
      overridePaths: [...(userListed.overridePaths ?? []), 'mcpServers.acme.url'],
      overrideEntryPaths: { 'endpoints.custom': { AcmeLLM: ['baseURL'] } },
    };
    const move = (contract: t.ConfigContract, profiles: t.ConfigScope[]) => {
      const { result } = renderTargets(contract, {}, profiles);
      const list = endpointsWith('AcmeLLM').map((entry) =>
        isAcme(entry) ? { ...entry, baseURL: 'https://api2.acme.dev/v1' } : entry,
      );
      act(() => {
        result.current.edits.handleFieldChange('mcpServers.acme.url', 'https://mcp2.acme.dev/mcp');
        result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2');
        result.current.edits.handleFieldChange('endpoints.custom', list);
      });
      return reviewRows(result.current.review).flatMap(unbound);
    };
    expect(move(batch, [userListed])).toHaveLength(2);
    expect(move(batch, [ownUrl])).toEqual([]);
    const legacy = createServerContract({ recordSecrets: true, changesBatch: true });
    expect(move(legacy, [userListed])).toEqual([]);
  });

  it('names the profile whose own key "Reset base config" stops, as the URL goes back to librechat.yaml', () => {
    const kbKey: t.ConfigScope = {
      ...userRole,
      overridePaths: [],
      storedSecrets: [{ path: 'mcpServers.kb.apiKey.key' }],
    };
    const { result } = renderTargets(batch, {}, [kbKey]);
    const rows = reviewRows(result.current.overrides);
    const url = rows.find((row) => row.item.path === 'mcpServers.kb.url');
    expect(unbound(url)).toEqual([{ change: { kind: 'moved', name: 'kb' }, profiles: [user] }]);
  });

  /** A profile that still overrides `ghost`, a name Base no longer uses: its title and its own key. */
  const leftover: t.ConfigScope = {
    ...userRole,
    principalId: 'eng',
    name: 'eng',
    principalType: PrincipalType.GROUP,
    overridePaths: ['mcpServers.ghost.title'],
    storedSecrets: [{ path: 'mcpServers.ghost.apiKey.key' }],
  };
  const eng = { profile: 'eng', overrides: true, secret: true, hidden: false };
  const took = (row: t.ReviewRow | undefined) =>
    (row && notesOf(row)?.filter(({ change }) => change.kind === 'took')) ?? [];

  it('names the profile whose leftover override a rename or a new server onto its name takes', () => {
    const { result } = renderTargets(batch, {}, [leftover]);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.oauthy', undefined);
      edits.handleFieldChange('mcpServers.ghost.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.ghost.url', 'https://mcp.oauthy.dev/mcp');
      edits.handleFieldChange('mcpServers.ghost.title', 'OAuthy');
      edits.handleRenameEntry('mcpServers.oauthy', 'mcpServers.ghost');
    });
    const renamed = reviewRows(result.current.review).find((row) => row.item.kind === 'renamed');
    expect(took(renamed)).toEqual([
      { change: { kind: 'took', name: 'ghost', sendsKeys: false }, profiles: [eng] },
    ]);
    const added = renderTargets(createServerContract({ recordSecrets: true }), {}, [leftover]);
    act(() => {
      const { edits } = added.result.current;
      edits.handleFieldChange('mcpServers.ghost.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.ghost.url', 'https://ghost.example.com/mcp');
    });
    const [row] = reviewRows(added.result.current.review);
    expect(row.item).toMatchObject({ kind: 'added', entryIdentity: 'ghost' });
    expect(took(row)).toEqual([
      { change: { kind: 'took', name: 'ghost', sendsKeys: true }, profiles: [eng] },
    ]);
  });

  it('names no taken override for a name Base already uses, written again under it', () => {
    const { result } = renderTargets(batch, {}, [userListed]);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.acme', undefined);
      edits.handleFieldChange('mcpServers.oauthy', undefined);
      edits.handleFieldChange('mcpServers.oauthy.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.oauthy.url', 'https://mcp.acme.dev/mcp');
      edits.handleFieldChange('mcpServers.oauthy.title', 'Acme');
      edits.handleRenameEntry('mcpServers.acme', 'mcpServers.oauthy');
    });
    expect(reviewRows(result.current.review).flatMap(took)).toEqual([]);
  });
});

describe('the review is the truth (b)', () => {
  it('sends nothing when the review lists no change, though the edits would write the same server', async () => {
    const { result } = renderTargets(batch);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.acme.apiKey', undefined);
      edits.handleFieldChange('mcpServers.acme.apiKey.source', 'admin');
      edits.handleFieldChange('mcpServers.acme.apiKey.authorization_type', 'bearer');
    });
    expect(result.current.review.model.count).toBe(0);
    expect(result.current.review.blocked).toBe(false);
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(applyMock).not.toHaveBeenCalled();
    expect(result.current.edits.editedValues).toEqual({});
    expect(toastMock).toHaveBeenLastCalledWith({
      type: 'default',
      title: 'Nothing to save: blank items and unchanged values are ignored',
    });
  });

  it('names a server left without the key it sends in the review, before Save', async () => {
    const { result } = renderTargets(batch);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.docs.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.docs.url', 'https://docs.example.com/mcp');
      edits.handleFieldChange('mcpServers.docs.apiKey.source', 'admin');
    });
    const { review, save } = result.current;
    expect(review.blocked).toBe(true);
    expect(save.issues).toContainEqual(
      expect.objectContaining({ path: 'mcpServers.docs.apiKey.key', code: 'MCP_API_KEY_MISSING' }),
    );
    expect(save.fieldErrors['mcpServers.docs.apiKey.key']).toMatch(/^API key must be entered/);
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('says before Save that a section holds more changes than one save takes', async () => {
    const limited: t.ConfigContract = { ...batch, limits: { ...batch.limits, maxChangeOps: 2 } };
    const { result } = renderTargets(limited);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.acme.title', 'A');
      edits.handleFieldChange('mcpServers.oauthy.title', 'O');
      edits.handleFieldChange('mcpServers.acme.timeout', 5000);
    });
    expect(result.current.review.blocked).toBe(true);
    expect(result.current.save.issues).toContainEqual(
      expect.objectContaining({ path: 'mcpServers', code: 'TOO_MANY_CHANGES' }),
    );
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('keeps a stored key a server written again under its name still holds, as Save does', () => {
    const { result } = renderTargets(batch);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.acme', undefined);
      edits.handleFieldChange('mcpServers.acme.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.acme.url', 'https://mcp.acme.dev/mcp');
      edits.handleFieldChange('mcpServers.acme.title', 'Acme copy');
      edits.handleFieldChange('mcpServers.acme.apiKey.source', 'admin');
      edits.handleFieldChange('mcpServers.acme.apiKey.authorization_type', 'bearer');
    });
    const { review, save } = result.current;
    expect(save.issues).toEqual([]);
    expect(reviewRows(review).map((row) => [row.item.kind, row.item.path])).toEqual([
      ['changed', 'mcpServers.acme.title'],
    ]);
  });
});

describe('an MCP key read back only as its preview (review 4)', () => {
  it('reads a key entered over the stored one as replacing it, in Base and in a profile', () => {
    const { result, rerender } = renderTargets(batch);
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.apiKey.key', 'sk-new-3333'));
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({
      path: 'mcpServers.acme.apiKey.key',
      kind: 'changed',
      before: '...1234',
      secret: true,
    });
    rerender({ scope: userRole });
    act(() =>
      result.current.edits.handleFieldChange('mcpServers.salesforce.oauth.client_secret', 'cs-2'),
    );
    expect(reviewRows(result.current.review).map(({ item }) => [item.kind, item.before])).toEqual([
      ['changed', '...1111'],
    ]);
  });
});

describe("Discard's Undo stays in its target (c)", () => {
  it('restores nothing into another target, a typed secret and a rename included, and says why', () => {
    const { result, rerender } = renderTargets(batch);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.oauthy.oauth.client_secret', 'cs-typed-4242');
      edits.handleFieldChange('mcpServers.acme', undefined);
      edits.handleFieldChange('mcpServers.acme-2.type', 'streamable-http');
      edits.handleFieldChange('mcpServers.acme-2.url', 'https://mcp.acme.dev/mcp');
      edits.handleRenameEntry('mcpServers.acme', 'mcpServers.acme-2');
    });
    act(() => result.current.review.discardAll());
    rerender({ scope: userRole });
    clickUndo();
    expect(result.current.edits.editedValues).toEqual({});
    expect(result.current.edits.renameEdits).toEqual({});
    expect(result.current.review.model.count).toBe(0);
    expect(toastMock).toHaveBeenLastCalledWith({
      type: 'default',
      title:
        "Nothing restored: the discarded changes were made for Base configuration in an earlier edit session, so they can't be put back here.",
    });
    rerender({ scope: undefined });
    clickUndo();
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('restores into the target it was discarded from, against the revision the edits were made against', async () => {
    const { result, rerender } = renderTargets(batch, { targetRevision: 'base:4' });
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2'));
    act(() => result.current.review.discardAll());
    rerender({ targetRevision: 'base:5' });
    clickUndo();
    expect(result.current.edits.editedValues).toEqual({ 'mcpServers.acme.title': 'Acme 2' });
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(sentOps().map((call) => call.expectedRevision)).toEqual(['base:4']);
  });

  it('restores over the reloaded version after Reload on a conflict', async () => {
    applyMock.mockResolvedValueOnce({ ...saved, applied: 0, conflict: true });
    const { result, rerender } = renderTargets(batch, { targetRevision: 'base:4' });
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2'));
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(result.current.review.conflict).toBe(true);
    act(() => result.current.review.reloadLatest());
    rerender({ targetRevision: 'base:5' });
    clickUndo();
    await waitFor(() =>
      expect(result.current.edits.editedValues).toEqual({ 'mcpServers.acme.title': 'Acme 2' }),
    );
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(sentOps().map((call) => call.expectedRevision)).toEqual(['base:4', 'base:5']);
  });

  it('waits for the re-read Reload starts, and restores over the version it loads', async () => {
    const server = heldReads('base:4');
    applyMock.mockImplementation(async (call) => {
      const { expectedRevision } = (call as { data: t.ApplyConfigChangesRequest }).data;
      return expectedRevision === server.revision
        ? saved
        : { ...saved, applied: 0, conflict: true };
    });
    const { result } = renderTargets(batch, {}, [], server.read);
    await waitFor(() => expect(result.current.save.editRevision).toBe('base:4'));
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2'));
    server.revision = 'base:5';
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(result.current.review.conflict).toBe(true);

    server.revision = 'base:6';
    server.hold();
    act(() => result.current.review.reloadLatest());
    clickUndo();
    await act(async () => undefined);
    expect(result.current.edits.editedValues).toEqual({});
    await act(async () => server.answer());
    await waitFor(() =>
      expect(result.current.edits.editedValues).toEqual({ 'mcpServers.acme.title': 'Acme 2' }),
    );
    expect(result.current.save.editRevision).toBe('base:6');
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(sentOps().map((call) => call.expectedRevision)).toEqual(['base:4', 'base:6']);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('restores nothing once another target opens while that re-read loads', async () => {
    const server = heldReads('base:4');
    const { result, rerender } = renderTargets(batch, {}, [], server.read);
    await waitFor(() => expect(result.current.save.editRevision).toBe('base:4'));
    act(() => result.current.edits.handleFieldChange('mcpServers.acme.title', 'Acme 2'));
    server.hold();
    act(() => result.current.review.reloadLatest());
    clickUndo();
    rerender({ scope: userRole });
    await act(async () => server.answer());
    await waitFor(() =>
      expect(toastMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/^Nothing restored/) }),
      ),
    );
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('holds the revision of a restate alone, which is a pending edit too', () => {
    const { result, rerender } = renderTargets(batch, { targetRevision: 'base:4' });
    act(() =>
      result.current.edits.handleRestateCredential(
        { path: 'mcpServers', entry: 'kb', secret: 'apiKey.key' },
        true,
      ),
    );
    expect(result.current.review.model.count).toBe(1);
    rerender({ targetRevision: 'base:5' });
    expect(result.current.save.editRevision).toBe('base:4');
  });
});

describe('Azure groups Base removes or renames while a profile overrides them (endpointRederive)', () => {
  const GROUPS = 'endpoints.azureOpenAI.groups';
  const rederive = createServerContract({
    endpointRederive: true,
    azureGroupMergeKey: true,
    azureGroupSecrets: true,
    secretRebinding: true,
    changesBatch: true,
    expectedRevision: true,
    dottedKeys: true,
  });
  const eastus = {
    group: 'eastus',
    apiKey: '${EASTUS_API_KEY}',
    instanceName: 'librechat-eastus',
    version: '2024-02-15-preview',
    models: { 'gpt-4.1': { deploymentName: 'gpt-41' } },
  };
  const west = {
    group: 'rv-west',
    apiKeyPreview: '...4321',
    instanceName: 'rv-west',
    version: 'v1',
    models: { 'gpt-4.1-dot': { deploymentName: 'dot' } },
  };
  const stored: Stored = {
    yaml: { endpoints: { azureOpenAI: { groups: [eastus] } } },
    base: { endpoints: { azureOpenAI: { groups: [west] } } },
    profile: { resolvedConfig: {}, changedPaths: [], overrides: {}, tombstones: [] },
    rules: getWriteRules(rederive),
  };
  /** Role USER as the profile list reads it: it changes rv-west's API version, and nothing else of it. */
  const versionOnly: t.ConfigScope = {
    ...userRole,
    overridePaths: [GROUPS],
    overrideEntries: { [GROUPS]: ['rv-west'] },
    overrideEntryPaths: { [GROUPS]: { 'rv-west': ['version'] } },
  };
  const groups = () => baseConfig(stored).endpoints as t.ConfigRecord;
  const listed = () => (groups().azureOpenAI as t.ConfigRecord).groups as t.ConfigRecord[];
  const notesOfGroup = (result: { current: { review: t.ChangeReviewState } }) =>
    reviewRows(result.current.review).flatMap((row) =>
      row.item.collectionPath === GROUPS ? (notesOf(row) ?? []) : [],
    );

  it('names the profile whose override a removal leaves as a group of its own', () => {
    const { result } = renderTargets(rederive, {}, [versionOnly], undefined, stored);
    act(() => {
      result.current.edits.handleFieldChange(
        GROUPS,
        listed().filter((entry) => entry.group !== 'rv-west'),
      );
    });
    expect(notesOfGroup(result)).toEqual([
      {
        change: { kind: 'removed', name: 'rv-west' },
        profiles: [{ profile: 'USER', overrides: true, secret: false, hidden: false }],
      },
    ]);
    const row = reviewRows(result.current.review).find((item) => item.item.kind === 'removed');
    expect(row?.item.overrideNotes?.[0].collection).toBe(GROUPS);
  });

  it('names it for a rename too, and for no profile on a server that does not derive groups', () => {
    const { result } = renderTargets(rederive, {}, [versionOnly], undefined, stored);
    act(() => {
      result.current.edits.handleFieldChange(
        GROUPS,
        listed().map((entry) =>
          entry.group === 'rv-west' ? { ...entry, group: 'rv-north' } : entry,
        ),
      );
    });
    expect(notesOfGroup(result).map(({ change }) => change)).toEqual([
      { kind: 'renamed', name: 'rv-west', next: 'rv-north', taken: false },
    ]);
    const inert = createServerContract({ azureGroupMergeKey: true, azureGroupSecrets: true });
    const older = renderTargets(inert, {}, [versionOnly], undefined, stored);
    act(() => {
      older.result.current.edits.handleFieldChange(
        GROUPS,
        listed().filter((entry) => entry.group !== 'rv-west'),
      );
    });
    expect(notesOfGroup(older.result)).toEqual([]);
  });
});
