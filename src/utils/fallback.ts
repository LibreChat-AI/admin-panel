import type * as t from '@/types';

/** The edit target's own value: a pending edit, or its saved override, unless a revert is pending. */
export function ownValue(state: t.FieldState): t.ConfigValue {
  if (state.isPendingReset) return undefined;
  return state.isOverride || state.isEdited ? state.value : undefined;
}

/** The value a field falls back to without the edit target's own value (librechat.yaml, Base or a default). */
export function lowerValue(state: t.FieldState): t.ConfigValue {
  if (state.revertTarget) return state.revertTarget.value;
  return state.isOverride ? undefined : state.effective;
}

/** Where the value beneath the edit target's own value comes from. */
export function lowerSource(state: t.FieldState): t.ProvenanceSource {
  return state.revertTarget?.source ?? state.source;
}
