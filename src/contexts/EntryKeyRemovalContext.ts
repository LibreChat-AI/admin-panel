import { createContext } from 'react';
import type * as t from '@/types';

/**
 * The record fields of the open collection entry whose inherited keys can
 * be removed one by one (`keyedTombstones`), provided by the entry's editor
 * (the custom endpoint editor). Null: inherited keys stay locked (D3).
 */
export const EntryKeyRemovalContext = createContext<t.EntryKeyRemoval | null>(null);
