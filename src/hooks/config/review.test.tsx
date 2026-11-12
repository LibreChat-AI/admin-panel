import '@/locales/i18n';
import { configSchema } from 'librechat-data-provider';
import { Button, createToast } from '@clickhouse/click-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { ReviewList } from '@/components/configuration/review';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { applyConfigChangesFn } from '@/server';
import { useChangeReview, useBaseOverrides } from './review';
import { useConfigEdits } from './edits';
import { flattenObject, createBaseLayers } from '@/utils';
import { useConfigSave } from './save';

vi.mock('@/server', () => ({ applyConfigChangesFn: vi.fn(), resetBaseConfigFn: vi.fn() }));

vi.mock('@clickhouse/click-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clickhouse/click-ui')>();
  return { ...actual, createToast: vi.fn() };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPathSet = getSchemaPathSet();
const models = { default: ['kimi-k2.5'] };
const moonshot = {
  name: 'Moonshot',
  apiKey: '${KIMI}',
  baseURL: 'https://api.moonshot.ai/v1',
  models,
};
const zai = { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai', models };
const yaml: t.ConfigRecord = {
  balance: { startBalance: 1000000 },
  endpoints: { custom: [moonshot, zai] },
};

/** The page's edit, save and review hooks over a base config: librechat.yaml, and what the panel stored. */
function renderPage(
  config: t.ConfigRecord = yaml,
  dbOverrides: t.ConfigRecord = {},
  yamlConfig: t.ConfigRecord = config,
  contract: t.ConfigContract = BUNDLED_CONFIG_CONTRACT,
  initialRevision?: string | null,
) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(
    ({ targetRevision }: { targetRevision?: string | null }) => {
      const edits = useConfigEdits({
        isEditingScope: false,
        flatBaseline: flattenObject(config),
        scopeResolvedValues: null,
        baseActiveConfigValues: config,
        schemaTree: tree,
        schemaPathSet,
      });
      const layers = {
        configValues: config,
        dbOverrides,
        yamlConfig,
        yamlMcpServers: {},
        schemaDefaults: {},
        schemaPathSet,
        overridePaths: new Set(Object.keys(flattenObject(dbOverrides))),
        valueLayers: null,
        baseActiveConfigValues: config,
        targetRevision,
      };
      const save = useConfigSave({ schemaTree: tree, schemaPathSet, layers, edits });
      const review = useChangeReview({
        schemaTree: tree,
        layers,
        edits,
        save,
        onTabChange: () => undefined,
      });
      return { edits, save, review };
    },
    { wrapper, initialProps: { targetRevision: initialRevision } },
  );
}

/** The review's rows, entry rows included, in order. */
function reviewRows(review: Pick<t.ChangeReviewState, 'model'>): t.ReviewRow[] {
  return review.model.tabs.flatMap((tab) =>
    tab.sections.flatMap((section) => [
      ...section.rows,
      ...section.entries.flatMap((entry) => entry.rows),
    ]),
  );
}

describe('the change review over the save pipeline (WS1 × WS7)', () => {
  it('shows one entry field change, although the write is a per-entry op', () => {
    const { result } = renderPage();
    act(() =>
      result.current.edits.handleFieldChange('endpoints.custom.0', {
        ...moonshot,
        baseURL: 'https://api.moonshot.cn/v1',
      }),
    );
    const { review } = result.current;
    expect(review.model.count).toBe(1);
    expect(review.blocked).toBe(false);
    const rows = reviewRows(review);
    expect(rows.map((row) => row.item.path)).toEqual(['endpoints.custom.0.baseURL']);
    expect(rows[0].item).toMatchObject({
      before: 'https://api.moonshot.ai/v1',
      after: 'https://api.moonshot.cn/v1',
    });
  });

  it('warns on the base URL that sends an inherited key somewhere new (secretRebinding)', () => {
    const rowsOf = (contract: t.ConfigContract) => {
      const { result } = renderPage(yaml, {}, yaml, contract);
      act(() =>
        result.current.edits.handleFieldChange('endpoints.custom.0', {
          ...moonshot,
          baseURL: 'https://evil.example/v1',
        }),
      );
      return reviewRows(result.current.review);
    };
    const rows = rowsOf(createServerContract({ secretRebinding: true }));
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.custom.0.baseURL', ['secretRebinding']],
    ]);
    const older = rowsOf(BUNDLED_CONFIG_CONTRACT);
    expect(older.map((row) => row.item.warnings)).toEqual([undefined]);
  });

  it('warns on an OCR or web search URL that moves an inherited key, asking for a credential', () => {
    const features: t.ConfigRecord = {
      ocr: { apiKey: '${OCR_API_KEY}', baseURL: 'https://api.mistral.ai/v1' },
      webSearch: {
        tavilyApiKeyPreview: '********',
        tavilySearchUrl: 'https://api.tavily.com/search',
      },
    };
    const rowsOf = (contract: t.ConfigContract) => {
      const { result } = renderPage(features, {}, features, contract);
      act(() => {
        result.current.edits.handleFieldChange('ocr.baseURL', 'https://evil.example/v1');
        result.current.edits.handleFieldChange('webSearch.tavilySearchUrl', 'https://evil.example');
      });
      return result.current.review.model.tabs.flatMap((tab) =>
        tab.sections.flatMap((section) => section.rows),
      );
    };
    const contract = createServerContract({ secretRebinding: true, webSearchStoredKeys: true });
    expect(rowsOf(contract).map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['ocr.baseURL', ['secretRebindingEnter']],
      ['webSearch.tavilySearchUrl', ['secretRebindingEnter']],
    ]);
    const older = rowsOf(BUNDLED_CONFIG_CONTRACT);
    expect(older.map((row) => row.item.warnings)).toEqual([undefined, undefined]);
  });

  it('lists a restated inherited key under its endpoint, and Revert takes the restate back', () => {
    const { result } = renderPage(yaml, {}, yaml, createServerContract({ secretRebinding: true }));
    const ref: t.CredentialRef = { path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' };
    act(() => {
      result.current.edits.handleFieldChange('endpoints.custom.0', {
        ...moonshot,
        baseURL: 'https://proxy.example/v1',
      });
      result.current.edits.handleRestateCredential(ref, true);
    });
    const rowsNow = () => reviewRows(result.current.review);
    expect(rowsNow().map((row) => [row.item.path, row.item.kind, row.item.warnings])).toEqual([
      ['endpoints.custom.0.baseURL', 'changed', undefined],
      ['endpoints.custom.0.apiKey', 'added', ['secretRestated']],
    ]);
    expect(rowsNow()[1].item).toMatchObject({ after: '${KIMI}', entryIdentity: 'Moonshot' });
    act(() => result.current.review.revertRow(rowsNow()[1]));
    expect(result.current.edits.restateEdits).toEqual({});
    expect(rowsNow().map((row) => row.item.warnings)).toEqual([['secretRebinding']]);
  });

  it('drops a restate once the edits no longer move the key, leaving nothing to save', () => {
    const { result } = renderPage(yaml, {}, yaml, createServerContract({ secretRebinding: true }));
    const ref: t.CredentialRef = { path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' };
    act(() => {
      result.current.edits.handleFieldChange('endpoints.custom.0', {
        ...moonshot,
        baseURL: 'https://proxy.example/v1',
      });
      result.current.edits.handleRestateCredential(ref, true);
    });
    expect(Object.values(result.current.edits.restateEdits)).toEqual([ref]);
    act(() => result.current.edits.handleFieldChange('endpoints.custom.0', moonshot));
    expect(result.current.edits.restateEdits).toEqual({});
    expect(result.current.review.isDirty).toBe(false);
  });

  it('warns on removing a restated key the moved destination then goes without', () => {
    const own = { name: 'Moonshot', baseURL: 'https://proxy.example/v1', apiKey: '${KIMI}' };
    const merged = { ...moonshot, ...own };
    const config = { ...yaml, endpoints: { custom: [merged, zai] } };
    const { result } = renderPage(
      config,
      { endpoints: { custom: [own] } },
      yaml,
      createServerContract({ secretRebinding: true }),
    );
    const { apiKey: _removed, ...withoutKey } = merged;
    act(() => result.current.edits.handleFieldChange('endpoints.custom.0', withoutKey));
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.custom.0.apiKey', ['secretRebinding']],
    ]);
  });

  it('warns that a value Global overrides take precedence over has no effect (D11)', () => {
    const { result } = renderPage({
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { activityModel: 'gpt-luna' } },
    });
    act(() => result.current.edits.handleFieldChange('endpoints.openAI.activityModel', 'gpt-x'));
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.activityModel', ['shadowed']],
    ]);
  });

  it('says a provider title setting is ignored while Global exists, even where Global leaves it unset (D11)', () => {
    const { result } = renderPage({
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { activityModel: 'gpt-luna' } },
    });
    act(() => result.current.edits.handleFieldChange('endpoints.openAI.titleModel', 'gpt-x'));
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.titleModel', ['shadowedBlock']],
    ]);
  });

  it('warns per field on a server that resolves titles per field, the endpoint and model together', () => {
    const config = {
      ...yaml,
      endpoints: { ...(yaml.endpoints as t.ConfigRecord), all: { titleEndpoint: 'anthropic' } },
    };
    const { result } = renderPage(
      config,
      {},
      config,
      createServerContract({}, { titleResolution: 'field' }),
    );
    act(() => {
      result.current.edits.handleFieldChange('endpoints.openAI.titleModel', 'gpt-x');
      result.current.edits.handleFieldChange('endpoints.openAI.titleMethod', 'completion');
    });
    const rows = result.current.review.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.rows),
    );
    expect(rows.map((row) => [row.item.path, row.item.warnings])).toEqual([
      ['endpoints.openAI.titleModel', ['shadowedPair']],
      ['endpoints.openAI.titleMethod', undefined],
    ]);
  });

  it("blocks Save on the pipeline's issue when a librechat.yaml entry is removed (D1)", () => {
    const { result } = renderPage();
    act(() => result.current.edits.handleFieldChange('endpoints.custom', [moonshot]));
    const { review } = result.current;
    expect(review.blocked).toBe(true);
    expect(review.model.issues.map((issue) => issue.message).join(' ')).toMatch(/Zai 2/);
  });

  it('undoes a server rename but keeps its field edit, under the old name again', () => {
    const dbsrv = { type: 'streamable-http', url: 'https://db.example/mcp', title: 'DB' };
    const stored = { mcpServers: { dbsrv } };
    const { result } = renderPage(stored, stored, {});
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.dbsrv', undefined);
      for (const [key, value] of Object.entries(dbsrv)) {
        edits.handleFieldChange(`mcpServers.dbsrv2.${key}`, value);
      }
      edits.handleRenameEntry('mcpServers.dbsrv', 'mcpServers.dbsrv2');
    });
    act(() => result.current.edits.handleFieldChange('mcpServers.dbsrv2.title', 'Docs'));
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['renamed', 'mcpServers.dbsrv2'],
      ['changed', 'mcpServers.dbsrv2.title'],
    ]);
    act(() => result.current.review.revertRow(rows[0]));
    expect(result.current.edits.editedValues).toEqual({ 'mcpServers.dbsrv.title': 'Docs' });
    expect(result.current.edits.renameEdits).toEqual({});
  });
});

describe('an MCP server written again under a deleted name', () => {
  const batch = createServerContract({
    recordSecrets: true,
    changesBatch: true,
    expectedRevision: true,
  });
  const acme: t.ConfigRecord = {
    type: 'streamable-http',
    url: 'https://mcp.acme.dev/mcp',
    title: 'Acme',
    headers: { 'X-Team': 'docs' },
    apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...1234' },
  };
  const oauthy: t.ConfigRecord = {
    type: 'streamable-http',
    url: 'https://mcp.oauthy.dev/mcp',
    title: 'OAuthy',
    oauth: { client_id: 'cid-1', client_secretPreview: '...9876' },
  };
  const stored = { mcpServers: { acme, oauthy } };

  /** Deletes `acme`, then writes `leaves` under its name. */
  function writeOverAcme(leaves: t.FlatConfigMap) {
    const page = renderPage(stored, stored, {}, batch);
    act(() => {
      const { edits } = page.result.current;
      edits.handleFieldChange('mcpServers.acme', undefined);
      for (const [leaf, value] of Object.entries(leaves)) {
        edits.handleFieldChange(`mcpServers.acme.${leaf}`, value);
      }
    });
    return page;
  }

  it('lists the stored fields the new server drops, its stored key included, and Revert keeps them', () => {
    const { result } = writeOverAcme({
      type: 'streamable-http',
      url: 'https://mcp.oauthy.dev/mcp',
      title: 'OAuthy',
      'oauth.client_id': 'cid-1',
      'oauth.client_secret': 'cs-new-2222',
    });
    const rows = reviewRows(result.current.review);
    const dropped = rows.filter((row) => row.item.kind === 'removed');
    expect(dropped.map((row) => [row.item.path, row.item.secret])).toEqual([
      ['mcpServers.acme.headers', undefined],
      ['mcpServers.acme.apiKey', true],
    ]);
    expect(dropped[0].item).toMatchObject({
      before: { 'X-Team': 'docs' },
      after: undefined,
      entryIdentity: 'acme',
    });
    expect(rows.map((row) => row.item.path)).toEqual(
      expect.arrayContaining(['mcpServers.acme.url', 'mcpServers.acme.oauth.client_secret']),
    );
    act(() => result.current.review.revertRow(dropped[1]));
    expect(result.current.edits.editedValues).not.toHaveProperty(['mcpServers.acme']);
    expect(reviewRows(result.current.review).filter((row) => row.item.kind === 'removed')).toEqual(
      [],
    );
  });

  it('keeps a stored key whose holder the new server writes, and lists only what goes', () => {
    const { result } = writeOverAcme({
      type: 'streamable-http',
      url: 'https://mcp.acme.dev/mcp',
      title: 'Acme',
      'apiKey.source': 'admin',
      'apiKey.authorization_type': 'bearer',
    });
    const dropped = reviewRows(result.current.review).filter((row) => row.item.kind === 'removed');
    expect(dropped.map((row) => row.item.path)).toEqual(['mcpServers.acme.headers']);
  });
});

describe('Discard and its Undo', () => {
  const vault: t.ConfigRecord = {
    type: 'streamable-http',
    url: 'https://mcp.vault.dev/mcp',
    title: 'Vault',
    oauth: { client_id: 'vault-id', client_secretPreview: 'sec...1234' },
  };
  const stored = { mcpServers: { vault } };
  const contract = createServerContract({ recordSecrets: true });

  it('puts back a renamed and a duplicated MCP server with what they carry', () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const { result } = renderPage(stored, stored, {}, contract);
    act(() => {
      const { edits } = result.current;
      edits.handleFieldChange('mcpServers.vault', undefined);
      for (const name of ['vault-kb', 'vault-copy']) {
        edits.handleFieldChange(`mcpServers.${name}.type`, 'streamable-http');
        edits.handleFieldChange(`mcpServers.${name}.url`, 'https://mcp.vault.dev/mcp');
        edits.handleFieldChange(`mcpServers.${name}.oauth.client_id`, 'vault-id');
      }
      edits.handleRenameEntry('mcpServers.vault', 'mcpServers.vault-kb');
      edits.handleRenameEntry('mcpServers.vault-kb', 'mcpServers.vault-copy', true);
    });
    const { pending, touched } = result.current.edits.snapshot;
    const rowsBefore = reviewRows(result.current.review).map((row) => [
      row.item.kind,
      row.item.path,
    ]);
    expect(rowsBefore).toContainEqual(['renamed', 'mcpServers.vault-kb']);

    act(() => result.current.review.discardAll());
    expect(result.current.edits.editedValues).toEqual({});
    expect(result.current.edits.renameEdits).toEqual({});
    const undo = toast.mock.calls.at(-1)?.[0].actions?.[0];
    if (!undo) throw new Error('no Undo action');
    render(<Button htmlType="button" label={undo.label} onClick={undo.onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(result.current.edits.editedValues).toEqual(pending.values);
    expect(result.current.edits.touchedPaths).toEqual(touched);
    expect(result.current.edits.renameEdits).toEqual({
      'mcpServers.vault-kb': 'mcpServers.vault',
    });
    expect(result.current.edits.copyEdits).toEqual({
      'mcpServers.vault-copy': 'mcpServers.vault',
    });
    expect(reviewRows(result.current.review).map((row) => [row.item.kind, row.item.path])).toEqual(
      rowsBefore,
    );
  });
});

describe('saving against the loaded revision (changesBatch)', () => {
  const batch = createServerContract({ changesBatch: true, expectedRevision: true });
  const applyMock = vi.mocked(applyConfigChangesFn);
  const saved: t.ApplyConfigChangesResult = {
    applied: 1,
    failed: [],
    warnings: [],
    issues: [],
    skipped: [],
    reported: [],
  };
  const conflicted: t.ApplyConfigChangesResult = {
    ...saved,
    applied: 0,
    conflict: true,
    failed: [{ path: '', code: 'CONFIG_VERSION_CONFLICT', message: 'changed' }],
  };
  const sentRevisions = () =>
    applyMock.mock.calls.map(
      ([call]) => (call as { data: { expectedRevision?: string } }).data.expectedRevision,
    );

  /** A server whose target is stored at `revision`: a save named by another one writes nothing. */
  const storedAt = (revision: string) =>
    applyMock.mockImplementation(async (call) => {
      const { expectedRevision } = (call as { data: { expectedRevision?: string } }).data;
      return expectedRevision === undefined || expectedRevision === revision ? saved : conflicted;
    });

  beforeEach(() => {
    applyMock.mockReset();
  });

  async function editAndSave(result: {
    current: ReturnType<typeof renderPage>['result']['current'];
  }) {
    act(() => result.current.edits.handleFieldChange('balance.startBalance', 5));
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
  }

  it('sends the revision the page loaded the target at', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['base:4']);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('marks the scope catalogs, env status and previews stale with the saved target', async () => {
    applyMock.mockResolvedValue(saved);
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([['baseConfig'], ['configCatalog'], ['envStatus'], ['configPreview']]),
    );
    invalidate.mockRestore();
  });

  it('names a target without a document as absent', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, null);
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['absent']);
  });

  it('sends no revision to a server without change batches', async () => {
    applyMock.mockResolvedValue(saved);
    const { result } = renderPage(yaml, {}, yaml, BUNDLED_CONFIG_CONTRACT, 'base:4');
    await editAndSave(result);
    expect(sentRevisions()).toEqual([undefined]);
  });

  it('keeps the edits after a conflict, and merges them over the latest version', async () => {
    applyMock.mockResolvedValueOnce(conflicted).mockResolvedValueOnce(saved);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(result.current.review.conflict).toBe(true);
    expect(result.current.review.open).toBe(true);
    expect(result.current.review.saveIssues).toEqual([]);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    await act(() => result.current.review.mergeLatest());
    expect(sentRevisions()).toEqual(['base:4', undefined]);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it("does not save from the footer over the other admin's version after a conflict", async () => {
    applyMock.mockResolvedValueOnce(conflicted).mockResolvedValue(saved);
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    rerender({ targetRevision: 'base:5' });
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4']);
    expect(result.current.review.conflict).toBe(true);
    expect(result.current.review.open).toBe(true);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    await act(() => result.current.review.mergeLatest());
    expect(sentRevisions()).toEqual(['base:4', undefined]);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('keeps the revision the edits were made against when the target is re-read meanwhile', async () => {
    storedAt('base:5');
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    act(() => result.current.edits.handleFieldChange('balance.startBalance', 5));
    rerender({ targetRevision: 'base:5' });
    act(() => result.current.save.openReview());
    rerender({ targetRevision: 'base:5' });
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4']);
    expect(result.current.review.conflict).toBe(true);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
  });

  it('conflicts again from a review opened again, until the edits are merged', async () => {
    storedAt('base:5');
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    rerender({ targetRevision: 'base:5' });
    act(() => result.current.review.closeReview());
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
    act(() => result.current.review.openReview());
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4', 'base:4']);
    expect(result.current.review.conflict).toBe(true);
    await act(() => result.current.review.mergeLatest());
    expect(sentRevisions()).toEqual(['base:4', 'base:4', undefined]);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('follows a re-read while no edits are pending', async () => {
    storedAt('base:5');
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    rerender({ targetRevision: 'base:5' });
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['base:5']);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('follows the loaded revision again once the edits are saved', async () => {
    storedAt('base:4');
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    storedAt('base:5');
    rerender({ targetRevision: 'base:5' });
    act(() => result.current.edits.handleFieldChange('balance.startBalance', 6));
    act(() => result.current.save.openReview());
    await act(() => result.current.review.confirm());
    expect(sentRevisions()).toEqual(['base:4', 'base:5']);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('follows the loaded revision again once the edits are discarded', async () => {
    storedAt('base:5');
    const { result, rerender } = renderPage(yaml, {}, yaml, batch, 'base:4');
    act(() => result.current.edits.handleFieldChange('balance.startBalance', 5));
    rerender({ targetRevision: 'base:5' });
    act(() => result.current.edits.handleDiscard());
    await editAndSave(result);
    expect(sentRevisions()).toEqual(['base:5']);
    expect(result.current.edits.editedValues).toEqual({});
  });

  it('says earlier batches stay saved when a later batch of a split save meets a conflict', async () => {
    applyMock.mockResolvedValueOnce({
      ...saved,
      applied: 0,
      partiallyWritten: true,
      failed: [{ path: 'balance.startBalance', code: 'CONFIG_VERSION_CONFLICT', message: 'x' }],
    });
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.edits.saveError).toMatch(/^Save failed partway: the changes written/);
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
  });

  it('says which section holds more changes than one save takes, and keeps the edits', async () => {
    applyMock.mockResolvedValueOnce({
      ...saved,
      applied: 0,
      failed: [
        {
          path: 'balance',
          code: 'TOO_MANY_CHANGES',
          message: 'has 1200 changes',
          params: { count: 1200, limit: 1000 },
        },
      ],
    });
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    expect(result.current.edits.saveError).toBe(
      'Save failed and nothing was changed — Balance has 1,200 changes, more than the 1,000 LibreChat takes in one save: save some of them first, then the rest',
    );
    expect(result.current.edits.editedValues).toEqual({ 'balance.startBalance': 5 });
  });

  it('drops the edits and closes the review on Reload after a conflict', async () => {
    applyMock.mockResolvedValueOnce(conflicted);
    const { result } = renderPage(yaml, {}, yaml, batch, 'base:4');
    await editAndSave(result);
    act(() => result.current.review.reloadLatest());
    expect(result.current.review.conflict).toBe(false);
    expect(result.current.review.open).toBe(false);
    expect(result.current.edits.editedValues).toEqual({});
    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});

describe('hides and removals by key (keyedTombstones)', () => {
  const keyed = createServerContract({
    changesBatch: true,
    expectedRevision: true,
    keyedTombstones: true,
  });
  const gateway = {
    name: 'Gateway',
    apiKey: '${GW_KEY}',
    baseURL: 'https://gw',
    models,
    headers: { 'X-Team': 'blue' },
  };
  const withSpec: t.ConfigRecord = {
    endpoints: { custom: [moonshot, gateway] },
    modelSpecs: {
      list: [{ name: 'gw-spec', label: 'GW Spec', preset: { endpoint: 'Gateway', model: 'm' } }],
    },
  };

  it('lists a hidden endpoint as one entry row, with the model specs it hides and what it deletes', () => {
    const stored = {
      endpoints: { custom: [{ name: 'Gateway', titleModel: 'm', apiKeyPreview: 'sk-...9' }] },
    };
    const config = {
      ...withSpec,
      endpoints: { custom: [moonshot, { ...gateway, titleModel: 'm' }] },
    };
    const { result } = renderPage(config, stored, withSpec, keyed);
    act(() => result.current.edits.handleHideField('endpoints.custom["Gateway"]'));
    const rows = reviewRows(result.current.review);
    expect(rows).toHaveLength(1);
    expect(rows[0].noun).toBeDefined();
    expect(rows[0].item).toMatchObject({
      kind: 'hidden',
      path: 'endpoints.custom.Gateway',
      entryIdentity: 'Gateway',
      sourcePath: 'endpoints.custom["Gateway"]',
      hiddenUses: { specs: ['GW Spec'], addedEndpoints: 'none', allowedProviders: 'none' },
      warnings: ['hideDeletesOwn'],
    });
    expect(rows[0].item.dropped?.map((part) => [part.path, part.secret])).toEqual([
      ['endpoints.custom.1.titleModel', undefined],
      ['endpoints.custom.1.apiKey', true],
    ]);
    act(() => result.current.review.revertRow(rows[0]));
    expect(result.current.edits.visibilityEdits).toEqual({});
  });

  it('says an allow-list naming only the endpoints the save hides allows none', () => {
    const config: t.ConfigRecord = {
      ...withSpec,
      endpoints: {
        custom: [moonshot, gateway],
        agents: { allowedProviders: ['Gateway', 'Moonshot'] },
      },
    };
    const { result } = renderPage(config, {}, config, keyed);
    act(() => result.current.edits.handleHideField('endpoints.custom["Gateway"]'));
    const usesOf = () => reviewRows(result.current.review).map((row) => row.item.hiddenUses);
    expect(usesOf()).toEqual([expect.objectContaining({ allowedProviders: 'dropped' })]);
    act(() => result.current.edits.handleHideField('endpoints.custom["Moonshot"]'));
    expect(usesOf()).toEqual([
      expect.objectContaining({ allowedProviders: 'only' }),
      expect.objectContaining({ allowedProviders: 'only' }),
    ]);
  });

  describe('a header the target also sets itself', () => {
    const own = { endpoints: { custom: [{ name: 'Gateway', headers: { 'X-Team': 'red' } }] } };
    const config: t.ConfigRecord = {
      ...withSpec,
      endpoints: { custom: [moonshot, { ...gateway, headers: { 'X-Team': 'red' } }] },
    };
    const header = 'endpoints.custom["Gateway"].headers.X-Team';

    it('removing it by key reads as its own value removed, which the removal deletes', () => {
      const { result } = renderPage(config, own, withSpec, keyed);
      act(() => result.current.edits.handleHideField(header));
      expect(reviewRows(result.current.review).map((row) => row.item)).toEqual([
        expect.objectContaining({
          kind: 'hidden',
          path: 'endpoints.custom.1.headers.X-Team',
          before: 'red',
          warnings: ['deletesOwnValue'],
          revertTarget: { value: 'blue', source: 'yaml' },
        }),
      ]);
    });

    it('keeps the row as it was where the server stores keyed tombstones without effect', () => {
      const { result } = renderPage(config, own, withSpec, BUNDLED_CONFIG_CONTRACT);
      act(() => result.current.edits.handleUnhideField(header));
      const [row] = reviewRows(result.current.review);
      expect(row.item).toMatchObject({
        kind: 'unhidden',
        path: 'endpoints.custom.1.headers.X-Team',
      });
      expect(row.item.before).toBeUndefined();
      expect(row.item.warnings).toBeUndefined();
    });

    it('showing it again with another value the same save writes reads with that value, in one row', () => {
      const { result } = renderPage(config, own, withSpec, keyed);
      act(() => {
        result.current.edits.handleUnhideField(header);
        result.current.edits.handleFieldChange('endpoints.custom.1', {
          ...gateway,
          headers: { 'X-Team': 'green' },
        });
      });
      const [row, ...rest] = reviewRows(result.current.review);
      expect(rest).toEqual([]);
      expect(row.item).toMatchObject({
        kind: 'unhidden',
        path: 'endpoints.custom.1.headers.X-Team',
        before: 'red',
        after: 'green',
      });
      expect(row.item.warnings).toBeUndefined();
    });

    it('Revert of the row showing it again with another value takes back the value too', () => {
      const { result } = renderPage(config, own, withSpec, keyed);
      act(() => {
        result.current.edits.handleUnhideField(header);
        result.current.edits.handleFieldChange('endpoints.custom.1', {
          ...gateway,
          headers: { 'X-Team': 'green' },
        });
      });
      const [row] = reviewRows(result.current.review);
      act(() => result.current.review.revertRow(row));
      expect(result.current.edits.visibilityEdits).toEqual({});
      expect(result.current.edits.editedValues).toEqual({});
      expect(result.current.edits.isDirty).toBe(false);
      expect(reviewRows(result.current.review)).toEqual([]);
    });

    it('showing it again with the value the layer beneath sets still reads as inherited', () => {
      const { result } = renderPage(config, own, withSpec, keyed);
      act(() => {
        result.current.edits.handleUnhideField(header);
        result.current.edits.handleFieldChange('endpoints.custom.1', gateway);
      });
      expect(reviewRows(result.current.review).map((row) => row.item)).toEqual([
        expect.objectContaining({
          kind: 'unhidden',
          before: 'red',
          after: undefined,
          revertTarget: { value: 'blue', source: 'yaml' },
          warnings: ['deletesOwnValue'],
        }),
      ]);
    });

    it('showing the inherited one again reads as its own value replaced, in one row', () => {
      const { result } = renderPage(config, own, withSpec, keyed);
      act(() => {
        result.current.edits.handleUnhideField(header);
        result.current.edits.handleFieldChange('endpoints.custom.1', { ...gateway, headers: {} });
      });
      expect(reviewRows(result.current.review).map((row) => row.item)).toEqual([
        expect.objectContaining({
          kind: 'unhidden',
          path: 'endpoints.custom.1.headers.X-Team',
          before: 'red',
          warnings: ['deletesOwnValue'],
        }),
      ]);
    });
  });

  it('restoring a removed header and adding it again with another value reads with that value', () => {
    const removed: t.ConfigRecord = {
      ...withSpec,
      endpoints: { custom: [moonshot, { ...gateway, headers: {} }] },
    };
    const { result } = renderPage(removed, {}, withSpec, keyed);
    act(() => {
      result.current.edits.handleUnhideField('endpoints.custom["Gateway"].headers.X-Team');
      result.current.edits.handleFieldChange('endpoints.custom.1', {
        ...gateway,
        headers: { 'X-Team': 'green' },
      });
    });
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'unhidden',
        path: 'endpoints.custom.1.headers.X-Team',
        before: undefined,
        after: 'green',
      }),
    ]);
    render(<ReviewList tabs={result.current.review.model.tabs} isScope={false} />);
    expect(screen.getByText('green')).toBeTruthy();
    expect(screen.queryByText(/inherits/)).toBeNull();
  });

  it('Revert of a removed header restored and set again takes back both, leaving nothing to save', () => {
    const removed: t.ConfigRecord = {
      ...withSpec,
      endpoints: { custom: [moonshot, { ...gateway, headers: {} }] },
    };
    const { result } = renderPage(removed, {}, withSpec, keyed);
    act(() => {
      result.current.edits.handleUnhideField('endpoints.custom["Gateway"].headers.X-Team');
      result.current.edits.handleFieldChange('endpoints.custom.1', {
        ...gateway,
        headers: { 'X-Team': 'green' },
      });
    });
    const rows = reviewRows(result.current.review);
    expect(rows).toHaveLength(1);
    act(() => result.current.review.revertRow(rows[0]));
    expect(result.current.edits.visibilityEdits).toEqual({});
    expect(result.current.edits.editedValues).toEqual({});
    expect(result.current.edits.isDirty).toBe(false);
    expect(reviewRows(result.current.review)).toEqual([]);
  });

  describe('an object-valued additional parameter', () => {
    const provider = 'endpoints.custom["Gateway"].addParams.provider';
    const params = { provider: { order: ['a', 'b'] }, plain: 'x' };
    const yamlParams: t.ConfigRecord = {
      endpoints: { custom: [moonshot, { ...gateway, addParams: params }] },
    };
    const gatewayWith = (addParams: t.ConfigRecord): t.ConfigRecord => ({ ...gateway, addParams });
    const withParams = (addParams: t.ConfigRecord): t.ConfigRecord => ({
      endpoints: { custom: [moonshot, gatewayWith(addParams)] },
    });
    const items = (review: t.ChangeReviewState) => reviewRows(review).map((row) => row.item);

    it('restored and added again with another object reads with that object, in one row', () => {
      const { result } = renderPage(withParams({ plain: 'x' }), {}, yamlParams, keyed);
      act(() => {
        result.current.edits.handleUnhideField(provider);
        result.current.edits.handleFieldChange(
          'endpoints.custom.1',
          gatewayWith({ plain: 'x', provider: { order: ['c'] } }),
        );
      });
      const [row, ...rest] = items(result.current.review);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        kind: 'unhidden',
        path: 'endpoints.custom.1.addParams.provider',
        before: undefined,
        after: { order: ['c'] },
      });
      expect(row.warnings).toBeUndefined();
      render(<ReviewList tabs={result.current.review.model.tabs} isScope={false} />);
      expect(screen.getByText('{order: [c]}')).toBeTruthy();
      expect(screen.queryByText(/inherits/)).toBeNull();
    });

    it('restored and added again as the layer beneath sets it still reads as inherited', () => {
      const { result } = renderPage(withParams({ plain: 'x' }), {}, yamlParams, keyed);
      act(() => {
        result.current.edits.handleUnhideField(provider);
        result.current.edits.handleFieldChange('endpoints.custom.1', gatewayWith(params));
      });
      expect(items(result.current.review)).toEqual([
        expect.objectContaining({
          kind: 'unhidden',
          after: undefined,
          revertTarget: { value: { order: ['a', 'b'] }, source: 'yaml' },
        }),
      ]);
    });

    it('shown again with one leaf of its own object changed reads with the whole object', () => {
      const ownProvider = { order: ['a'], sort: 'price' };
      const own = {
        endpoints: { custom: [{ name: 'Gateway', addParams: { provider: ownProvider } }] },
      };
      const config = withParams({ plain: 'x', provider: ownProvider });
      const { result } = renderPage(config, own, yamlParams, keyed);
      act(() => {
        result.current.edits.handleUnhideField(provider);
        result.current.edits.handleFieldChange(
          'endpoints.custom.1',
          gatewayWith({ plain: 'x', provider: { ...ownProvider, order: ['c'] } }),
        );
      });
      const [row, ...rest] = items(result.current.review);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        kind: 'unhidden',
        before: ownProvider,
        after: { order: ['c'], sort: 'price' },
      });
      expect(row.warnings).toBeUndefined();
    });

    it('Revert of a row restored as the layer beneath sets it takes back the value too', () => {
      const { result } = renderPage(withParams({ plain: 'x' }), {}, yamlParams, keyed);
      act(() => {
        result.current.edits.handleUnhideField(provider);
        result.current.edits.handleFieldChange('endpoints.custom.1', gatewayWith(params));
      });
      const [row] = reviewRows(result.current.review);
      act(() => result.current.review.revertRow(row));
      expect(result.current.edits.visibilityEdits).toEqual({});
      expect(result.current.edits.isDirty).toBe(false);
      expect(reviewRows(result.current.review)).toEqual([]);
    });

    it('Revert of a hide with an edit of its own object pending takes back both', () => {
      const own = {
        endpoints: { custom: [{ name: 'Gateway', addParams: { provider: { order: ['z'] } } }] },
      };
      const config = withParams({ plain: 'x', provider: { order: ['z'] } });
      const { result } = renderPage(config, own, yamlParams, keyed);
      act(() => {
        result.current.edits.handleFieldChange(
          'endpoints.custom.1',
          gatewayWith({ plain: 'x', provider: { order: ['q'] } }),
        );
        result.current.edits.handleHideField(provider);
      });
      const [row] = reviewRows(result.current.review);
      act(() => result.current.review.revertRow(row));
      expect(result.current.edits.visibilityEdits).toEqual({});
      expect(result.current.edits.isDirty).toBe(false);
      expect(reviewRows(result.current.review)).toEqual([]);
    });

    it('hidden with an edit of its own object pending reads as one hide row', () => {
      const own = {
        endpoints: { custom: [{ name: 'Gateway', addParams: { provider: { order: ['z'] } } }] },
      };
      const config = withParams({ plain: 'x', provider: { order: ['z'] } });
      const { result } = renderPage(config, own, yamlParams, keyed);
      act(() => {
        result.current.edits.handleFieldChange(
          'endpoints.custom.1',
          gatewayWith({ plain: 'x', provider: { order: ['q'] } }),
        );
        result.current.edits.handleHideField(provider);
      });
      expect(items(result.current.review)).toEqual([
        expect.objectContaining({
          kind: 'hidden',
          path: 'endpoints.custom.1.addParams.provider',
          before: { order: ['z'] },
          warnings: ['deletesOwnValue'],
        }),
      ]);
    });
  });

  it('lists a removed inherited header as a field row of its endpoint, at its place in the list', () => {
    const { result } = renderPage(withSpec, {}, withSpec, keyed);
    act(() => result.current.edits.handleHideField('endpoints.custom["Gateway"].headers.X-Team'));
    const rows = reviewRows(result.current.review);
    expect(rows.map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'hidden',
        path: 'endpoints.custom.1.headers.X-Team',
        entryPath: 'endpoints.custom.1',
        entryIdentity: 'Gateway',
        revertTarget: { value: 'blue', source: 'yaml' },
      }),
    ]);
  });
});

describe('unhiding a hide of an Azure group by name another client stored', () => {
  const sweden = { group: 'region-sweden', instanceName: 'libre-dall-e', version: 'v1' };
  const groups: t.ConfigRecord = {
    endpoints: { azureOpenAI: { groups: [{ group: 'o4-mini', instanceName: 'o4' }, sweden] } },
  };
  const field = 'endpoints.azureOpenAI.groups["region-sweden"].instanceName';
  const whole = 'endpoints.azureOpenAI.groups["o4-mini"]';
  const derived = createServerContract({
    keyedTombstones: true,
    endpointRederive: true,
    azureGroupMergeKey: true,
    azureGroupSecrets: true,
  });

  it('reads with the value the group gets back, and the group shown again, where LibreChat applies them', () => {
    const { result } = renderPage(groups, {}, groups, derived);
    act(() => {
      result.current.edits.handleUnhideField(field);
      result.current.edits.handleUnhideField(whole);
    });
    expect(reviewRows(result.current.review).map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'unhidden',
        path: 'endpoints.azureOpenAI.groups.o4-mini',
        entryIdentity: 'o4-mini',
        collectionPath: 'endpoints.azureOpenAI.groups',
      }),
      expect.objectContaining({
        kind: 'unhidden',
        path: 'endpoints.azureOpenAI.groups.1.instanceName',
        entryIdentity: 'region-sweden',
        revertTarget: { value: 'libre-dall-e', source: 'yaml' },
      }),
    ]);
    render(<ReviewList tabs={result.current.review.model.tabs} isScope={false} />);
    expect(screen.getByText('libre-dall-e (librechat.yaml)')).toBeTruthy();
  });

  it('keeps the stored path where LibreChat stores them without applying them', () => {
    const { result } = renderPage(
      groups,
      {},
      groups,
      createServerContract({ keyedTombstones: true, azureGroupMergeKey: true }),
    );
    act(() => result.current.edits.handleUnhideField(field));
    const [row] = reviewRows(result.current.review);
    expect(row.item).toMatchObject({ kind: 'unhidden', path: field });
    expect(row.item.revertTarget).toBeUndefined();
  });
});

describe('"Revert all to librechat.yaml" with removals by key (keyedTombstones)', () => {
  const gateway = {
    name: 'Gateway',
    apiKey: '${GW_KEY}',
    baseURL: 'https://gw',
    models,
    headers: { 'X-Team': 'blue', 'X-Org': 'acme' },
  };
  const yamlConfig: t.ConfigRecord = { endpoints: { custom: [moonshot, gateway] } };
  const removal = 'endpoints.custom["Gateway"].headers.X-Team';

  function renderOverrides(
    dbOverrides: t.ConfigRecord,
    dbTombstones: string[],
    contract: t.ConfigContract,
  ) {
    const config: t.ConfigRecord = {
      endpoints: { custom: [moonshot, { ...gateway, headers: { 'X-Org': 'acme' } }] },
    };
    const data: t.BaseConfigData = {
      config,
      yamlConfig,
      yamlPaths: Object.keys(flattenObject(yamlConfig)),
      dbOverrides,
      dbTombstones,
      schemaDefaults: {},
    };
    const layers = {
      configValues: config,
      dbOverrides,
      yamlConfig,
      yamlMcpServers: {},
      schemaDefaults: {},
      schemaPathSet,
      overridePaths: new Set(Object.keys(flattenObject(dbOverrides))),
      valueLayers: createBaseLayers(
        data,
        schemaPathSet,
        undefined,
        contract.features.keyedTombstones,
      ),
      baseActiveConfigValues: config,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    );
    return renderHook(() => useBaseOverrides({ schemaTree: tree, layers }), { wrapper });
  }
  const keyed = createServerContract({ keyedTombstones: true });

  it('counts and lists a removal Base stores alone, which reverting takes back', () => {
    const { result } = renderOverrides({}, [removal], keyed);
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'unhidden',
        path: 'endpoints.custom.1.headers.X-Team',
        entryIdentity: 'Gateway',
        revertTarget: { value: 'blue', source: 'yaml' },
      }),
    ]);
  });

  it('lists a removal in the group of its endpoint, counting the endpoint once', () => {
    const own = { endpoints: { custom: [{ name: 'Gateway', titleModel: 'm' }] } };
    const { result } = renderOverrides(own, [removal], keyed);
    expect(result.current.count).toBe(1);
    const groups = result.current.model.tabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.entries),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['reverted', 'endpoints.custom.0.titleModel'],
      ['unhidden', 'endpoints.custom.0.headers.X-Team'],
    ]);
  });

  it('leaves a removal Base sets its own value over to the row of that value', () => {
    const own = { endpoints: { custom: [{ name: 'Gateway', headers: { 'X-Team': 'red' } }] } };
    const { result } = renderOverrides(own, [removal], keyed);
    expect(reviewRows(result.current).map((row) => [row.item.kind, row.item.path])).toEqual([
      ['reverted', 'endpoints.custom.0.headers.X-Team'],
    ]);
  });

  it('lists nothing for a removal the server stores without effect', () => {
    const { result } = renderOverrides({}, [removal], BUNDLED_CONFIG_CONTRACT);
    expect(result.current.count).toBe(0);
    expect(reviewRows(result.current)).toEqual([]);
  });

  it('counts Azure groups per group only where the server derives them, beside a removal by key', () => {
    const own = {
      endpoints: {
        azureOpenAI: {
          groups: [
            { group: 'eastus', version: '2025-01-01' },
            { group: 'westus', instanceName: 'west', models: { 'gpt-4o': true } },
          ],
        },
      },
    };
    const derived = createServerContract({
      keyedTombstones: true,
      endpointRederive: true,
      azureGroupMergeKey: true,
      azureGroupSecrets: true,
    });
    expect(renderOverrides(own, [removal], derived).result.current.count).toBe(3);
    expect(renderOverrides(own, [removal], keyed).result.current.count).toBe(2);
  });
});

describe('"Revert all to librechat.yaml" with every tombstone Base stores', () => {
  const yamlConfig: t.ConfigRecord = {
    interface: { customWelcome: 'Hi', bookmarks: true },
    endpoints: {
      azureOpenAI: {
        groups: [{ group: 'region-sweden', instanceName: 'libre-dall-e', version: 'v1' }],
      },
    },
  };
  const derived = createServerContract({
    keyedTombstones: true,
    endpointRederive: true,
    azureGroupMergeKey: true,
    azureGroupSecrets: true,
  });
  const groupField = 'endpoints.azureOpenAI.groups["region-sweden"].instanceName';

  function renderOverrides(
    dbOverrides: t.ConfigRecord,
    dbTombstones: string[],
    contract: t.ConfigContract,
  ) {
    const data: t.BaseConfigData = {
      config: yamlConfig,
      yamlConfig,
      yamlPaths: Object.keys(flattenObject(yamlConfig)),
      dbOverrides,
      dbTombstones,
      schemaDefaults: {},
    };
    const layers = {
      configValues: yamlConfig,
      dbOverrides,
      yamlConfig,
      yamlMcpServers: {},
      schemaDefaults: {},
      schemaPathSet,
      overridePaths: new Set(Object.keys(flattenObject(dbOverrides))),
      valueLayers: createBaseLayers(
        data,
        schemaPathSet,
        undefined,
        contract.features.keyedTombstones,
      ),
      baseActiveConfigValues: yamlConfig,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    );
    return renderHook(() => useBaseOverrides({ schemaTree: tree, layers }), { wrapper });
  }

  it('counts and lists a hidden path Base stores alone, with what it gets back', () => {
    const { result } = renderOverrides({}, ['interface.customWelcome'], BUNDLED_CONFIG_CONTRACT);
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'unhidden',
        path: 'interface.customWelcome',
        revertTarget: { value: 'Hi', source: 'yaml' },
      }),
    ]);
    render(<ReviewList tabs={result.current.model.tabs} isScope={false} />);
    expect(screen.getByText('Shown again')).toBeTruthy();
    expect(screen.getByText('Hi (librechat.yaml)')).toBeTruthy();
  });

  it('leaves a hidden path Base sets its own value at to the row of that value', () => {
    const { result } = renderOverrides(
      { interface: { customWelcome: 'Hello' } },
      ['interface.customWelcome'],
      BUNDLED_CONFIG_CONTRACT,
    );
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => [row.item.kind, row.item.path])).toEqual([
      ['reverted', 'interface.customWelcome'],
    ]);
  });

  it('lists a hide of an Azure group setting where LibreChat applies it, counting the group once', () => {
    const { result } = renderOverrides({}, [groupField], derived);
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => row.item)).toEqual([
      expect.objectContaining({
        kind: 'unhidden',
        path: 'endpoints.azureOpenAI.groups.0.instanceName',
        entryIdentity: 'region-sweden',
        revertTarget: { value: 'libre-dall-e', source: 'yaml' },
      }),
    ]);
  });

  it("lists a secret's hide once, without the preview LibreChat stores beside it", () => {
    const { result } = renderOverrides(
      {},
      ['webSearch.tavilyApiKey', 'webSearch.tavilyApiKeyPreview'],
      BUNDLED_CONFIG_CONTRACT,
    );
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => row.item.path)).toEqual([
      'webSearch.tavilyApiKey',
    ]);
  });

  it('lists no hide of an Azure group where LibreChat stores it without applying it', () => {
    const { result } = renderOverrides(
      {},
      [groupField, 'interface.bookmarks'],
      createServerContract({ keyedTombstones: true, azureGroupMergeKey: true }),
    );
    expect(result.current.count).toBe(1);
    expect(reviewRows(result.current).map((row) => row.item.path)).toEqual(['interface.bookmarks']);
  });
});
