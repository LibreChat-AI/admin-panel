import { queryOptions } from '@tanstack/react-query';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import {
  unwrapSchema,
  ZOD_WRAPPER_TYPES,
  resolveIntersection,
  filterSecretPreviewFields,
  filterInterfacePermissionChildren,
} from '@/utils';
import { apiFetch } from '../utils/api';

/** Hide the Langfuse section when LibreChat reports fanout is disabled. When the
 *  fanout state is unknown (older backends), the schema-provided section is kept. */
export function applyLangfuseSchemaVisibility(
  tree: t.SchemaField[],
  fanoutEnabled: boolean | undefined,
): t.SchemaField[] {
  if (fanoutEnabled !== false) return tree;
  const langfuseIndex = tree.findIndex((section) => section.key === 'langfuse');
  if (langfuseIndex >= 0) tree.splice(langfuseIndex, 1);
  return tree;
}

/** Detects union(boolean | object{...}) — a feature toggle pattern where
 *  `false` disables and an object gives fine-grained control.
 *  Handles boolean variants wrapped in ZodOptional/ZodDefault. */
function hasBooleanObjectUnion(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  if (options.length < 2) return false;
  let hasBool = false;
  let hasObj = false;
  for (const opt of options) {
    const unwrapped = unwrapSchema(opt);
    if (!hasBool && unwrapped?._def?.typeName === 'ZodBoolean') hasBool = true;
    if (!hasObj && unwrapped && typeof unwrapped === 'object' && 'shape' in unwrapped)
      hasObj = true;
    if (hasBool && hasObj) return true;
  }
  return false;
}

function isUnionOfObjects(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  return (
    options.length > 0 &&
    options.every((opt: t.ZodSchemaLike) => opt && typeof opt === 'object' && 'shape' in opt)
  );
}

function hasUnionObjectVariant(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  return options.some((opt: t.ZodSchemaLike) => opt && typeof opt === 'object' && 'shape' in opt);
}

const ZOD_TO_KV: Record<string, t.KVValueType> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBoolean: 'boolean',
};

function inferRecordKVTypes(schema: t.ZodSchemaLike): t.KVValueType[] | undefined {
  if (!schema?._def) return undefined;
  const tn = schema._def.typeName;
  if (tn && tn in ZOD_TO_KV) return [ZOD_TO_KV[tn]];
  if (tn !== 'ZodUnion') return undefined;
  const types = new Set<t.KVValueType>();
  for (const opt of schema._def.options ?? []) {
    const optTn = opt?._def?.typeName;
    if (optTn && optTn in ZOD_TO_KV) {
      types.add(ZOD_TO_KV[optTn]);
    } else if (
      optTn === 'ZodRecord' ||
      optTn === 'ZodArray' ||
      optTn === 'ZodObject' ||
      (opt && typeof opt === 'object' && 'shape' in opt)
    ) {
      types.add('json');
    }
  }
  return types.size > 0 ? [...types] : undefined;
}

/** Merges fields from union object variants into a single list.
 *  When the same key appears in multiple variants with different literal
 *  types, the literals are combined into a union(literal(...) | literal(...))
 *  so discriminator fields like `type` render as selects. */
function mergeVariantFields(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
  objectsOnly: boolean,
): t.SchemaField[] {
  const options = schema._def?.options ?? [];
  const byKey = new Map<string, t.SchemaField>();

  for (const opt of options) {
    if (objectsOnly && !(opt && typeof opt === 'object' && 'shape' in opt)) continue;
    for (const field of extractSchemaTree(opt, parentPath, depth)) {
      const existing = byKey.get(field.key);
      if (!existing) {
        byKey.set(field.key, { ...field, isOptional: true });
      } else if (
        existing.type !== field.type &&
        isLiteralLike(existing.type) &&
        isLiteralLike(field.type)
      ) {
        existing.type = mergeLiteralTypes(existing.type, field.type);
      }
    }
  }
  return [...byKey.values()];
}

function isLiteralLike(type: string): boolean {
  if (type.startsWith('literal(')) return true;
  if (type.startsWith('union(') && type.includes('literal(')) return true;
  return false;
}

function extractLiterals(type: string): string[] {
  if (type.startsWith('literal(')) return [type];
  if (type.startsWith('union(')) {
    const inner = type.slice(6, -1);
    return inner.split(' | ').filter((s) => s.startsWith('literal('));
  }
  return [];
}

function mergeLiteralTypes(a: string, b: string): string {
  const existing = extractLiterals(a);
  for (const lit of extractLiterals(b)) {
    if (!existing.includes(lit)) existing.push(lit);
  }
  return existing.length === 1 ? existing[0] : `union(${existing.join(' | ')})`;
}

function extractUnionObjectVariants(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
): t.SchemaField[] {
  return mergeVariantFields(schema, parentPath, depth, true);
}

function mergeUnionVariantFields(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
): t.SchemaField[] {
  return mergeVariantFields(schema, parentPath, depth, false);
}

export function extractSchemaTree(
  schema: t.ZodSchemaLike,
  path: string[] = [],
  depth: number = 0,
): t.SchemaField[] {
  const fields: t.SchemaField[] = [];

  if (schema && typeof schema === 'object' && 'shape' in schema) {
    const shape = schema.shape;
    if (shape && typeof shape === 'object') {
      for (const [key, value] of Object.entries(shape)) {
        const currentPath = [...path, key];
        const fieldPath = currentPath.join('.');

        let isOptional = false;
        let isNullable = false;
        let innerSchema: t.ZodSchemaLike = value;
        let description: string | undefined;

        while (innerSchema?._def?.typeName && ZOD_WRAPPER_TYPES.has(innerSchema._def.typeName)) {
          const def = innerSchema._def;
          if (def.description && !description) {
            description = def.description;
          }
          if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
            isOptional = true;
          }
          if (def.typeName === 'ZodNullable') {
            isNullable = true;
          }
          let next: t.ZodSchemaLike | undefined;
          if (def.typeName === 'ZodLazy') {
            next = def.getter?.();
          } else if (def.typeName === 'ZodPipeline') {
            next = def.out;
          } else if (def.typeName === 'ZodEffects') {
            next = def.schema;
          } else {
            next = def.innerType;
          }
          if (!next) break;
          innerSchema = next;
        }

        if (innerSchema?._def?.description && !description) {
          description = innerSchema._def.description;
        }

        const resolved = resolveIntersection(innerSchema);
        if (resolved) innerSchema = resolved;

        if (innerSchema && typeof innerSchema === 'object' && 'shape' in innerSchema) {
          const children = extractSchemaTree(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: 'object',
            isOptional,
            isNullable,
            isArray: false,
            isObject: true,
            description,
            children,
            depth,
          });
        } else if (isUnionOfObjects(innerSchema)) {
          const children = mergeUnionVariantFields(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: 'object',
            isOptional,
            isNullable,
            isArray: false,
            isObject: true,
            description,
            children,
            depth,
          });
        } else if (hasBooleanObjectUnion(innerSchema)) {
          const children = extractUnionObjectVariants(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: getZodTypeName(innerSchema),
            isOptional,
            isNullable,
            isArray: false,
            isObject: false,
            description,
            children,
            depth,
          });
        } else {
          const typeName = getZodTypeName(innerSchema);
          const isArray = checkIsArray(innerSchema);
          const isObject = checkIsObject(innerSchema);

          let children: t.SchemaField[] | undefined;
          let recordValueType: 'primitive' | 'complex' | undefined;
          let recordValueAllowsPrimitive: boolean | undefined;
          let recordValueKVTypes: t.KVValueType[] | undefined;

          if (isArray && innerSchema?._def?.type) {
            let elementSchema: t.ZodSchemaLike = innerSchema._def.type;
            const resolvedElement = resolveIntersection(elementSchema);
            if (resolvedElement) elementSchema = resolvedElement;
            if (elementSchema && typeof elementSchema === 'object' && 'shape' in elementSchema) {
              children = extractSchemaTree(elementSchema, [...currentPath, '[]'], depth + 1);
            } else if (isUnionOfObjects(elementSchema)) {
              children = mergeUnionVariantFields(elementSchema, [...currentPath, '[]'], depth + 1);
            }
          }

          if (typeName === 'record' && innerSchema?._def) {
            const valueSchema = (innerSchema._def as t.ZodDef & { valueType?: t.ZodSchemaLike })
              .valueType;
            if (valueSchema) {
              const unwrapped = unwrapSchema(valueSchema);
              if (unwrapped && typeof unwrapped === 'object' && 'shape' in unwrapped) {
                children = extractSchemaTree(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
              } else if (isUnionOfObjects(unwrapped)) {
                children = mergeUnionVariantFields(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
              } else if (hasUnionObjectVariant(unwrapped)) {
                children = extractUnionObjectVariants(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
                recordValueAllowsPrimitive = true;
              } else {
                recordValueType = 'primitive';
                recordValueKVTypes = inferRecordKVTypes(unwrapped);
              }
            }
          }

          fields.push({
            path: fieldPath,
            key,
            type: typeName,
            isOptional,
            isNullable,
            isArray,
            isObject,
            children,
            description,
            depth,
            recordValueType,
            recordValueAllowsPrimitive,
            recordValueKVTypes,
          });
        }
      }
    }
  }

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

function checkIsArray(schema: t.ZodSchemaLike): boolean {
  if (!schema || typeof schema !== 'object') return false;
  if ('_def' in schema) {
    return schema._def?.typeName === 'ZodArray';
  }
  return false;
}

function checkIsObject(schema: t.ZodSchemaLike): boolean {
  if (!schema || typeof schema !== 'object') return false;
  return 'shape' in schema;
}

const MAX_ZOD_TYPE_DEPTH = 10;

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

  if (!innerSchema || typeof innerSchema !== 'object' || !innerSchema._def) {
    return 'unknown';
  }

  if (innerSchema !== schema) {
    if (seen.has(innerSchema)) return 'unknown';
    seen.add(innerSchema);
  }

  const typeName = innerSchema._def.typeName;

  if (typeName === 'ZodString') return 'string';
  if (typeName === 'ZodNumber') return 'number';
  if (typeName === 'ZodBoolean') return 'boolean';
  if (typeName === 'ZodNull') return 'null';
  if (typeName === 'ZodArray') {
    const elementType = innerSchema._def.type;
    if (!elementType) return 'array<unknown>';
    const elementTypeName = getZodTypeName(elementType, seen, depth + 1);
    return `array<${elementTypeName}>`;
  }
  if (typeName === 'ZodObject') return 'object';
  if (typeName === 'ZodEnum') {
    const values = innerSchema._def?.values ?? [];
    return `enum(${Array.isArray(values) ? values.join(' | ') : Object.values(values).join(' | ')})`;
  }
  if (typeName === 'ZodNativeEnum') {
    const raw = innerSchema._def?.values ?? {};
    const numericValues = Object.entries(raw).filter(([, v]) => typeof v === 'number') as Array<
      [string, number]
    >;
    if (numericValues.length > 0) {
      return `enum(${numericValues.map(([label, val]) => `${label}=${val}`).join(' | ')})`;
    }
    const stringValues = Object.values(raw).filter((v): v is string => typeof v === 'string');
    if (stringValues.length > 0) return `enum(${stringValues.join(' | ')})`;
    return 'enum';
  }
  if (typeName === 'ZodUnion') {
    const options = innerSchema._def.options || [];
    const types = options.map((opt: t.ZodSchemaLike) => getZodTypeName(opt, seen, depth + 1));
    return `union(${types.join(' | ')})`;
  }
  if (typeName === 'ZodLiteral') {
    const literalValue = innerSchema._def.value;
    return `literal(${JSON.stringify(literalValue)})`;
  }
  if (typeName === 'ZodRecord') return 'record';
  if (typeName === 'ZodAny') return 'any';
  if (typeName === 'ZodUnknown') return 'unknown';
  return typeName || 'unknown';
}

/** Shared queryOptions for the schema tree used by command palette search. */
export const configSchemaTreeOptions = queryOptions({
  queryKey: ['configSchemaTree'],
  queryFn: () => getConfigSchemaFields().then((r) => r.tree),
  staleTime: Infinity,
});

export const getConfigSchemaFields = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const tree = extractSchemaTree(configSchema);
    const startupConfigResponse = await apiFetch('/api/config');
    const startupConfig = startupConfigResponse.ok
      ? ((await startupConfigResponse.json()) as { langfuseFanoutEnabled?: boolean })
      : undefined;
    applyLangfuseSchemaVisibility(tree, startupConfig?.langfuseFanoutEnabled);
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

function getFieldDefault(schema: t.ZodSchemaLike): { hasDefault: boolean; value: unknown } {
  let current = schema;
  while (current?._def) {
    if (current._def.typeName === 'ZodDefault') {
      const defVal = (current._def as unknown as { defaultValue: () => unknown }).defaultValue;
      return { hasDefault: true, value: typeof defVal === 'function' ? defVal() : defVal };
    }
    const next =
      current._def.typeName === 'ZodEffects' ? current._def.schema : current._def.innerType;
    if (!next) break;
    current = next;
  }
  return { hasDefault: false, value: undefined };
}

/** Nested object of every `.default()` value in `schema` (stops at the first default on a path). */
export function extractSchemaDefaults(schema: t.ZodSchemaLike): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object' || !('shape' in schema) || !schema.shape) return result;

  for (const [key, fieldSchema] of Object.entries(
    schema.shape as Record<string, t.ZodSchemaLike>,
  )) {
    const { hasDefault, value } = getFieldDefault(fieldSchema);
    if (hasDefault) {
      result[key] = value;
      continue;
    }

    const inner = unwrapSchema(fieldSchema);

    if (inner && typeof inner === 'object' && 'shape' in inner) {
      const nested = extractSchemaDefaults(inner);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
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
