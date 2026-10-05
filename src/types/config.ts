/** JSON-compatible value for config entries — replaces bare `unknown` in config contexts. */
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ConfigValue[]
  | { [key: string]: ConfigValue };

/** Flattened config: dot-path keys to leaf values. Produced by `flattenObject()`. */
export type FlatConfigMap = Record<string, ConfigValue>;

/** An object-shaped config value (a section, entry or record), keyed by setting name. */
export type ConfigRecord = { [key: string]: ConfigValue };

export type ControlType =
  | 'toggle'
  | 'select'
  | 'text'
  | 'number'
  | 'array'
  | 'array-object'
  | 'object'
  | 'record'
  | 'record-object'
  | 'switch-object'
  | 'text-record'
  | 'list-record'
  | 'code';

export interface SchemaField {
  path: string;
  key: string;
  type: string;
  isOptional: boolean;
  isNullable: boolean;
  isArray: boolean;
  isObject: boolean;
  description?: string;
  children?: SchemaField[];
  depth: number;
  recordValueType?: 'primitive' | 'complex';
  recordValueAllowsPrimitive?: boolean;
  recordValueKVTypes?: KVValueType[];
}

export interface ZodDef {
  typeName?: string;
  description?: string;
  options?: ZodSchemaLike[];
  innerType?: ZodSchemaLike;
  schema?: ZodSchemaLike;
  type?: ZodSchemaLike;
  left?: ZodSchemaLike;
  right?: ZodSchemaLike;
  getter?: () => ZodSchemaLike;
  out?: ZodSchemaLike;
  values?: string[] | Record<string, string | number>;
  value?: string | number | boolean;
}

export interface ZodSchemaLike {
  _def?: ZodDef;
  shape?: Record<string, ZodSchemaLike>;
}

export interface FieldValidationError {
  fieldPath: string;
  error: string;
}

export interface SelectOption {
  label: string;
  value: string;
}

export type KVValueType = 'string' | 'number' | 'boolean' | 'json';

export interface KeyValuePair {
  [k: string]: string | KVValueType | undefined;
  key: string;
  value: string;
  valueType?: KVValueType;
}

/** Why a config section or field cannot be edited in the panel. */
export type ReadOnlyReason = 'baseOnly' | 'yamlOnly';

/**
 * Why a pending change is not stored:
 * - `ReadOnlyReason`: the section (or YAML-managed field) is read only from librechat.yaml
 * - `permission`: a role permission, managed on the roles page
 * - `dedicated`: a section with its own settings API (e.g. the Langfuse connection)
 * - `yamlValue`: clearing a value that only librechat.yaml sets (there is no override to remove)
 * - `empty`: an imported value that is blank or empty
 * - `notStored`: sent, but LibreChat's admin API did not store it
 */
export type SkipReason =
  | ReadOnlyReason
  | 'permission'
  | 'dedicated'
  | 'yamlValue'
  | 'empty'
  | 'notStored';

/** A record key the admin API cannot store, and the dot-path of the object holding it. */
export interface UnsafeConfigKey {
  path: string;
  key: string;
}
