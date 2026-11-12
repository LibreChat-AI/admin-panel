import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createToast } from '@clickhouse/click-ui';
import { configSchema, PrincipalType } from 'librechat-data-provider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { isLabelInName, visibleText } from '@/test/a11y';
import { holdErrorToasts, notifyError } from '@/utils';
import { summarizeChanges, applySaves } from './diff';
import { extractSchemaTree } from '@/server/config';
import { ChangeReview } from './ChangeReview';
import { buildReviewModel } from './group';
import { ChangesBar } from './ChangesBar';
import i18n from '@/locales/i18n';

vi.mock('@clickhouse/click-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clickhouse/click-ui')>();
  return { ...actual, createToast: vi.fn() };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const localize: t.LocalizeFn = (key, options) => i18n.t(key, options ?? {});

const baseline: t.ConfigRecord = {
  endpoints: {
    custom: [
      { name: 'Moonshot', baseURL: 'https://api.moonshot.ai/v1', apiKey: '${MOONSHOT_KEY}' },
      { name: 'Zai 2', baseURL: 'https://zai.example/v1' },
    ],
  },
  registration: { socialLogins: ['openid', 'google'] },
};

function reviewFor(
  saves: t.SaveEntry[],
  overrides: Partial<t.ChangeReviewState> = {},
  issues: t.ReviewIssue[] = [],
): t.ChangeReviewState {
  const items = summarizeChanges({
    saves,
    resets: [],
    baseline,
    ownAt: () => undefined,
    isOwned: () => true,
    lowerAt: () => undefined,
    yamlEntries: () => new Set(['Zai 2']),
    isScope: false,
    fields: tree,
    schemaPaths: new Set(),
  });
  const model = buildReviewModel(
    items,
    { localize, fields: tree, tree: applySaves(baseline, saves) },
    issues,
  );
  return {
    model,
    open: true,
    saving: false,
    sessionExpired: false,
    termsUrl: null,
    conflict: false,
    reloadLatest: vi.fn(),
    mergeLatest: vi.fn().mockResolvedValue(undefined),
    saveIssues: [],
    title: 'Review',
    blocked: issues.some((issue) => issue.blocking),
    isDirty: true,
    openReview: vi.fn(),
    closeReview: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    revertRow: vi.fn(),
    goToRow: vi.fn(),
    discardAll: vi.fn(),
    ...overrides,
  };
}

describe('ChangeReview', () => {
  it('offers to sign in again, in a new tab, when the session ended', () => {
    render(
      <ChangeReview
        review={reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }], {
          sessionExpired: true,
          saveIssues: [{ message: 'Your session ended', blocking: false }],
        })}
      />,
    );
    const link = screen.getByRole('link', { name: /sign in again/i });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links to LibreChat to accept its terms when a save was refused until the admin does', () => {
    render(
      <ChangeReview
        review={reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }], {
          termsUrl: 'https://chat.example.com',
          saveIssues: [{ message: 'LibreChat refused the save', blocking: false }],
        })}
      />,
    );
    const link = screen.getByRole('link', { name: /accept the terms/i });
    expect(link).toHaveAttribute('href', 'https://chat.example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('offers to reload or merge when the target was saved elsewhere meanwhile', () => {
    const review = reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }], {
      conflict: true,
    });
    render(<ChangeReview review={review} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Changed elsewhere');
    expect(alert).toHaveTextContent(/Base configuration was saved elsewhere/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
    expect(review.reloadLatest).toHaveBeenCalledTimes(1);
    fireEvent.click(within(alert).getByRole('button', { name: 'Merge and save' }));
    expect(review.mergeLatest).toHaveBeenCalledTimes(1);
  });

  it('keeps the footer Save disabled while the conflict waits for Reload or Merge', () => {
    const edit = [{ fieldPath: 'registration.socialLogins', value: ['openid'] }];
    const { unmount } = render(<ChangeReview review={reviewFor(edit, { conflict: true })} />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeDisabled();
    unmount();
    render(<ChangeReview review={reviewFor(edit)} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('names the profile that was saved elsewhere', () => {
    const scope = {
      principalType: 'role',
      principalId: 'USER',
      name: 'USER',
    } as t.ConfigScope;
    render(
      <ChangeReview
        review={reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }], {
          conflict: true,
          scope,
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/USER was saved elsewhere/);
  });

  it('shows list changes as added and removed items', () => {
    render(
      <ChangeReview
        review={reviewFor([
          { fieldPath: 'registration.socialLogins', value: ['openid', 'github'] },
        ])}
      />,
    );
    expect(screen.getByLabelText('Added: github')).toBeInTheDocument();
    expect(screen.getByLabelText('Removed: google')).toBeInTheDocument();
    expect(screen.getByText('Social logins')).toBeInTheDocument();
  });

  it('shows a keyed list change per entry, by name', () => {
    const value = [
      { name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1', apiKey: '${MOONSHOT_KEY}' },
    ];
    render(<ChangeReview review={reviewFor([{ fieldPath: 'endpoints.custom', value }])} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Zai 2')).toBeInTheDocument();
    expect(within(dialog).getByText('Removed endpoint')).toBeInTheDocument();
    expect(within(dialog).getByText('Moonshot')).toBeInTheDocument();
    expect(within(dialog).getByText('Base URL')).toBeInTheDocument();
    expect(within(dialog).getByText('https://api.moonshot.cn/v1')).toBeInTheDocument();
    expect(dialog.textContent).not.toContain('apiKey:');
  });

  it('never renders a typed secret', () => {
    const value = [
      { name: 'Moonshot', baseURL: 'https://api.moonshot.ai/v1', apiKey: 'sk-typed-secret' },
      { name: 'Zai 2', baseURL: 'https://zai.example/v1' },
      { name: 'New', baseURL: 'https://new.example', apiKey: 'sk-new-secret' },
    ];
    render(<ChangeReview review={reviewFor([{ fieldPath: 'endpoints.custom', value }])} />);
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toContain('sk-typed-secret');
    expect(text).not.toContain('sk-new-secret');
    expect(text).toContain('${MOONSHOT_KEY}');
    expect(text).toContain('Will be replaced (hidden)');
    expect(text).toContain('Will be set (hidden)');
  });

  it('disables Save while blocking problems exist and offers to jump to the first', () => {
    const issue: t.ReviewIssue = {
      path: 'registration.socialLogins',
      label: 'System › Registration › Social logins',
      message: 'Invalid',
      blocking: true,
    };
    const review = reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }], {}, [
      issue,
    ]);
    render(<ChangeReview review={review} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to first error' }));
    expect(review.goToRow).toHaveBeenCalledWith(issue);
  });

  it('wires per-row Revert and Go to field', () => {
    const review = reviewFor([{ fieldPath: 'registration.socialLogins', value: ['openid'] }]);
    render(<ChangeReview review={review} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revert Social logins' }));
    const goTo = screen.getByRole('button', { name: 'Go to field: Social logins' });
    expect(isLabelInName(visibleText(goTo), goTo.getAttribute('aria-label') ?? '')).toBe(true);
    fireEvent.click(goTo);
    expect(review.revertRow).toHaveBeenCalledTimes(1);
    expect(review.goToRow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('error toasts', () => {
  it('are held while the review shows errors itself, and summarized otherwise', () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const release = holdErrorToasts();
    notifyError('Validation failed — a.b: bad');
    expect(toast).not.toHaveBeenCalled();
    release();
    notifyError('Validation failed — a.b: bad; c.d: worse');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Validation failed', description: 'a.b: bad\nc.d: worse' }),
    );
  });
});

describe('ChangeReview — what a change deletes with it', () => {
  it("lists under a hide what it deletes of the profile's own settings, never a stored key", () => {
    const hidden: t.ChangeSummaryItem = {
      path: 'mcpServers.salesforce',
      kind: 'hidden',
      before: undefined,
      after: undefined,
      warnings: ['hideDeletesOwn'],
      dropped: [
        {
          path: 'mcpServers.salesforce.title',
          kind: 'removed',
          before: 'SF Users',
          after: undefined,
        },
        {
          path: 'mcpServers.salesforce.oauth.client_secret',
          kind: 'removed',
          before: undefined,
          after: undefined,
          secret: true,
        },
      ],
    };
    const model = buildReviewModel([hidden], { localize, fields: tree, tree: {} });
    render(<ChangeReview review={{ ...reviewFor([]), model, scope: undefined }} />);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        "Hiding it also deletes what Base sets for it, listed below. Unhiding it later won't bring that back.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('SF Users')).toHaveClass('line-through');
    expect(within(dialog).getByText('OAuth › Client secret')).toBeInTheDocument();
    expect(within(dialog).getByText('Stored key removed')).toBeInTheDocument();
  });

  it('reads a stored key replaced by a shown reference as the stored key struck through', () => {
    const replaced: t.ChangeSummaryItem = {
      path: 'endpoints.custom.0.apiKey',
      kind: 'changed',
      before: '********',
      after: '${KIMI}',
      secret: true,
      collectionPath: 'endpoints.custom',
      entryPath: 'endpoints.custom.0',
      entryIdentity: 'Moonshot',
    };
    const model = buildReviewModel([replaced], { localize, fields: tree, tree: {} });
    render(<ChangeReview review={{ ...reviewFor([]), model, scope: undefined }} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Stored key')).toHaveClass('line-through');
    expect(within(dialog).getByText('${KIMI}')).toBeInTheDocument();
    expect(within(dialog).queryByText('********')).toBeNull();
  });
  it('warns on a rename and a removal in Base about the profile overrides they leave behind', () => {
    const user: t.EntryOverride = {
      scope: {
        principalType: PrincipalType.ROLE,
        principalId: 'USER',
        name: 'USER',
        priority: 10,
        isActive: true,
      },
      overrides: true,
      secrets: ['apiKey.key'],
      settings: [],
      hidden: false,
    };
    const renamed: t.ChangeSummaryItem = {
      path: 'mcpServers.acme-2',
      kind: 'renamed',
      before: undefined,
      after: { type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' },
      collectionPath: 'mcpServers',
      entryPath: 'mcpServers.acme-2',
      entryIdentity: 'acme-2',
      previousIdentity: 'acme-kb',
      overrideNotes: [
        {
          change: { kind: 'renamed', name: 'acme-kb', next: 'acme-2', taken: false },
          overrides: [user],
        },
      ],
    };
    const removed: t.ChangeSummaryItem = {
      path: 'mcpServers.oauthy',
      kind: 'removed',
      before: { type: 'streamable-http', url: 'https://mcp.oauthy.dev/mcp' },
      after: undefined,
      collectionPath: 'mcpServers',
      entryPath: 'mcpServers.oauthy',
      entryIdentity: 'oauthy',
      overrideNotes: [
        { change: { kind: 'removed', name: 'oauthy' }, overrides: [{ ...user, secrets: [] }] },
      ],
    };
    const model = buildReviewModel([renamed, removed], { localize, fields: tree, tree: {} });
    render(<ChangeReview review={{ ...reviewFor([]), model, scope: undefined }} />);
    const dialog = screen.getByRole('dialog');
    const rows = [...dialog.querySelectorAll<HTMLElement>('[data-review-path]')];
    const renamedRow = rows.find((row) => row.dataset.reviewPath === 'mcpServers.acme-2');
    const removedRow = rows.find((row) => row.dataset.reviewPath === 'mcpServers.oauthy');
    if (!renamedRow || !removedRow) throw new Error('missing rows');
    expect(
      within(renamedRow).getByText(
        'Role: USER overrides "acme-kb". The override stays under that name, so its members get "acme-2" without it, plus a leftover "acme-kb" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(renamedRow).getByText(
        'Role: USER stores its own key for "acme-kb". The key stays under that name too, so its members get "acme-2" with Base\'s credentials instead.',
      ),
    ).toBeInTheDocument();
    expect(
      within(removedRow).getByText(
        'Role: USER overrides "oauthy". The override stays, so its members get a leftover "oauthy" until it is removed there.',
      ),
    ).toBeInTheDocument();
    expect(within(removedRow).queryByText(/stores its own key/)).toBeNull();
  });

  it("warns on a moved setting's row about the profile keys it stops, and on a rename about the override it takes", () => {
    const user: t.EntryOverride = {
      scope: {
        principalType: PrincipalType.ROLE,
        principalId: 'USER',
        name: 'USER',
        priority: 10,
        isActive: true,
      },
      overrides: true,
      secrets: ['apiKey.key'],
      settings: [],
      hidden: false,
    };
    const url: t.ChangeSummaryItem = {
      path: 'mcpServers.acme-kb.url',
      kind: 'changed',
      before: 'https://mcp.acme.dev/mcp',
      after: 'https://mcp2.acme.dev/mcp',
      collectionPath: 'mcpServers',
      entryPath: 'mcpServers.acme-kb',
      entryIdentity: 'acme-kb',
      overrideNotes: [{ change: { kind: 'moved', name: 'acme-kb' }, overrides: [user] }],
    };
    const renamed: t.ChangeSummaryItem = {
      path: 'mcpServers.ghost',
      kind: 'renamed',
      before: undefined,
      after: { type: 'streamable-http', url: 'https://mcp.oauthy.dev/mcp' },
      collectionPath: 'mcpServers',
      entryPath: 'mcpServers.ghost',
      entryIdentity: 'ghost',
      previousIdentity: 'oauthy',
      overrideNotes: [
        { change: { kind: 'took', name: 'ghost', sendsKeys: false }, overrides: [user] },
      ],
    };
    const model = buildReviewModel([url, renamed], { localize, fields: tree, tree: {} });
    render(<ChangeReview review={{ ...reviewFor([]), model, scope: undefined }} />);
    const rows = [
      ...screen.getByRole('dialog').querySelectorAll<HTMLElement>('[data-review-path]'),
    ];
    const urlRow = rows.find((row) => row.dataset.reviewPath === 'mcpServers.acme-kb.url');
    const renamedRow = rows.find((row) => row.dataset.reviewPath === 'mcpServers.ghost');
    if (!urlRow || !renamedRow) throw new Error('missing rows');
    expect(
      within(urlRow).getByText(
        'Role: USER stores its own key for "acme-kb", which LibreChat sends only where it was entered. This save changes where "acme-kb" sends it, so its members get "acme-kb" without that key until it is entered again there.',
      ),
    ).toBeInTheDocument();
    expect(
      within(renamedRow).getByText(
        'Role: USER still overrides "ghost". The override applies to this one once it is saved under that name, until it is removed there.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ChangesBar', () => {
  const saves: t.SaveEntry[] = [{ fieldPath: 'registration.socialLogins', value: ['openid'] }];
  /** jsdom has no ResizeObserver; the bar keeps toasts clear of itself with one. */
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  it('announces the first unsaved change from a status region that was there before it', async () => {
    function Page() {
      const [dirty, setDirty] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDirty(true)}>
            Edit
          </button>
          <ChangesBar review={reviewFor(saves, { isDirty: dirty })} />
        </>
      );
    }
    render(<Page />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(/^1 unsaved change · System$/);
    expect(within(status).queryByRole('button')).toBeNull();
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(within(bar).getByRole('button', { name: 'Discard' })).toBeVisible();
    expect(within(bar).queryByRole('status')).toBeNull();
  });

  it('puts focus on the open tab once Discard takes the bar away', async () => {
    function Page() {
      const [dirty, setDirty] = useState(true);
      return (
        <>
          <div role="tablist">
            <button type="button" role="tab" data-state="active">
              System
            </button>
          </div>
          <ChangesBar
            review={reviewFor(saves, { isDirty: dirty, discardAll: () => setDirty(false) })}
          />
        </>
      );
    }
    render(<Page />);
    const discard = screen.getByRole('button', { name: 'Discard' });
    discard.focus();
    fireEvent.click(discard);
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(screen.getByRole('tab', { name: 'System' })).toHaveFocus();
  });
});
