import { useCallback } from 'react';
import type * as t from '@/types';
import { lowerValue, ownValue } from '@/utils';
import { useFieldState } from './field';

/**
 * A field an area renderer edits with its own control: its state, its own
 * value, the value it falls back to, and `set`, which stages a value or (with
 * `undefined`) removes the own value: the saved override's removal, or the
 * pending edit's discard. `set(undefined)` returns false when there was
 * nothing of the target's own to remove (D3).
 */
export function useOwnedField(path: string, fieldProps: t.FieldRendererProps): t.OwnedField {
  const state = useFieldState(path);
  const { onChange, onDiscardField, editedValues } = fieldProps;
  const hasPendingEdit = editedValues ? path in editedValues : false;
  const set = useCallback(
    (next: t.ConfigValue): boolean => {
      if (next !== undefined) {
        onChange(path, next);
        return true;
      }
      if (state.isOverride) {
        onChange(path, undefined);
        return true;
      }
      if (!hasPendingEdit) return false;
      if (onDiscardField) onDiscardField(path);
      else onChange(path, undefined);
      return true;
    },
    [path, onChange, onDiscardField, state.isOverride, hasPendingEdit],
  );
  return { path, state, own: ownValue(state), fallback: lowerValue(state), set };
}
