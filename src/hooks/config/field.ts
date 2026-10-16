import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { deriveFieldState } from '@/utils';

/**
 * State of one field (value, effective value, provenance, edit flags) from the
 * nearest `ConfigValuesProvider` (WS4; consumed by WS3, WS6 and WS9–13).
 * Outside a provider it returns an empty default state.
 */
export function useFieldState(path: string): t.FieldState {
  const data = useContext(ConfigValuesContext);
  return useMemo(() => deriveFieldState(path, data), [path, data]);
}
