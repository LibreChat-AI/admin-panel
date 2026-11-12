import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { deriveFieldState } from '@/utils';

const NO_VISIBILITY: Readonly<Record<string, t.VisibilityEdit>> = {};

/** Pending hides and unhides of the open edit target, by path (WS13). */
export function usePendingVisibility(): Readonly<Record<string, t.VisibilityEdit>> {
  return useContext(ConfigValuesContext)?.visibilityEdits ?? NO_VISIBILITY;
}

/**
 * `FieldState` of several paths at once, for editors that read a fixed set
 * of sibling fields (the memory agent's keys) without a hook per field.
 */
export function useFieldStates(paths: readonly string[]): Readonly<Record<string, t.FieldState>> {
  const data = useContext(ConfigValuesContext);
  return useMemo(
    () => Object.fromEntries(paths.map((path) => [path, deriveFieldState(path, data)])),
    [paths, data],
  );
}
