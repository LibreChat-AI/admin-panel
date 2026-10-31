import type * as t from '@/types';
import { isConfigRecord } from './format';

/**
 * Zod 4 wrapper types that `unwrapSchema` (and the schema tree walk) step
 * through. `prefault` is a default applied before parsing, `nonoptional` an
 * object's `.required()` field.
 */
export const ZOD_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'optional',
  'default',
  'prefault',
  'nullable',
  'nonoptional',
  'pipe',
  'lazy',
]);

/** A schema's Zod 4 type (`_zod.def.type`: `object`, `string`, `optional`, …). */
export function schemaType(schema: t.ZodSchemaLike | null | undefined): string | undefined {
  return schema?._zod?.def.type;
}

/**
 * The side of a pipe that holds the value's shape: its output, unless that
 * only transforms (`.transform()`), when the input does. So `preprocess` and
 * `a.pipe(b)` give the schema they parse into, and `a.transform(fn)` gives `a`.
 */
function pipeSchemaOf(def: t.ZodDef): t.ZodSchemaLike | undefined {
  return schemaType(def.out) === 'transform' ? def.in : def.out;
}

/** The schema one wrapper (`ZOD_WRAPPER_TYPES`) encloses. */
export function innerSchemaOf(def: t.ZodDef): t.ZodSchemaLike | undefined {
  if (def.type === 'lazy') return def.getter?.();
  if (def.type === 'pipe') return pipeSchemaOf(def);
  return def.innerType;
}

/** Strips optional/default/nullable/pipe/lazy (and the like) wrappers down to the inner schema. */
export function unwrapSchema(schema: t.ZodSchemaLike): t.ZodSchemaLike {
  const seen = new Set<t.ZodSchemaLike>();
  let current = schema;
  while (ZOD_WRAPPER_TYPES.has(schemaType(current) ?? '')) {
    if (seen.has(current)) break;
    seen.add(current);
    const next = current._zod && innerSchemaOf(current._zod.def);
    if (!next) break;
    current = next;
  }
  return current;
}

/** Whether a (unwrapped) schema is a union: `z.union` or `z.discriminatedUnion`. */
export function isUnionSchema(schema: t.ZodSchemaLike): boolean {
  return schemaType(schema) === 'union';
}

/** Merges the object shapes from both sides of a ZodIntersection. Non-object
 *  sides (e.g. arrays) are intentionally dropped — only object shapes are
 *  extractable for the schema-driven form renderer. */
export function resolveIntersection(schema: t.ZodSchemaLike): t.ZodSchemaLike | null {
  const def = schema?._zod?.def;
  if (def?.type !== 'intersection') return null;
  const left = unwrapSchema(def.left ?? {});
  const right = unwrapSchema(def.right ?? {});
  const leftShape = left && typeof left === 'object' && 'shape' in left ? left.shape : undefined;
  const rightShape =
    right && typeof right === 'object' && 'shape' in right ? right.shape : undefined;
  if (!leftShape && !rightShape) return null;
  return { shape: { ...leftShape, ...rightShape } };
}

/** Synthesizes a union that reports the closest branch's issues (not a zod `invalid_union`). */
function anyOfSchema(candidates: t.ZodSchemaLike[]): t.ParseableSchema {
  const safeParse: t.ParseableSchema['safeParse'] = (value, params) => {
    const errors: NonNullable<t.SchemaParseResult['error']>[] = [];
    for (const candidate of candidates) {
      const c = candidate as Partial<t.ParseableSchema>;
      if (typeof c.safeParse !== 'function') continue;
      let result: t.SchemaParseResult;
      try {
        result = c.safeParse(value, params);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Validation failed';
        errors.push({ issues: [{ code: 'custom', message, path: [] }] });
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
      error: best ?? { issues: [{ code: 'custom', message: 'Validation failed', path: [] }] },
    };
  };
  /** The options are kept so resolveSubSchema can keep traversing into nested fields under union branches; without them, the next segment short-circuits and validateFieldValue silently passes everything. */
  return { _zod: { def: { type: 'union', options: candidates } }, safeParse };
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
    const def = unwrapped?._zod?.def;
    if (!def) return null;

    if (unwrapped.shape && typeof unwrapped.shape === 'object') {
      const next = unwrapped.shape[segment];
      if (!next) return null;
      current = next;
    } else if (def.type === 'array') {
      if (!def.element) return null;
      current = def.element;
    } else if (def.type === 'record') {
      if (!def.valueType) return null;
      current = def.valueType;
    } else if (isUnionSchema(unwrapped)) {
      const options = def.options ?? [];
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
    } else if (def.type === 'intersection') {
      const resolved = resolveIntersection(unwrapped);
      if (!resolved?.shape?.[segment]) return null;
      current = resolved.shape[segment];
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Entries of an object value whose keys the schema does not describe (settings
 * from a newer LibreChat than the panel's bundled schema). Secret preview
 * companions of known fields are not settings and are left out.
 */
export function getUnknownConfigEntries(
  fields: t.SchemaField[],
  value: t.ConfigValue,
): Array<[string, t.ConfigValue]> {
  if (!isConfigRecord(value)) return [];
  const known = new Set(fields.map((f) => f.key));
  return Object.entries(value).filter(
    ([key, child]) =>
      child !== undefined &&
      !known.has(key) &&
      !(key.endsWith('Preview') && known.has(key.slice(0, -'Preview'.length))),
  );
}

const ARRAY_MARKER = '[]';
const RECORD_MARKER = '{}';
const childIndexCache = new WeakMap<ReadonlySet<string>, Map<string, Set<string>>>();

/** Schema paths of every field in a tree, keeping the `[]`/`{}` markers (`mcpServers.{}.url`). */
export function collectSchemaPaths(tree: t.SchemaField[]): Set<string> {
  const paths = new Set<string>();
  const visit = (fields: t.SchemaField[]) => {
    for (const field of fields) {
      paths.add(field.path);
      if (field.children) visit(field.children);
    }
  };
  visit(tree);
  return paths;
}

/** Parent schema path → the child segments the schema defines under it (`''` is the root). */
function childIndex(schemaPaths: ReadonlySet<string>): Map<string, Set<string>> {
  const cached = childIndexCache.get(schemaPaths);
  if (cached) return cached;
  const index = new Map<string, Set<string>>();
  for (const path of schemaPaths) {
    const segments = path.split('.');
    for (let i = 0; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('.');
      const children = index.get(parent) ?? new Set<string>();
      children.add(segments[i]);
      index.set(parent, children);
    }
  }
  childIndexCache.set(schemaPaths, index);
  return index;
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function isPreviewCompanion(key: string, known: ReadonlySet<string>): boolean {
  return key.endsWith('Preview') && known.has(key.slice(0, -'Preview'.length));
}

/**
 * Dot-paths of config keys the schema does not describe (SCH-6), such as
 * settings from a newer LibreChat: walks objects, array elements (`[]`) and
 * record values (`{}`) of `config` against schema paths that keep their
 * markers (`collectSchemaPaths`). Values under a leaf field (a primitive
 * record, a list) are never reported; secret `*Preview` companions are skipped.
 */
export function getUnknownConfigKeys(
  config: t.ConfigValue,
  schemaPaths: ReadonlySet<string>,
): string[] {
  const index = childIndex(schemaPaths);
  const unknown: string[] = [];
  const walk = (value: t.ConfigValue, schemaPath: string, dataPath: string) => {
    const known = index.get(schemaPath);
    if (!known) return;
    if (Array.isArray(value)) {
      if (!known.has(ARRAY_MARKER)) return;
      value.forEach((item, i) =>
        walk(item, joinPath(schemaPath, ARRAY_MARKER), joinPath(dataPath, String(i))),
      );
      return;
    }
    if (!isConfigRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (known.has(RECORD_MARKER)) {
        walk(child, joinPath(schemaPath, RECORD_MARKER), joinPath(dataPath, key));
      } else if (known.has(key)) {
        walk(child, joinPath(schemaPath, key), joinPath(dataPath, key));
      } else if (!isPreviewCompanion(key, known)) {
        unknown.push(joinPath(dataPath, key));
      }
    }
  };
  walk(config, '', '');
  return unknown;
}
