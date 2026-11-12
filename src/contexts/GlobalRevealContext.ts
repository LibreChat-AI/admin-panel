import { createContext } from 'react';

/**
 * Opens a Global overrides (`endpoints.all`) setting: the configuration page
 * provides it, so an "Overridden by Global" chip on any tab (a provider card,
 * a custom endpoint) links to the setting that wins (D11). Without a provider
 * the chip has no link.
 */
export const GlobalRevealContext = createContext<((path: string) => void) | null>(null);
