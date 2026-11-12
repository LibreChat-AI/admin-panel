import type { ReactNode } from 'react';
import type { EndpointModelsMap, EndpointStatusMap, ToolOption } from './providers';
import type { ConfigScope, IconName } from './scope';
import type { ConfigValue } from './config';

/** The principal a server read is resolved for: Base (`role` `__base__`), or a profile's principal. */
export type ConfigPrincipal = Pick<ConfigScope, 'principalType' | 'principalId'>;

/**
 * Why an endpoint of a scope's catalog is not served (`AdminCatalogEndpointReason`
 * of newer `@librechat/data-schemas`): `ENDPOINTS` leaves it out, a built-in
 * endpoint has no credentials in the environment, or a custom endpoint lacks
 * its API key, base URL or models. `unknown`: a reason a newer server adds.
 */
export type CatalogEndpointReason =
  | 'not_listed'
  | 'missing_credentials'
  | 'missing_api_key'
  | 'missing_base_url'
  | 'missing_models'
  | 'unknown';

/** One endpoint of a scope's catalog: whether its users are served it, why not, and the env names it reads. */
export interface CatalogEndpoint {
  enabled: boolean;
  custom: boolean;
  reason?: CatalogEndpointReason;
  /** Env names its credentials or base URL come from; whether each is set is `GET /env-status`'s to say. */
  envVars: string[];
}

/** One endpoint's models for a scope, never fetched with a user's stored key. */
export interface CatalogModels {
  /** What the scope's users are offered. */
  served: string[];
  /** The list the scope's config sets; absent when it sets none. */
  configured?: string[];
  /** What the endpoint offers without a configured list; absent when nothing is fetched. */
  defaults?: string[];
}

/**
 * What one scope serves, from `GET /api/admin/config/catalog` (`catalogApi`),
 * resolved for the scope rather than for the signed-in admin. A part is absent
 * when the admin cannot read its section.
 */
export interface ConfigCatalog {
  /** The served endpoints, in the shape `GET /api/endpoints` gave the panel before. */
  status?: EndpointStatusMap;
  /** Every endpoint the scope's config defines, served or not. */
  endpoints?: Readonly<Record<string, CatalogEndpoint>>;
  /** Served models per endpoint, in the shape `GET /api/models` gave the panel before. */
  models?: EndpointModelsMap;
  modelLists?: Readonly<Record<string, CatalogModels>>;
  tools?: ToolOption[];
}

/**
 * Where an env name `GET /env-status` reports is used: librechat.yaml, a
 * default reference loading fills in, a built-in endpoint, the override
 * allowlist, or a stored profile (`AdminConfigEnvSource`).
 */
export type EnvSource = 'yaml' | 'default' | 'endpoint' | 'allowlist' | 'override';

/** Whether an env name holds a value on the server; the value itself is never returned. */
export interface EnvVarStatus {
  set: boolean;
  /** The value is `user_provided`: each user enters their own. */
  userProvided: boolean;
  sources: EnvSource[];
}

/** `GET /api/admin/config/env-status` (`envStatus`), by env name. */
export type EnvStatusMap = Readonly<Record<string, EnvVarStatus>>;

/**
 * How a `${NAME}` reference reads on the server: set, empty, `user_provided`,
 * a name the server's override allowlist leaves out (`envAllowlist`: only
 * stored profiles use it, so it resolves to nothing), or a name the server
 * does not report (not used where it looks, or in a section the admin cannot read).
 */
export type EnvReferenceState = 'set' | 'unset' | 'userProvided' | 'notAllowed' | 'unreported';

/** Each env name a value references, with the dot-paths of the strings that reference it. */
export type EnvReferenceSites = Map<string, string[]>;

export interface EnvReference {
  name: string;
  state: EnvReferenceState;
}

export interface EnvStatusNoteProps {
  /** The value whose `${NAME}` references are reported; strings inside objects and lists count. */
  value?: ConfigValue;
  /** Where `value` is (`endpoints.custom.0.headers`), and where `names` are read. */
  path?: string;
  /** Env names to report besides those `value` references (a provider's credentials). */
  names?: readonly string[];
  /** The names are alternatives or optional settings, so one that is not set is not a problem. */
  optional?: boolean;
  id?: string;
}

/** How one env reference is shown: its text's locale key, icon and text color class. */
export interface EnvReferenceDisplay {
  key: string;
  icon: IconName;
  tone: string;
}

export interface EnvReferenceListProps extends Pick<EnvStatusNoteProps, 'optional' | 'id'> {
  references: EnvReference[];
}

export interface EnvStatusWrapProps {
  value: ConfigValue;
  path: string;
  children: ReactNode;
}

export interface EnvReferenceTextProps {
  name: string;
  /** The locale key of the sentence, with the name as `{{env}}`. */
  textKey: string;
}
