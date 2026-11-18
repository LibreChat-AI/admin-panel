import '@/locales/i18n';
import { PrincipalType } from 'librechat-data-provider';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  applyConfigChangesFn,
  verifyAdminTokenFn,
  getEffectiveCapabilitiesFn,
  getLangfuseConnectionFn,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from '@/server';
import { LangfuseRenderer } from '@/components/configuration/sections/LangfuseRenderer';
import { RecordObjectField } from '@/components/configuration/fields/RecordObjectField';
import { MimeListField } from '@/components/configuration/fields/MimeListField';
import { NumberField } from '@/components/configuration/fields/NumberField';
import { BUNDLED_CONFIG_CONTRACT, SystemCapabilities } from '@/constants';
import { CodeField } from '@/components/configuration/fields/CodeField';
import { flattenObject, getValueAtPath, sessionFetch } from '@/utils';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { useSessionDrafts, useDraftBaseline } from './pending';
import { DraftsContext } from '@/contexts/DraftsContext';
import { SessionDraftError } from '@/components/shared';
import { useScopeSelection } from './scope';
import { useConfigEdits } from './edits';
import { useConfigSave } from './save';

const { readScopes } = vi.hoisted(() => ({
  readScopes: vi.fn<() => Promise<t.ConfigScope[]>>(),
}));

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock('@/server', () => ({
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: readScopes,
    staleTime: Infinity,
  },
  applyConfigChangesFn: vi.fn(),
  resetBaseConfigFn: vi.fn(),
  verifyAdminTokenFn: vi.fn(),
  getEffectiveCapabilitiesFn: vi.fn(),
  LANGFUSE_CONNECTION_QUERY_KEY: ['adminLangfuseConnection'],
  getLangfuseConnectionFn: vi.fn(),
  testLangfuseConnectionFn: vi.fn(),
  updateLangfuseConnectionFn: vi.fn(),
}));

const PROFILE: t.ConfigScope = {
  _id: 'scope-1',
  principalType: PrincipalType.ROLE,
  principalId: 'ADMIN',
  name: 'Admins',
  priority: 10,
  isActive: true,
};

const INITIAL: t.ConfigRecord = {
  balance: { startBalance: 100 },
  fileConfig: { fileSize: 1 },
  mime: ['image/.*'],
  record: { original: { fileSize: 1 } },
};
const REFRESHED: t.ConfigRecord = {
  balance: { startBalance: 250 },
  fileConfig: { fileSize: 2 },
  mime: ['text/.*'],
  record: {},
};
const LATER: t.ConfigRecord = {
  balance: { startBalance: 500 },
  fileConfig: { fileSize: 3 },
  mime: ['audio/.*'],
  record: {},
};
const NO_FIELDS: t.SchemaField[] = [];
const NO_PATHS = new Set<string>();

function RecoveryEditor({
  kind,
  readBaseline,
}: {
  kind: 'yaml' | 'scalar' | 'mime' | 'langfuse' | 'record' | 'scope';
  readBaseline: () => Promise<t.ConfigRecord>;
}) {
  const { data: loadedConfig } = useQuery({
    queryKey: ['baseConfig'],
    queryFn: readBaseline,
    initialData: INITIAL,
    staleTime: Infinity,
  });
  const drafts = useSessionDrafts();
  const config = useDraftBaseline(loadedConfig, kind === 'record' && drafts.hasPendingDrafts);
  const liveScope = useScopeSelection({
    initialScope: kind === 'scope' ? 'role:ADMIN' : undefined,
  });
  const resolution = useDraftBaseline(
    { editingScope: liveScope.editingScope, scopeNotFound: liveScope.scopeNotFound },
    kind === 'scope' && drafts.hasPendingDrafts,
  );
  const editingScope = kind === 'scope' ? resolution.editingScope : undefined;
  const edits = useConfigEdits({
    isEditingScope: editingScope !== undefined,
    flatBaseline: flattenObject(config),
    scopeResolvedValues: editingScope ? flattenObject(config) : null,
    baseActiveConfigValues: config,
    schemaTree: NO_FIELDS,
    schemaPathSet: NO_PATHS,
  });
  const save = useConfigSave({
    sessionIdentity: { userId: 'admin-1', tenantId: null },
    editingScope,
    sectionPermissions: {},
    canManageConfig: false,
    hasPendingDrafts: drafts.hasPendingDrafts,
    schemaTree: NO_FIELDS,
    schemaPathSet: NO_PATHS,
    edits,
    layers: {
      configValues: config,
      dbOverrides: {},
      yamlConfig: config,
      yamlMcpServers: {},
      schemaDefaults: {},
      overridePaths: new Set(),
      valueLayers: null,
      baseActiveConfigValues: config,
    },
  });
  const currentValue = (path: string) =>
    path in edits.editedValues ? edits.editedValues[path] : getValueAtPath(config, path);
  const balance = currentValue('balance.startBalance');
  const mime = currentValue('mime');
  const patterns = Array.isArray(mime)
    ? mime.filter((pattern): pattern is string => typeof pattern === 'string')
    : undefined;
  return (
    <DraftsContext.Provider
      value={{
        registerDraft: drafts.registerDraft,
        editSessionId: edits.editSessionId,
        sessionError: save.sessionError,
        recoveryError: save.recoveryError,
        blocked: save.sessionError !== null,
        retrySession: save.retrySession,
      }}
    >
      <output aria-label="Loaded baseline">{JSON.stringify(loadedConfig)}</output>
      {save.sessionError && (
        <SessionDraftError
          code={save.sessionError}
          error={save.recoveryError}
          onRetry={save.retrySession}
        />
      )}
      <div style={save.sessionError ? { display: 'none' } : undefined}>
        {kind === 'yaml' && (
          <CodeField
            id="buffer"
            aria-label="Buffer"
            value={currentValue('fileConfig')}
            onChange={(value) => edits.handleFieldChange('fileConfig', value)}
          />
        )}
        {kind === 'scalar' && (
          <NumberField
            id="buffer"
            aria-label="Buffer"
            required
            value={typeof balance === 'number' ? balance : undefined}
            onChange={(value) => edits.handleFieldChange('balance.startBalance', value)}
          />
        )}
        {kind === 'mime' && (
          <MimeListField
            id="buffer"
            path="fileConfig.endpoints.agents.supportedMimeTypes"
            value={patterns}
            inherited={{ patterns: ['image/.*'], origin: 'yaml' }}
            onChange={(value) => edits.handleFieldChange('mime', value)}
            onClear={() => true}
          />
        )}
        {kind === 'record' && (
          <RecordObjectField
            id="record"
            value={currentValue('record')}
            fields={[]}
            onChange={(value) => edits.handleFieldChange('record', value)}
            renderFields={() => null}
          />
        )}
        {kind === 'scope' &&
          (editingScope ? (
            <section aria-label={`Profile ${editingScope.name}`}>
              <NumberField
                id="scope-buffer"
                aria-label="Profile buffer"
                value={typeof balance === 'number' ? balance : undefined}
                required
                onChange={(value) => edits.handleFieldChange('balance.startBalance', value)}
              />
            </section>
          ) : (
            <p>Profile missing</p>
          ))}
        {kind === 'langfuse' && (
          <LangfuseRenderer
            fields={NO_FIELDS}
            parentValue={{}}
            parentPath="langfuse"
            getValue={(_path, fallback) => fallback}
            onChange={vi.fn()}
          />
        )}
        <button onClick={() => liveScope.setScopeSelectorOpen(!liveScope.scopeSelectorOpen)}>
          Toggle profile selector
        </button>
        <output aria-label="Profile selector open">{String(liveScope.scopeSelectorOpen)}</output>
        <button onClick={edits.resetEdits}>Discard</button>
      </div>
    </DraftsContext.Provider>
  );
}

function renderRecovery(kind: 'yaml' | 'scalar' | 'mime' | 'langfuse' | 'record' | 'scope') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const readBaseline = vi.fn().mockResolvedValue(REFRESHED);
  client.setQueryData(['availableScopes'], [PROFILE]);
  render(
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={BUNDLED_CONFIG_CONTRACT}>
        <RecoveryEditor kind={kind} readBaseline={readBaseline} />
      </ConfigContractContext.Provider>
    </QueryClientProvider>,
  );
  return { readBaseline, client };
}

async function failProtectedRead(code: t.SessionErrorCode) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { headers: { 'X-Admin-Session-Error': code } })),
  );
  try {
    await act(async () => {
      await expect(sessionFetch('/background')).rejects.toThrow(code);
    });
  } finally {
    vi.unstubAllGlobals();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  readScopes.mockResolvedValue([]);
  vi.mocked(verifyAdminTokenFn).mockResolvedValue({
    valid: true,
    user: { id: 'admin-1', email: 'admin@example.test', name: 'Admin', role: 'ADMIN' },
    tenantId: null,
  });
  vi.mocked(getEffectiveCapabilitiesFn).mockResolvedValue({
    capabilities: [SystemCapabilities.ACCESS_ADMIN],
  });
  vi.mocked(getLangfuseConnectionFn).mockResolvedValue({
    configured: false,
    enabled: false,
    destinations: [
      { key: 'eu', baseUrl: 'https://cloud.langfuse.com' },
      { key: 'us', baseUrl: 'https://us.cloud.langfuse.com' },
    ],
    promptSync: { available: false, enabled: false },
  });
  vi.mocked(testLangfuseConnectionFn).mockResolvedValue({ success: true });
});

describe('nested inputs through the configuration Retry read', () => {
  for (const code of ['AUTH_SESSION_CHECK_UNAVAILABLE', 'OPENID_SESSION_ENDED'] as const) {
    it.each(['yaml', 'scalar', 'mime'] as const)(
      `keeps an invalid %s buffer when ${code} recovery loads a changed baseline`,
      async (kind) => {
        const { readBaseline, client } = renderRecovery(kind);
        const field = screen.getByLabelText(kind === 'mime' ? 'Pattern 1' : 'Buffer');
        const text = kind === 'scalar' ? '' : '[unfinished';
        fireEvent.change(field, { target: { value: text } });
        fireEvent.blur(field);
        await failProtectedRead(code);
        expect(field).not.toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(field).toBeVisible());
        expect(readBaseline).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText('Loaded baseline')).toHaveTextContent(
          JSON.stringify(REFRESHED),
        );
        expect(field).toHaveDisplayValue(text);
        expect(applyConfigChangesFn).not.toHaveBeenCalled();
        act(() => client.setQueryData(['baseConfig'], LATER));
        await waitFor(() =>
          expect(screen.getByLabelText('Loaded baseline')).toHaveTextContent(JSON.stringify(LATER)),
        );
        expect(field).toHaveDisplayValue(text);
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(field).toHaveDisplayValue(
          { yaml: 'fileSize: 3', mime: 'audio/.*', scalar: '500' }[kind],
        );
      },
    );
  }

  it('keeps a removed parent entry mounted through Retry until its draft is discarded', async () => {
    const { client, readBaseline } = renderRecovery('record');
    fireEvent.click(screen.getByRole('button', { name: /^original/ }));
    const field = screen.getByLabelText('original');
    fireEvent.change(field, { target: { value: '[unfinished' } });
    fireEvent.blur(field);
    await failProtectedRead('AUTH_SESSION_CHECK_UNAVAILABLE');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(field).toBeVisible());
    expect(readBaseline).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['baseConfig'])).toEqual(REFRESHED);
    expect(field).toHaveValue('[unfinished');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(field).not.toBeInTheDocument());
    expect(screen.getByText('No entries configured')).toBeVisible();
  });

  it('keeps a removed selected profile mounted through Retry until its draft is discarded', async () => {
    const { client } = renderRecovery('scope');
    const field = screen.getByLabelText('Profile buffer');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle profile selector' }));
    expect(screen.getByLabelText('Profile selector open')).toHaveTextContent('true');
    await failProtectedRead('OPENID_SESSION_ENDED');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(field).toBeVisible());
    expect(readScopes).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['availableScopes'])).toEqual([]);
    expect(field).toHaveDisplayValue('');
    expect(screen.getByRole('region', { name: 'Profile Admins' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle profile selector' }));
    expect(screen.getByLabelText('Profile selector open')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(field).not.toBeInTheDocument());
    expect(screen.getByText('Profile missing')).toBeVisible();
  });

  it('closes a real Langfuse Select portal and keeps its pending key during recovery', async () => {
    renderRecovery('langfuse');
    const key = await screen.findByLabelText('Public key');
    fireEvent.change(key, { target: { value: 'pk-lf-pending' } });
    fireEvent.click(screen.getByTestId('select-trigger'));
    expect(await screen.findByText('us - https://us.cloud.langfuse.com')).toBeVisible();
    await failProtectedRead('AUTH_SESSION_CHECK_UNAVAILABLE');
    expect(screen.queryByText('us - https://us.cloud.langfuse.com')).not.toBeInTheDocument();
    expect(key).toHaveValue('pk-lf-pending');
    expect(testLangfuseConnectionFn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(key).toBeVisible());
    expect(key).toHaveValue('pk-lf-pending');
  });

  it('does not turn a late Langfuse verification into a write after recovery blocks it', async () => {
    let finish: (result: { success: boolean }) => void = () => undefined;
    vi.mocked(testLangfuseConnectionFn).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderRecovery('langfuse');
    fireEvent.click(await screen.findByTestId('select-trigger'));
    fireEvent.click(await screen.findByText('eu - https://cloud.langfuse.com'));
    fireEvent.change(screen.getByLabelText('Public key'), { target: { value: 'pk-lf-pending' } });
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk-lf-pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & enable' }));
    await waitFor(() => expect(testLangfuseConnectionFn).toHaveBeenCalledTimes(1));
    await failProtectedRead('OPENID_SESSION_ENDED');
    await act(async () => finish({ success: true }));
    expect(updateLangfuseConnectionFn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByLabelText('Secret key')).toBeVisible());
    expect(screen.getByLabelText('Public key')).toHaveValue('pk-lf-pending');
    expect(screen.getByLabelText('Secret key')).toHaveValue('sk-lf-pending');
    expect(updateLangfuseConnectionFn).not.toHaveBeenCalled();
  });
});
