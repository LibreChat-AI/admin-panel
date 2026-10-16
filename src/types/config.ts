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

/** Control vocabulary for `FieldMeta.control` (WS2 maps kinds; WS3 adds one per control it ships). */
export type ControlKind =
  | ControlType
  | 'textarea'
  | 'secret'
  | 'tristate'
  | 'bool-or-list'
  | 'variant'
  | 'scalar-union'
  | 'literal'
  | 'multi-enum'
  | 'ref-select'
  | 'model-list';

/** Display unit for numeric fields (WS2). */
export type FieldUnit = 'MB' | 'ms' | 's' | 'px' | 'hours' | 'credits';

/** Control width token (WS6 applies it through `FieldMeta.width`). */
export type ControlWidth = 'S' | 'M' | 'L';

/** A named group of sibling fields, optionally collapsed behind a toggle field (WS2). */
export interface FieldMetaGroup {
  key: string;
  fields: string[];
  toggle?: string;
}

/** Where a reference select gets its options (WS9 implements `useOptionSources`; WS3 consumes it). */
export type OptionSource = 'endpoints' | `models:${string}` | 'mcpServers' | 'specGroups' | 'tools';

/** Options of an `OptionSource` (WS9). */
export interface OptionSourceResult {
  options: SelectOption[];
  isLoading: boolean;
}

/** Per-field metadata the schema cannot express (WS2 registry; area workstreams contribute entries). */
export interface FieldMeta {
  labelKey?: string;
  descriptionKey?: string;
  docsUrl?: string;
  unit?: FieldUnit;
  /** Effective value LibreChat applies when the field is unset and the schema has no default. */
  runtimeDefault?: ConfigValue;
  /** Enum value → display label. */
  enumLabels?: Record<string, string>;
  /** Child keys in display order. */
  order?: string[];
  groups?: FieldMetaGroup[];
  control?: ControlKind;
  optionSource?: OptionSource;
  multiline?: boolean;
  width?: ControlWidth;
  secret?: boolean;
  hidden?: boolean;
  baseOnly?: boolean;
  yamlOnly?: boolean;
  permission?: boolean;
  confirmChange?: boolean;
}

/**
 * Field metadata keyed by index-free path. `[]` stands for any array element
 * and `{}` for any record key; both `endpoints.custom[].name` and
 * `endpoints.custom.[].name` are accepted (WS2).
 */
export type FieldMetaRegistry = Record<string, FieldMeta>;

/** A node of the compiled metadata registry: one path segment (WS2). */
export interface FieldMetaNode {
  meta?: FieldMeta;
  children: Map<string, FieldMetaNode>;
}
