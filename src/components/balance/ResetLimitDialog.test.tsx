import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdminBalanceListItem } from '@/types';
import { ResetLimitDialog } from './ResetLimitDialog';

const mockMutate = vi.fn();

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key} ${JSON.stringify(opts)}` : key,
  useAddCredit: () => ({ mutate: mockMutate, isPending: false }),
}));

vi.mock('@clickhouse/click-ui', () => ({
  ConfirmationDialog: ({
    title,
    primaryActionLabel,
    secondaryActionLabel,
    disabled,
    onConfirm,
    onCancel,
    children,
  }: {
    title: string;
    primaryActionLabel?: string;
    secondaryActionLabel?: string;
    disabled?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
    children?: React.ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      {children}
      <button onClick={onConfirm} disabled={disabled}>
        {primaryActionLabel}
      </button>
      <button onClick={onCancel}>{secondaryActionLabel}</button>
    </div>
  ),
}));

const target: AdminBalanceListItem = {
  id: 'u1',
  name: 'Alice',
  email: 'alice@example.com',
  avatar: '',
  tokenCredits: 500,
  balanceEnabled: true,
  refillAmount: 2000,
  // The row action that opens this dialog is itself gated on a pending
  // request existing, so every "normal" scenario here has one by default.
  pendingRequest: { requestId: 'req-base', requestedAt: '2026-01-01T00:00:00.000Z' },
};

describe('ResetLimitDialog', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    if (!globalThis.crypto?.randomUUID) {
      // @ts-expect-error -- test shim
      globalThis.crypto = { randomUUID: () => 'test-uuid' };
    }
  });

  it('renders nothing when there is no target', () => {
    const { container } = render(<ResetLimitDialog target={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the refill amount and resulting balance, with confirm enabled', () => {
    render(<ResetLimitDialog target={target} onClose={vi.fn()} />);

    expect(
      screen.getByText('com_balance_reset_limit_confirm {"amount":"2,000","name":"Alice"}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('com_balance_resulting_balance {"amount":"2,500"}'),
    ).toBeInTheDocument();
    const confirmButton = screen.getByText('com_balance_reset_limit');
    expect(confirmButton).not.toBeDisabled();
  });

  it('disables confirm and shows a warning when no refill amount is configured', () => {
    const noRefill: AdminBalanceListItem = { ...target, refillAmount: 0 };
    render(<ResetLimitDialog target={noRefill} onClose={vi.fn()} />);

    expect(screen.getByText('com_balance_no_refill_amount')).toBeInTheDocument();
    expect(screen.getByText('com_balance_reset_limit')).toBeDisabled();
  });

  it('shows the pending request reason when present', () => {
    const withPending: AdminBalanceListItem = {
      ...target,
      pendingRequest: {
        requestId: 'req-1',
        requestedAt: '2026-01-01T00:00:00.000Z',
        reason: 'need more for a project',
      },
    };
    render(<ResetLimitDialog target={withPending} onClose={vi.fn()} />);

    expect(screen.getByText('com_balance_request_reason')).toBeInTheDocument();
    expect(screen.getByText('need more for a project')).toBeInTheDocument();
  });

  it('confirms with the refillAmount, target userId, and a pending requestId when present', () => {
    const withPending: AdminBalanceListItem = {
      ...target,
      pendingRequest: { requestId: 'req-1', requestedAt: '2026-01-01T00:00:00.000Z' },
    };
    render(<ResetLimitDialog target={withPending} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('com_balance_reset_limit'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', amount: 2000, requestId: 'req-1' }),
      expect.anything(),
    );
  });

  it('does not confirm when there is no usable refill amount', () => {
    const noRefill: AdminBalanceListItem = { ...target, refillAmount: 0 };
    render(<ResetLimitDialog target={noRefill} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('com_balance_reset_limit'));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('disables confirm and shows a warning if the dialog is somehow open without a pending request', () => {
    const noPending: AdminBalanceListItem = { ...target, pendingRequest: undefined };
    render(<ResetLimitDialog target={noPending} onClose={vi.fn()} />);

    expect(screen.getByText('com_balance_no_pending_request')).toBeInTheDocument();
    const confirmButton = screen.getByText('com_balance_reset_limit');
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('reuses the same idempotency key across repeated confirms of the same dialog', () => {
    render(<ResetLimitDialog target={target} onClose={vi.fn()} />);

    const confirmButton = screen.getByText('com_balance_reset_limit');
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(mockMutate).toHaveBeenCalledTimes(2);
    const firstKey = mockMutate.mock.calls[0][0].idempotencyKey;
    const secondKey = mockMutate.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it('generates a fresh idempotency key when a new target is opened', () => {
    const { rerender } = render(<ResetLimitDialog target={target} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('com_balance_reset_limit'));
    const firstKey = mockMutate.mock.calls[0][0].idempotencyKey;

    const otherTarget: AdminBalanceListItem = { ...target, id: 'u2', name: 'Bob' };
    rerender(<ResetLimitDialog target={otherTarget} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('com_balance_reset_limit'));

    expect(mockMutate).toHaveBeenCalledTimes(2);
    const secondKey = mockMutate.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });
});
