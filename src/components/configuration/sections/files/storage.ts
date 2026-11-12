import type * as t from '@/types';
import { STORAGE_BACKENDS, STORAGE_BACKEND_LABELS, DEFAULT_STORAGE_BACKEND } from '@/constants';
import { ownValue, lowerValue, getValueAtPath, isConfigRecord } from '@/utils';
import { getFieldOptions } from '../../controls';

const BACKEND_INFO: ReadonlyMap<string, t.StorageBackendInfo> = new Map(
  STORAGE_BACKENDS.map((info) => [info.backend, info]),
);

/** A backend value: any name, since a newer LibreChat can accept backends the panel doesn't know. */
export function isStorageBackend(value: t.ConfigValue): value is t.StorageBackend {
  return typeof value === 'string' && value !== '';
}

/** What a backend needs on the server, for the backends the panel knows. */
export function backendInfo(backend: t.StorageBackend): t.StorageBackendInfo | undefined {
  return BACKEND_INFO.get(backend);
}

/** A backend's proper name ("Amazon S3"), else its value as written. */
export function backendName(backend: t.StorageBackend, localize: t.LocalizeFn): string {
  const info = BACKEND_INFO.get(backend);
  return info ? localize(STORAGE_BACKEND_LABELS[info.backend]) : backend;
}

/**
 * The backends a storage row offers: the ones the panel knows, in its order,
 * then any other its schema field accepts or a layer already sets (a newer
 * LibreChat's), so such a backend shows as set and is never overwritten unasked.
 */
export function backendChoices(
  field: t.SchemaField | undefined,
  values: readonly t.ConfigValue[],
): t.StorageBackend[] {
  const choices = new Set<t.StorageBackend>(BACKEND_INFO.keys());
  for (const option of field ? getFieldOptions(field) : []) choices.add(option.value);
  for (const value of values) {
    if (isStorageBackend(value)) choices.add(value);
  }
  return [...choices];
}

/** The backend a field uses: its own value, else the one beneath it, else `fallback`. */
function effectiveBackend(state: t.FieldState, fallback: t.StorageBackend): t.StorageBackend {
  const own = ownValue(state);
  if (isStorageBackend(own)) return own;
  const lower = lowerValue(state);
  return isStorageBackend(lower) ? lower : fallback;
}

/** A field's own or lower-layer backend, if either sets one. */
function setBackend(state: t.FieldState): t.StorageBackend | undefined {
  const own = ownValue(state);
  if (isStorageBackend(own)) return own;
  const lower = lowerValue(state);
  return isStorageBackend(lower) ? lower : undefined;
}

/**
 * The backend each file type uses (LibreChat's `getFileStrategy`): its own
 * `fileStrategies` entry, else `fileStrategies.default`, else `fileStrategy`,
 * else local storage. Skill files without their own entry follow the image or
 * document entry by file type (`skills` is then undefined).
 */
export function resolveStorage(states: t.StorageFieldStates): t.ResolvedStorage {
  const primary = effectiveBackend(states.primary, DEFAULT_STORAGE_BACKEND);
  const fallback = effectiveBackend(states.default, primary);
  return {
    primary,
    default: fallback,
    avatar: effectiveBackend(states.avatar, fallback),
    image: effectiveBackend(states.image, fallback),
    document: effectiveBackend(states.document, fallback),
    skills: setBackend(states.skills),
  };
}

/** Every backend in use for some kind of file. */
export function backendsInUse(resolved: t.ResolvedStorage): Set<t.StorageBackend> {
  const used = new Set<t.StorageBackend>([
    resolved.default,
    resolved.avatar,
    resolved.image,
    resolved.document,
  ]);
  if (resolved.skills) used.add(resolved.skills);
  return used;
}

/**
 * Whether LibreChat set up CloudFront at startup: it only does so from
 * librechat.yaml, when a strategy there uses `cloudfront` and the
 * `cloudfront` block names a domain. Choosing CloudFront in the panel
 * without that leaves uploads failing.
 */
export function isCloudFrontReady(yaml: t.ConfigRecord | null | undefined): boolean {
  const domain = getValueAtPath(yaml ?? null, 'cloudfront.domain');
  if (typeof domain !== 'string' || domain === '') return false;
  if (getValueAtPath(yaml ?? null, 'fileStrategy') === 'cloudfront') return true;
  const strategies = getValueAtPath(yaml ?? null, 'fileStrategies');
  return isConfigRecord(strategies) && Object.values(strategies).includes('cloudfront');
}
