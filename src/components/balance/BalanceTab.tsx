import { useState } from 'react';
import { Button, Badge, Tabs, Tooltip } from '@clickhouse/click-ui';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { AdminBalanceListItem, BalanceListView } from '@/types';
import { Avatar, EmptyState, LoadingState, Pagination, SearchInput } from '@/components/shared';
import { useCapabilities, useLocalize, useDebouncedFilter } from '@/hooks';
import { balanceListQueryOptions, BALANCE_PAGE_SIZE } from '@/server';
import { MANAGE_BALANCES_CAPABILITY } from '@/constants';
import { ResetLimitDialog } from './ResetLimitDialog';
import { cn, formatRelativeTime } from '@/utils';

type Localize = ReturnType<typeof useLocalize>;

/**
 * Four mutually-exclusive display states, checked in this order:
 * `balanceEnabled: false` wins regardless of a pending request, because it's
 * what determines whether "Add credits" can succeed at all — the other
 * states only matter once the feature is actually usable for this user.
 */
function statusFor(
  item: AdminBalanceListItem,
): 'not_enabled' | 'requested' | 'out_of_credits' | 'available' {
  if (!item.balanceEnabled) return 'not_enabled';
  if (item.pendingRequest) return 'requested';
  if (item.tokenCredits === 0) return 'out_of_credits';
  return 'available';
}

function StatusCell({ item, localize }: { item: AdminBalanceListItem; localize: Localize }) {
  const status = statusFor(item);

  if (status === 'available') {
    return <Badge text={localize('com_balance_status_available')} state="success" size="sm" />;
  }
  if (status === 'not_enabled') {
    return <Badge text={localize('com_balance_status_not_enabled')} state="disabled" size="sm" />;
  }
  if (status === 'out_of_credits') {
    return <Badge text={localize('com_balance_status_out_of_credits')} state="danger" size="sm" />;
  }

  const pending = item.pendingRequest;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1.5">
        <Badge text={localize('com_balance_status_requested')} state="warning" size="sm" />
        {pending && (
          <span className="text-xs text-(--cui-color-text-muted)">
            · {formatRelativeTime(pending.requestedAt)}
          </span>
        )}
      </div>
      {pending?.reason && (
        <span className="max-w-55 truncate text-xs text-(--cui-color-text-muted)">
          “{pending.reason}”
        </span>
      )}
    </div>
  );
}

function ResetLimitButton({
  item,
  canManage,
  fillWidth,
  localize,
  onClick,
}: {
  item: AdminBalanceListItem;
  canManage: boolean;
  fillWidth?: boolean;
  localize: Localize;
  onClick: () => void;
}) {
  const hasRefillAmount = (item.refillAmount ?? 0) > 0;
  const hasPendingRequest = item.pendingRequest != null;
  const disabled = !canManage || !item.balanceEnabled || !hasPendingRequest || !hasRefillAmount;
  let title: string | undefined;
  if (!canManage) {
    title = localize('com_cap_no_permission', { cap: MANAGE_BALANCES_CAPABILITY });
  } else if (!item.balanceEnabled) {
    title = localize('com_balance_status_not_enabled');
  } else if (!hasPendingRequest) {
    title = localize('com_balance_no_pending_request');
  } else if (!hasRefillAmount) {
    title = localize('com_balance_no_refill_amount');
  }

  const button = (
    <Button
      type="primary"
      label={localize('com_balance_reset_limit')}
      fillWidth={fillWidth}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-label={`${localize('com_balance_reset_limit')} ${item.name}`}
      onClick={onClick}
    />
  );

  if (!title) {
    return button;
  }

  // The native `title` attribute never shows on a disabled <button> in any
  // browser — hit-testing on a disabled form control suppresses it even
  // from a non-disabled ancestor. A real tooltip (hover state owned by its
  // own wrapper div, independent of the button's disabled state) is the
  // only reliable way to tell the admin *why* the action is unavailable.
  return (
    <Tooltip>
      <Tooltip.Trigger className={fillWidth ? 'block w-full' : 'inline-block'}>
        {button}
      </Tooltip.Trigger>
      <Tooltip.Content>{title}</Tooltip.Content>
    </Tooltip>
  );
}

export function BalanceTab() {
  const localize = useLocalize();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(MANAGE_BALANCES_CAPABILITY);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<BalanceListView>('all');
  const {
    value: search,
    debouncedValue: debouncedSearch,
    onChange: handleSearchChange,
  } = useDebouncedFilter('', () => setPage(1));
  const [creditTarget, setCreditTarget] = useState<AdminBalanceListItem | null>(null);

  const { data, isLoading, isError, isFetching } = useQuery({
    ...balanceListQueryOptions(page, debouncedSearch, view),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pendingCount = data?.pendingCount ?? 0;
  const totalPages = Math.ceil(total / BALANCE_PAGE_SIZE);

  const handleViewChange = (next: string) => {
    setView(next === 'requests' ? 'requests' : 'all');
    setPage(1);
  };

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (isError && !data) {
    return (
      <div className="px-4 py-8 text-center text-sm text-(--cui-color-foreground-danger)">
        {localize('com_error_load_balances')}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={localize('com_nav_balance')}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2"
    >
      <Tabs
        value={view}
        onValueChange={handleViewChange}
        ariaLabel={localize('com_balance_view_label')}
      >
        <Tabs.TriggersList>
          <Tabs.Trigger value="all">{localize('com_balance_tab_all')}</Tabs.Trigger>
          <Tabs.Trigger value="requests">
            {localize('com_balance_tab_requests', { count: pendingCount })}
          </Tabs.Trigger>
        </Tabs.TriggersList>
        <Tabs.Content value="all" tabIndex={-1} />
        <Tabs.Content value="requests" tabIndex={-1} />
      </Tabs>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-3">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder={localize('com_balance_search')}
          className="relative"
        />

        {/* Desktop: table. Hidden below md — a row this information-dense
            doesn't fit a narrow viewport without horizontal scrolling. */}
        <div className="hidden overflow-x-auto rounded-lg border border-(--cui-color-stroke-default) md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_balance_col_user')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_balance_col_status')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_balance_col_current_balance')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  {localize('com_balance_col_last_refill')}
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                  <span className="sr-only">{localize('com_ui_actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className={cn(isFetching && 'opacity-60 transition-opacity')}>
              {items.map((item, i) => (
                <tr
                  key={item.id}
                  className={cn(
                    'bg-(--cui-color-background-panel)',
                    i !== items.length - 1 && 'border-b border-(--cui-color-stroke-default)',
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={item.name || item.email} />
                      <div className="flex flex-col">
                        <span className="font-medium text-(--cui-color-text-default)">
                          {item.name}
                        </span>
                        <span className="text-xs text-(--cui-color-text-muted)">{item.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusCell item={item} localize={localize} />
                  </td>
                  <td className="px-4 py-3 text-(--cui-color-text-default)">
                    {item.tokenCredits.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-(--cui-color-text-muted)">
                    {item.lastRefill ? new Date(item.lastRefill).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <ResetLimitButton
                      item={item}
                      canManage={canManage}
                      localize={localize}
                      onClick={() => setCreditTarget(item)}
                    />
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message={localize('com_balance_empty')} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards instead of a horizontally-scrolling table. */}
        <div
          className={cn(
            'flex flex-col gap-2 md:hidden',
            isFetching && 'opacity-60 transition-opacity',
          )}
        >
          {items.length === 0 ? (
            <EmptyState message={localize('com_balance_empty')} />
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) p-3"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={item.name || item.email} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-(--cui-color-text-default)">
                      {item.name}
                    </span>
                    <span className="truncate text-xs text-(--cui-color-text-muted)">
                      {item.email}
                    </span>
                  </div>
                </div>

                <StatusCell item={item} localize={localize} />

                <div className="flex items-center justify-between text-xs text-(--cui-color-text-muted)">
                  <span>
                    {localize('com_balance_col_current_balance')}:{' '}
                    {item.tokenCredits.toLocaleString()}
                  </span>
                  <span>
                    {item.lastRefill ? new Date(item.lastRefill).toLocaleDateString() : '—'}
                  </span>
                </div>

                <ResetLimitButton
                  item={item}
                  canManage={canManage}
                  fillWidth
                  localize={localize}
                  onClick={() => setCreditTarget(item)}
                />
              </div>
            ))
          )}
        </div>

        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      <ResetLimitDialog target={creditTarget} onClose={() => setCreditTarget(null)} />
    </div>
  );
}
