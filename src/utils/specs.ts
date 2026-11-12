import type * as t from '@/types';
import { getValueAtPath, isConfigRecord } from './format';
import { SPEC_CONTROL_KEYS } from '@/constants';
import { hasPathOrAncestor } from './paths';

/**
 * What LibreChat derives for a control model specs decide where no layer
 * sets it (`specInterfaceRederive`): with specs served, the model selector
 * shows only when the menu adds endpoints, and parameters and presets are
 * off; without specs, each is on (its default).
 */
export function deriveSpecControl(key: t.SpecControlKey, specs: number, added: number): boolean {
  if (specs === 0) return true;
  return key === 'modelSelect' ? added > 0 : false;
}

function countOf(value: t.ConfigValue): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * `effective` with each spec control no layer leaves set (`isSet`) derived
 * from the model specs `served` (`effective` as LibreChat serves it, which
 * leaves out the specs that select an endpoint the merge removed), as
 * LibreChat derives them after the profiles merge (`specInterfaceRederive`):
 * a profile that adds specs turns them off, one that removes or hides the
 * endpoint of every spec turns them back on.
 */
export function withDerivedSpecControls(
  effective: t.ConfigRecord,
  isSet: (path: string) => boolean,
  served: t.ConfigRecord = effective,
): t.ConfigRecord {
  const specs = countOf(getValueAtPath(served, 'modelSpecs.list'));
  const added = countOf(getValueAtPath(served, 'modelSpecs.addedEndpoints'));
  const current = isConfigRecord(effective.interface) ? effective.interface : {};
  const next: t.ConfigRecord = { ...current };
  for (const key of SPEC_CONTROL_KEYS) {
    if (isSet(`interface.${key}`)) continue;
    next[key] = deriveSpecControl(key, specs, added);
  }
  return { ...effective, interface: next };
}

/**
 * Whether a layer of a profile's config leaves `path` set: the profile sets
 * it, or, unless the profile hides it, Base does, or librechat.yaml under
 * Base's own hides.
 */
export function leavesSet(
  path: string,
  layers: Pick<t.ValueLayers, 'yamlPaths' | 'baseOverridePaths' | 'baseTombstones'>,
  scope: Pick<t.ResolvedConfigData, 'changedPaths' | 'tombstones'>,
): boolean {
  if (scope.changedPaths.includes(path)) return true;
  if (hasPathOrAncestor(new Set(scope.tombstones), path)) return false;
  if (layers.baseOverridePaths.paths.has(path)) return true;
  if (hasPathOrAncestor(layers.baseTombstones, path)) return false;
  return layers.yamlPaths.paths.has(path);
}

/** Layers that set a value of their own, as opposed to defaults LibreChat fills in. */
const SETTING_SOURCES: ReadonlySet<t.ProvenanceSource> = new Set(['yaml', 'admin', 'scope']);

/**
 * Whether a field's value is set by a layer (librechat.yaml, Base or the
 * profile), as the page shows it with its pending edits, rather than
 * derived: a pending value sets it, a pending revert leaves what lies
 * beneath, and the topmost setting layer decides, a hide included.
 */
export function isSetByLayer(state: t.FieldState): boolean {
  if (state.visibilityEdit === 'hide') return false;
  if (state.isEdited && !state.isPendingReset && state.visibilityEdit !== 'unhide') return true;
  /** The edit target's own layer: the profile's (which reports what it inherits), else Base's. */
  const own: t.ProvenanceSource = state.inherited !== undefined ? 'scope' : 'admin';
  const drops = state.isPendingReset || state.visibilityEdit === 'unhide';
  const top = (state.stack ?? [])
    .filter((layer) => SETTING_SOURCES.has(layer.source) && !(drops && layer.source === own))
    .at(-1);
  return top !== undefined && !top.hidden && top.value !== undefined;
}
