import type { ReactNode } from 'react';
import type { ReadOnlyReason } from './config';

/**
 * A behaviour of the admin config API that a LibreChat server reports in
 * `GET /api/admin/config/meta`. Mirrors `AdminConfigFeatureFlag` of newer
 * `@librechat/data-schemas` releases (the pinned one has no meta contract).
 */
export type ConfigFeatureFlag =
  | 'dottedKeys'
  | 'sectionAllowlist'
  | 'readFilteredWriteResponses'
  | 'preAuthBaseOverrides'
  | 'webSearchStoredKeys'
  | 'expectedRevision'
  | 'prunesEmptyParents'
  | 'awaitedInvalidation'
  | 'changesBatch'
  | 'yamlMcpHide'
  | 'deterministicPrecedence'
  | 'priorityRoute'
  | 'principalCheck'
  | 'roleRenameMovesProfile'
  | 'recordSecrets'
  | 'azureGroupSecrets'
  | 'yamlSecretPreview'
  | 'envAllowlist'
  | 'secretRebinding'
  | 'keyedTombstones'
  | 'renameHints'
  | 'writeReport'
  | 'issueParams'
  | 'resolvedApi'
  | 'catalogApi'
  | 'envStatus'
  | 'azureGroupMergeKey'
  | 'customParamsExpansion'
  | 'specInterfaceRederive'
  | 'endpointRederive';

/** Which admin config behaviours the server has; a flag it does not report is `false`. */
export type ConfigFeatures = Readonly<Record<ConfigFeatureFlag, boolean>>;

/** The features that decide where the panel may write (`resolveWriteRules`). */
export type WriteRuleFeatures = Pick<
  ConfigFeatures,
  'preAuthBaseOverrides' | 'endpointRederive' | 'azureGroupMergeKey' | 'azureGroupSecrets'
>;

export interface ConfigLimits {
  /** Most entries one `PATCH /fields` accepts. */
  maxPatchEntries: number;
  /** Most ops one `POST /changes` accepts (`0` without `changesBatch`). */
  maxChangeOps: number;
  /** How long another LibreChat instance may serve resolved config from before a write. */
  overrideCacheTtlMs: number;
  /** How long `GET /catalog` reuses a scope's model lists while its endpoint config is unchanged (`catalogApi`). */
  catalogModelsTtlMs: number;
  /** Longest entry name a keyed path (`keyedTombstones`) can name. */
  maxEntryKeyLength: number;
}

/** A secret config field: encrypted at rest, omitted from reads, kept when a write omits it. */
export interface ConfigSecretFieldRule {
  path: string;
  /** Masked-preview companion returned on reads; never writable. */
  previewPath: string;
  /** Whether a `${ENV_VAR}` reference is stored as is instead of encrypted. */
  allowEnvPlaceholder: boolean;
}

/** A secret held by every item of an array, matched across writes by `identityKey`. */
export interface ConfigArraySecretFieldRule {
  arrayPath: string;
  secretKey: string;
  previewKey: string;
  identityKey: string;
}

/** A secret every entry of a record keyed by entry name holds, such as each MCP server's. */
export interface ConfigRecordSecretFieldRule {
  recordPath: string;
  secretPath: string;
  previewPath: string;
}

export interface ConfigInterfaceRules {
  /** Interface fields that are role permissions; overrides drop them. */
  permissionFields: string[];
  /** Permission fields whose boolean form is a runtime toggle overrides keep. */
  runtimeFields: string[];
  /** Sub-keys of an object-form permission field that are permission bits. */
  permissionSubKeys: string[];
}

/**
 * Why only librechat.yaml sets a path: LibreChat reads it once at startup
 * (`startup`), it is a boundary only the operator sets (`operator`), or
 * nothing reads it (`unused`).
 */
export type DeploymentOnlyReason = 'startup' | 'operator' | 'unused';

/** The write rules a server enforces, in `librechat.yaml` key names. */
export interface ConfigRules {
  /** Top-level sections the server's config schema defines. */
  acceptedSections: string[];
  /** Sections only `librechat.yaml` sets; writes to them are dropped. */
  baseOnlySections: string[];
  /** Sections only the base document holds, through their dedicated APIs. */
  basePrincipalSections: string[];
  /** Fields inside overridable sections that only `librechat.yaml` sets. */
  baseOnlyPaths: string[];
  /** Sections and fields only `librechat.yaml` sets, with why; writes to them are skipped. */
  deploymentOnlyPaths: Readonly<Record<string, DeploymentOnlyReason>>;
  /** Arrays merged item by item on a key field instead of replaced. */
  arrayMergeKeys: Readonly<Record<string, string>>;
  /** Objects an override replaces whole instead of merging into. */
  atomicMergePaths: string[];
  /** Override sections the resolved config holds under another name. */
  overrideKeyMap: Readonly<Record<string, string>>;
  /** Fields the server derives from others (`endpoints.anthropic.vertexConfig`); writes there are skipped. */
  derivedPaths: string[];
  secretFields: ConfigSecretFieldRule[];
  arraySecretFields: ConfigArraySecretFieldRule[];
  recordSecretFields: ConfigRecordSecretFieldRule[];
  /** Maps of credentials admin writes are refused for. */
  refusedMaps: string[];
  /** MCP server fields that make a server process-backed; only `librechat.yaml` sets them. */
  processMcpFields: string[];
  interface: ConfigInterfaceRules;
  /** Whether `endpoints.all` title settings apply as one block or per field. */
  titleResolution: 'block' | 'field';
}

export interface ConfigVersions {
  librechat: string;
  dataProvider: string;
  configSchema: string;
}

/**
 * The admin config API contract of the connected LibreChat server: what it
 * reports in `GET /api/admin/config/meta`, each part it leaves out (or an
 * older server without the route) filled from the panel's bundled fallback.
 */
export interface ConfigContract {
  /** `server`: read from the meta route; `bundled`: the server has none, or it could not be read. */
  source: 'server' | 'bundled';
  versions?: ConfigVersions;
  features: ConfigFeatures;
  limits: ConfigLimits;
  rules: ConfigRules;
}

/**
 * Where the panel may write, from a contract's rules and features: what it
 * renders read-only and leaves out of saves (see `getWriteRules`).
 */
export interface ConfigWriteRules {
  /** Top-level sections the panel never writes, with why. */
  readOnlySections: ReadonlyMap<string, ReadOnlyReason>;
  /** Fields inside writable sections that only librechat.yaml sets. */
  yamlManagedFields: ReadonlySet<string>;
  /** Of `yamlManagedFields`, those LibreChat reads only once, at startup. */
  startupOnlyFields: ReadonlySet<string>;
  /** Of `yamlManagedFields`, those the server keeps from librechat.yaml whatever an override stores (`baseOnlyPaths`). */
  baseOnlyFields: ReadonlySet<string>;
}

/** Which renames and duplicates keep the secrets their source stores (see `getSecretCarry`). */
export interface SecretCarry {
  /** A renamed custom endpoint keeps its stored API key: a batch `rename`, or a field PATCH's `renames` hint (`renameHints`). */
  endpointRename: boolean;
  /** A renamed MCP server keeps its stored API key and OAuth client secret. */
  mcpRename: boolean;
  /** A duplicated MCP server starts with its source's stored secrets. */
  mcpCopy: boolean;
}

/** `GET /api/admin/config/meta` as parsed: every part optional, since forks and older servers differ. */
export interface AdminConfigMetaBody {
  versions?: Partial<ConfigVersions>;
  features?: Partial<Record<string, boolean>>;
  limits?: Partial<ConfigLimits>;
  rules?: Partial<ConfigRules>;
}

export interface ConfigContractProviderProps {
  children: ReactNode;
}
