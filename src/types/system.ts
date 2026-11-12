import type { ConfigValue, ConfigRecord, FlatConfigMap, SchemaField } from './config';
import type { FieldState } from './values';

/** A field of a rate limit (`rateLimits.<limiter>.<field>`). */
export type RateLimitField = 'ipMax' | 'ipWindowInMinutes' | 'userMax' | 'userWindowInMinutes';

/** One LibreChat rate limiter, its `.env` prefix and the values it uses when nothing is set (FX-12). */
export interface RateLimiterInfo {
  key: string;
  envPrefix: string;
  defaults: Partial<Record<RateLimitField, number>>;
}

/** A list of email domains edited as chips (FX-9). */
export interface EmailDomainListFieldProps {
  id: string;
  /** The domains in effect (own, inherited or from librechat.yaml). */
  domains: string[];
  onChange: (domains: string[]) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** A whole-number input that shows thousands separators (credits). */
export interface CreditsInputProps {
  id: string;
  value: number | undefined;
  /** `undefined` removes the own value; returning false says there was none to remove. */
  onChange: (value: number | undefined) => boolean | void;
  /** The value in effect without an own value, shown as the placeholder. */
  placeholder?: number;
  disabled?: boolean;
  min?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** A field an area renderer edits with its own control (`useOwnedField`). */
export interface OwnedField {
  path: string;
  state: FieldState;
  /** The edit target's own value (pending or saved). */
  own: ConfigValue;
  /** The value in effect without it (librechat.yaml, Base or the default). */
  fallback: ConfigValue;
  /** Stages a value, or with `undefined` removes the own one; false when there was none. */
  set: (value: ConfigValue) => boolean;
}

/** A schema field found by key among a section's fields. */
export type FieldLookup = (key: string) => SchemaField | undefined;

/** Read-only rows of librechat.yaml-only settings, valued from librechat.yaml (FX-10, FX-12). */
export interface YamlRowsProps {
  fields: SchemaField[];
  parentPath: string;
  schemaDefaults?: FlatConfigMap;
}

export interface YamlRowProps {
  field: SchemaField;
  path: string;
  yaml: ConfigRecord | null;
  /** Leaf paths librechat.yaml sets, for the group counts. */
  yamlPaths: ReadonlySet<string>;
  schemaDefaults?: FlatConfigMap;
}
