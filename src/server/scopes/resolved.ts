import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import type { AdminConfigResponse } from '@librechat/data-schemas';
import type * as t from '@/types';
import { apiFetch } from '../utils/api';

/**
 * Fetch the resolved (merged) config for a specific scope.
 * Returns the config's overrides with the changed field paths.
 */
export const getResolvedConfigFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
    }),
  )
  .handler(async ({ data }: { data: { principalType: PrincipalType; principalId: string } }) => {
    const apiType = data.principalType;
    const response = await apiFetch(
      `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}`,
    );

    if (response.status === 404) {
      return { resolvedConfig: {}, changedPaths: [] };
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status}`);
    }

    const { config } = (await response.json()) as AdminConfigResponse;
    const overrides = config.overrides ?? {};

    const changedPaths: string[] = [];
    const resolvedConfig: t.FlatConfigMap = {};

    function flatten(obj: object, prefix: string) {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value as object, path);
        } else {
          changedPaths.push(path);
          resolvedConfig[path] = value as t.FlatConfigMap[string];
        }
      }
    }
    flatten(overrides, '');

    return { resolvedConfig, changedPaths };
  });
