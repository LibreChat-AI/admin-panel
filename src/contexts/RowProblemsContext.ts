import { createContext } from 'react';
import type * as t from '@/types';

/**
 * Where a key/value editor reports the rows it can't save as typed (a blank,
 * missing, repeated or dotted key). A create dialog listens, keeping Create
 * disabled and saying what to fix; elsewhere nothing does, and the save
 * pre-flight reports what was committed.
 */
export const RowProblemsContext = createContext<t.RowProblemReporter | null>(null);
