import type * as t from '@/types';
import { isConfigRecord } from './format';

/** Zod wrapper types that `unwrapSchema` (and the schema tree walk) step through. */
export const ZOD_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'ZodOptional',
  'ZodDefault',
  'ZodNullable',
  'ZodEffects',
  'ZodLazy',
  'ZodPipeline',
]);

/** Strips optional/default/nullable/effects/lazy/pipeline wrappers down to the inner schema. */
export function unwrapSchema(schema: t.ZodSchemaLike): t.ZodSchemaLike {
  const seen = new Set<t.ZodSchemaLike>();
  let current = schema;
  while (current?._def?.typeName && ZOD_WRAPPER_TYPES.has(current._def.typeName)) {
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
export function resolveIntersection(schema: t.ZodSchemaLike): t.ZodSchemaLike | null {
  if (schema?._def?.typeName !== 'ZodIntersection') return null;
  const left = unwrapSchema(schema._def.left ?? ({} as t.ZodSchemaLike));
  const right = unwrapSchema(schema._def.right ?? ({} as t.ZodSchemaLike));
  const leftShape = left && typeof left === 'object' && 'shape' in left ? left.shape : undefined;
  const rightShape =
    right && typeof right === 'object' && 'shape' in right ? right.shape : undefined;
  if (!leftShape && !rightShape) return null;
  return { shape: { ...leftShape, ...rightShape } };
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
