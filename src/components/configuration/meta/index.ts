import type * as t from '@/types';
import { buildFieldMetaRegistry, resolveFieldMeta } from './registry';
import { GENERIC_FIELD_META } from './generic';

/** Registries merged in order; area files are appended here (WS2 owns, WS9–13 contribute). */
const META_SOURCES: t.FieldMetaRegistry[] = [GENERIC_FIELD_META];

const REGISTRY = buildFieldMetaRegistry(META_SOURCES);

const NON_LABEL_SEGMENT = /^(\d+|\[\]|\{\})$/;

/** Field metadata for a data or schema path, resolving `[]`/`{}` wildcards (WS2). */
export function getFieldMeta(path: string): t.FieldMeta | undefined {
  return resolveFieldMeta(REGISTRY, path);
}

/**
 * Display label for a config path (WS2; used by WS5 search and WS7 review):
 * the meta `labelKey`, else the `com_config_field_<key>` label of the last
 * named segment, else that key itself when it has no translation.
 */
export function labelForPath(path: string, localize: t.LocalizeFn): string {
  const labelKey = getFieldMeta(path)?.labelKey;
  if (labelKey) return localize(labelKey);
  const key = lastNamedSegment(path);
  const fieldKey = `com_config_field_${key}`;
  const label = localize(fieldKey);
  return label === fieldKey ? key : label;
}

/** Last path segment that names a field (skips array indices and `[]`/`{}` markers). */
function lastNamedSegment(path: string): string {
  const segments = path.split('.');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!NON_LABEL_SEGMENT.test(segments[i])) return segments[i];
  }
  return segments[segments.length - 1];
}

export { buildFieldMetaRegistry, resolveFieldMeta };
