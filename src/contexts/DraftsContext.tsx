import { createContext } from 'react';
import type * as t from '@/types';

/** Local input belongs to the configuration page's existing session recovery. */
export const DraftsContext = createContext<t.ConfigDraftContextValue | null>(null);
