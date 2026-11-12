import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type {
  AdminConfigListResponse,
  AdminConfigResponse,
  AdminUserListItem,
} from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  ABSENT_REVISION,
  OBJECT_ID_PATTERN,
  MAX_SCOPE_PRIORITY,
  VERSION_CONFLICT_CODE,
  DEFAULT_SCOPE_PRIORITY,
} from '@/constants';
import {
  findStoredSecrets,
  collectOverridePaths,
  scopeOverrideEntries,
  stripSecretPreviewValues,
} from '@/utils';
import { normalizeAppServiceKeys } from '../config/normalize';
import { apiErrorBodyMessage, apiErrorMessage, apiFetch } from '../utils/api';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { requireCapability, requireAnyCapability } from '../capabilities';
import { getSchemaPathSet } from '../config/schema';
import { readConfigContract } from '../config/meta';
import { deepGet } from './paths';

/** The admin list endpoints return at most this many items per page. */
const DIRECTORY_PAGE_SIZE = 200;
/** Pages read per directory lookup before unresolved principals fall back to their ids. */
const DIRECTORY_MAX_PAGES = 10;
/**
 * Groups read at once with `GET /api/admin/groups/:id`. Profiles for up to
 * this many groups are resolved in that one round, without the directory.
 */
const GROUP_READ_CONCURRENCY = 10;

interface DirectoryGroup {
  _id: string;
  name: string;
  memberIds?: string[];
}

interface DirectoryPage<T> {
  items: T[];
  total: number;
}

interface DirectoryLookup<T> {
  found: Map<string, T>;
  /** The walk stopped at `DIRECTORY_MAX_PAGES` with ids still missing and more of the list unread. */
  capped: boolean;
}

function principalKey(principalType: PrincipalType, principalId: string): string {
  return `${principalType}:${principalId}`;
}

/**
 * What a stored profile overrides: its leaf paths (secret previews and
 * permission fields left out), the entries it stores in lists merged by
 * entry with the settings each sets, and the secrets it stores (by where
 * their previews are).
 */
function profileOverrides(
  config: t.ScopeConfigDoc,
  features?: t.ConfigFeatures,
): Pick<
  t.ConfigScope,
  'overridePaths' | 'overrideEntries' | 'overrideEntryPaths' | 'storedSecrets'
> {
  const overrides = (config.overrides ?? {}) as t.ConfigRecord;
  const visible = stripSecretPreviewValues(overrides, '', getSchemaPathSet()) as t.ConfigRecord;
  const normalized = normalizeAppServiceKeys(visible);
  return {
    overridePaths: collectOverridePaths(normalized),
    ...scopeOverrideEntries(normalized, features),
    storedSecrets: findStoredSecrets(normalizeAppServiceKeys(overrides)),
  };
}

function apiConfigToScope(
  config: t.ScopeConfigDoc,
  directory?: ReadonlyMap<string, t.PrincipalDetails>,
  features?: t.ConfigFeatures,
): t.ConfigScope {
  const details = directory?.get(principalKey(config.principalType, config.principalId));
  return {
    _id: config._id,
    principalType: config.principalType,
    principalId: config.principalId,
    name: details?.name || config.principalId,
    ...(details?.email && { email: details.email }),
    ...(details?.memberCount != null && { memberCount: details.memberCount }),
    priority: config.priority,
    isActive: config.isActive,
    ...profileOverrides(config, features),
    tombstones: config.tombstones ?? [],
  };
}

/**
 * Pages through an admin list endpoint until every wanted id is found, the
 * list ends, or `DIRECTORY_MAX_PAGES` were read. A failed page (e.g. 403
 * without read access) ends the lookup with what was found so far.
 */
async function lookupPaged<B, T>(
  path: string,
  wanted: ReadonlySet<string>,
  readPage: (body: B) => DirectoryPage<T>,
  idOf: (item: T) => string,
): Promise<DirectoryLookup<T>> {
  const found = new Map<string, T>();
  for (let page = 0; page < DIRECTORY_MAX_PAGES && found.size < wanted.size; page++) {
    const offset = page * DIRECTORY_PAGE_SIZE;
    const response = await apiFetch(`${path}?limit=${DIRECTORY_PAGE_SIZE}&offset=${offset}`).catch(
      () => null,
    );
    if (!response?.ok) return { found, capped: false };
    const { items, total } = readPage((await response.json()) as B);
    for (const item of items) {
      const id = idOf(item);
      if (wanted.has(id)) found.set(id, item);
    }
    if (items.length === 0 || offset + items.length >= total) return { found, capped: false };
  }
  return { found, capped: found.size < wanted.size };
}

/** One group, or null when it is gone (404), can't be read (403) or the request fails. */
async function readGroup(id: string): Promise<DirectoryGroup | null> {
  const response = await apiFetch(`/api/admin/groups/${encodeURIComponent(id)}`).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { group?: DirectoryGroup };
  return body.group ?? null;
}

/**
 * Reads groups one by one (`readGroup`), `GROUP_READ_CONCURRENCY` at a time,
 * and adds each one found to `into`.
 */
async function readGroupsById(
  ids: readonly string[],
  into = new Map<string, DirectoryGroup>(),
): Promise<Map<string, DirectoryGroup>> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const id = ids[next++];
      const group = await readGroup(id);
      if (group) into.set(id, group);
    }
  };
  const workers = Math.min(GROUP_READ_CONCURRENCY, ids.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return into;
}

/**
 * The groups with the given ids. A few are read by id; more are first looked
 * up in the directory, and those it can't reach within its page cap are then
 * read by id. Only ObjectIds are looked up, since every group id is one (a
 * legacy `grp_<name>` principal id matches no group), and a group that can't
 * be read (deleted, no access, failed request) stays unresolved.
 */
async function lookupGroups(ids: ReadonlySet<string>): Promise<Map<string, DirectoryGroup>> {
  const wanted = new Set([...ids].filter((id) => OBJECT_ID_PATTERN.test(id)));
  if (wanted.size <= GROUP_READ_CONCURRENCY) return readGroupsById([...wanted]);
  const { found, capped } = await lookupPaged(
    '/api/admin/groups',
    wanted,
    (body: { groups?: DirectoryGroup[]; total?: number }) => ({
      items: body.groups ?? [],
      total: body.total ?? 0,
    }),
    (group) => group._id,
  );
  if (!capped) return found;
  const missing = [...wanted].filter((id) => !found.has(id));
  return readGroupsById(missing, found);
}

async function lookupUsers(ids: ReadonlySet<string>): Promise<Map<string, AdminUserListItem>> {
  if (ids.size === 0) return new Map();
  const { found } = await lookupPaged(
    '/api/admin/users',
    ids,
    (body: { users?: AdminUserListItem[]; total?: number }) => ({
      items: body.users ?? [],
      total: body.total ?? 0,
    }),
    (user) => user.id,
  );
  return found;
}

/** Number of users with a role, or undefined when its members can't be read. */
async function countRoleMembers(roleName: string): Promise<number | undefined> {
  const response = await apiFetch(
    `/api/admin/roles/${encodeURIComponent(roleName)}/members?limit=1`,
  ).catch(() => null);
  if (!response?.ok) return undefined;
  const { total } = (await response.json()) as { total?: number };
  return total;
}

/**
 * Names, emails and member counts for the principals of the given profiles,
 * keyed by `principalType:principalId`. Users are read in pages from the admin
 * directory, groups by id or from the directory (`lookupGroups`); role members
 * are counted per role profile.
 */
export async function resolvePrincipals(
  configs: t.ScopeConfigDoc[],
): Promise<Map<string, t.PrincipalDetails>> {
  const idsOf = (type: PrincipalType) =>
    new Set(configs.filter((c) => c.principalType === type).map((c) => c.principalId));
  const roleNames = [...idsOf(PrincipalType.ROLE)];
  const [groups, users, roleCounts] = await Promise.all([
    lookupGroups(idsOf(PrincipalType.GROUP)),
    lookupUsers(idsOf(PrincipalType.USER)),
    Promise.all(roleNames.map(countRoleMembers)),
  ]);

  const directory = new Map<string, t.PrincipalDetails>();
  for (const [id, group] of groups) {
    directory.set(principalKey(PrincipalType.GROUP, id), {
      name: group.name,
      memberCount: group.memberIds?.length ?? 0,
    });
  }
  for (const [id, user] of users) {
    directory.set(principalKey(PrincipalType.USER, id), {
      name: user.name || user.username || user.email,
      email: user.email || undefined,
    });
  }
  roleNames.forEach((name, i) => {
    directory.set(principalKey(PrincipalType.ROLE, name), { name, memberCount: roleCounts[i] });
  });
  return directory;
}

/**
 * Every profile (config document other than Base), with its principal's name,
 * the user's email, member counts, and the paths it overrides or hides.
 */
export const getAvailableScopesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [configRes, contract] = await Promise.all([
    apiFetch('/api/admin/config'),
    readConfigContract(),
  ]);
  if (!configRes.ok) {
    throw new Error(`Failed to fetch scopes: ${configRes.status}`);
  }
  const { configs } = (await configRes.json()) as { configs: t.ScopeConfigDoc[] };
  const profiles = configs.filter((c) => c.principalId !== BASE_CONFIG_PRINCIPAL_ID);
  const directory = await resolvePrincipals(profiles);
  const scopes: t.ConfigScope[] = profiles.map((c) =>
    apiConfigToScope(c, directory, contract.features),
  );
  return { scopes };
});

/**
 * Shared queryOptions so every consumer deduplicates and caches the scopes list.
 * One retry: a failing profile list shows its error in about a second, like the base and schema queries.
 */
export const availableScopesOptions = queryOptions({
  queryKey: ['availableScopes'],
  queryFn: () => getAvailableScopesFn().then((r) => r.scopes),
  staleTime: 30_000,
  retry: 1,
});

/** Thrown before writing to a profile that no longer exists, so a save never recreates it (PR-3). */
export const MISSING_SCOPE_MESSAGE =
  'This profile no longer exists (it may have been deleted), so nothing was saved. Switch to Base or another profile.';

/**
 * Fetch all profile values for a specific field across all scopes.
 * Fetches all configs and extracts the field value from each config's overrides.
 */
export const getFieldProfileValuesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ fieldPath: z.string() }))
  .handler(async ({ data }: { data: { fieldPath: string } }) => {
    const response = await apiFetch('/api/admin/config');
    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status}`);
    }
    const { configs } = (await response.json()) as AdminConfigListResponse;

    const values: t.FieldProfileValue[] = [];
    for (const config of configs) {
      if (config.principalId === BASE_CONFIG_PRINCIPAL_ID) continue;
      const value = deepGet(config.overrides, data.fieldPath);
      if (value !== undefined) {
        values.push({
          scope: apiConfigToScope(config),
          value: value as NonNullable<unknown>,
        });
      }
    }
    return { fieldPath: data.fieldPath, values };
  });

/** Shared queryOptions for fetching a single field's profile values. */
export const fieldProfileValuesOptions = (fieldPath: string) =>
  queryOptions<t.FieldProfileValue[]>({
    queryKey: ['fieldProfileValues', fieldPath],
    queryFn: () => getFieldProfileValuesFn({ data: { fieldPath } }).then((r) => r.values),
  });

/** The admin API's code for a create-only PUT for a principal that does not exist. */
const PRINCIPAL_NOT_FOUND_CODE = 'PRINCIPAL_NOT_FOUND';

function missingRoleMessage(principalId: string): string {
  return `There is no role named "${principalId}"`;
}

/** A created or existing profile's document from a reply, or an error when it carries none. */
async function readConfigDoc(response: Response): Promise<t.ScopeConfigDoc> {
  const body = (await response.json()) as AdminConfigResponse | { message?: string };
  const config = 'config' in body ? body.config : undefined;
  if (!config?._id) {
    throw new Error(
      'Backend did not return a config document. The scope may not have been created.',
    );
  }
  return config;
}

/**
 * Before `expectedRevision`: reads the principal's profile and returns it
 * when there is one, else checks that a role exists (the admin API would
 * create a profile for any name) and creates the profile with a PUT. A
 * profile created by someone else between the read and the PUT is
 * overwritten with an empty one.
 */
async function createScopeLegacy(
  url: string,
  data: t.CreateScopeInput,
  principalId: string,
  priority: number,
): Promise<t.ScopeConfigDoc> {
  const existing = await apiFetch(url);
  if (existing.ok) return ((await existing.json()) as AdminConfigResponse).config;
  if (data.principalType === PrincipalType.ROLE) {
    const role = await apiFetch(`/api/admin/roles/${encodeURIComponent(principalId)}`);
    if (role.status === 404) throw new Error(missingRoleMessage(principalId));
  }
  const response = await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify({ overrides: {}, priority }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Failed to create scope'));
  return readConfigDoc(response);
}

/**
 * With `expectedRevision`: one create-only PUT (`expectedRevision: 'absent'`),
 * so a profile created meanwhile is never overwritten; when one exists
 * (409) it is read and returned. With `principalCheck` the admin API refuses
 * a principal that doesn't exist (404 `PRINCIPAL_NOT_FOUND`), so the role
 * is not looked up first.
 */
async function createScopeOnce(
  url: string,
  data: t.CreateScopeInput,
  principalId: string,
  priority: number,
  principalCheck: boolean,
): Promise<t.ScopeConfigDoc> {
  if (!principalCheck && data.principalType === PrincipalType.ROLE) {
    const role = await apiFetch(`/api/admin/roles/${encodeURIComponent(principalId)}`);
    if (role.status === 404) throw new Error(missingRoleMessage(principalId));
  }
  const response = await apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify({ overrides: {}, priority, expectedRevision: ABSENT_REVISION }),
  });
  if (response.ok) return readConfigDoc(response);
  const body = (await response.json().catch(() => ({}))) as t.ApiErrorBody;
  if (response.status === 409 && body.code === VERSION_CONFLICT_CODE) {
    const existing = await apiFetch(url);
    if (existing.ok) return ((await existing.json()) as AdminConfigResponse).config;
  }
  if (body.code === PRINCIPAL_NOT_FOUND_CODE && data.principalType === PrincipalType.ROLE) {
    throw new Error(missingRoleMessage(principalId));
  }
  throw new Error(apiErrorBodyMessage(body, response.status, 'Failed to create scope'));
}

/**
 * Create a profile for a role, group or user. The priority defaults to
 * `DEFAULT_SCOPE_PRIORITY` for the principal type. When the principal already
 * has a profile it is returned as is, so creating never replaces overrides:
 * atomically on a server with `expectedRevision` (`createScopeOnce`), else
 * by reading first (`createScopeLegacy`).
 */
export const createScopeFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        principalType: z.nativeEnum(PrincipalType),
        name: z.string().min(1),
        priority: z.number().int().min(0).optional(),
        principalId: z.string().optional(),
        email: z.string().optional(),
      })
      .refine((d) => d.principalType !== PrincipalType.USER || !!d.principalId, {
        message: 'principalId is required for USER scopes',
        path: ['principalId'],
      })
      .refine((d) => d.principalId !== BASE_CONFIG_PRINCIPAL_ID, {
        message: 'Cannot create a scope with the reserved base config ID',
        path: ['principalId'],
      }),
  )
  .handler(async ({ data }: { data: t.CreateScopeInput }) => {
    await requireAnyCapability([
      SystemCapabilities.ASSIGN_CONFIGS,
      SystemCapabilities.MANAGE_CONFIGS,
    ]);
    const principalId =
      data.principalId ??
      (data.principalType === PrincipalType.ROLE
        ? data.name.toLowerCase().replace(/\s+/g, '_')
        : `grp_${data.name.toLowerCase().replace(/\s+/g, '_')}`);
    const url = `/api/admin/config/${data.principalType}/${encodeURIComponent(principalId)}`;
    const priority =
      data.priority ?? DEFAULT_SCOPE_PRIORITY[data.principalType as t.ScopePrincipalType];
    const { features } = await readConfigContract();
    const config = features.expectedRevision
      ? await createScopeOnce(url, data, principalId, priority, features.principalCheck)
      : await createScopeLegacy(url, data, principalId, priority);
    return {
      scope: {
        ...apiConfigToScope(config, undefined, features),
        name: data.name,
        ...(data.email && { email: data.email }),
        ...(data.principalType === PrincipalType.GROUP && { memberCount: 0 }),
      },
    };
  });

/**
 * Sets only a profile's priority (`priorityRoute`, D6): its overrides,
 * hidden settings and active state stay as stored. Broad `manage:configs`
 * only, like every priority change.
 */
export const setScopePriorityFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string().min(1),
      priority: z.number().int().min(0).max(MAX_SCOPE_PRIORITY),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { principalType: PrincipalType; principalId: string; priority: number };
    }) => {
      await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
      const response = await apiFetch(
        `/api/admin/config/${data.principalType}/${encodeURIComponent(data.principalId)}/priority`,
        { method: 'PATCH', body: JSON.stringify({ priority: data.priority }) },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, 'Failed to change the priority'));
      }
      const config = await readConfigDoc(response);
      return { priority: config.priority };
    },
  );

/**
 * Toggle a scope's isActive flag.
 */
export const toggleScopeActiveFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      isActive: z.boolean(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
        isActive: boolean;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/active`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: data.isActive }),
        },
      );

      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, 'Failed to toggle scope'));
      }
      return { success: true };
    },
  );

/**
 * Delete a scope and all its config overrides.
 */
export const deleteScopeFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}`,
        { method: 'DELETE' },
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(await apiErrorMessage(response, 'Failed to delete scope'));
      }
      return { success: true };
    },
  );
