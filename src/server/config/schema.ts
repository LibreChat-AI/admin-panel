import { queryOptions } from '@tanstack/react-query';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { TStartupConfig } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  schemaType,
  unwrapSchema,
  innerSchemaOf,
  isUnionSchema,
  isConfigRecord,
  ZOD_WRAPPER_TYPES,
  resolveIntersection,
  filterSecretPreviewFields,
  filterInterfacePermissionChildren,
} from '@/utils';
import { apiFetch } from '../utils/api';

/**
 * Hides the Langfuse section when LibreChat reports the signed-in admin can't
 * use its connection settings (`langfuseConnectionAccess`: tracing or tenant
 * export is off, credentials come from the environment, or the admin lacks
 * the Langfuse capability). A backend without that flag is judged by
 * `langfuseFanoutEnabled`; with neither, the schema-provided section is kept.
 */
export function applyLangfuseSchemaVisibility(
  tree: t.SchemaField[],
  startup: Pick<TStartupConfig, 'langfuseFanoutEnabled' | 'langfuseConnectionAccess'> | undefined,
): t.SchemaField[] {
  const available = startup?.langfuseConnectionAccess ?? startup?.langfuseFanoutEnabled;
  if (available !== false) return tree;
  const langfuseIndex = tree.findIndex((section) => section.key === 'langfuse');
  if (langfuseIndex >= 0) tree.splice(langfuseIndex, 1);
  return tree;
}

/**
 * A Zod node with its wrappers removed, and what the wrappers said about it.
 * A `.required()` field (`nonoptional`) is required even where it wraps an
 * optional schema; a default still makes it optional to write.
 */
interface UnwrappedNode {
  schema: t.ZodSchemaLike;
  isOptional: boolean;
  isNullable: boolean;
  description?: string;
}

/** The parts of a field before unset properties and `false` flags are dropped. */
interface FieldParts {
  path: string;
  key: string;
  type: string;
  isOptional: boolean;
  isNullable?: boolean;
  isArray?: boolean;
  isObject?: boolean;
  description?: string;
  children?: t.SchemaField[];
  depth: number;
  recordValueType?: 'primitive' | 'complex';
  recordValueAllowsPrimitive?: boolean;
  recordValueKVTypes?: t.KVValueType[];
  itemType?: string;
  variants?: t.SchemaVariant[];
  discriminator?: string;
  constraints?: t.FieldConstraints;
}

const ABSENT_TYPES: ReadonlySet<string> = new Set(['undefined', 'null', 'void']);

/** Wrappers that give a field a default, which makes it optional to write. */
const DEFAULT_TYPES: ReadonlySet<string> = new Set(['default', 'prefault']);

/** Wrappers that make a field optional to write: a default, or a `.catch()` fallback for a missing value. */
const OPTIONAL_INPUT_TYPES: ReadonlySet<string> = new Set([...DEFAULT_TYPES, 'catch']);

/** `number_format` checks of whole numbers (`.int()` is `safeint`). */
const INT_FORMATS: ReadonlySet<string> = new Set(['safeint', 'int32', 'uint32']);

/** Record value types worth sending to the client: choices a value select can offer. */
const CHOICE_TYPE = /^(enum|literal)\(|^union\((enum|literal)\(/;

const ZOD_TO_KV: Record<string, t.KVValueType> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  literal: 'string',
};

function unwrapNode(value: t.ZodSchemaLike): UnwrappedNode {
  const seen = new Set<t.ZodSchemaLike>();
  let schema = value;
  let isOptional = false;
  let isNullable = false;
  let isRequired = false;
  let description: string | undefined;
  while (schema?._zod && ZOD_WRAPPER_TYPES.has(schema._zod.def.type ?? '')) {
    if (seen.has(schema)) break;
    seen.add(schema);
    const def = schema._zod.def;
    description ??= schema.description;
    if (def.type === 'nonoptional') isRequired = true;
    if (def.type === 'optional' && !isRequired) isOptional = true;
    if (OPTIONAL_INPUT_TYPES.has(def.type ?? '')) isOptional = true;
    if (def.type === 'nullable') isNullable = true;
    const next = innerSchemaOf(def);
    if (!next) break;
    schema = next;
  }
  description ??= schema?.description;
  return { schema: resolveIntersection(schema) ?? schema, isOptional, isNullable, description };
}

function isObjectNode(schema: t.ZodSchemaLike | undefined): boolean {
  return !!schema && typeof schema === 'object' && 'shape' in schema && !!schema.shape;
}

function isAbsentNode(schema: t.ZodSchemaLike): boolean {
  return ABSENT_TYPES.has(schemaType(schema) ?? '');
}

/** Union members with their wrappers removed, leaving out `undefined`/`null` members. */
function presentMembers(schema: t.ZodSchemaLike): t.ZodSchemaLike[] {
  if (!isUnionSchema(schema)) return [];
  return (schema._zod?.def.options ?? [])
    .map((option) => unwrapNode(option).schema)
    .filter((option) => !isAbsentNode(option));
}

/** The object members of a union whose members are all objects (`memory.agent`, `summarization.trigger`). */
function objectVariants(schema: t.ZodSchemaLike): t.ZodSchemaLike[] | undefined {
  const members = presentMembers(schema);
  return members.length > 0 && members.every(isObjectNode) ? members : undefined;
}

/** `boolean | object`: a feature switch whose object form gives fine-grained control. */
function isBooleanObjectUnion(schema: t.ZodSchemaLike): boolean {
  const members = presentMembers(schema);
  return members.some((member) => schemaType(member) === 'boolean') && members.some(isObjectNode);
}

/** An enum's members' type: `number` for a numeric native enum, else `string`. */
function enumKVType(schema: t.ZodSchemaLike): t.KVValueType {
  const entries = Object.values(schema._zod?.def.entries ?? {});
  return entries.some((value) => typeof value === 'number') ? 'number' : 'string';
}

function inferRecordKVTypes(schema: t.ZodSchemaLike): t.KVValueType[] | undefined {
  const type = schemaType(schema);
  if (type === 'enum') return [enumKVType(schema)];
  if (type && type in ZOD_TO_KV) return [ZOD_TO_KV[type]];
  if (!isUnionSchema(schema)) return undefined;
  const types = new Set<t.KVValueType>();
  for (const member of presentMembers(schema)) {
    const memberType = schemaType(member);
    if (memberType === 'enum') {
      types.add(enumKVType(member));
    } else if (memberType && memberType in ZOD_TO_KV) {
      types.add(ZOD_TO_KV[memberType]);
    } else if (memberType === 'record' || memberType === 'array' || isObjectNode(member)) {
      types.add('json');
    }
  }
  return types.size > 0 ? [...types] : undefined;
}

/** Input step implied by the bounds: whole numbers step by 1, ratios by 0.01. */
function stepFor(constraints: t.FieldConstraints): number | undefined {
  if (constraints.int) return 1;
  if (constraints.max === undefined) return undefined;
  if (constraints.max <= 1) return 0.01;
  if (constraints.max <= 10) return 0.1;
  return undefined;
}

function withStep(constraints: t.FieldConstraints): t.FieldConstraints | undefined {
  const step = stepFor(constraints);
  const result = step === undefined ? constraints : { ...constraints, step };
  return Object.keys(result).length > 0 ? result : undefined;
}

function numberConstraints(checks: t.ZodCheckDef[]): t.FieldConstraints {
  const constraints: t.FieldConstraints = {};
  for (const check of checks) {
    if (check.check === 'number_format' && INT_FORMATS.has(check.format ?? '')) {
      constraints.int = true;
    }
    if (check.check === 'greater_than' && typeof check.value === 'number') {
      constraints.min = check.value;
      if (check.inclusive === false) constraints.minExclusive = true;
    }
    if (check.check === 'less_than' && typeof check.value === 'number') {
      constraints.max = check.value;
      if (check.inclusive === false) constraints.maxExclusive = true;
    }
  }
  return constraints;
}

function stringConstraints(checks: t.ZodCheckDef[]): t.FieldConstraints {
  const constraints: t.FieldConstraints = {};
  for (const check of checks) {
    if (check.check === 'string_format' && check.format === 'url') constraints.url = true;
    if (check.check === 'string_format' && check.format === 'email') constraints.email = true;
    if (check.check === 'string_format' && check.format === 'regex' && check.pattern) {
      constraints.regex = check.pattern.source;
    }
    if (check.check === 'min_length' && typeof check.minimum === 'number') {
      constraints.minLength = check.minimum;
    }
    if (check.check === 'max_length' && typeof check.maximum === 'number') {
      constraints.maxLength = check.maximum;
    }
    if (check.check === 'length_equals' && typeof check.length === 'number') {
      constraints.minLength = check.length;
      constraints.maxLength = check.length;
    }
  }
  return constraints;
}

/** A scalar's checks: its `checks`, after the schema itself when it is a format (`z.url()`). */
function checkDefsOf(def: t.ZodDef): t.ZodCheckDef[] {
  const own = def.check ? [{ check: def.check, format: def.format }] : [];
  return [...own, ...(def.checks ?? []).map((check) => check._zod.def)];
}

/** Validation limits from a scalar's Zod checks (`min`, `max`, `int`, `url`, `regex`, …). */
export function extractConstraints(schema: t.ZodSchemaLike): t.FieldConstraints | undefined {
  const def = schema?._zod?.def;
  if (!def) return undefined;
  const checks = checkDefsOf(def);
  if (checks.length === 0) return undefined;
  if (def.type === 'number') return withStep(numberConstraints(checks));
  if (def.type === 'string') return withStep(stringConstraints(checks));
  return undefined;
}

function lowerBound(a: t.FieldConstraints, b: t.FieldConstraints): t.FieldConstraints {
  if (a.min === undefined || b.min === undefined) return {};
  const min = Math.min(a.min, b.min);
  const exclusive =
    (a.min !== min || a.minExclusive === true) && (b.min !== min || b.minExclusive === true);
  return exclusive ? { min, minExclusive: true } : { min };
}

function upperBound(a: t.FieldConstraints, b: t.FieldConstraints): t.FieldConstraints {
  if (a.max === undefined || b.max === undefined) return {};
  const max = Math.max(a.max, b.max);
  const exclusive =
    (a.max !== max || a.maxExclusive === true) && (b.max !== max || b.maxExclusive === true);
  return exclusive ? { max, maxExclusive: true } : { max };
}

/** Limits that hold for a key shared by several union variants: the loosest of each bound. */
function hullConstraints(
  a: t.FieldConstraints | undefined,
  b: t.FieldConstraints | undefined,
): t.FieldConstraints | undefined {
  if (!a || !b) return undefined;
  const hull: t.FieldConstraints = {
    ...lowerBound(a, b),
    ...upperBound(a, b),
    ...(a.int && b.int ? { int: true } : {}),
  };
  return withStep(hull);
}

function isLiteralLike(type: string): boolean {
  if (type.startsWith('literal(')) return true;
  return type.startsWith('union(') && type.includes('literal(');
}

function extractLiterals(type: string): string[] {
  if (type.startsWith('literal(')) return [type];
  if (!type.startsWith('union(')) return [];
  return type
    .slice(6, -1)
    .split(' | ')
    .filter((s) => s.startsWith('literal('));
}

function mergeLiteralTypes(a: string, b: string): string {
  const literals = extractLiterals(a);
  for (const literal of extractLiterals(b)) {
    if (!literals.includes(literal)) literals.push(literal);
  }
  return literals.length === 1 ? literals[0] : `union(${literals.join(' | ')})`;
}

function mergeSharedField(existing: t.SchemaField, field: t.SchemaField): t.SchemaField {
  const type =
    existing.type !== field.type && isLiteralLike(existing.type) && isLiteralLike(field.type)
      ? mergeLiteralTypes(existing.type, field.type)
      : existing.type;
  const { constraints: _dropped, ...rest } = existing;
  const constraints = hullConstraints(existing.constraints, field.constraints);
  return constraints ? { ...rest, type, constraints } : { ...rest, type };
}

/**
 * Merges the fields of several union variants into one optional list. A key
 * that is `undefined` in some variants (MCP `obo` on stdio) takes its real
 * definition from another; discriminator literals combine into one select;
 * shared keys keep only the limits every variant accepts.
 */
function mergeFieldLists(lists: t.SchemaField[][]): t.SchemaField[] {
  const byKey = new Map<string, t.SchemaField>();
  for (const fields of lists) {
    for (const field of fields) {
      const existing = byKey.get(field.key);
      if (!existing || existing.type === 'undefined') {
        byKey.set(field.key, { ...field, isOptional: true });
      } else if (field.type !== 'undefined') {
        byKey.set(field.key, mergeSharedField(existing, field));
      }
    }
  }
  return [...byKey.values()];
}

function mergeVariantFields(
  members: t.ZodSchemaLike[],
  parentPath: string[],
  depth: number,
): t.SchemaField[] {
  return mergeFieldLists(members.map((member) => extractSchemaTree(member, parentPath, depth)));
}

function discriminatorValue(member: t.ZodSchemaLike, discriminator: string): string | undefined {
  const node = member.shape?.[discriminator];
  const value = node ? unwrapSchema(node)._zod?.def.values?.[0] : undefined;
  return value === undefined ? undefined : String(value);
}

/** Names a variant by its discriminator value, else by the first key no other variant has. */
function variantKey(
  member: t.ZodSchemaLike,
  fields: t.SchemaField[],
  lists: t.SchemaField[][],
  index: number,
  discriminator: string | undefined,
): string {
  const tagged = discriminator ? discriminatorValue(member, discriminator) : undefined;
  if (tagged !== undefined) return tagged;
  const unique = fields.find((field) =>
    lists.every((list, i) => i === index || !list.some((f) => f.key === field.key)),
  );
  return unique?.key ?? String(index);
}

function finalizeField(parts: FieldParts): t.SchemaField {
  const field: t.SchemaField = {
    path: parts.path,
    key: parts.key,
    type: parts.type,
    isOptional: parts.isOptional,
    depth: parts.depth,
  };
  if (parts.isNullable) field.isNullable = true;
  if (parts.isArray) field.isArray = true;
  if (parts.isObject) field.isObject = true;
  if (parts.description) field.description = parts.description;
  if (parts.children) field.children = parts.children;
  if (parts.recordValueType) field.recordValueType = parts.recordValueType;
  if (parts.recordValueAllowsPrimitive) field.recordValueAllowsPrimitive = true;
  if (parts.recordValueKVTypes) field.recordValueKVTypes = parts.recordValueKVTypes;
  if (parts.itemType) field.itemType = parts.itemType;
  if (parts.variants) field.variants = parts.variants;
  if (parts.discriminator) field.discriminator = parts.discriminator;
  if (parts.constraints) field.constraints = parts.constraints;
  return field;
}

function variantField(
  base: FieldParts,
  schema: t.ZodSchemaLike,
  members: t.ZodSchemaLike[],
  path: string[],
): t.SchemaField {
  const lists = members.map((member) => extractSchemaTree(member, path, base.depth + 1));
  const discriminator = schema._zod?.def.discriminator;
  const variants = lists.map((fields, index) => ({
    key: variantKey(members[index], fields, lists, index, discriminator),
    fields,
  }));
  return finalizeField({
    ...base,
    type: 'object',
    isObject: true,
    children: mergeFieldLists(lists),
    variants,
    discriminator,
  });
}

function arrayField(base: FieldParts, schema: t.ZodSchemaLike, path: string[]): t.SchemaField {
  const elementSchema = schema._zod?.def.element;
  const element = elementSchema ? unwrapNode(elementSchema).schema : undefined;
  const elementPath = [...path, '[]'];
  const depth = base.depth + 1;
  const type = getZodTypeName(schema);
  if (element && isObjectNode(element)) {
    const children = extractSchemaTree(element, elementPath, depth);
    return finalizeField({ ...base, type, isArray: true, children });
  }
  const members = element ? objectVariants(element) : undefined;
  const children = members ? mergeVariantFields(members, elementPath, depth) : undefined;
  return finalizeField({ ...base, type, isArray: true, children });
}

function recordField(base: FieldParts, schema: t.ZodSchemaLike, path: string[]): t.SchemaField {
  const type = getZodTypeName(schema);
  const valueSchema = schema._zod?.def.valueType;
  if (!valueSchema) return finalizeField({ ...base, type });
  const value = unwrapNode(valueSchema).schema;
  const valuePath = [...path, '{}'];
  const depth = base.depth + 1;
  if (isObjectNode(value)) {
    const children = extractSchemaTree(value, valuePath, depth);
    return finalizeField({ ...base, type, children, recordValueType: 'complex' });
  }
  const members = objectVariants(value);
  if (members) {
    const children = mergeVariantFields(members, valuePath, depth);
    return finalizeField({ ...base, type, children, recordValueType: 'complex' });
  }
  const objects = presentMembers(value).filter(isObjectNode);
  if (objects.length > 0) {
    return finalizeField({
      ...base,
      type,
      children: mergeVariantFields(objects, valuePath, depth),
      recordValueType: 'complex',
      recordValueAllowsPrimitive: true,
    });
  }
  const valueType = getZodTypeName(value);
  return finalizeField({
    ...base,
    type,
    recordValueType: 'primitive',
    recordValueKVTypes: inferRecordKVTypes(value),
    itemType: CHOICE_TYPE.test(valueType) ? valueType : undefined,
  });
}

function buildField(
  key: string,
  value: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
): t.SchemaField {
  const path = [...parentPath, key];
  const node = unwrapNode(value);
  const { schema } = node;
  const base: FieldParts = {
    path: path.join('.'),
    key,
    type: '',
    isOptional: node.isOptional,
    isNullable: node.isNullable,
    description: node.description,
    depth,
  };
  if (isObjectNode(schema)) {
    const children = extractSchemaTree(schema, path, depth + 1);
    return finalizeField({ ...base, type: 'object', isObject: true, children });
  }
  const members = objectVariants(schema);
  if (members) return variantField(base, schema, members, path);
  if (isBooleanObjectUnion(schema)) {
    const objects = presentMembers(schema).filter(isObjectNode);
    const children = mergeVariantFields(objects, path, depth + 1);
    return finalizeField({ ...base, type: getZodTypeName(schema), children });
  }
  const type = schemaType(schema);
  if (type === 'array') return arrayField(base, schema, path);
  if (type === 'record') return recordField(base, schema, path);
  return finalizeField({
    ...base,
    type: getZodTypeName(schema),
    constraints: extractConstraints(schema),
  });
}

/**
 * Walks an object schema into `SchemaField`s (WS2). Unions of objects and
 * discriminated unions become variant fields, refined array elements are
 * unwrapped, and fields keep a compact `type` string plus `variants`,
 * `discriminator` and `constraints` where the schema has them.
 */
export function extractSchemaTree(
  schema: t.ZodSchemaLike,
  path: string[] = [],
  depth: number = 0,
): t.SchemaField[] {
  if (!isObjectNode(schema)) return [];
  const fields = Object.entries(schema.shape ?? {}).map(([key, value]) =>
    buildField(key, value, path, depth),
  );
  return filterSecretPreviewFields(fields);
}

export function flattenTree(fields: t.SchemaField[]): t.SchemaField[] {
  const result: t.SchemaField[] = [];
  for (const field of fields) {
    result.push(field);
    if (field.children) {
      result.push(...flattenTree(field.children));
    }
  }
  return result;
}

const MAX_ZOD_TYPE_DEPTH = 10;

/** `enum(a | b)`, or `enum(OFF=0 | ON=1)` for a numeric native enum (whose entries map numbers back to names). */
function enumTypeName(entries: Record<string, string | number>): string {
  const pairs = Object.entries(entries);
  const numeric = pairs.filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  if (numeric.length > 0) {
    return `enum(${numeric.map(([label, val]) => `${label}=${val}`).join(' | ')})`;
  }
  const strings = pairs.map(([, v]) => v).filter((v): v is string => typeof v === 'string');
  return strings.length > 0 ? `enum(${strings.join(' | ')})` : 'enum';
}

/** `literal("a")`; a literal of several values reads as the union of each. */
function literalTypeName(values: NonNullable<t.ZodDef['values']>): string {
  const literals = values.map((value) =>
    typeof value === 'bigint' ? `literal(${value})` : `literal(${JSON.stringify(value)})`,
  );
  return literals.length === 1 ? literals[0] : `union(${literals.join(' | ')})`;
}

export function getZodTypeName(
  schema: t.ZodSchemaLike,
  _seen?: Set<t.ZodSchemaLike>,
  _depth?: number,
): string {
  if (!schema || typeof schema !== 'object') return 'unknown';

  const depth = _depth ?? 0;
  if (depth >= MAX_ZOD_TYPE_DEPTH) return 'unknown';

  const seen = _seen ?? new Set<t.ZodSchemaLike>();
  if (seen.has(schema)) return 'unknown';
  seen.add(schema);

  const innerSchema = unwrapSchema(schema);
  const def = innerSchema && typeof innerSchema === 'object' ? innerSchema._zod?.def : undefined;
  if (!def) return 'unknown';

  if (innerSchema !== schema) {
    if (seen.has(innerSchema)) return 'unknown';
    seen.add(innerSchema);
  }

  const type = def.type;

  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'null') return 'null';
  if (type === 'undefined') return 'undefined';
  if (type === 'array') {
    if (!def.element) return 'array<unknown>';
    return `array<${getZodTypeName(def.element, seen, depth + 1)}>`;
  }
  if (type === 'object') return 'object';
  if (type === 'intersection') {
    return resolveIntersection(innerSchema) ? 'object' : 'unknown';
  }
  if (type === 'enum') return enumTypeName(def.entries ?? {});
  if (isUnionSchema(innerSchema)) {
    const options = def.options || [];
    const types = options.map((opt: t.ZodSchemaLike) => getZodTypeName(opt, seen, depth + 1));
    return `union(${types.join(' | ')})`;
  }
  if (type === 'literal') return literalTypeName(def.values ?? []);
  if (type === 'record') return 'record';
  if (type === 'any') return 'any';
  if (type === 'unknown') return 'unknown';
  return type || 'unknown';
}

/** Shared queryOptions for the schema tree used by command palette search. */
export const configSchemaTreeOptions = queryOptions({
  queryKey: ['configSchemaTree'],
  queryFn: async () => {
    const result = await getConfigSchemaFields();
    if (!result?.tree) throw new Error('The configuration schema could not be loaded');
    return result.tree;
  },
  staleTime: Infinity,
});

export const getConfigSchemaFields = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const tree = extractSchemaTree(configSchema);
    const startupConfigResponse = await apiFetch('/api/config');
    const startupConfig = startupConfigResponse.ok
      ? ((await startupConfigResponse.json()) as TStartupConfig)
      : undefined;
    applyLangfuseSchemaVisibility(tree, startupConfig);
    for (const section of tree) {
      if (section.key === 'interface' && section.children) {
        section.children = filterInterfacePermissionChildren(section.children);
      }
    }
    const flatFields = flattenTree(tree);
    tree.sort((a, b) => a.key.localeCompare(b.key));

    return { tree, totalFields: flatFields.length, topLevelSections: tree.length };
  } catch (error) {
    console.error('Failed to extract schema fields:', error);
    throw new Error(
      `Failed to extract schema fields: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
});

function getFieldDefault(schema: t.ZodSchemaLike): { hasDefault: boolean; value?: t.ConfigValue } {
  const seen = new Set<t.ZodSchemaLike>();
  let current = schema;
  while (current?._zod && !seen.has(current)) {
    seen.add(current);
    const def = current._zod.def;
    if (DEFAULT_TYPES.has(def.type ?? '')) return { hasDefault: true, value: def.defaultValue };
    if (!ZOD_WRAPPER_TYPES.has(def.type ?? '')) break;
    const next = innerSchemaOf(def);
    if (!next) break;
    current = next;
  }
  return { hasDefault: false };
}

/** Deep-merges nested field defaults under an explicit object default; the explicit values win. */
function mergeDefaults(nested: t.ConfigRecord, explicit: t.ConfigRecord): t.ConfigRecord {
  const merged: t.ConfigRecord = { ...nested };
  for (const [key, value] of Object.entries(explicit)) {
    const inner = merged[key];
    merged[key] =
      isConfigRecord(value) && isConfigRecord(inner) ? mergeDefaults(inner, value) : value;
  }
  return merged;
}

/**
 * Nested object of every `.default()` value in `schema`. A field whose object
 * default leaves out some keys still contributes those keys' own defaults
 * (`interface.retentionMode`, `endpoints.agents.maxProviderErrorChars`); the
 * object default wins where both set a key.
 */
export function extractSchemaDefaults(schema: t.ZodSchemaLike): t.ConfigRecord {
  const result: t.ConfigRecord = {};
  if (!isObjectNode(schema)) return result;

  for (const [key, fieldSchema] of Object.entries(schema.shape ?? {})) {
    const { hasDefault, value } = getFieldDefault(fieldSchema);
    const inner = unwrapNode(fieldSchema).schema;
    const nested = isObjectNode(inner) ? extractSchemaDefaults(inner) : {};
    const hasNested = Object.keys(nested).length > 0;
    if (hasDefault && hasNested && isConfigRecord(value)) {
      result[key] = mergeDefaults(nested, value);
    } else if (hasDefault) {
      result[key] = value;
    } else if (hasNested) {
      result[key] = nested;
    }
  }
  return result;
}

let cachedSchemaPathSet: Set<string> | undefined;

/**
 * Index-free schema field paths (e.g. `endpoints.custom.apiKey`), memoized
 * since the schema is static. `extractSchemaTree` bakes `[]`/`{}` markers
 * into array/record element paths for its own tree-walking bookkeeping;
 * strip them so paths match the plain dotted convention `secretPathForPreviewPath`
 * and `stripSecretPreviewValues` expect.
 */
export function getSchemaPathSet(): Set<string> {
  if (!cachedSchemaPathSet) {
    const paths = flattenTree(extractSchemaTree(configSchema)).map((f) =>
      f.path.replace(/\.(\[\]|\{\})/g, ''),
    );
    cachedSchemaPathSet = new Set(paths);
  }
  return cachedSchemaPathSet;
}
