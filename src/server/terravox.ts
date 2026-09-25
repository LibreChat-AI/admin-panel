/**
 * Server functions for TerraVox tool management.
 *
 * All calls go through the LibreChat proxy (/api/terravox/*), which forwards to
 * the Tool Gateway with the shared service token and this admin's acting
 * identity (the proxy enforces ACCESS_ADMIN before forwarding).
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { apiFetch } from './utils/api';

// ── Types ────────────────────────────────────────────────────────────

/** JSON value tree — used for manifest blocks the gateway re-validates. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Editing view of a Tool Manifest (contracts manifest/v1). `parameters`,
 * `form`, `execution`, `result` and `audit` stay loose: the gateway is the
 * validation authority — it re-checks every submit against the vendored
 * contracts schema. Explicit interfaces (not zod inference) so the values
 * stay assignable across the server-fn serialization boundary.
 */
export interface TerraVoxTool {
  schema_version?: number;
  tool_id: string;
  version: string;
  enabled?: boolean;
  display_name: string;
  description: string;
  expose?: string[];
  allowed_groups?: string[];
  dangerous?: boolean;
  parameters?: { [key: string]: JsonValue };
  form?: { [key: string]: JsonValue };
  execution?: { [key: string]: JsonValue };
  result?: { [key: string]: JsonValue };
  timeout_seconds?: number;
  audit?: { [key: string]: JsonValue };
}

export interface TerraVoxGroup {
  name: string;
  display_name: string;
  description: string;
  sort_order: number;
  tool_count: number;
  /** false = implicit namespace derived from existing tools (no DB row). */
  explicit: boolean;
}

export interface TerraVoxGroupMeta {
  name: string;
  display_name: string;
  sort_order: number;
}

export interface ImportResult {
  tool_id: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

// ── Runtime guards (shape only — the gateway validates semantics) ────

const toolManifestSchema = z
  .object({
    tool_id: z.string(),
    version: z.string(),
    display_name: z.string(),
    description: z.string(),
  })
  .passthrough();

const toolGroupSchema = z.object({
  name: z.string(),
  display_name: z.string().optional().default(''),
  description: z.string().optional().default(''),
  sort_order: z.number().optional().default(0),
  tool_count: z.number().optional().default(0),
  explicit: z.boolean().optional().default(false),
});

const toolGroupMetaSchema = z.object({
  name: z.string(),
  display_name: z.string().optional().default(''),
  sort_order: z.number().optional().default(0),
});

// ── Error plumbing ───────────────────────────────────────────────────

/** Gateway error detail ({code, message, errors?}) flattened for the UI. */
export async function gatewayError(response: Response): Promise<never> {
  let message = `Request failed: ${String(response.status)}`;
  let code: string | undefined;
  let errors: { path?: string; message: string }[] | undefined;
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      message?: unknown;
    };
    const detail = body?.detail ?? body;
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail && typeof detail === 'object') {
      const d = detail as {
        message?: unknown;
        code?: unknown;
        errors?: unknown;
      };
      if (typeof d.message === 'string') {
        message = d.message;
      }
      if (typeof d.code === 'string') {
        code = d.code;
      }
      if (Array.isArray(d.errors)) {
        errors = d.errors
          .map((e) => {
            const item = e as { path?: unknown; message?: unknown };
            return {
              path: typeof item.path === 'string' ? item.path : undefined,
              message: typeof item.message === 'string' ? item.message : String(item),
            };
          })
          .filter((e) => e.message);
      }
    }
  } catch {
    /* non-JSON body — keep the status message */
  }
  const error = new Error(message) as Error & {
    status?: number;
    code?: string;
    errors?: { path?: string; message: string }[];
  };
  error.status = response.status;
  error.code = code;
  error.errors = errors;
  throw error;
}

// ── Catalog ──────────────────────────────────────────────────────────

export const getToolsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ tools: TerraVoxTool[]; groups: TerraVoxGroupMeta[] }> => {
    const response = await apiFetch('/api/terravox/tools/all');
    if (!response.ok) {
      await gatewayError(response);
    }
    const json = (await response.json()) as {
      tools?: unknown[];
      groups?: unknown[];
    };
    const parsed = z.array(toolManifestSchema).safeParse(json.tools ?? []);
    if (!parsed.success) {
      throw new Error('Failed to parse tool catalog');
    }
    const groups = z.array(toolGroupMetaSchema).safeParse(json.groups ?? []);
    return {
      tools: parsed.data as TerraVoxTool[],
      groups: groups.success ? (groups.data as TerraVoxGroupMeta[]) : [],
    };
  },
);

export const toolsQueryOptions = queryOptions({
  queryKey: ['terravox', 'tools', 'all'],
  queryFn: () => getToolsFn(),
  staleTime: 30_000,
});

// ── Groups ───────────────────────────────────────────────────────────

export const getToolGroupsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ groups: TerraVoxGroup[] }> => {
    const response = await apiFetch('/api/terravox/admin/groups');
    if (!response.ok) {
      await gatewayError(response);
    }
    const parsed = z.object({ groups: z.array(toolGroupSchema) }).safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Failed to parse tool groups');
    }
    return { groups: parsed.data.groups as TerraVoxGroup[] };
  },
);

export const toolGroupsQueryOptions = queryOptions({
  queryKey: ['terravox', 'groups'],
  queryFn: () => getToolGroupsFn().then((r) => r.groups),
  staleTime: 30_000,
});

const groupInputSchema = z.object({
  name: z.string().optional(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  sort_order: z.number().optional(),
});

export const createToolGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(groupInputSchema)
  .handler(async ({ data }) => {
    const response = await apiFetch('/api/terravox/admin/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const updateToolGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(
    groupInputSchema.extend({
      name: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { name, ...patch } = data;
    const response = await apiFetch(`/api/terravox/admin/groups/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const deleteToolGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(`/api/terravox/admin/groups/${encodeURIComponent(data.name)}`, {
      method: 'DELETE',
    });
    if (!response.ok && response.status !== 404) {
      await gatewayError(response);
    }
    return { deleted: data.name };
  });

// ── Handlers ─────────────────────────────────────────────────────────

export const getHandlersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const response = await apiFetch('/api/terravox/admin/handlers');
  if (!response.ok) {
    await gatewayError(response);
  }
  const parsed = z.object({ handlers: z.array(z.string()) }).safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Failed to parse handlers');
  }
  return parsed.data;
});

export const handlersQueryOptions = queryOptions({
  queryKey: ['terravox', 'handlers'],
  queryFn: () => getHandlersFn().then((r) => r.handlers),
  staleTime: 5 * 60_000,
});

// ── Tool CRUD ────────────────────────────────────────────────────────

export const createToolFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ manifest: z.record(z.string(), z.any()) }))
  .handler(async ({ data }) => {
    const response = await apiFetch('/api/terravox/admin/tools', {
      method: 'POST',
      body: JSON.stringify(data.manifest),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const updateToolFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      toolId: z.string(),
      manifest: z.record(z.string(), z.any()),
    }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/tools/${encodeURIComponent(data.toolId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(data.manifest),
      },
    );
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const toggleToolFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      toolId: z.string(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/tools/${encodeURIComponent(data.toolId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ enabled: data.enabled }),
      },
    );
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const deleteToolFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ toolId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/tools/${encodeURIComponent(data.toolId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      await gatewayError(response);
    }
    return { deleted: data.toolId };
  });

// ── Import ───────────────────────────────────────────────────────────

export const importToolsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tools: z.array(z.record(z.string(), z.any())).min(1),
      overwrite: z.boolean().default(false),
      dryRun: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch('/api/terravox/admin/tools/import', {
      method: 'POST',
      body: JSON.stringify({
        tools: data.tools,
        overwrite: data.overwrite,
        dry_run: data.dryRun,
      }),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    const parsed = z
      .object({
        results: z.array(
          z.object({
            tool_id: z.string(),
            action: z.enum(['created', 'updated', 'skipped', 'failed']),
            error: z.string().optional(),
          }),
        ),
        dry_run: z.boolean().optional(),
      })
      .safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Failed to parse import results');
    }
    return parsed.data;
  });
