import { z } from 'zod';
import yaml from 'js-yaml';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import {
  configSchema,
  isProcessMCPServerField,
  isProcessMCPServerConfig,
} from 'librechat-data-provider';
import type { AdminConfigResponse } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  flattenObject,
  findUnsafeKeys,
  isConfigRecord,
  getWriteSkipReason,
  findYamlManagedValues,
  stripSecretPreviewValues,
  isInterfacePermissionPath,
  filterSecretPreviewFields,
  stripInterfacePermissionFields,
  filterInterfacePermissionChildren,
} from '@/utils';
import {
  requireCapability,
  requireAnyCapability,
  requireAllSectionCapabilities,
} from './capabilities';
import { BLOCK_UNSAFE_CONFIG_KEYS, APP_SERVICE_KEY_ALIASES, getConfigSection } from '@/constants';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { safeFieldPath } from './utils/validation';
import { apiFetch } from './utils/api';

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

const WRAPPER_TYPES = new Set([
  'ZodOptional',
  'ZodDefault',
  'ZodNullable',
  'ZodEffects',
  'ZodLazy',
  'ZodPipeline',
]);

const INDEXED_ARRAY_RE = /^(.+)\.(\d+)$/;
const ARRAY_INDEX_KEY_RE = /^(0|[1-9]\d*)$/;

function unwrapSchema(schema: t.ZodSchemaLike): t.ZodSchemaLike {
  const seen = new Set<t.ZodSchemaLike>();
  let current = schema;
  while (current?._def?.typeName && WRAPPER_TYPES.has(current._def.typeName)) {
    if (seen.has(current)) break;
    seen.add(current);
    let next: t.ZodSchemaLike | undefined;
    if (current._def.typeName === 'ZodLazy') {
      next = current._def.getter?.();
    } else if (current._def.typeName === 'ZodPipeline') {
      next = current._def.out;
    } else if (current._def.typeName === 'ZodEffects') {
      next = current._def.schema;
    } else {
      next = current._def.innerType;
    }
    if (!next) break;
    current = next;
  }
  return current;
}

/** Merges the object shapes from both sides of a ZodIntersection. Non-object
 *  sides (e.g. arrays) are intentionally dropped — only object shapes are
 *  extractable for the schema-driven form renderer. */
function resolveIntersection(schema: t.ZodSchemaLike): t.ZodSchemaLike | null {
  if (schema?._def?.typeName !== 'ZodIntersection') return null;
  const left = unwrapSchema(schema._def.left ?? ({} as t.ZodSchemaLike));
  const right = unwrapSchema(schema._def.right ?? ({} as t.ZodSchemaLike));
  const leftShape = left && typeof left === 'object' && 'shape' in left ? left.shape : undefined;
  const rightShape =
    right && typeof right === 'object' && 'shape' in right ? right.shape : undefined;
  if (!leftShape && !rightShape) return null;
  return { shape: { ...leftShape, ...rightShape } };
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

        while (innerSchema?._def?.typeName && WRAPPER_TYPES.has(innerSchema._def.typeName)) {
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

/** Synthesizes a union without z.union to avoid the zod v3/v4 cross-version pitfall. */
function anyOfSchema(candidates: t.ZodSchemaLike[]): t.ZodSchemaLike {
  type ParseResult = {
    success: boolean;
    error?: { issues: Array<{ message: string; path: (string | number)[] }> };
  };
  const safeParse = (value: unknown): ParseResult => {
    const errors: NonNullable<ParseResult['error']>[] = [];
    for (const candidate of candidates) {
      const c = candidate as t.ZodSchemaLike & {
        safeParse?: (v: unknown) => ParseResult;
      };
      if (typeof c.safeParse !== 'function') continue;
      let result: ParseResult;
      try {
        result = c.safeParse(value);
      } catch (e) {
        errors.push({
          issues: [{ message: e instanceof Error ? e.message : 'Validation failed', path: [] }],
        });
        continue;
      }
      if (result.success) return { success: true };
      if (result.error) errors.push(result.error);
    }
    /** Pick the branch with the fewest issues (most likely the intended one); tiebreak on longest path. */
    const sorted = errors
      .filter((e): e is NonNullable<typeof e> => e != null && Array.isArray(e.issues))
      .sort((a, b) => {
        const ca = a.issues?.length ?? Infinity;
        const cb = b.issues?.length ?? Infinity;
        if (ca !== cb) return ca - cb;
        const pa = Math.max(0, ...(a.issues ?? []).map((i) => i.path?.length ?? 0));
        const pb = Math.max(0, ...(b.issues ?? []).map((i) => i.path?.length ?? 0));
        return pb - pa;
      });
    const best = sorted[0];
    return {
      success: false,
      error: best ?? { issues: [{ message: 'Validation failed', path: [] }] },
    };
  };
  /** _def.options is preserved so resolveSubSchema can keep traversing into nested fields under union branches; without it, the next segment short-circuits and validateFieldValue silently passes everything. */
  return { _def: { typeName: 'ZodUnion', options: candidates }, safeParse } as t.ZodSchemaLike;
}

/** Walks a Zod schema tree to find the sub-schema at a given dot-path.
 *  Returns the schema **with wrappers intact** so `.safeParse()` runs the
 *  full validation chain (refine, transform, pipe). Returns `null` if the
 *  path cannot be resolved. */
export function resolveSubSchema(
  schema: t.ZodSchemaLike,
  segments: string[],
): t.ZodSchemaLike | null {
  let current: t.ZodSchemaLike = schema;

  for (const segment of segments) {
    const unwrapped = unwrapSchema(current);
    if (!unwrapped?._def) return null;

    const typeName = unwrapped._def.typeName;

    if (unwrapped.shape && typeof unwrapped.shape === 'object') {
      const next = unwrapped.shape[segment];
      if (!next) return null;
      current = next;
    } else if (typeName === 'ZodArray') {
      const elementType = unwrapped._def.type;
      if (!elementType) return null;
      current = elementType;
    } else if (typeName === 'ZodRecord') {
      const valueType = (unwrapped._def as t.ZodDef & { valueType?: t.ZodSchemaLike }).valueType;
      if (!valueType) return null;
      current = valueType;
    } else if (typeName === 'ZodUnion') {
      const options = unwrapped._def.options ?? [];
      const candidates: t.ZodSchemaLike[] = [];
      for (const opt of options) {
        /** Recurse so options that are records, arrays, or further unions resolve through their own walker case, not just shape lookup. */
        const resolved = resolveSubSchema(opt, [segment]);
        if (resolved) candidates.push(resolved);
      }
      if (candidates.length === 0) return null;
      if (candidates.length === 1) {
        current = candidates[0];
      } else {
        current = anyOfSchema(candidates);
      }
    } else if (typeName === 'ZodIntersection') {
      const resolved = resolveIntersection(unwrapped);
      if (!resolved?.shape?.[segment]) return null;
      current = resolved.shape[segment];
    } else {
      return null;
    }
  }

  return current;
}

export function validateFieldValue(
  fieldPath: string,
  value: unknown,
): { success: true } | { success: false; error: string } {
  const segments = fieldPath.split('.');
  const subSchema = resolveSubSchema(configSchema as t.ZodSchemaLike, segments);

  if (!subSchema) return { success: true };

  if (
    typeof subSchema === 'object' &&
    'safeParse' in subSchema &&
    typeof subSchema.safeParse === 'function'
  ) {
    const result = (
      subSchema as {
        safeParse: (v: unknown) => {
          success: boolean;
          error?: { issues: Array<{ message: string; path: (string | number)[] }> };
        };
      }
    ).safeParse(value);
    if (!result.success && result.error) {
      const messages = result.error.issues.map((issue) => {
        const issuePath = issue.path.reduce(
          (path, segment) =>
            typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`,
          fieldPath,
        );
        return `${issuePath}: ${issue.message}`;
      });
      return { success: false, error: messages.join('; ') || 'Validation failed' };
    }
  }

  return { success: true };
}

export function parseIndexedArrayPath(
  fieldPath: string,
): { arrayPath: string; index: number } | null {
  const match = INDEXED_ARRAY_RE.exec(fieldPath);
  if (!match) return null;
  const [, arrayPath, indexStr] = match;
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, arrayPath.split('.'));
  if (!schema) return null;
  const unwrapped = unwrapSchema(schema);
  if (unwrapped?._def?.typeName !== 'ZodArray') return null;
  return { arrayPath, index: Number(indexStr) };
}

export function toConfigArraySource(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return [...value];
  return toIndexedArrayObjectSource(value);
}

export function toIndexedArrayObjectSource(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return undefined;
  const arrayValue: unknown[] = [];
  for (const [key, entryValue] of Object.entries(value as Record<string, t.ConfigValue>)) {
    if (!ARRAY_INDEX_KEY_RE.test(key)) return undefined;
    const index = Number(key);
    if (!Number.isSafeInteger(index)) return undefined;
    arrayValue[index] = entryValue;
  }
  return arrayValue;
}

function overlayArraySource(source: unknown[], overlay: unknown[]): unknown[] {
  const result = [...source];
  for (const key of Object.keys(overlay)) {
    const index = Number(key);
    result[index] = overlay[index];
  }
  return result;
}

function mergeConfigArraySource(source: unknown[], value: unknown): unknown[] {
  if (Array.isArray(value)) return [...value];
  const overlay = toIndexedArrayObjectSource(value);
  return overlay ? overlayArraySource(source, overlay) : source;
}

export function mergeConfigArraySources(
  baseValue: unknown,
  overrideValue: unknown,
  pendingValue: unknown,
): unknown[] {
  const baseSource = toConfigArraySource(baseValue) ?? [];
  const overrideSource = mergeConfigArraySource(baseSource, overrideValue);
  return mergeConfigArraySource(overrideSource, pendingValue);
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

const UNSAFE_KEY_MESSAGE =
  "keys containing '.' or starting with '$' can't be saved through the admin API yet; set this in librechat.yaml";

function describeUnsafeKey({ path, key }: t.UnsafeConfigKey): string {
  return `${path ? `${path} → ` : ''}"${key}": ${UNSAFE_KEY_MESSAGE}`;
}

/** Leaf paths of `raw` that the bundled config schema does not describe. */
export function findUnknownConfigPaths(raw: Record<string, t.ConfigValue>): string[] {
  return Object.keys(flattenObject(raw)).filter(
    (path) => resolveSubSchema(configSchema as t.ZodSchemaLike, path.split('.')) == null,
  );
}

/**
 * Parses and validates pasted/uploaded YAML for import. Validation runs on a
 * copy with `version` replaced (a snippet need not carry it, and import never
 * writes it, so `version: 1.2` read as a number must not fail), but the result
 * is the raw parsed object: no Zod defaults are injected and keys the bundled
 * schema does not know are kept (and reported in `unknownPaths`).
 */
export function parseConfigYaml(yamlContent: string): t.ImportParseResult {
  const failure = (
    error: string,
    validationErrors?: t.ImportValidationError[],
  ): t.ImportParseResult => ({
    success: false,
    error,
    validationErrors,
    appConfig: null,
    unknownPaths: [],
  });

  let rawConfig: unknown;
  try {
    rawConfig = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
  } catch (parseError) {
    const mark = (parseError as { mark?: { line: number; column: number } }).mark;
    const where = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : '';
    return failure(`Invalid YAML syntax${where}. Please check the content for syntax errors.`);
  }

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return failure('YAML did not produce a valid configuration object');
  }

  const appConfig = rawConfig as t.ConfigRecord;
  const result = configSchema.safeParse({ ...appConfig, version: '1.0.0' });
  if (!result.success) {
    return failure(
      'Config validation failed',
      result.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    );
  }

  if (BLOCK_UNSAFE_CONFIG_KEYS) {
    const unsafe = findUnsafeKeys(appConfig, '');
    if (unsafe.length > 0) {
      return failure(
        'Some keys cannot be imported',
        unsafe.map(({ path, key }) => ({
          path: path || key,
          message: `"${key}": ${UNSAFE_KEY_MESSAGE}`,
        })),
      );
    }
  }

  return {
    success: true,
    error: undefined,
    validationErrors: undefined,
    appConfig,
    unknownPaths: findUnknownConfigPaths(appConfig),
  };
}

export const parseImportedYaml = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ yamlContent: z.string() }))
  .handler(async ({ data }: { data: { yamlContent: string } }) =>
    parseConfigYaml(data.yamlContent),
  );

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

function extractSchemaDefaults(schema: t.ZodSchemaLike): Record<string, unknown> {
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

function computeConfiguredPaths(
  config: Record<string, t.ConfigValue>,
  defaults: Record<string, unknown>,
): string[] {
  const flatConfig = flattenObject(config);
  const flatDefaults = flattenObject(defaults as Record<string, t.ConfigValue>);
  const configured: string[] = [];
  for (const [path, value] of Object.entries(flatConfig)) {
    if (value === '' || value === null || value === undefined) continue;
    if (!(path in flatDefaults)) {
      configured.push(path);
      continue;
    }
    const defaultVal = flatDefaults[path];
    if (value === defaultVal) continue;
    if (JSON.stringify(value) === JSON.stringify(defaultVal)) continue;
    configured.push(path);
  }
  return configured;
}

const AZURE_OPENAI_DERIVED_KEYS = new Set([
  'assistantGroups',
  'errors',
  'isValid',
  'groupMap',
  'modelNames',
  'modelGroupMap',
  'assistantModels',
  'serverless',
  'instanceName',
  'deploymentName',
]);

function normalizeEndpointValue(value: t.ConfigValue): t.ConfigValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, t.ConfigValue>;
  if ('groupMap' in obj && 'isValid' in obj) {
    const groupMap = obj.groupMap;
    const cleaned: Record<string, t.ConfigValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (AZURE_OPENAI_DERIVED_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    if (groupMap && typeof groupMap === 'object' && !Array.isArray(groupMap)) {
      cleaned.groups = Object.entries(groupMap as Record<string, t.ConfigValue>).map(
        ([group, config]) => ({
          group,
          ...(typeof config === 'object' && config !== null && !Array.isArray(config)
            ? (config as Record<string, t.ConfigValue>)
            : {}),
        }),
      );
    }
    return cleaned;
  }
  return value;
}

export function normalizeAppServiceKeys(
  raw: Record<string, t.ConfigValue>,
): Record<string, t.ConfigValue> {
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[APP_SERVICE_KEY_ALIASES[key] ?? key] = value;
  }
  if (
    result.interface &&
    typeof result.interface === 'object' &&
    !Array.isArray(result.interface)
  ) {
    result.interface = stripInterfacePermissionFields(
      result.interface as Record<string, unknown>,
    ) as t.ConfigValue;
  }
  if (
    result.endpoints &&
    typeof result.endpoints === 'object' &&
    !Array.isArray(result.endpoints)
  ) {
    const endpoints = { ...(result.endpoints as Record<string, t.ConfigValue>) };
    result.endpoints = endpoints;
    for (const [epKey, epValue] of Object.entries(endpoints)) {
      endpoints[epKey] = normalizeEndpointValue(epValue);
    }
  }
  return result;
}

export const getBaseConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [baseResponse, baseOnlyResponse, dbBaseResponse] = await Promise.all([
    apiFetch('/api/admin/config/base'),
    apiFetch('/api/admin/config/base?baseOnly=true'),
    apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`),
  ]);

  if (!baseResponse.ok) {
    throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
  }

  const { config: rawConfig } = (await baseResponse.json()) as {
    config: Record<string, t.ConfigValue>;
  };
  const config = normalizeAppServiceKeys(rawConfig);

  let configuredFromBase: string[] = [];
  let flatDefaults: Record<string, t.ConfigValue> = {};
  try {
    const schemaDefaults = extractSchemaDefaults(configSchema as t.ZodSchemaLike);
    flatDefaults = flattenObject(schemaDefaults as Record<string, t.ConfigValue>);
    configuredFromBase = computeConfiguredPaths(config, schemaDefaults);
  } catch (e) {
    console.warn('[getBaseConfigFn] Failed to compute schema defaults:', e);
  }

  let dbOverrides: Record<string, t.ConfigValue> | undefined;

  if (dbBaseResponse.ok) {
    const { config: dbConfig } = (await dbBaseResponse.json()) as AdminConfigResponse;
    dbOverrides = dbConfig.overrides as Record<string, t.ConfigValue>;
  }

  let yamlMcpKeys: string[] | undefined;
  let yamlMcpServers: Record<string, t.ConfigValue> | undefined;
  /** librechat.yaml alone (no admin overrides): what a base field reverts to when its override is reset. */
  let yamlConfig: t.ConfigRecord | undefined;
  if (baseOnlyResponse.ok) {
    const { config: baseOnlyRaw } = (await baseOnlyResponse.json()) as {
      config: Record<string, t.ConfigValue>;
    };
    const baseOnly = normalizeAppServiceKeys(baseOnlyRaw);
    yamlConfig = baseOnly;
    const mcp = baseOnly.mcpServers;
    if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
      /** Trust the baseOnly response when it has a valid mcpServers shape. The previous byte-equality fallback against `config.mcpServers` was a defensive heuristic for hypothetical legacy backends that ignore `?baseOnly`, but it false-negatived whenever an admin override happened to be a no-op (e.g. an admin set `title` to a value that already matched YAML), causing the YAML lock affordances to disappear for entries that should stay locked. The deployed LibreChat supports `?baseOnly` directly, so the heuristic is no longer earning its keep. */
      yamlMcpServers = mcp as Record<string, t.ConfigValue>;
      yamlMcpKeys = Object.keys(yamlMcpServers);
    }
  }

  return {
    config,
    dbOverrides,
    configuredFromBase,
    schemaDefaults: flatDefaults,
    yamlMcpKeys,
    yamlMcpServers,
    yamlConfig,
  };
});

export const baseConfigOptions = queryOptions({
  queryKey: ['baseConfig'],
  queryFn: () => getBaseConfigFn(),
  staleTime: 30_000,
});

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

export function mergeIndexedArrayEntriesIntoBase(
  entries: t.SaveEntry[],
  baseConfig: t.ConfigRecord,
  mergedPaths?: Set<string>,
): t.SaveEntry[] {
  const indexed = new Map<string, Map<number, t.ConfigValue>>();
  const rest: t.SaveEntry[] = [];

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (parsed) {
      const { arrayPath, index } = parsed;
      if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
      indexed.get(arrayPath)!.set(index, entry.value);
    } else {
      rest.push(entry);
    }
  }

  if (indexed.size === 0) return entries;
  const normalizedBaseConfig = normalizeAppServiceKeys(baseConfig);

  for (const [arrayPath, updates] of indexed) {
    const segments = arrayPath.split('.');
    let current: unknown = normalizedBaseConfig;
    for (const seg of segments) {
      if (current == null || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[seg];
    }
    const arr = toConfigArraySource(current) ?? [];
    for (const [idx, value] of updates) {
      arr[idx] = value;
    }
    const strippedArr = stripSecretPreviewValues(
      arr as t.ConfigValue[],
      arrayPath,
      getSchemaPathSet(),
    );
    rest.push({ fieldPath: arrayPath, value: strippedArr });
    mergedPaths?.add(arrayPath);
  }

  return rest;
}

function hasIndexedArrayEntry(entries: t.SaveEntry[]): boolean {
  for (const entry of entries) {
    if (parseIndexedArrayPath(entry.fieldPath)) return true;
  }
  return false;
}

async function mergeIndexedArrayEntries(
  entries: t.SaveEntry[],
  mergedPaths?: Set<string>,
): Promise<t.SaveEntry[]> {
  if (!hasIndexedArrayEntry(entries)) return entries;
  const baseResponse = await apiFetch('/api/admin/config/base');
  if (!baseResponse.ok) throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
  const { config: baseConfig } = (await baseResponse.json()) as {
    config: Record<string, t.ConfigValue>;
  };
  return mergeIndexedArrayEntriesIntoBase(entries, baseConfig, mergedPaths);
}

function isProcessMCPServerFieldPath(fieldPath: string, value: t.ConfigValue): boolean {
  const [section, serverName, field] = fieldPath.split('.');
  if (section !== 'mcpServers') return false;
  if (serverName == null) {
    return isConfigRecord(value) && Object.values(value).some(isProcessMCPServerConfig);
  }
  if (field == null) return isProcessMCPServerConfig(value);
  return isProcessMCPServerField(field) || (field === 'type' && value === 'stdio');
}

const YAML_MANAGED_MESSAGE =
  'managed in librechat.yaml; LibreChat ignores admin overrides for it until it re-processes them';

/**
 * Pre-flight for a batch of saves and resets, run before anything is written:
 * per-entry schema validation (an indexed array entry such as
 * `endpoints.custom.3` is validated against the element schema), the
 * process-backed MCP field rule, and keys the admin API would silently drop.
 * Paths the panel must not write (`getWriteSkipReason`: read-only and
 * dedicated sections, role permissions, YAML-managed fields) are reported in
 * `skipped`; this covers every write path, imports and profile saves included.
 */
export function checkConfigChanges(saves: t.SaveEntry[], resets: string[]): t.ConfigCheckResult {
  const errors: t.FieldValidationError[] = [];
  const skipped: t.SkippedChange[] = [];
  for (const { fieldPath, value } of saves) {
    const reason = getWriteSkipReason(fieldPath, false);
    if (reason) {
      skipped.push({ fieldPath, reason });
      continue;
    }
    const managed = findYamlManagedValues(fieldPath, value);
    if (managed.length > 0) {
      errors.push(
        ...managed.map((path) => ({ fieldPath, error: `${path}: ${YAML_MANAGED_MESSAGE}` })),
      );
      continue;
    }
    if (isProcessMCPServerFieldPath(fieldPath, value)) {
      errors.push({
        fieldPath,
        error: `${fieldPath}: process-backed MCP servers (command, args, env, cwd, stderr, stdio) can only be configured in librechat.yaml`,
      });
      continue;
    }
    const unsafe = BLOCK_UNSAFE_CONFIG_KEYS ? findUnsafeKeys(value, fieldPath) : [];
    if (unsafe.length > 0) {
      errors.push(...unsafe.map((u) => ({ fieldPath, error: describeUnsafeKey(u) })));
      continue;
    }
    const result = validateFieldValue(fieldPath, value);
    if (!result.success) errors.push({ fieldPath, error: result.error });
  }
  for (const fieldPath of resets) {
    const reason = getWriteSkipReason(fieldPath, true);
    if (reason) skipped.push({ fieldPath, reason });
  }
  return { errors, skipped };
}

function formatCheckErrors(errors: t.FieldValidationError[]): string {
  return `Validation failed — ${errors.map((e) => e.error).join('; ')}`;
}

function topLevelSections(paths: string[]): string[] {
  return [...new Set(paths.map(getConfigSection))];
}

const saveEntrySchema = z.object({ fieldPath: safeFieldPath, value: z.unknown() });

/** Validates a batch before any write so a failed save never leaves resets half-applied. */
export const validateConfigChangesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      target: z.enum(['base', 'scope']),
      saves: z.array(saveEntrySchema).max(2000),
      resets: z.array(safeFieldPath).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const saves = data.saves as t.SaveEntry[];
    const check = checkConfigChanges(saves, data.resets);
    const skippedPaths = new Set(check.skipped.map((s) => s.fieldPath));
    const written = [...saves.map((e) => e.fieldPath), ...data.resets].filter(
      (p) => !skippedPaths.has(p),
    );
    if (data.target === 'base') {
      if (written.length > 0) await requireAllSectionCapabilities(topLevelSections(written));
    } else {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
    }
    return check;
  });

/** The admin API accepts at most this many entries per PATCH. */
const MAX_PATCH_ENTRIES = 100;

/**
 * Entries of a PATCH batch that LibreChat did not store. A 200 "No actionable
 * field entries" reply means it stripped the whole batch. Otherwise the reply
 * carries the stored overrides, and an entry whose top-level section is absent
 * from them was stripped (LibreChat strips by section: base-only, dedicated
 * and newer sections this panel does not know about yet).
 */
export function findDroppedEntries(batch: t.SaveEntry[], body: t.PatchFieldsResponse): string[] {
  if (body.message?.startsWith('No actionable')) return batch.map((e) => e.fieldPath);
  const overrides = body.config?.overrides;
  if (!isConfigRecord(overrides)) return [];
  return batch
    .filter((e) => !Object.hasOwn(overrides, getConfigSection(e.fieldPath)))
    .map((e) => e.fieldPath);
}

/**
 * PATCHes field entries in batches the admin API accepts. Entries LibreChat
 * did not store are returned as `skipped` (`notStored`) so the caller never
 * reports them saved. A batch rejected after earlier batches were written
 * fails with an error that says how many entries were already saved.
 */
export async function patchConfigFields(
  url: string,
  entries: t.SaveEntry[],
  extraBody: { priority?: number } = {},
): Promise<{ applied: number; skipped: t.SkippedChange[] }> {
  let applied = 0;
  const skipped: t.SkippedChange[] = [];
  for (let i = 0; i < entries.length; i += MAX_PATCH_ENTRIES) {
    const batch = entries.slice(i, i + MAX_PATCH_ENTRIES);
    const response = await apiFetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ entries: batch, ...extraBody }),
    });
    const body = (await response.json().catch(() => ({}))) as t.PatchFieldsResponse;
    if (!response.ok) {
      const message = body.error ?? `Failed to save config: ${response.status}`;
      throw new Error(
        applied > 0
          ? `${message} (${applied} of ${entries.length} entries were already saved)`
          : message,
      );
    }
    const dropped = findDroppedEntries(batch, body);
    applied += batch.length - dropped.length;
    skipped.push(...dropped.map((fieldPath) => ({ fieldPath, reason: 'notStored' as const })));
  }
  return { applied, skipped };
}

/**
 * Splits a request into the entries to write and the ones the panel must not
 * send, and rejects the whole request if any entry fails the pre-flight.
 */
export function prepareConfigWrite(entries: t.SaveEntry[]): {
  writable: t.SaveEntry[];
  skipped: t.SkippedChange[];
} {
  const check = checkConfigChanges(entries, []);
  if (check.errors.length > 0) throw new Error(formatCheckErrors(check.errors));
  const skippedPaths = new Set(check.skipped.map((s) => s.fieldPath));
  return {
    writable: entries.filter((e) => !skippedPaths.has(e.fieldPath)),
    skipped: check.skipped,
  };
}

export const saveBaseConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      entries: z.array(saveEntrySchema).min(1).max(2000),
    }),
  )
  .handler(async ({ data }): Promise<t.ConfigWriteResult> => {
    const { writable, skipped } = prepareConfigWrite(data.entries as t.SaveEntry[]);
    if (writable.length === 0) return { success: true, applied: 0, skipped };

    /** Indexed array entries (e.g. endpoints.custom.2) were validated against the element schema above; merge them back into full arrays so the API receives complete field values. */
    const merged = await mergeIndexedArrayEntries(writable);

    await requireAllSectionCapabilities(topLevelSections(merged.map((e) => e.fieldPath)));

    const result = await patchConfigFields(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/fields`,
      merged,
      { priority: 0 },
    );
    return { success: true, applied: result.applied, skipped: [...skipped, ...result.skipped] };
  });

export const resetBaseConfigFieldFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ fieldPath: safeFieldPath }))
  .handler(async ({ data }) => {
    if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
    const section = data.fieldPath.split('.')[0];
    await requireAnyCapability([SystemCapabilities.MANAGE_CONFIGS, `manage:configs:${section}`]);
    const response = await apiFetch(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/fields?fieldPath=${encodeURIComponent(data.fieldPath)}`,
      { method: 'DELETE' },
    );

    if (!response.ok && response.status !== 404) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Failed to reset field: ${response.status}`,
      );
    }

    return { success: true };
  });

/** Deletes the entire base config DB override, reverting every value back to
 *  what librechat.yaml defines. Removes the `__base__` config document outright;
 *  scope (role/group/user) profiles are untouched. A 404 means there was no
 *  override to begin with, which is treated as success. */
export const resetBaseConfigFn = createServerFn({ method: 'POST' }).handler(async () => {
  await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
  const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `Failed to reset base config: ${response.status}`,
    );
  }

  return { success: true };
});
