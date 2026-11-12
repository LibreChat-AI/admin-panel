import { createContext } from 'react';
import type * as t from '@/types';

/**
 * Extra chips for the field rows of a collection entry (Edited with Undo,
 * an admin override with Revert), provided by a collection editor such as
 * the custom endpoint editor (WS10). Null: entry rows show no such chips.
 */
export const EntryFieldChipsContext = createContext<t.EntryFieldChipsRenderer | null>(null);
