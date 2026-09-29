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
  display_group?: string;
  help_url?: string;
  usage_stats?: boolean;
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
  /** 该组工具的可见组（2.17.0）；空 = 不限（全员可见）。 */
  allowed_groups: string[];
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

// ── Gitea 分发（「从 Gitea 导入」）───────────────────────────────────

export interface GiteaRepoSummary {
  name: string;
  description?: string;
  updated_at?: string;
}

export interface GiteaOwner {
  login: string;
  type?: 'user' | 'org';
  repos: GiteaRepoSummary[];
}

export interface GiteaReposResult {
  base_url: string;
  owners: GiteaOwner[];
}

export interface GiteaReleaseInfo {
  tag: string;
  published_at?: string;
  zip_asset?: string;
  zip_size?: number;
}

export interface GiteaCheckItem {
  key: string;
  level: 'ok' | 'warn' | 'error';
  message: string;
}

export interface GiteaCheckResult {
  owner: string;
  repo: string;
  repo_description?: string;
  release?: GiteaReleaseInfo;
  /** repo 根 tool.json 解析结果（缺失时 undefined） */
  tool_json?: { [key: string]: JsonValue };
  checks: GiteaCheckItem[];
  installable: boolean;
}

// ── 待确认更新（2.8.0 治理决策）─────────────────────────────────────

export interface PendingPackageMeta {
  version: string;
  size: number;
  updated_at: string;
}

/** 仓库最新稳定 Release 领先于 manifest 已批准版本的 desktop 工具。 */
export interface PendingToolUpdate {
  tool_id: string;
  display_name: string;
  owner?: string;
  repo?: string;
  current_version: string;
  package: PendingPackageMeta;
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
  allowed_groups: z.array(z.string()).optional().default([]),
  tool_count: z.number().optional().default(0),
  explicit: z.boolean().optional().default(false),
});

const toolGroupMetaSchema = z.object({
  name: z.string(),
  display_name: z.string().optional().default(''),
  sort_order: z.number().optional().default(0),
});

const giteaCheckItemSchema = z.object({
  key: z.string(),
  level: z.enum(['ok', 'warn', 'error']),
  message: z.string(),
});

const pendingToolUpdateSchema = z.object({
  tool_id: z.string(),
  display_name: z.string(),
  owner: z.string().optional(),
  repo: z.string().optional(),
  current_version: z.string(),
  package: z.object({
    version: z.string(),
    size: z.number(),
    updated_at: z.string(),
  }),
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
  allowed_groups: z.array(z.string()).optional(),
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

// ── Gitea 分发（「从 Gitea 导入」）───────────────────────────────────

export const giteaReposFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ baseUrl: z.string().optional() }))
  .handler(async ({ data }): Promise<GiteaReposResult> => {
    const qs = data.baseUrl ? `?base_url=${encodeURIComponent(data.baseUrl)}` : '';
    const response = await apiFetch(`/api/terravox/admin/gitea/repos${qs}`);
    if (!response.ok) {
      await gatewayError(response);
    }
    const parsed = z
      .object({
        base_url: z.string(),
        owners: z.array(
          z.object({
            login: z.string(),
            repos: z.array(
              z.object({
                name: z.string(),
                description: z.string().optional(),
                updated_at: z.string().optional(),
              }),
            ),
          }),
        ),
      })
      .safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Failed to parse Gitea repository listing');
    }
    return parsed.data as GiteaReposResult;
  });

/** Gitea 地址 → owner 分组仓库列表（随地址变化重新拉取）。空串 = 网关默认地址。 */
export const giteaReposQueryOptions = (baseUrl: string) =>
  queryOptions({
    queryKey: ['terravox', 'gitea', 'repos', baseUrl],
    queryFn: () => giteaReposFn({ data: { baseUrl: baseUrl || undefined } }),
    staleTime: 60_000,
  });

export const giteaCheckRepoFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      baseUrl: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<GiteaCheckResult> => {
    const response = await apiFetch('/api/terravox/admin/gitea/repos/check', {
      method: 'POST',
      body: JSON.stringify({
        owner: data.owner,
        repo: data.repo,
        ...(data.baseUrl ? { base_url: data.baseUrl } : {}),
      }),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    const parsed = z
      .object({
        owner: z.string(),
        repo: z.string(),
        repo_description: z.string().optional(),
        release: z
          .object({
            tag: z.string(),
            published_at: z.string().optional(),
            zip_asset: z.string().optional(),
            zip_size: z.number().optional(),
          })
          .optional(),
        tool_json: z.record(z.string(), z.any()).optional(),
        checks: z.array(giteaCheckItemSchema),
        installable: z.boolean(),
      })
      .safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Failed to parse Gitea repo check result');
    }
    return parsed.data as GiteaCheckResult;
  });

// ── 待确认更新 ───────────────────────────────────────────────────────

export const getPendingUpdatesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ updates: PendingToolUpdate[] }> => {
    const response = await apiFetch('/api/terravox/admin/tools/pending-updates');
    if (!response.ok) {
      await gatewayError(response);
    }
    const parsed = z
      .object({ updates: z.array(pendingToolUpdateSchema) })
      .safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Failed to parse pending tool updates');
    }
    return parsed.data as { updates: PendingToolUpdate[] };
  },
);

/** 每分钟的刷新对齐网关 60s 的 Gitea 解析缓存；确认落库后 invalidate 即时清空。 */
export const pendingUpdatesQueryOptions = queryOptions({
  queryKey: ['terravox', 'pending-updates'],
  queryFn: () => getPendingUpdatesFn().then((r) => r.updates),
  staleTime: 60_000,
  refetchInterval: 60_000,
});

// ── 使用统计（run_reports，local-tool-plan §11 步骤 3）───────────────

/** One direct-run usage row recorded by the toolbox (gateway `run_reports`). */
export interface RunReport {
  id: string;
  user_sub: string;
  username: string | null;
  tool_id: string;
  version: string | null;
  status: 'succeeded' | 'failed' | 'stopped' | 'timeout';
  duration_ms: number | null;
  /** Argument key names only — values are never recorded (privacy by contract). */
  argument_keys: string[];
  source: string;
  created_at: string;
}

export interface RunReportFilters {
  tool_id?: string;
  user_sub?: string;
  /** Inclusive ISO bounds built from local-day pickers. */
  since?: string;
  until?: string;
}

export const RUN_REPORTS_PAGE_SIZE = 50;
/** Gateway caps a page at 200 — the export loop uses that maximum. */
const RUN_REPORTS_FETCH_LIMIT = 200;
/** Hard export ceiling: a runaway filter must not loop the gateway forever. */
export const RUN_REPORTS_EXPORT_CAP = 10_000;

const runReportSchema = z.object({
  id: z.string(),
  user_sub: z.string(),
  username: z.string().nullable().optional().default(''),
  tool_id: z.string(),
  version: z.string().nullable().optional().default(null),
  status: z.enum(['succeeded', 'failed', 'stopped', 'timeout']),
  duration_ms: z.number().nullable().optional().default(null),
  argument_keys: z.array(z.string()).optional().default([]),
  source: z.string().optional().default(''),
  created_at: z.string(),
});

const runReportFiltersSchema = z.object({
  tool_id: z.string().optional(),
  user_sub: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

/** Serialize filters + paging into the gateway query string (empty values dropped). */
export function buildRunReportsQuery(
  filters: RunReportFilters,
  limit: number,
  offset: number,
): string {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function fetchRunReportsPage(
  filters: RunReportFilters,
  limit: number,
  offset: number,
): Promise<{ reports: RunReport[]; total: number }> {
  const response = await apiFetch(
    `/api/terravox/admin/runs/reports${buildRunReportsQuery(filters, limit, offset)}`,
  );
  if (!response.ok) {
    await gatewayError(response);
  }
  const parsed = z
    .object({ reports: z.array(runReportSchema), total: z.number() })
    .safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Failed to parse run reports');
  }
  return parsed.data;
}

export const getRunReportsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    runReportFiltersSchema.extend({
      limit: z.number().int().min(1).max(RUN_REPORTS_FETCH_LIMIT).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(
    async ({ data }): Promise<{ reports: RunReport[]; total: number }> =>
      fetchRunReportsPage(data, data.limit ?? RUN_REPORTS_PAGE_SIZE, data.offset ?? 0),
  );

/** Paged table query — the Usage screen's main data source. */
export const runReportsQueryOptions = (page: number, filters: RunReportFilters = {}) =>
  queryOptions({
    queryKey: ['terravox', 'runReports', page, filters] as const,
    queryFn: () =>
      getRunReportsFn({
        data: {
          ...filters,
          limit: RUN_REPORTS_PAGE_SIZE,
          offset: (Math.max(1, page) - 1) * RUN_REPORTS_PAGE_SIZE,
        },
      }),
    staleTime: 60_000,
  });

/** Export path: page through the whole filter result (up to the cap) and hand
 * the rows to the client, which builds the BOM'd UTF-8 CSV. */
export const exportRunReportsFn = createServerFn({ method: 'POST' })
  .inputValidator(runReportFiltersSchema)
  .handler(async ({ data }): Promise<{ reports: RunReport[]; truncated: boolean }> => {
    const reports: RunReport[] = [];
    let offset = 0;
    let total = Infinity;
    for (;;) {
      const page = await fetchRunReportsPage(data, RUN_REPORTS_FETCH_LIMIT, offset);
      total = page.total;
      reports.push(...page.reports);
      if (reports.length >= RUN_REPORTS_EXPORT_CAP) {
        reports.length = RUN_REPORTS_EXPORT_CAP;
        return { reports, truncated: total > RUN_REPORTS_EXPORT_CAP };
      }
      if (reports.length >= total || page.reports.length < RUN_REPORTS_FETCH_LIMIT) {
        return { reports, truncated: false };
      }
      offset += page.reports.length;
    }
  });

// ── Service registry (contracts 2.16.0) ─────────────────────────────

/** 一个绑定 = 一幅地图（iserver_map）或一个数据源（iserver_data）。 */
export interface TerraVoxService {
  id: string;
  name: string;
  type: 'iserver_map' | 'iserver_data';
  base_url: string;
  service_path: string;
  datasource: string;
  allowed_groups: string[];
  enabled: boolean;
  status: 'available' | 'unavailable' | 'unprobed';
  probe_detail: string;
  probed_at: string | null;
}

export interface TerraVoxServiceInput {
  name: string;
  type: string;
  base_url: string;
  service_path: string;
  datasource: string;
  allowed_groups: string[];
  enabled: boolean;
}

const serviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  base_url: z.string(),
  service_path: z.string(),
  datasource: z.string(),
  allowed_groups: z.array(z.string()),
  enabled: z.boolean(),
  status: z.string(),
  probe_detail: z.string(),
  probed_at: z.string().nullable().optional().default(null),
});

export const getServicesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ services: TerraVoxService[]; total: number }> => {
    const response = await apiFetch('/api/terravox/admin/services');
    if (!response.ok) {
      await gatewayError(response);
    }
    const json = (await response.json()) as { services?: unknown[]; total?: number };
    const parsed = z.array(serviceSchema).safeParse(json.services ?? []);
    if (!parsed.success) {
      throw new Error('Failed to parse service registry');
    }
    return { services: parsed.data as TerraVoxService[], total: json.total ?? parsed.data.length };
  },
);

export const servicesQueryOptions = queryOptions({
  queryKey: ['terravox', 'admin', 'services'],
  queryFn: () => getServicesFn(),
  staleTime: 15_000,
});

export const createServiceFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ service: z.record(z.string(), z.any()) }))
  .handler(async ({ data }) => {
    const response = await apiFetch('/api/terravox/admin/services', {
      method: 'POST',
      body: JSON.stringify(data.service),
    });
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const updateServiceFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      serviceId: z.string(),
      service: z.record(z.string(), z.any()),
    }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/services/${encodeURIComponent(data.serviceId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data.service),
      },
    );
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const deleteServiceFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ serviceId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/services/${encodeURIComponent(data.serviceId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 204) {
      await gatewayError(response);
    }
    return { ok: true };
  });

export const probeServiceFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ serviceId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/services/${encodeURIComponent(data.serviceId)}/probe`,
      { method: 'POST' },
    );
    if (!response.ok) {
      await gatewayError(response);
    }
    return response.json();
  });

export const getServiceDatasourcesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ serviceId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/terravox/admin/services/${encodeURIComponent(data.serviceId)}/datasources`,
    );
    if (!response.ok) {
      await gatewayError(response);
    }
    return (await response.json()) as {
      datasources: string[];
      dataset_counts: Record<string, number>;
    };
  });
