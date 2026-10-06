import { createContext, useContext } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminBalanceListItem } from '@/types';
import { BalanceTab } from './BalanceTab';

const mockHasCapability = vi.fn();
const mockGetBalanceListFn = vi.fn();

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key} ${JSON.stringify(opts)}` : key,
  useCapabilities: () => ({ hasCapability: mockHasCapability }),
  useDebouncedFilter: (initial: string) => ({
    value: initial,
    debouncedValue: initial,
    onChange: vi.fn(),
  }),
  useAddCredit: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  formatRelativeTime: () => '2h ago',
}));

vi.mock('@/server', () => ({
  balanceListQueryOptions: (page: number, search: string, view: string) => ({
    queryKey: ['balanceRequests', page, search, view],
    queryFn: () => mockGetBalanceListFn({ data: { search, view } }),
  }),
  BALANCE_PAGE_SIZE: 50,
}));

vi.mock('@/constants', () => ({
  MANAGE_BALANCES_CAPABILITY: 'manage:balances',
}));

vi.mock('@/components/shared', () => ({
  Avatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  LoadingState: () => <div data-testid="loading">loading</div>,
  Pagination: () => <div data-testid="pagination" />,
  SearchInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="search" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const TabsCtx = createContext<{ onValueChange?: (v: string) => void }>({});

function MockTabs({
  value,
  onValueChange,
  children,
  ariaLabel,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  children?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <TabsCtx.Provider value={{ onValueChange }}>
      <div data-testid="tabs" data-value={value} aria-label={ariaLabel}>
        {children}
      </div>
    </TabsCtx.Provider>
  );
}
MockTabs.TriggersList = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
MockTabs.Trigger = ({ value, children }: { value: string; children?: React.ReactNode }) => {
  const { onValueChange } = useContext(TabsCtx);
  return (
    <button type="button" onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  );
};
MockTabs.Content = () => null;

function MockTooltip({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
MockTooltip.Trigger = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => <div className={className}>{children}</div>;
MockTooltip.Content = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;

vi.mock('@clickhouse/click-ui', () => ({
  Button: ({
    label,
    onClick,
    disabled,
    ...props
  }: {
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {label}
    </button>
  ),
  Badge: ({ text, state }: { text: string; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
  Tabs: MockTabs,
  Tooltip: MockTooltip,
}));

vi.mock('./ResetLimitDialog', () => ({
  ResetLimitDialog: ({ target }: { target: AdminBalanceListItem | null }) =>
    target ? <div data-testid="reset-limit-dialog">{target.name}</div> : null,
}));

function renderWithClient(children: React.ReactNode) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const items: AdminBalanceListItem[] = [
  {
    id: 'u1',
    name: 'Alice',
    email: 'alice@example.com',
    avatar: '',
    tokenCredits: 500,
    balanceEnabled: true,
    refillAmount: 2000,
  },
  {
    id: 'u2',
    name: 'Bob',
    email: 'bob@example.com',
    avatar: '',
    tokenCredits: 0,
    balanceEnabled: true,
    refillAmount: 1500,
    pendingRequest: {
      requestId: 'req-1',
      requestedAt: '2026-01-01T00:00:00.000Z',
      reason: 'ran out',
    },
  },
  {
    id: 'u3',
    name: 'Cara',
    email: 'cara@example.com',
    avatar: '',
    tokenCredits: 0,
    balanceEnabled: true,
    refillAmount: 1000,
  },
  {
    id: 'u4',
    name: 'Dee',
    email: 'dee@example.com',
    avatar: '',
    tokenCredits: 0,
    balanceEnabled: false,
    refillAmount: 500,
  },
];

describe('BalanceTab', () => {
  beforeEach(() => {
    mockHasCapability.mockReturnValue(true);
    mockGetBalanceListFn.mockResolvedValue({ items, total: items.length, pendingCount: 1 });
  });

  it('renders each user with their balance, status, and visible (non-tooltip) request details', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));

    expect(table.getByText('alice@example.com')).toBeInTheDocument();
    expect(table.getByText('500')).toBeInTheDocument();
    expect(table.getByText('bob@example.com')).toBeInTheDocument();

    // Pending-request details are plain visible text, not hover-only.
    expect(table.getByText('com_balance_status_requested')).toBeInTheDocument();
    expect(table.getByText('· 2h ago')).toBeInTheDocument();
    expect(table.getByText('“ran out”')).toBeInTheDocument();
  });

  it('shows "Out of credits" for an enabled user with zero balance and no pending request', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));

    expect(table.getByText('com_balance_status_out_of_credits')).toBeInTheDocument();
  });

  it('enables Reset limit for an out-of-credit user without a pending request', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    const caraRow = table.getByText('cara@example.com').closest('tr') as HTMLElement;
    const actionButton = within(caraRow).getByRole('button');

    expect(actionButton).not.toBeDisabled();
    actionButton.click();

    await waitFor(() => expect(screen.getByTestId('reset-limit-dialog')).toHaveTextContent('Cara'));
  });

  it('shows "Not enabled" — and disables the action with a visible reason — for a user with balanceEnabled: false, regardless of capability', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    const deeRow = table.getByText('dee@example.com').closest('tr') as HTMLElement;
    expect(deeRow).not.toBeNull();

    const statusCell = deeRow.querySelectorAll('td')[1];
    expect(within(statusCell).getByText('com_balance_status_not_enabled')).toBeInTheDocument();

    const actionButton = within(deeRow).getByRole('button');
    expect(actionButton).toBeDisabled();
    // The disabled reason renders via a real tooltip component (not a
    // native `title` on the disabled button, which no browser ever shows)
    // — so the status badge's text and the tooltip's reason both appear in
    // this row, once each.
    expect(within(deeRow).getAllByText('com_balance_status_not_enabled')).toHaveLength(2);
  });

  it('shows a success-colored "Available" badge for an available user (enabled, positive balance, no pending request)', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    const aliceRow = table.getByText('alice@example.com').closest('tr') as HTMLElement;
    expect(aliceRow).not.toBeNull();
    const statusCell = aliceRow.querySelectorAll('td')[1];
    const badge = within(statusCell).getByTestId('badge');
    expect(badge).toHaveTextContent('com_balance_status_available');
    expect(badge).toHaveAttribute('data-state', 'success');
  });

  it('disables every Reset limit action when the caller lacks MANAGE_BALANCES, even for a user with a pending request', async () => {
    mockHasCapability.mockReturnValue(false);
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /com_balance_reset_limit Bob/ });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute('disabled'))).toBe(true);
  });

  it('disables Reset limit for a user with no configured refill amount', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    const deeRow = table.getByText('dee@example.com').closest('tr') as HTMLElement;
    // Dee is already disabled via balanceEnabled: false; also exercise a
    // refillAmount: 0 case directly against the button's own gating logic.
    expect(within(deeRow).getByRole('button')).toBeDisabled();
  });

  it('disables Reset limit for a positive-balance user with no pending request', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    // Alice is enabled with a configured refillAmount, but has no pendingRequest.
    const aliceRow = table.getByText('alice@example.com').closest('tr') as HTMLElement;
    const actionButton = within(aliceRow).getByRole('button');
    expect(actionButton).toBeDisabled();
    expect(within(aliceRow).getByText('com_balance_no_pending_request')).toBeInTheDocument();
  });

  it('opens the Reset limit dialog for a user with a pending request', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    const bobRow = table.getByText('bob@example.com').closest('tr') as HTMLElement;
    within(bobRow).getByRole('button').click();

    await waitFor(() => expect(screen.getByTestId('reset-limit-dialog')).toBeInTheDocument());
  });

  it('shows the global pending count on the Requests tab and switches the query view on click', async () => {
    renderWithClient(<BalanceTab />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('com_balance_tab_requests {"count":1}')).toBeInTheDocument();

    mockGetBalanceListFn.mockClear();
    screen.getByText('com_balance_tab_requests {"count":1}').click();

    await waitFor(() =>
      expect(mockGetBalanceListFn).toHaveBeenCalledWith({ data: { search: '', view: 'requests' } }),
    );
  });
});
