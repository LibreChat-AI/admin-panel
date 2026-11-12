/**
 * Server functions for user management.
 *
 * Calls the LibreChat Admin API (/api/admin/users) for list, search, and delete.
 * Create user is not yet wired.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { TUser } from 'librechat-data-provider';
import { apiFetch, extractApiError } from './utils/api';
import { USER_DELETE_UNAVAILABLE } from '@/constants';

// ── Server functions ─────────────────────────────────────────────────

export const getUsersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ users: TUser[] }> => {
    const response = await apiFetch('/api/admin/users');
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }
    const json = (await response.json()) as { users: TUser[] };
    return { users: json.users ?? [] };
  },
);

export const usersQueryOptions = queryOptions({
  queryKey: ['users'],
  queryFn: () => getUsersFn().then((r) => r.users),
  staleTime: 30_000,
});

export const createUserFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      role: z.nativeEnum(SystemRoles),
    }),
  )
  .handler(async (): Promise<{ user: TUser }> => {
    throw new Error('Not implemented: createUserFn');
  });

/** The admin users API's reply when the user to delete no longer exists. */
const USER_NOT_FOUND_ERROR = 'User not found';

/**
 * Deletes a user. LibreChat's own "user not found" 404 means the user is
 * already gone, which is success; any other 404 is a server without the
 * delete route (LibreChat ships it disabled), reported as
 * `USER_DELETE_UNAVAILABLE` so the page explains it instead of claiming the
 * user was deleted.
 */
export const deleteUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(data.id)}`, {
      method: 'DELETE',
    });
    if (response.ok) return;
    if (response.status === 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === USER_NOT_FOUND_ERROR) return;
      throw new Error(USER_DELETE_UNAVAILABLE);
    }
    await extractApiError(response, 'Failed to delete user');
  });

export const searchUsersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ query: z.string() }))
  .handler(async ({ data }): Promise<{ users: AdminUserSearchResult[] }> => {
    const response = await apiFetch(`/api/admin/users/search?q=${encodeURIComponent(data.query)}`);
    if (!response.ok) {
      await extractApiError(response, 'Failed to search users');
    }
    const json = (await response.json()) as { users: AdminUserSearchResult[] };
    return { users: json.users ?? [] };
  });
