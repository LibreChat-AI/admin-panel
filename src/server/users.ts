/**
 * Server functions for user management.
 *
 * Calls the LibreChat Admin API (/api/admin/users) for list, search, create, and delete.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminUserListItem, AdminUserSearchResult } from '@librechat/data-schemas';
import { apiFetch, extractApiError } from './utils/api';

// ── Server functions ─────────────────────────────────────────────────

export const getUsersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ users: AdminUserListItem[] }> => {
    const response = await apiFetch('/api/admin/users');
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }
    const json = (await response.json()) as { users: AdminUserListItem[] };
    return { users: json.users ?? [] };
  },
);

export const usersQueryOptions = queryOptions({
  queryKey: ['users'],
  queryFn: () => getUsersFn().then((r) => r.users as AdminUserListItem[]),
  staleTime: 30_000,
});

export const createUserFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      role: z.nativeEnum(SystemRoles),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { name: string; email: string; role: SystemRoles };
    }): Promise<{ user: AdminUserListItem }> => {
      const response = await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        await extractApiError(response, 'Failed to create user');
      }
      const json = (await response.json()) as { user: AdminUserListItem };
      return json;
    },
  );

export const deleteUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(data.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete user: ${response.status}`);
    }
  });

export const searchUsersFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ query: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(`/api/admin/users/search?q=${encodeURIComponent(data.query)}`);
    if (!response.ok) {
      await extractApiError(response, 'Failed to search users');
    }
    const json = (await response.json()) as { users: AdminUserSearchResult[] };
    return { users: json.users ?? [] };
  });
