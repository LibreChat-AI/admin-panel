import { createContext } from 'react';
import type * as t from '@/types';

const NO_COLLECTION_EDITS: t.CollectionEdits = {};

/**
 * The page's pending keyed-collection edits (WS1 `collectionEdits`): which
 * loaded entry each pending item came from, and the loaded entries a pending
 * edit took out. Collection editors read it to show pending deletions (with
 * Undo) and renames from the edit state itself, so they survive Discard →
 * Undo and edits made from outside the editor (WS10).
 */
export const CollectionEditsContext = createContext<t.CollectionEdits>(NO_COLLECTION_EDITS);
