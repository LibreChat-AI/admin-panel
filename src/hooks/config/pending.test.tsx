import '@/locales/i18n';
import { useState, useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { holdSessionRedirects, hasSessionRedirectHold, notifySessionRedirectHolds } from '@/utils';
import { AzureGroupsTable } from '@/components/configuration/sections/providers/AzureGroups';
import { RecordObjectField } from '@/components/configuration/fields/RecordObjectField';
import { CreateMcpServerDialog } from '@/components/configuration/sections/mcp/Create';
import { EndpointCreator } from '@/components/configuration/sections/endpoints/Create';
import { EndpointDrawer } from '@/components/configuration/sections/endpoints/Drawer';
import { DomainListField } from '@/components/configuration/fields/DomainListField';
import { ObjectEntryCard } from '@/components/configuration/fields/ObjectEntryCard';
import { PricingRow } from '@/components/configuration/sections/endpoints/Pricing';
import { ModelListField } from '@/components/configuration/fields/ModelListField';
import { KeyValueField } from '@/components/configuration/fields/KeyValueField';
import { MimeListField } from '@/components/configuration/fields/MimeListField';
import { ScopePriorityEditor } from '@/components/configuration/ScopePriority';
import { McpServerCard } from '@/components/configuration/sections/mcp/Card';
import { CodeField } from '@/components/configuration/fields/CodeField';
import { TextField } from '@/components/configuration/fields/TextField';
import { ListField } from '@/components/configuration/fields/ListField';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { useSessionDraft, useSessionDrafts } from './pending';
import { DraftsContext } from '@/contexts/DraftsContext';
import { SessionDraftError } from '@/components/shared';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { useDraftValue } from './draft';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ navigate: vi.fn() }),
}));

function DraftOwner({ children }: { children: ReactNode }) {
  const drafts = useSessionDrafts();
  const [sessionError, setSessionError] = useState<t.SessionErrorCode | null>(null);
  useLayoutEffect(() => {
    if (!drafts.hasPendingDrafts && !sessionError) return;
    return holdSessionRedirects(setSessionError);
  }, [drafts.hasPendingDrafts, sessionError]);
  return (
    <DraftsContext.Provider
      value={{
        registerDraft: drafts.registerDraft,
        editSessionId: 0,
        sessionError,
        recoveryError: null,
        blocked: sessionError !== null,
        retrySession: async () => setSessionError(null),
      }}
    >
      <output aria-label="Pending input">{String(drafts.hasPendingDrafts)}</output>
      {sessionError && (
        <SessionDraftError
          code={sessionError}
          error={null}
          onRetry={async () => setSessionError(null)}
        />
      )}
      <div style={sessionError ? { display: 'none' } : undefined}>{children}</div>
    </DraftsContext.Provider>
  );
}

function renderDraft(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={BUNDLED_CONFIG_CONTRACT}>
        <DraftOwner>{children}</DraftOwner>
      </ConfigContractContext.Provider>
    </QueryClientProvider>,
  );
}

function PendingInput({ name }: { name: string }) {
  const [value, setValue] = useState('');
  useSessionDraft(value !== '');
  return <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} />;
}

describe('nested configuration draft recovery', () => {
  it('keeps another owner registered when one input becomes clean or unmounts', () => {
    const { rerender, unmount } = render(
      <DraftOwner>
        <PendingInput key="first" name="First" />
        <PendingInput key="second" name="Second" />
      </DraftOwner>,
    );
    fireEvent.change(screen.getByLabelText('First'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'two' } });
    fireEvent.change(screen.getByLabelText('First'), { target: { value: '' } });
    expect(hasSessionRedirectHold()).toBe(true);
    rerender(
      <DraftOwner>
        <PendingInput key="second" name="Second" />
      </DraftOwner>,
    );
    expect(hasSessionRedirectHold()).toBe(true);
    expect(screen.getByLabelText('Second')).toHaveValue('two');
    unmount();
    expect(hasSessionRedirectHold()).toBe(false);
  });

  for (const code of ['AUTH_SESSION_CHECK_UNAVAILABLE', 'OPENID_SESSION_ENDED'] as const) {
    it.each([
      {
        name: 'invalid YAML',
        control: <CodeField id="yaml" value={{}} onChange={vi.fn()} aria-label="Draft" />,
        open: () => undefined,
        input: () => screen.getByLabelText('Draft'),
        text: '[unfinished',
      },
      {
        name: 'a rejected scalar',
        control: (
          <TextField id="scalar" value="required" required onChange={vi.fn()} aria-label="Draft" />
        ),
        open: () => undefined,
        input: () => screen.getByLabelText('Draft'),
        text: '',
      },
      {
        name: 'an uncommitted list item',
        control: <ListField id="list" values={[]} onChange={vi.fn()} />,
        open: () => fireEvent.click(screen.getByRole('button', { name: 'Add item' })),
        input: () => screen.getByRole('textbox'),
        text: 'pending-item',
      },
      {
        name: 'an uncommitted record key',
        control: (
          <RecordObjectField
            id="record"
            value={{}}
            fields={[]}
            renderFields={() => null}
            onChange={vi.fn()}
          />
        ),
        open: () => fireEvent.click(screen.getByRole('button', { name: 'Add entry' })),
        input: () => screen.getByRole('textbox'),
        text: 'pending-key',
      },
      {
        name: 'a key/value draft row',
        control: <KeyValueField id="pairs" pairs={[]} onChange={vi.fn()} />,
        open: () => fireEvent.click(screen.getByRole('button', { name: 'Add entry' })),
        input: () => screen.getAllByRole('textbox')[0],
        text: 'pending-header',
      },
      {
        name: 'a rejected domain',
        control: (
          <DomainListField
            id="domain"
            path="mcpSettings.allowedDomains"
            values={[]}
            hasOwnValue
            onChange={vi.fn()}
            onClear={() => true}
          />
        ),
        open: () => undefined,
        input: () => screen.getByRole('textbox'),
        text: 'bad domain',
      },
      {
        name: 'a pending model name',
        control: (
          <ModelListField
            id="models"
            value={[]}
            defaults={[]}
            onChange={vi.fn()}
            onClear={() => true}
          />
        ),
        open: () => undefined,
        input: () => screen.getByRole('textbox'),
        text: 'pending-model',
      },
      {
        name: 'a rejected MIME pattern',
        control: (
          <MimeListField
            id="mime"
            path="fileConfig.endpoints.agents.supportedMimeTypes"
            value={['image/.*']}
            inherited={{ patterns: ['image/.*'], origin: 'yaml' }}
            onChange={vi.fn()}
            onClear={() => true}
          />
        ),
        open: () => undefined,
        input: () => screen.getByLabelText('Pattern 1'),
        text: '[unfinished',
      },
      {
        name: 'an invalid scope priority',
        control: (
          <ScopePriorityEditor
            scope={{
              principalType: PrincipalType.ROLE,
              principalId: 'ADMIN',
              name: 'Admins',
              priority: 10,
              isActive: true,
            }}
          />
        ),
        open: () => fireEvent.click(screen.getByRole('button', { name: 'Change priority' })),
        input: () => screen.getByLabelText('Priority'),
        text: '',
      },
      {
        name: 'a pricing model name',
        control: (
          <PricingRow
            path="endpoints.custom.0.tokenConfig"
            value={{}}
            models={[]}
            lockedModels={new Set()}
            onChange={vi.fn()}
          />
        ),
        open: () => undefined,
        input: () => screen.getByLabelText('Model to price, e.g. gpt-4o-mini'),
        text: 'pending-priced-model',
      },
      {
        name: 'an Azure group name',
        control: (
          <AzureGroupsTable path="endpoints.azureOpenAI.groups" value={[]} onChange={vi.fn()} />
        ),
        open: () => fireEvent.click(screen.getByRole('button', { name: 'Add group' })),
        input: () => screen.getByLabelText('Name of the new Azure group'),
        text: 'pending-azure-group',
      },
      {
        name: 'an MCP server rename',
        control: (
          <McpServerCard
            serverKey="original"
            path="mcpServers"
            value={{}}
            badges={{ source: 'admin', overrides: 0, edited: false, isNew: false }}
            actions={[]}
            readOnly={false}
            renaming
            onRenameCommit={() => null}
            onRenameCancel={vi.fn()}
            defaultExpanded={false}
          >
            {null}
          </McpServerCard>
        ),
        open: () => undefined,
        input: () => screen.getByLabelText('Rename original'),
        text: 'pending-mcp-name',
      },
      {
        name: 'an object rename',
        control: (
          <ObjectEntryCard
            entryKey="original"
            fields={[]}
            value={{}}
            renderFields={() => null}
            onValueChange={vi.fn()}
            onRename={vi.fn()}
          />
        ),
        open: () => fireEvent.click(screen.getByRole('button', { name: /Rename/ })),
        input: () => screen.getByRole('textbox'),
        text: 'pending-name',
      },
    ])('preserves $name through ' + code, async ({ control, open, input, text }) => {
      renderDraft(control);
      open();
      const field = input();
      fireEvent.change(field, { target: { value: text } });
      expect(hasSessionRedirectHold()).toBe(true);
      act(() => notifySessionRedirectHolds(code));
      expect(field).toBeInTheDocument();
      expect(field).toHaveDisplayValue(text);
      expect(field).not.toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(field).toHaveDisplayValue(text);
      expect(field).toBeVisible();
    });
  }

  it.each(['endpoint', 'MCP server'] as const)(
    'keeps an unfinished %s in its existing creation dialog',
    (kind) => {
      const onClose = vi.fn();
      const onCreate = vi.fn();
      const none: ReadonlySet<string> = new Set();
      renderDraft(
        kind === 'endpoint' ? (
          <EndpointCreator
            open
            fields={[
              {
                key: 'name',
                path: 'endpoints.custom.[].name',
                type: 'string',
                isOptional: false,
                depth: 3,
              },
            ]}
            names={[]}
            inheritedNames={[]}
            onCreate={onCreate}
            onOverride={vi.fn()}
            onClose={onClose}
          />
        ) : (
          <CreateMcpServerDialog
            open
            onClose={onClose}
            onCreate={onCreate}
            onOverride={vi.fn()}
            onUnhide={vi.fn()}
            fields={[]}
            existingKeys={none}
            inheritedKeys={none}
            hiddenKeys={none}
          />
        ),
      );
      if (kind === 'endpoint') {
        fireEvent.click(screen.getByRole('button', { name: /Blank endpoint/ }));
      }
      const dialog = screen.getByRole('dialog');
      const field =
        kind === 'endpoint'
          ? within(dialog).getByRole('textbox')
          : within(dialog).getByPlaceholderText('e.g. github or acme-docs');
      fireEvent.change(field, { target: { value: 'unfinished-name' } });
      expect(hasSessionRedirectHold()).toBe(true);
      act(() => notifySessionRedirectHolds('AUTH_SESSION_CHECK_UNAVAILABLE'));
      expect(field).toBeInTheDocument();
      expect(field).toHaveDisplayValue('unfinished-name');
      expect(field).not.toBeVisible();
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
      expect(field).toHaveDisplayValue('unfinished-name');
      expect(field).toBeVisible();
    },
  );

  it('shows recovery inside a portal drawer and keeps its buffered input mounted', () => {
    function BufferedInput() {
      const { draft, setDraft, commit } = useDraftValue({
        value: '',
        onCommit: () => false,
        delay: 0,
      });
      return (
        <textarea
          aria-label="Drawer draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      );
    }
    const onSave = vi.fn();
    renderDraft(
      <EndpointDrawer
        open
        title="Create endpoint"
        onClose={vi.fn()}
        footer={<button onClick={onSave}>Create</button>}
      >
        <BufferedInput />
      </EndpointDrawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Create endpoint' });
    const field = within(dialog).getByLabelText('Drawer draft');
    fireEvent.change(field, { target: { value: 'unfinished input' } });
    fireEvent.blur(field);
    act(() => notifySessionRedirectHolds('OPENID_SESSION_ENDED'));
    expect(field).toBeInTheDocument();
    expect(field).toHaveDisplayValue('unfinished input');
    expect(field).not.toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Create' })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(field).toHaveDisplayValue('unfinished input');
    expect(field).toBeVisible();
  });
});
