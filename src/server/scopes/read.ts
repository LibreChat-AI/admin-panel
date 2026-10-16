import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type {
  AdminConfigListResponse,
  AdminConfigResponse,
  AdminConfig,
} from '@librechat/data-schemas';
import type * as t from '@/types';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { requireAnyCapability } from '../capabilities';
import { apiFetch } from '../utils/api';
import { deepGet } from './paths';

function apiConfigToScope(config: AdminConfig, nameMap?: Map<string, string>): t.ConfigScope {
  return {
    _id: config._id,
    principalType: config.principalType,
    principalId: config.principalId,
    name: nameMap?.get(config.principalId) ?? config.principalId,
    priority: config.priority,
    isActive: config.isActive,
  };
}

/**
 * Fetch all available scopes (all config overrides in the DB).
 */
export const getAvailableScopesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [configRes, groupsRes] = await Promise.all([
    apiFetch('/api/admin/config'),
    apiFetch('/api/admin/groups?limit=200').catch(() => null),
  ]);
  if (!configRes.ok) {
    throw new Error(`Failed to fetch scopes: ${configRes.status}`);
  }
  const { configs } = (await configRes.json()) as AdminConfigListResponse;

  const nameMap = new Map<string, string>();
  if (groupsRes?.ok) {
    const { groups } = (await groupsRes.json()) as { groups: { _id: string; name: string }[] };
    for (const g of groups) nameMap.set(g._id, g.name);
  }

  const scopes: t.ConfigScope[] = configs
    .filter((c) => c.principalId !== BASE_CONFIG_PRINCIPAL_ID)
    .map((c) => apiConfigToScope(c, nameMap));
  return { scopes };
});

/** Shared queryOptions so every consumer deduplicates and caches the scopes list. */
export const availableScopesOptions = queryOptions({
  queryKey: ['availableScopes'],
  queryFn: () => getAvailableScopesFn().then((r) => r.scopes),
  staleTime: 30_000,
});

/**
 * Fetch all profile values for a specific field across all scopes.
 * Fetches all configs and extracts the field value from each config's overrides.
 */
export const getFieldProfileValuesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ fieldPath: z.string() }))
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

/**
 * Batch fetch profile principal types for many fields at once.
 * Fetches all configs once and checks each field path across all configs.
 */
export const getBatchFieldProfilesFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ paths: z.array(z.string()) }))
  .handler(async ({ data }: { data: { paths: string[] } }) => {
    const response = await apiFetch('/api/admin/config');
    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status}`);
    }
    const { configs } = (await response.json()) as AdminConfigListResponse;

    const map: Record<string, string[]> = {};
    for (const path of data.paths) {
      const principalTypes: string[] = [];
      for (const config of configs) {
        if (config.principalId === BASE_CONFIG_PRINCIPAL_ID) continue;
        if (deepGet(config.overrides, path) !== undefined) {
          principalTypes.push(config.principalType);
        }
      }
      if (principalTypes.length > 0) {
        map[path] = principalTypes;
      }
    }
    return { profileMap: map };
  });

/**
 * Create a new scope by upserting a config with empty overrides.
 */
export const createScopeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z
      .object({
        principalType: z.nativeEnum(PrincipalType),
        name: z.string().min(1),
        priority: z.number().int().min(0),
        principalId: z.string().optional(),
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
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        name: string;
        priority: number;
        principalId?: string;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const principalId =
        data.principalId ??
        (data.principalType === PrincipalType.ROLE
          ? data.name.toLowerCase().replace(/\s+/g, '_')
          : `grp_${data.name.toLowerCase().replace(/\s+/g, '_')}`);

      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(principalId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ overrides: {}, priority: data.priority }),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to create scope: ${response.status}`,
        );
      }

      const body = (await response.json()) as AdminConfigResponse | { message?: string };
      const config = 'config' in body ? body.config : undefined;
      if (!config?._id) {
        throw new Error(
          'Backend did not return a config document. The scope may not have been created.',
        );
      }
      const scope: t.ConfigScope = {
        _id: config._id,
        principalType: data.principalType,
        principalId,
        name: data.name,
        priority: data.priority,
        memberCount: data.principalType === PrincipalType.GROUP ? 0 : undefined,
        isActive: true,
      };
      return { scope };
    },
  );

/**
 * Toggle a scope's isActive flag.
 */
export const toggleScopeActiveFn = createServerFn({ method: 'POST' })
  .inputValidator(
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
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to toggle scope: ${response.status}`,
        );
      }
      return { success: true };
    },
  );

/**
 * Delete a scope and all its config overrides.
 */
export const deleteScopeFn = createServerFn({ method: 'POST' })
  .inputValidator(
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
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to delete scope: ${response.status}`,
        );
      }
      return { success: true };
    },
  );
