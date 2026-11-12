import { createContext } from 'react';
import type * as t from '@/types';

const NO_RENAMES: t.EntryRenames = { renames: {}, copies: {} };

/**
 * The record entries the pending edits rename or duplicate (`renameEdits`,
 * `copyEdits`): the MCP servers editor reads which saved server each one
 * comes from out of the edit state itself, so a rename survives Discard →
 * Undo, and goes with edits taken back from outside the editor.
 */
export const RenamesContext = createContext<t.EntryRenames>(NO_RENAMES);
