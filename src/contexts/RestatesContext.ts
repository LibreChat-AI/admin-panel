import { createContext } from 'react';
import type * as t from '@/types';

const NO_RESTATES: t.RestatesContextValue = { restates: {} };

/**
 * The inherited credentials the pending edits restate (`restate` change):
 * editors whose overrides move a `${VAR}` credential the layer beneath holds
 * offer to send it to the new destination too. Without a provider nothing is
 * restated, and nothing can be.
 */
export const RestatesContext = createContext<t.RestatesContextValue>(NO_RESTATES);
