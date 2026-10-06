/**
 * TerraVox 领域类型（manifest/服务绑定/用量/Gitea 检查等）。
 *
 * 从 src/server/terravox.ts 迁入（CLAUDE.md：本地接口一律入 src/types/）。
 * 刻意用显式 interface 而非 zod 推断——值需跨 server-fn 序列化边界保持
 * 可赋值；gateway 是校验权威（提交时按 vendored contracts schema 重校验）。
 */

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
  /** 2.22.0 分组内显示顺序：升序，缺省沉底（再按 tool_id）。 */
  display_order?: number;
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

/** One direct-run usage row recorded by the toolbox (gateway `run_reports`). */
export interface RunReport {
  id: string;
  user_sub: string;
  /** 工具显示名（2.19.0）；空 = 未记录，展示回退 tool_id。 */
  tool_name?: string | null;
  username: string | null;
  /** 用户显示名（OIDC name claim，如中文名）；空 = 未提供，展示回退 username。 */
  user_name?: string | null;
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

/** 一个绑定 = 一幅地图（iserver_map）或一个数据源（iserver_data）。 */
export interface TerraVoxService {
  id: string;
  name: string;
  type: 'iserver_map' | 'iserver_data';
  base_url: string;
  service_path: string;
  datasource: string;
  allowed_groups: string[];
  map_name: string;
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

/** 底图组（2.19.0）：按叠放序的多幅底图，整组读写。 */
export interface BasemapItem {
  id?: string;
  base_url: string;
  service_path: string;
  map_name: string;
  url?: string;
}

/** 自动发现候选服务（2.18.0）：iServer 基地址 → REST 地图/数据服务清单。 */
export interface DiscoveredService {
  name: string;
  type: 'iserver_map' | 'iserver_data' | 'unknown';
  service_path: string;
  status: 'available' | 'unavailable';
  detail: string;
  maps: string[];
  datasources: string[];
}
