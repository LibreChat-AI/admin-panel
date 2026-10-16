import { useCallback } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import { getEffectiveCapabilitiesFn } from '@/server';
import { hasImpliedCapability } from '@/constants';

const Route = getRouteApi('/_app');

/** Status codes that indicate the grants system is not deployed (vs. access denied). */
const GRANTS_UNAVAILABLE_PATTERN = /\b(404|503)\b|endpoint not found|fetch failed/i;
const AUTH_DENIED_PATTERN =
  /\b(401|403)\b|forbidden|unauthorized|authentication required|no admin session token/i;

export const capabilitiesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ['effectiveCapabilities', userId],
    queryFn: async (): Promise<t.CapabilitiesData> => {
      try {
        const res = await getEffectiveCapabilitiesFn();
        return { available: true, capabilities: res.capabilities };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (GRANTS_UNAVAILABLE_PATTERN.test(message)) {
          return { available: false, capabilities: [] };
        }
        if (AUTH_DENIED_PATTERN.test(message)) {
          return { available: true, capabilities: [] };
        }
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });

export function useCapabilities(): {
  capabilities: string[];
  hasCapability: (cap: string) => boolean;
  isLoading: boolean;
  isError: boolean;
} {
  const { user } = Route.useRouteContext();
  const query = useQuery(capabilitiesQueryOptions(user?.id ?? ''));

  const grantsAvailable = query.data?.available ?? false;
  const capabilities = query.data?.capabilities ?? [];

  const hasCapability = useCallback(
    (_cap: string) => {
      if (!grantsAvailable) return false;
      return hasImpliedCapability(capabilities, _cap);
    },
    [grantsAvailable, capabilities],
  );

  return { capabilities, hasCapability, isLoading: query.isLoading, isError: query.isError };
}
