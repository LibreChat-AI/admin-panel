import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { fireEvent, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { createServerContract } from '@/test/fixtures';
import { renderTab } from '@/test/page';

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

function endpoint(name: string, host: string): t.ConfigRecord {
  return {
    name,
    baseURL: `https://${host}.example.com/v1`,
    apiKeyPreview: 'sk-...1234',
    models: { default: ['m-1'] },
  };
}

/** Two endpoints Base stores with their API keys, read back as masked previews. */
const OVERRIDES: t.ConfigRecord = {
  endpoints: { custom: [endpoint('Alpha', 'alpha'), endpoint('Beta', 'beta')] },
};

const SERVERS: ReadonlyArray<readonly [string, t.ConfigContract]> = [
  [
    'change batches',
    createServerContract({ recordSecrets: true, changesBatch: true, expectedRevision: true }),
  ],
  ['field PATCHes', createServerContract({ recordSecrets: true })],
];

/** Opens the editor of the endpoint listed as `name`. */
function open(name: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(
    `[data-endpoint-row="${name}"] button[aria-haspopup="dialog"]`,
  );
  if (!button) throw new Error(`no row for ${name}`);
  fireEvent.click(button);
  return screen.getByRole('dialog');
}

function close(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
}

/** Types a new name into the open editor of the endpoint at `index`. */
function rename(index: number, name: string) {
  const input = document.querySelector<HTMLInputElement>(`input#endpoints-custom-${index}-name`);
  if (!input) throw new Error(`no name input at ${index}`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.blur(input);
}

function namesOf(plan: t.WritePlan): string[] {
  const list = plan.sets.find(({ fieldPath }) => fieldPath === 'endpoints.custom')?.value;
  return (Array.isArray(list) ? list : []).map((entry) => String((entry as t.ConfigRecord).name));
}

describe.each(SERVERS)('Custom endpoint renames in one edit session, with %s', (mode, contract) => {
  const batch = mode === 'change batches';
  const renderCustom = () => renderTab({ tab: 'custom', overrides: OVERRIDES, contract });

  it('leaves nothing to save after a rename and back, the stored key with it', () => {
    const view = renderCustom();
    open('Alpha');
    rename(0, 'Gamma');
    rename(0, 'Alpha');
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    expect(plan.sets).toEqual([]);
    expect(plan.resets).toEqual([]);
    expect(plan.renames).toEqual([]);
  });

  it('moves the stored key once along a chain of renames, or asks for it', () => {
    const view = renderCustom();
    open('Alpha');
    rename(0, 'Gamma');
    rename(0, 'Delta');
    const plan = view.plan();
    if (batch) {
      expect(plan.issues).toEqual([]);
      expect(plan.renames).toEqual([{ path: 'endpoints.custom', from: 'Alpha', to: 'Delta' }]);
      expect(namesOf(plan)).toEqual(['Delta', 'Beta']);
    } else {
      expect(plan.issues.map(({ code }) => code)).toEqual(['SECRET_REQUIRED_FOR_RENAME']);
    }
    expect(plan.resets).toEqual([]);
  });

  it('asks for the keys of a swap and writes nothing until they are entered', () => {
    const view = renderCustom();
    open('Alpha');
    rename(0, 'Tmp');
    close(screen.getByRole('dialog'));
    open('Beta');
    rename(1, 'Alpha');
    close(screen.getByRole('dialog'));
    open('Tmp');
    rename(0, 'Beta');
    const plan = view.plan();
    expect(plan.issues.map(({ code }) => code)).toContain('SECRET_REQUIRED_FOR_RENAME');
    expect(plan.renames).toEqual([]);
  });

  it('deletes the saved endpoint, key and all, when its rename is deleted', () => {
    const view = renderCustom();
    const dialog = open('Alpha');
    rename(0, 'Gamma');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete endpoint' }));
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    expect(plan.renames).toEqual([]);
    expect(namesOf(plan)).toEqual(['Beta']);
  });
});

/** Role USER's profile as the profile list reads it: its own key for Base's `Alpha`. */
const USER_PROFILE: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
  overridePaths: ['endpoints.custom'],
  overrideEntries: { 'endpoints.custom': ['Alpha'] },
  storedSecrets: [{ path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Alpha' } }],
};

describe('what a rename or removal in Base leaves in the profiles that override the endpoint', () => {
  const renderCustom = (profiles: t.ConfigScope[] = [USER_PROFILE]) =>
    renderTab({ tab: 'custom', overrides: OVERRIDES, contract: SERVERS[0][1], profiles });

  it("says in the editor that the profile's override and its own key stay under the old name", () => {
    renderCustom();
    const dialog = open('Alpha');
    expect(within(dialog).queryByText(/Role: USER/)).toBeNull();
    rename(0, 'Gamma');
    expect(
      within(dialog).getByText(
        'Role: USER overrides "Alpha". The override stays under that name, so its members get "Gamma" without it, plus a leftover "Alpha" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Role: USER stores its own key for "Alpha". The key stays under that name too, so its members get "Gamma" with Base\'s credentials instead.',
      ),
    ).toBeInTheDocument();
    rename(0, 'Alpha');
    expect(within(dialog).queryByText(/Role: USER/)).toBeNull();
  });

  it("says on a removed endpoint's row that the profile's override and key stay", () => {
    renderCustom();
    const dialog = open('Alpha');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete endpoint' }));
    const list = screen.getByRole('list', { name: /endpoints/i });
    expect(
      within(list).getByText(
        'Role: USER overrides "Alpha". The override stays, so its members get a leftover "Alpha" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(
        'Role: USER stores its own key for "Alpha", which stays with its override.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing of profiles where none overrides the endpoint', () => {
    renderCustom([]);
    const dialog = open('Alpha');
    rename(0, 'Gamma');
    expect(within(dialog).queryByText(/Role: USER/)).toBeNull();
  });
});

describe('what a Base change does to the own keys and leftover overrides of the profiles (review 4)', () => {
  const rebinding = createServerContract({
    recordSecrets: true,
    secretRebinding: true,
    changesBatch: true,
    expectedRevision: true,
  });
  const renderCustom = (profiles: t.ConfigScope[], contract = rebinding) =>
    renderTab({ tab: 'custom', overrides: OVERRIDES, contract, profiles });
  const unbound =
    'Role: USER stores its own key for "Alpha", which LibreChat sends only where it was entered. This save changes where "Alpha" sends it, so its members get "Alpha" without that key until it is entered again there.';

  /** Types a new base URL into the open editor of the endpoint at `index`. */
  function setBaseUrl(index: number, url: string) {
    const input = document.querySelector<HTMLInputElement>(
      `input#endpoints-custom-${index}-baseURL`,
    );
    if (!input) throw new Error(`no base URL input at ${index}`);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: url } });
    fireEvent.blur(input);
  }

  it("names the profile whose own key the endpoint's new base URL stops, in the editor", () => {
    renderCustom([USER_PROFILE]);
    const dialog = open('Alpha');
    expect(within(dialog).queryByText(unbound)).toBeNull();
    setBaseUrl(0, 'https://alpha2.example.com/v1');
    expect(within(dialog).getByText(unbound)).toBeInTheDocument();
  });

  it('names no profile that sets its own base URL, or on a server without secretRebinding', () => {
    const ownUrl: t.ConfigScope = {
      ...USER_PROFILE,
      overrideEntryPaths: { 'endpoints.custom': { Alpha: ['baseURL'] } },
    };
    const view = renderCustom([ownUrl]);
    const own = open('Alpha');
    setBaseUrl(0, 'https://alpha2.example.com/v1');
    expect(within(own).queryByText(unbound)).toBeNull();
    view.unmount();
    renderCustom([USER_PROFILE], SERVERS[0][1]);
    const dialog = open('Alpha');
    setBaseUrl(0, 'https://alpha2.example.com/v1');
    expect(within(dialog).queryByText(unbound)).toBeNull();
  });

  it('names the leftover override a rename onto its name takes', () => {
    const leftover: t.ConfigScope = {
      ...USER_PROFILE,
      overrideEntries: { 'endpoints.custom': ['Gamma'] },
      storedSecrets: [
        { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Gamma' } },
      ],
    };
    renderCustom([leftover]);
    const dialog = open('Alpha');
    rename(0, 'Gamma');
    expect(
      within(dialog).getByText(
        'Role: USER still overrides "Gamma". The override applies to this one once it is saved under that name, until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/^Role: USER stores its own key for "Gamma" too, entered for/),
    ).toBeInTheDocument();
  });
});
