import { createContext, useContext } from 'react';
import type * as t from '@/types';

/** The spec list an editor or summary belongs to (its items, problems, options and actions). */
export const SpecListContext = createContext<t.SpecListContextValue | null>(null);

export function useSpecList(): t.SpecListContextValue {
  const value = useContext(SpecListContext);
  if (!value) throw new Error('useSpecList must be used inside a spec list');
  return value;
}

/** Position of a spec from its data path (`modelSpecs.list.3` → 3). */
export function specIndexOf(path: string): number {
  return Number(path.slice(path.lastIndexOf('.') + 1));
}
