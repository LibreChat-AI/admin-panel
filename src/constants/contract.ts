import {
  configSchema,
  PERMISSION_SUB_KEYS,
  INTERFACE_PERMISSION_FIELDS,
  BASE_PRINCIPAL_CONFIG_SECTIONS,
  RUNTIME_CONFIG_INTERFACE_FIELDS,
} from 'librechat-data-provider';
import type * as t from '@/types';
import {
  resolveWriteRules,
  BUNDLED_WRITE_RULES,
  APP_SERVICE_KEY_ALIASES,
  READ_ONLY_CONFIG_SECTIONS,
  BUNDLED_DEPLOYMENT_ONLY_PATHS,
} from './config';
import { KEYED_COLLECTIONS } from './collections';

/** Every flag of the admin config contract the panel reads. */
export const CONFIG_FEATURE_FLAGS: readonly t.ConfigFeatureFlag[] = [
  'dottedKeys',
  'sectionAllowlist',
  'readFilteredWriteResponses',
  'preAuthBaseOverrides',
  'webSearchStoredKeys',
  'expectedRevision',
  'prunesEmptyParents',
  'awaitedInvalidation',
  'changesBatch',
  'yamlMcpHide',
  'deterministicPrecedence',
  'priorityRoute',
  'principalCheck',
  'roleRenameMovesProfile',
  'recordSecrets',
  'azureGroupSecrets',
  'yamlSecretPreview',
  'envAllowlist',
  'secretRebinding',
  'keyedTombstones',
  'renameHints',
  'writeReport',
  'issueParams',
  'resolvedApi',
  'catalogApi',
  'envStatus',
  'azureGroupMergeKey',
  'customParamsExpansion',
  'specInterfaceRederive',
  'endpointRederive',
];

/** A server without the meta route (or one that leaves a flag out) has none of these behaviours. */
export const BUNDLED_CONFIG_FEATURES: t.ConfigFeatures = Object.fromEntries(
  CONFIG_FEATURE_FLAGS.map((flag) => [flag, false]),
) as Record<t.ConfigFeatureFlag, boolean>;

/** The limits LibreChat enforced before it reported them. */
export const BUNDLED_CONFIG_LIMITS: t.ConfigLimits = {
  maxPatchEntries: 100,
  maxChangeOps: 0,
  overrideCacheTtlMs: 60_000,
  catalogModelsTtlMs: 120_000,
  maxEntryKeyLength: 256,
};

/** `expectedRevision` that makes a write apply only when the principal has no document. */
export const ABSENT_REVISION = 'absent';

/** The admin API's code for a write whose `expectedRevision` no longer matches (409). */
export const VERSION_CONFLICT_CODE = 'CONFIG_VERSION_CONFLICT';

/** Pre-flight: an MCP server sends an API key the admin provides for everyone, and has none. */
export const MCP_API_KEY_MISSING_CODE = 'MCP_API_KEY_MISSING';

/** Pre-flight: a renamed MCP server uses a secret its saved name stores, which the save can't move. */
export const MCP_SECRET_NOT_CARRIED_CODE = 'MCP_SECRET_NOT_CARRIED';

/** The admin API refused a `renames` hint of a write; its `reason` says why. */
export const RENAME_INVALID_CODE = 'CONFIG_RENAME_INVALID';

/** The `reason`s of a refused `renames` hint the panel words (`com_config_issue_rename_<reason>`). */
export const RENAME_REASON_CODES: ReadonlySet<string> = new Set([
  'inherited_entry',
  'source_not_found',
  'target_exists',
  'target_not_written',
  'source_still_written',
  'duplicate_source',
  'duplicate_target',
  'invalid_name',
]);

/** A save refused before anything is written: one section holds more changes than one batch takes (`maxChangeOps`). */
export const TOO_MANY_CHANGES_CODE = 'TOO_MANY_CHANGES';

/** A stdio MCP server's process fields: only librechat.yaml sets them (D10). */
export const PROCESS_MCP_FIELDS: readonly string[] = ['command', 'args', 'env', 'cwd', 'stderr'];

/** Secrets LibreChat encrypted before it reported its registry (`${VAR}` references stay readable). */
const BUNDLED_SECRET_PATHS: ReadonlyArray<[path: string, allowEnvPlaceholder: boolean]> = [
  ['langfuse.secretKey', false],
  ['ocr.apiKey', true],
  ['speech.tts.openai.apiKey', true],
  ['speech.tts.azureOpenAI.apiKey', true],
  ['speech.tts.elevenlabs.apiKey', true],
  ['speech.tts.localai.apiKey', true],
  ['speech.stt.openai.apiKey', true],
  ['speech.stt.azureOpenAI.apiKey', true],
  ['webSearch.serperApiKey', true],
  ['webSearch.searxngApiKey', true],
  ['webSearch.firecrawlApiKey', true],
  ['webSearch.tavilyApiKey', true],
  ['webSearch.jinaApiKey', true],
  ['webSearch.cohereApiKey', true],
  ['endpoints.assistants.apiKey', true],
  ['endpoints.azureAssistants.apiKey', true],
];

/** The keyed lists LibreChat merged by key before it reported its rules (none behind a flag). */
const keyedCollections = [...KEYED_COLLECTIONS.values()].filter(
  (collection) => collection.gate === undefined,
);

/**
 * The write rules of a LibreChat server that does not report its own, as the
 * panel knows them: the bundled config schema and data-provider constants,
 * and the panel's mirrors of LibreChat's merge rules.
 */
export const BUNDLED_CONFIG_RULES: t.ConfigRules = {
  acceptedSections: Object.keys(configSchema.shape),
  baseOnlySections: [...READ_ONLY_CONFIG_SECTIONS]
    .filter(([, reason]) => reason === 'baseOnly')
    .map(([section]) => section),
  basePrincipalSections: [...BASE_PRINCIPAL_CONFIG_SECTIONS],
  baseOnlyPaths: [],
  deploymentOnlyPaths: BUNDLED_DEPLOYMENT_ONLY_PATHS,
  arrayMergeKeys: Object.fromEntries(
    keyedCollections
      .filter((collection) => collection.merge === 'byKey')
      .map((collection) => [collection.path, collection.key]),
  ),
  atomicMergePaths: ['interface.theme'],
  overrideKeyMap: Object.fromEntries(
    Object.entries(APP_SERVICE_KEY_ALIASES).map(([alias, section]) => [section, alias]),
  ),
  derivedPaths: [],
  secretFields: BUNDLED_SECRET_PATHS.map(([path, allowEnvPlaceholder]) => ({
    path,
    previewPath: `${path}Preview`,
    allowEnvPlaceholder,
  })),
  arraySecretFields: keyedCollections.flatMap((collection) =>
    collection.secret
      ? [
          {
            arrayPath: collection.path,
            secretKey: collection.secret.key,
            previewKey: collection.secret.preview,
            identityKey: collection.key,
          },
        ]
      : [],
  ),
  recordSecretFields: [],
  refusedMaps: ['langfuse.headers'],
  processMcpFields: [...PROCESS_MCP_FIELDS],
  interface: {
    permissionFields: [...INTERFACE_PERMISSION_FIELDS],
    runtimeFields: [...RUNTIME_CONFIG_INTERFACE_FIELDS],
    permissionSubKeys: [...PERMISSION_SUB_KEYS],
  },
  titleResolution: 'block',
};

/** The contract of a LibreChat server without `GET /api/admin/config/meta`: every behaviour as before it. */
export const BUNDLED_CONFIG_CONTRACT: t.ConfigContract = {
  source: 'bundled',
  features: BUNDLED_CONFIG_FEATURES,
  limits: BUNDLED_CONFIG_LIMITS,
  rules: BUNDLED_CONFIG_RULES,
};

const WRITE_RULES_CACHE = new WeakMap<t.ConfigContract, t.ConfigWriteRules>();

/**
 * Where the panel may write on the contract's server (`resolveWriteRules`),
 * built once per contract. The bundled contract keeps the panel's own lists.
 */
export function getWriteRules(contract: t.ConfigContract): t.ConfigWriteRules {
  if (contract === BUNDLED_CONFIG_CONTRACT) return BUNDLED_WRITE_RULES;
  const cached = WRITE_RULES_CACHE.get(contract);
  if (cached) return cached;
  const rules = resolveWriteRules(contract.rules, contract.features);
  WRITE_RULES_CACHE.set(contract, rules);
  return rules;
}
