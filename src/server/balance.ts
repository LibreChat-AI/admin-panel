/**
 * Server functions for the admin Balance tab.
 *
 * Calls the LibreChat Admin API (/api/admin/balance) for the paginated
 * user-balance list and the "Add credit" action. No direct DB access.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type { AdminBalanceListItem, BalanceListView } from '@/types';
import { READ_BALANCES_CAPABILITY, MANAGE_BALANCES_CAPABILITY } from '@/constants';
import { apiFetch, extractApiError } from './utils/api';
import { requireCapability } from './capabilities';

export const BALANCE_PAGE_SIZE = 50;

interface BalanceListResponse {
  items: AdminBalanceListItem[];
  total: number;
  /** Global pending-request count — independent of the current view/search,
   *  drives the "Requests (N)" tab badge. */
  pendingCount: number;
}

export const getBalanceListFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      view: z.enum(['all', 'requests']).optional(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { search?: string; limit?: number; offset?: number; view?: BalanceListView };
    }): Promise<BalanceListResponse> => {
      await requireCapability(READ_BALANCES_CAPABILITY);

      const params = new URLSearchParams();
      if (data.search) params.set('search', data.search);
      if (data.limit != null) params.set('limit', String(data.limit));
      if (data.offset != null) params.set('offset', String(data.offset));
      if (data.view === 'requests') params.set('filter', 'requests');
      const qs = params.toString();
      const response = await apiFetch(`/api/admin/balance${qs ? `?${qs}` : ''}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch balances: ${response.status}`);
      }
      const json = (await response.json()) as BalanceListResponse;
      return { items: json.items, total: json.total, pendingCount: json.pendingCount ?? 0 };
    },
  );

export const balanceListQueryOptions = (page = 1, search = '', view: BalanceListView = 'all') =>
  queryOptions<BalanceListResponse>({
    queryKey: ['balanceRequests', page, search, view],
    queryFn: () =>
      getBalanceListFn({
        data: {
          search: search || undefined,
          limit: BALANCE_PAGE_SIZE,
          offset: (page - 1) * BALANCE_PAGE_SIZE,
          view,
        },
      }),
    staleTime: 30_000,
  });

export const addCreditFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      userId: z.string(),
      amount: z.number(),
      idempotencyKey: z.string(),
      requestId: z.string().optional(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { userId: string; amount: number; idempotencyKey: string; requestId?: string };
    }): Promise<{
      resultingBalance: number;
      creditAlreadyApplied: boolean;
      requestAlreadyResolved: boolean;
    }> => {
      await requireCapability(MANAGE_BALANCES_CAPABILITY);

      const response = await apiFetch(
        `/api/admin/balance/${encodeURIComponent(data.userId)}/credit`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: data.amount,
            idempotencyKey: data.idempotencyKey,
            requestId: data.requestId,
          }),
        },
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to add credit');
      }
      return (await response.json()) as {
        resultingBalance: number;
        creditAlreadyApplied: boolean;
        requestAlreadyResolved: boolean;
      };
    },
  );
