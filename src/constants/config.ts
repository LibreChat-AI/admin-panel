import { BASE_ONLY_CONFIG_SECTIONS, BASE_PRINCIPAL_CONFIG_SECTIONS } from 'librechat-data-provider';
import type * as t from '@/types';

/**
 * Issue codes of a record key the admin API can't store. `UNSAFE_KEY`: an
 * older LibreChat's request sanitizer silently drops keys that contain `.`
 * or start with `$`. `RESERVED_KEY`: a server that keeps dotted keys
 * (`dottedKeys`) refuses `$`-prefixed keys and the prototype names.
 */
export const UNSAFE_KEY_CODES: ReadonlySet<string> = new Set(['UNSAFE_KEY', 'RESERVED_KEY']);

/** `deleteUserFn`'s error when the LibreChat server has no admin user-delete route (it ships disabled). */
export const USER_DELETE_UNAVAILABLE = 'user_delete_unavailable';

/** The admin API's 403 code while the signed-in admin hasn't accepted LibreChat's terms of service. */
export const TERMS_NOT_ACCEPTED_CODE = 'terms_not_accepted';

/** Once true, LibreChat refuses writes (admin API saves included) from anyone who hasn't accepted its terms. */
export const TERMS_ACCEPTANCE_PATH = 'interface.termsOfService.modalAcceptance';

/** Issue code of a save LibreChat refused until the admin accepts its terms of service. */
export const TERMS_NOT_ACCEPTED_ISSUE = 'TERMS_NOT_ACCEPTED';

/**
 * Sections LibreChat reads from librechat.yaml before sign-in (Turnstile),
 * read-only on every server: one that reports its rules lists them as
 * base-only, an older one reads them from the raw file.
 */
const PRE_AUTH_YAML_SECTIONS: readonly string[] = ['turnstile'];

/**
 * Sections and fields LibreChat reads only from librechat.yaml although its
 * `DEPLOYMENT_ONLY_CONFIG_PATHS` (data-provider 0.8.530) doesn't list them,
 * so the panel adds them on every server: the startup config's client limits
 * and real user monitoring (and the RUM proxy) read the raw file
 * (`appConfig.config`), the conversation list's limits and skill deletion's
 * cleanup concurrency `getAppConfig({ baseOnly: true })`, and the password
 * hashing pool and the HTML shell's color-mode handoff are set once at
 * startup. Drop an entry once LibreChat reads it from the merged config.
 */
const RAW_YAML_PATHS: Readonly<Record<string, t.DeploymentOnlyReason>> = {
  clientLimits: 'operator',
  telemetry: 'operator',
  conversationList: 'operator',
  passwordHashing: 'startup',
  'fileConfig.skills.deletionCleanupConcurrency': 'operator',
  'interface.colorModeFromUrl': 'startup',
};

/** `paths` with the ones LibreChat reads from librechat.yaml without listing them (`RAW_YAML_PATHS`). */
function withRawYamlPaths(
  paths: Readonly<Record<string, t.DeploymentOnlyReason>>,
): Readonly<Record<string, t.DeploymentOnlyReason>> {
  return { ...RAW_YAML_PATHS, ...paths };
}

/**
 * Sections and fields only librechat.yaml sets, as the panel knew them before
 * servers reported `rules.deploymentOnlyPaths`: sections read at startup or
 * from the raw librechat.yaml, and settings read once at startup.
 */
export const BUNDLED_DEPLOYMENT_ONLY_PATHS: Readonly<Record<string, t.DeploymentOnlyReason>> = {
  cloudfront: 'operator',
  rateLimits: 'operator',
  /** Read as `req.config.config.permissions`: the raw librechat.yaml, never the merged overrides. */
  permissions: 'operator',
  /** The docs gate reads `getAppConfig({ baseOnly: true }).config.openapi`. */
  openapi: 'operator',
  /** Only librechat.yaml's own loader knows it; AppService never carries it into the app config. */
  cache: 'unused',
  /** Social sign-in and OpenID discovery are set up once at startup from librechat.yaml. */
  'registration.oauthStateTtlMs': 'startup',
  'registration.openidDiscovery': 'startup',
  /**
   * Read once at startup, from librechat.yaml alone (`getAppConfig({ baseOnly:
   * true })` while the server boots): the agents' background, event and
   * approval hook runtime, and MCP catalog recovery's state limits and fence
   * retry worker. `catalogRecovery.authorizationFenceTimeoutMs` is not one:
   * requests read it from the merged config too.
   */
  'endpoints.agents.eventDriven': 'startup',
  'endpoints.agents.subagentActivity': 'startup',
  'endpoints.agents.toolApproval.hooks': 'startup',
  'endpoints.agents.backgroundTasks.shutdownInterruptGraceMs': 'startup',
  'endpoints.agents.backgroundTasks.completionResultBatchSize': 'startup',
  'endpoints.agents.backgroundTasks.completionReceiptBatching': 'startup',
  'mcpSettings.catalogRecovery.maxStateEntries': 'startup',
  'mcpSettings.catalogRecovery.maxDetachedDiscoveries': 'startup',
  'mcpSettings.catalogRecovery.authorizationFenceRetryIntervalMs': 'startup',
  'mcpSettings.catalogRecovery.authorizationFenceRetryBatchSize': 'startup',
};

/**
 * Top-level sections the panel must never write, with the reason shown in the
 * UI, on a server that does not report its rules. Base-only sections are
 * stripped by the admin API for every principal; the YAML-only ones are read
 * from the raw librechat.yaml at startup or before login, so overrides have
 * no effect. A server that reports its rules decides them (`getWriteRules`).
 */
export const READ_ONLY_CONFIG_SECTIONS: ReadonlyMap<string, t.ReadOnlyReason> = new Map<
  string,
  t.ReadOnlyReason
>([
  ...BASE_ONLY_CONFIG_SECTIONS.map((section): [string, t.ReadOnlyReason] => [section, 'baseOnly']),
  ...Object.keys(withRawYamlPaths(BUNDLED_DEPLOYMENT_ONLY_PATHS))
    .filter((path) => !path.includes('.'))
    .map((section): [string, t.ReadOnlyReason] => [section, 'yamlOnly']),
  ...PRE_AUTH_YAML_SECTIONS.map((section): [string, t.ReadOnlyReason] => [section, 'yamlOnly']),
]);

/**
 * Tenant-wide sections with their own admin API (e.g. the Langfuse connection).
 * The generic config API strips them, so saves and imports never send them.
 */
export const DEDICATED_CONFIG_SECTIONS: ReadonlySet<string> = new Set(
  BASE_PRINCIPAL_CONFIG_SECTIONS,
);

/** AppService output names for config sections, mapped to their canonical config keys. */
export const APP_SERVICE_KEY_ALIASES: Readonly<Record<string, string>> = {
  interfaceConfig: 'interface',
  turnstileConfig: 'turnstile',
  mcpConfig: 'mcpServers',
};

/** Social sign-in buttons: read before sign-in, from librechat.yaml until `preAuthBaseOverrides`. */
export const SOCIAL_LOGINS_PATH = 'registration.socialLogins';

/**
 * Whether the panel edits Azure groups: LibreChat serves a profile's groups
 * (`endpointRederive`), merged by `group` over the groups beneath
 * (`azureGroupMergeKey`), with their keys stored encrypted (`azureGroupSecrets`).
 */
export function editsAzureGroups(features: t.WriteRuleFeatures): boolean {
  return features.endpointRederive && features.azureGroupMergeKey && features.azureGroupSecrets;
}

/**
 * Whether LibreChat applies the hides of Azure groups by name that another
 * client stores (`endpoints.azureOpenAI.groups["east"]`, or a path inside
 * one): it applies keyed tombstones (`keyedTombstones`) to the groups it
 * derives from the overrides (`endpointRederive`). The panel then reads them
 * by group; the groups editor writes none.
 */
export function appliesGroupHides(
  features: Pick<t.ConfigFeatures, 'keyedTombstones' | 'endpointRederive'>,
): boolean {
  return features.keyedTombstones && features.endpointRederive;
}

/** Whether LibreChat derives Vertex AI from a profile's `endpoints.anthropic.vertex` (`endpointRederive`). */
export function editsVertex(features: t.WriteRuleFeatures): boolean {
  return features.endpointRederive;
}

/**
 * Fields LibreChat processes only from librechat.yaml (overrides are merged
 * after `azureConfigSetup`/`vertexConfigSetup` run, so edits would be silent
 * no-ops), each with whether the server derives it again from overrides.
 * Rendered read-only until it does.
 */
const YAML_PROCESSED_FIELDS: ReadonlyArray<
  readonly [string, (features: t.WriteRuleFeatures) => boolean]
> = [
  ['endpoints.azureOpenAI.groups', editsAzureGroups],
  ['endpoints.anthropic.vertex', editsVertex],
];

/**
 * The fields of `rules`' deployment-only paths inside writable sections, and
 * which of them are read only at startup.
 */
function deploymentOnlyFields(paths: Readonly<Record<string, t.DeploymentOnlyReason>>): {
  fields: string[];
  startup: string[];
} {
  const nested = Object.entries(paths).filter(([path]) => path.includes('.'));
  return {
    fields: nested.map(([path]) => path),
    startup: nested.filter(([, reason]) => reason === 'startup').map(([path]) => path),
  };
}

/**
 * Where the panel may write on a server with these rules and features:
 * base-only sections, deployment-only sections and fields, base-only fields,
 * fields the server derives from others, the fields LibreChat only processes
 * from librechat.yaml (until it derives them again), and, until Base
 * overrides apply before sign-in (`preAuthBaseOverrides`), the social
 * sign-in buttons.
 */
export function resolveWriteRules(
  rules: Pick<
    t.ConfigRules,
    'baseOnlySections' | 'baseOnlyPaths' | 'deploymentOnlyPaths' | 'derivedPaths'
  >,
  features: t.WriteRuleFeatures,
): t.ConfigWriteRules {
  const deploymentOnlyPaths = withRawYamlPaths(rules.deploymentOnlyPaths);
  const readOnlySections = new Map<string, t.ReadOnlyReason>();
  for (const section of rules.baseOnlySections) readOnlySections.set(section, 'baseOnly');
  for (const path of Object.keys(deploymentOnlyPaths)) {
    if (!path.includes('.')) readOnlySections.set(path, 'yamlOnly');
  }
  for (const section of PRE_AUTH_YAML_SECTIONS) readOnlySections.set(section, 'yamlOnly');
  const { fields, startup } = deploymentOnlyFields(deploymentOnlyPaths);
  return {
    readOnlySections,
    yamlManagedFields: new Set([
      ...YAML_PROCESSED_FIELDS.flatMap(([path, rederived]) => (rederived(features) ? [] : [path])),
      ...(features.preAuthBaseOverrides ? [] : [SOCIAL_LOGINS_PATH]),
      ...fields,
      ...rules.baseOnlyPaths,
      ...rules.derivedPaths,
    ]),
    startupOnlyFields: new Set(startup),
    baseOnlyFields: new Set(rules.baseOnlyPaths),
  };
}

/** The write rules of a server that reports none: every section and field as before servers did. */
export const BUNDLED_WRITE_RULES: t.ConfigWriteRules = resolveWriteRules(
  {
    baseOnlySections: [...READ_ONLY_CONFIG_SECTIONS]
      .filter(([, reason]) => reason === 'baseOnly')
      .map(([section]) => section),
    baseOnlyPaths: [],
    deploymentOnlyPaths: BUNDLED_DEPLOYMENT_ONLY_PATHS,
    derivedPaths: [],
  },
  {
    preAuthBaseOverrides: false,
    endpointRederive: false,
    azureGroupMergeKey: false,
    azureGroupSecrets: false,
  },
);

/** Fields LibreChat reads once at startup, from librechat.yaml alone, as the panel knew them. */
export const STARTUP_ONLY_FIELDS: ReadonlySet<string> = BUNDLED_WRITE_RULES.startupOnlyFields;

/** Fields only librechat.yaml sets, as the panel knew them before servers reported their rules. */
export const YAML_MANAGED_FIELDS: ReadonlySet<string> = BUNDLED_WRITE_RULES.yamlManagedFields;

/**
 * The preview a server with `yamlSecretPreview` reads back for a secret it
 * holds without one (a librechat.yaml literal, or a key stored before
 * previews): the secret is set, and nothing of it is shown.
 */
export const SECRET_PREVIEW_MASK = '********';

/** Config keys for values that must never be displayed in plain text. */
export const SECRET_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'apiKey',
  'serviceKey',
  'secretKey',
  'clientSecret',
  'client_secret',
]);

/** Locale keys explaining why a pending change is not sent or was not stored. */
export const SKIP_REASON_KEYS: Readonly<Record<t.SkipReason, string>> = {
  baseOnly: 'com_config_skip_base_only',
  yamlOnly: 'com_config_skip_yaml_only',
  permission: 'com_config_skip_permission',
  dedicated: 'com_config_skip_dedicated',
  yamlValue: 'com_config_skip_yaml_value',
  empty: 'com_config_skip_empty',
  notStored: 'com_config_skip_not_stored',
  notApplied: 'com_config_skip_not_applied',
  yamlMerged: 'com_config_skip_yaml_merged',
  baseScope: 'com_scope_skip_base_scope',
  inheritedValue: 'com_scope_skip_inherited_value',
  inheritedMerged: 'com_scope_skip_inherited_merged',
  processServer: 'com_config_skip_process_server',
  secretRebinding: 'com_config_skip_secret_rebinding',
  hiddenBySave: 'com_config_skip_hidden_by_save',
  hiddenEntry: 'com_config_skip_hidden_entry',
};

/**
 * The panel's skip reason for each reason the admin API reports a write did
 * not store (`skipped`, with `writeReport`) or stores without effect
 * (`ignored`). A reason a newer server adds reads as not stored or not applied.
 */
export const REPORTED_SKIP_REASONS: Readonly<Record<string, t.SkipReason>> = {
  base_only_section: 'baseOnly',
  base_only_path: 'baseOnly',
  deployment_only_path: 'yamlOnly',
  dedicated_section: 'dedicated',
  interface_permission: 'permission',
  process_mcp_server: 'processServer',
  secret_rebinding: 'secretRebinding',
};

/** Why a lower-layer key comes back after a write: LibreChat merges it in, so it is reported but not lost. */
export const MERGED_BACK_REASONS: ReadonlySet<t.SkipReason> = new Set([
  'yamlMerged',
  'inheritedMerged',
]);

/** The top-level config section of a dot-path (`balance.startBalance` → `balance`). */
export function getConfigSection(path: string): string {
  const dot = path.indexOf('.');
  return dot === -1 ? path : path.slice(0, dot);
}

/** The top-level section a dot-path belongs to, when that section is read-only. */
export function getReadOnlyReason(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.ReadOnlyReason | undefined {
  return rules.readOnlySections.get(getConfigSection(path));
}

function isAtOrUnderAny(path: string, fields: ReadonlySet<string>): boolean {
  for (const field of fields) {
    if (path === field || path.startsWith(`${field}.`)) return true;
  }
  return false;
}

/** Whether `path` is, or is inside, a field managed only in librechat.yaml. */
export function isYamlManagedPath(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): boolean {
  return isAtOrUnderAny(path, rules.yamlManagedFields);
}

/** Whether the server keeps librechat.yaml's value at `path` whatever an override stores (`baseOnlyPaths`). */
export function isBaseOnlyPath(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): boolean {
  return isAtOrUnderAny(path, rules.baseOnlyFields);
}

/** Whether `path` is, or is inside, a setting LibreChat reads only at startup. */
export function isStartupOnlyPath(
  path: string,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): boolean {
  return isAtOrUnderAny(path, rules.startupOnlyFields);
}
