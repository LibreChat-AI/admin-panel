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

/** A record key the admin API cannot store, and the dot-path of the object holding it. */
export interface UnsafeConfigKey {
  path: string;
  key: string;
}
