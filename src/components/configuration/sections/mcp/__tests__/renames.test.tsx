import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { createServerContract } from '@/test/fixtures';
import { renderTab } from '@/test/page';

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

/** Two servers Base stores with their secrets, read back as masked previews. */
const OVERRIDES: t.ConfigRecord = {
  mcpServers: {
    vault: {
      type: 'streamable-http',
      url: 'https://mcp.vault.dev/mcp',
      title: 'Vault',
      headers: { 'X-Team': 'docs' },
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...4321' },
    },
    keys: {
      type: 'streamable-http',
      url: 'https://mcp.keys.dev/mcp',
      oauth: { client_id: 'keys-id', client_secretPreview: 'sec...1234' },
    },
  },
};

const SERVERS: ReadonlyArray<readonly [string, t.ConfigContract]> = [
  [
    'change batches',
    createServerContract({ recordSecrets: true, changesBatch: true, expectedRevision: true }),
  ],
  ['field PATCHes', createServerContract({ recordSecrets: true })],
];

function card(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${key}"]`);
  if (!element) throw new Error(`no card for ${key}`);
  return element;
}

/** Opens a card after a remount (Discard → Undo leaves it collapsed). */
function expand(key: string) {
  const toggle = card(key).querySelector<HTMLButtonElement>('button[aria-expanded]');
  if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function choose(key: string, action: string) {
  const trigger = within(card(key)).getByRole('button', { name: `Actions for ${key}` });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${action}`) }));
  });
  await nextFrame();
}

async function rename(from: string, to: string) {
  await choose(from, 'Rename');
  const input = screen.getByRole('textbox', { name: `Rename ${from}` });
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await nextFrame();
}

function writesOf(plan: t.WritePlan) {
  return {
    sets: plan.sets.map(({ fieldPath }) => fieldPath),
    resets: plan.resets,
    tombstones: plan.tombstones,
    renames: plan.renames,
    renameHints: plan.renameHints,
  };
}

const NO_WRITES = { sets: [], resets: [], tombstones: [], renames: [], renameHints: [] };

describe.each(SERVERS)('MCP server renames in one edit session, with %s', (mode, contract) => {
  const batch = mode === 'change batches';
  const renderMcp = () => renderTab({ tab: 'mcp', overrides: OVERRIDES, contract });

  it('leaves nothing to save after a rename and back, the stored key with it', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    await rename('vault-kb', 'vault');
    expect(view.edits().editedValues).toEqual({});
    expect(view.edits().renameEdits).toEqual({});
    expect(writesOf(view.plan())).toEqual(NO_WRITES);
    expect(within(card('vault')).queryByText(/Renamed from/)).toBeNull();
    expect(document.querySelector('[data-mcp-deleted="vault"]')).toBeNull();
  });

  it('keeps only the field edits made between a rename and its way back', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    act(() => {
      view.edits().handleFieldChange('mcpServers.vault-kb.title', 'Vault KB');
      view.edits().handleFieldChange('mcpServers.vault-kb.headers.X-Team', undefined);
    });
    await rename('vault-kb', 'vault');
    expect(view.edits().editedValues).toEqual({
      'mcpServers.vault.title': 'Vault KB',
      'mcpServers.vault.headers': undefined,
    });
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    expect(writesOf(plan)).toEqual({
      ...NO_WRITES,
      sets: ['mcpServers.vault.title'],
      resets: ['mcpServers.vault.headers'],
    });
  });

  it('carries the stored key from the saved name through a chain of renames', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    await rename('vault-kb', 'vault-docs');
    expect(view.edits().renameEdits).toEqual({ 'mcpServers.vault-docs': 'mcpServers.vault' });
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    if (batch) {
      expect(plan.renames).toEqual([{ path: 'mcpServers', from: 'vault', to: 'vault-docs' }]);
      expect(plan.resets).toEqual([]);
    } else {
      expect(plan.renameHints).toEqual([
        { path: 'mcpServers', previousName: 'vault', name: 'vault-docs' },
      ]);
      expect(plan.resets).toEqual(['mcpServers.vault']);
    }
    expect(
      within(card('vault-docs')).getByText(/The secrets Base stores for it move with it/),
    ).toBeInTheDocument();
  });

  it('keeps a rename, and the secrets it carries, through Discard and Undo', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    const { snapshot } = view.edits();
    const planned = writesOf(view.plan());
    act(() => view.edits().handleDiscard());
    await nextFrame();
    expect(document.querySelector('[data-mcp-server="vault-kb"]')).toBeNull();
    act(() => view.edits().handleRestoreEdits(snapshot));
    await nextFrame();
    expect(view.edits().renameEdits).toEqual({ 'mcpServers.vault-kb': 'mcpServers.vault' });
    expect(writesOf(view.plan())).toEqual(planned);
    expect(view.plan().issues).toEqual([]);
    expand('vault-kb');
    expect(
      within(card('vault-kb')).getByText(/The secrets Base stores for it move with it/),
    ).toBeInTheDocument();
  });

  it('asks for both secrets again after a swap, which no rename carries, and deletes neither', async () => {
    const view = renderMcp();
    await rename('vault', 'tmp');
    await rename('keys', 'vault');
    await rename('tmp', 'keys');
    const plan = view.plan();
    expect(plan.renames).toEqual([]);
    expect(plan.renameHints).toEqual([]);
    expect(plan.resets).toEqual([]);
    expect(plan.sets.map(({ fieldPath }) => fieldPath).sort()).toEqual([
      'mcpServers.keys',
      'mcpServers.vault',
    ]);
    for (const key of ['vault', 'keys']) {
      expect(within(card(key)).getByText(/Stored secrets are not copied/)).toBeInTheDocument();
    }
    const { snapshot } = view.edits();
    act(() => view.edits().handleDiscard());
    act(() => view.edits().handleRestoreEdits(snapshot));
    await nextFrame();
    for (const key of ['vault', 'keys']) {
      expand(key);
      expect(within(card(key)).getByText(/Stored secrets are not copied/)).toBeInTheDocument();
    }
  });

  it('deletes the saved server when its rename is deleted, and Undo brings the rename back', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    await choose('vault-kb', 'Delete');
    expect(writesOf(view.plan())).toEqual({ ...NO_WRITES, resets: ['mcpServers.vault'] });
    const ghost = document.querySelector<HTMLElement>('[data-mcp-deleted="vault"]');
    if (!ghost) throw new Error('no deleted row');
    fireEvent.click(within(ghost).getByRole('button'));
    await nextFrame();
    expect(view.edits().renameEdits).toEqual({ 'mcpServers.vault-kb': 'mcpServers.vault' });
    await rename('vault-kb', 'vault');
    expect(writesOf(view.plan())).toEqual(NO_WRITES);
  });

  it('gives a duplicate of a renamed server the stored key it carries, or asks for it', async () => {
    const view = renderMcp();
    await rename('vault', 'vault-kb');
    await choose('vault-kb', 'Duplicate');
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    expect(view.edits().copyEdits).toEqual({ 'mcpServers.vault-kb-copy': 'mcpServers.vault' });
    if (batch) {
      expect(plan.renames).toEqual([{ path: 'mcpServers', from: 'vault', to: 'vault-kb' }]);
      expect(
        within(card('vault-kb-copy')).getByText(/Stored secrets are not copied/),
      ).toBeInTheDocument();
    } else {
      expect(plan.renameHints).toEqual([
        { path: 'mcpServers', previousName: 'vault', name: 'vault-kb' },
        { path: 'mcpServers', previousName: 'vault', name: 'vault-kb-copy' },
      ]);
      expect(within(card('vault-kb-copy')).queryByText(/Stored secrets are not copied/)).toBeNull();
    }
    await rename('vault-kb', 'vault');
    const back = view.plan();
    expect(back.resets).toEqual([]);
    expect(back.renames).toEqual([]);
    expect(
      back.sets.every(({ fieldPath }) => fieldPath.startsWith('mcpServers.vault-kb-copy')),
    ).toBe(true);
    expect(back.renameHints).toEqual(
      batch ? [] : [{ path: 'mcpServers', previousName: 'vault', name: 'vault-kb-copy' }],
    );
  });

  it('writes a server deleted and then written again under its name, instead of only deleting it', async () => {
    const view = renderMcp();
    await choose('vault', 'Duplicate');
    await choose('vault', 'Delete');
    await rename('vault-copy', 'vault');
    const plan = view.plan();
    expect(plan.resets).toEqual([]);
    expect(plan.sets).toEqual([
      {
        fieldPath: 'mcpServers.vault',
        value: expect.objectContaining({ url: 'https://mcp.vault.dev/mcp', title: 'Vault copy' }),
      },
    ]);
  });
});

/** Role USER's profile as the profile list reads it: its own title and key for `vault`, and a hide of `keys`. */
const USER_PROFILE: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
  overridePaths: ['mcpServers.vault.title'],
  tombstones: ['mcpServers.keys'],
  storedSecrets: [{ path: 'mcpServers.vault.apiKey.key' }],
};

describe('what a rename or deletion in Base leaves in the profiles that override the server', () => {
  const renderMcp = (profiles: t.ConfigScope[] = [USER_PROFILE]) =>
    renderTab({ tab: 'mcp', overrides: OVERRIDES, contract: SERVERS[0][1], profiles });

  it("says the profile's override and its own key stay under the old name, and moves only Base's secrets", async () => {
    renderMcp();
    await rename('vault', 'vault-kb');
    const notes = within(card('vault-kb'));
    expect(
      notes.getByText(
        'Renamed from "vault". The secrets Base stores for it move with it when you save.',
      ),
    ).toBeInTheDocument();
    expect(
      notes.getByText(
        'Role: USER overrides "vault". The override stays under that name, so its members get "vault-kb" without it, plus a leftover "vault" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      notes.getByText(
        'Role: USER stores its own key for "vault". The key stays under that name too, so its members get "vault-kb" with Base\'s credentials instead.',
      ),
    ).toBeInTheDocument();
  });

  it('says a hide no longer hides the renamed server, and an override follows the name in a swap', async () => {
    renderMcp();
    await rename('keys', 'keys-2');
    expect(
      within(card('keys-2')).getByText(
        'Role: USER hides "keys". The hide stays under that name, so its members can use "keys-2".',
      ),
    ).toBeInTheDocument();
    await rename('keys-2', 'keys');
    await rename('vault', 'tmp');
    await rename('keys', 'vault');
    await rename('tmp', 'keys');
    expect(
      within(card('keys')).getByText(
        'Role: USER overrides "vault". The override stays under that name, so it applies to the one saved as "vault" now, not to "keys".',
      ),
    ).toBeInTheDocument();
  });

  it("says a deleted server's profile override and key stay, on its deleted row", async () => {
    renderMcp();
    await choose('vault', 'Delete');
    const ghost = document.querySelector<HTMLElement>('[data-mcp-deleted="vault"]');
    if (!ghost) throw new Error('no deleted row');
    expect(
      within(ghost).getByText(
        'Role: USER overrides "vault". The override stays, so its members get a leftover "vault" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(ghost).getByText(
        'Role: USER stores its own key for "vault", which stays with its override.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing of profiles where none overrides the server', async () => {
    renderMcp([]);
    await rename('vault', 'vault-kb');
    expect(within(card('vault-kb')).queryByText(/Role: USER/)).toBeNull();
    await choose('vault-kb', 'Delete');
    const ghost = document.querySelector<HTMLElement>('[data-mcp-deleted="vault"]');
    expect(ghost && within(ghost).queryByText(/Role: USER/)).toBeNull();
  });
});

describe('what a Base change does to the own keys and leftover overrides of the profiles (review 4)', () => {
  const rebinding = createServerContract({
    recordSecrets: true,
    secretRebinding: true,
    changesBatch: true,
    expectedRevision: true,
  });
  const renderMcp = (profiles: t.ConfigScope[], contract = rebinding) =>
    renderTab({ tab: 'mcp', overrides: OVERRIDES, contract, profiles });
  const unbound =
    'Role: USER stores its own key for "vault", which LibreChat sends only where it was entered. This save changes where "vault" sends it, so its members get "vault" without that key until it is entered again there.';

  it("names the profile whose own key a server's new URL stops, on the card", () => {
    const view = renderMcp([USER_PROFILE]);
    expect(within(card('vault')).queryByText(/Role: USER/)).toBeNull();
    act(() => view.edits().handleFieldChange('mcpServers.vault.url', 'https://mcp2.vault.dev/mcp'));
    expand('vault');
    expect(within(card('vault')).getByText(unbound)).toBeInTheDocument();
    act(() => view.edits().handleFieldChange('mcpServers.vault.url', 'https://mcp.vault.dev/mcp'));
    expect(within(card('vault')).queryByText(unbound)).toBeNull();
  });

  it('names no profile that sets the URL itself, a transport change alone, or a server without secretRebinding', () => {
    const ownUrl = {
      ...USER_PROFILE,
      overridePaths: ['mcpServers.vault.title', 'mcpServers.vault.url'],
    };
    const view = renderMcp([ownUrl]);
    act(() => view.edits().handleFieldChange('mcpServers.vault.url', 'https://mcp2.vault.dev/mcp'));
    expand('vault');
    expect(within(card('vault')).queryByText(unbound)).toBeNull();
    view.unmount();
    const sse = renderMcp([USER_PROFILE]);
    act(() => sse.edits().handleFieldChange('mcpServers.vault.type', 'sse'));
    expand('vault');
    expect(within(card('vault')).queryByText(unbound)).toBeNull();
    sse.unmount();
    const legacy = renderMcp([USER_PROFILE], SERVERS[0][1]);
    act(() =>
      legacy.edits().handleFieldChange('mcpServers.vault.url', 'https://mcp2.vault.dev/mcp'),
    );
    expect(within(card('vault')).queryByText(unbound)).toBeNull();
  });

  /** Group eng still overrides `ghost`, a name Base no longer uses: its title and its own key. */
  const LEFTOVER: t.ConfigScope = {
    principalType: PrincipalType.GROUP,
    principalId: 'eng',
    name: 'Engineering',
    priority: 20,
    isActive: true,
    overridePaths: ['mcpServers.ghost.title'],
    storedSecrets: [{ path: 'mcpServers.ghost.apiKey.key' }],
  };

  it('names the leftover override a rename onto its name takes, and whether LibreChat sends its key there', async () => {
    renderMcp([LEFTOVER]);
    await rename('keys', 'ghost');
    const notes = within(card('ghost'));
    expect(
      notes.getByText(
        'Group: Engineering still overrides "ghost". The override applies to this one once it is saved under that name, until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      notes.getByText(/^Group: Engineering stores its own key for "ghost" too, entered for/),
    ).toBeInTheDocument();
  });

  it("says a leftover key is sent to the server that takes its name where LibreChat doesn't bind keys", async () => {
    renderMcp([LEFTOVER], SERVERS[0][1]);
    await rename('keys', 'ghost');
    expect(
      within(card('ghost')).getByText(
        'Group: Engineering stores its own key for "ghost" too, which LibreChat sends to this one.',
      ),
    ).toBeInTheDocument();
  });
});
