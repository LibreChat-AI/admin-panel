import type * as t from '@/types';
import {
  ABSENT_REVISION,
  CONFIG_FEATURE_FLAGS,
  BUNDLED_CONFIG_RULES,
  BUNDLED_CONFIG_LIMITS,
  BUNDLED_CONFIG_CONTRACT,
} from '@/constants';

/**
 * The contract a server reported, every part it leaves out filled from the
 * bundled fallback: a flag it does not report is off, and a limit or rule it
 * does not report is the one LibreChat enforced before it reported them.
 * `null` (no meta route, or an unreadable reply) is the bundled contract.
 */
export function resolveConfigContract(body: t.AdminConfigMetaBody | null): t.ConfigContract {
  if (!body) return BUNDLED_CONFIG_CONTRACT;
  const reported = body.features ?? {};
  const features = Object.fromEntries(
    CONFIG_FEATURE_FLAGS.map((flag) => [flag, reported[flag] === true]),
  ) as Record<t.ConfigFeatureFlag, boolean>;
  const versions = body.versions;
  return {
    source: 'server',
    versions:
      versions?.librechat != null && versions.dataProvider != null && versions.configSchema != null
        ? {
            librechat: versions.librechat,
            dataProvider: versions.dataProvider,
            configSchema: versions.configSchema,
          }
        : undefined,
    features,
    limits: { ...BUNDLED_CONFIG_LIMITS, ...definedOnly(body.limits) },
    rules: { ...BUNDLED_CONFIG_RULES, ...definedOnly(body.rules) },
  };
}

/**
 * Whether LibreChat folds endpoint references to the names it serves
 * (`Ollama` and `ollama` are one endpoint in `addedEndpoints`, a spec's
 * endpoint and `allowedProviders`). It shipped with per-field title
 * resolution and has no flag of its own, so `titleResolution: 'field'` reports it.
 */
export function foldsEndpointReferences(contract: t.ConfigContract): boolean {
  return contract.rules.titleResolution === 'field';
}

/**
 * Whether saves go to `POST …/changes` as one batch with a revision
 * precondition: written all at once and validated as a whole, so nothing is
 * rolled back by hand and another admin's save is never overwritten unseen.
 */
export function usesChangeBatch(features: t.ConfigFeatures): boolean {
  return features.changesBatch && features.expectedRevision;
}

/**
 * What a rename or duplicate takes along of the secrets its source stores,
 * which the panel never reads (`SecretCarry`). A change batch renames a
 * stored entry whole (`rename`), MCP servers once their secrets are in the
 * registry (`recordSecrets`); a field PATCH carries an MCP server's secrets
 * to a new name, a copy included, through its `renames` hint, and a custom
 * endpoint's key once the hint takes endpoints (`renameHints`).
 */
export function getSecretCarry(features: t.ConfigFeatures): t.SecretCarry {
  const batch = usesChangeBatch(features);
  return {
    endpointRename: batch || features.renameHints,
    mcpRename: features.recordSecrets,
    mcpCopy: features.recordSecrets && !batch,
  };
}

/**
 * The `expectedRevision` that names a stored revision: `absent` for a
 * target without a document (`null`), none when the server reports no
 * revisions (`undefined`).
 */
export function toRevisionPrecondition(revision: string | null | undefined): string | undefined {
  if (revision === undefined) return undefined;
  return revision ?? ABSENT_REVISION;
}

/** A copy without the keys whose value is `undefined`, so they don't hide the fallback's. */
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
