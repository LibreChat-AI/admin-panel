import { createContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { configContractOptions } from '@/server';

/**
 * The connected LibreChat server's admin config contract. Outside the
 * provider, and until the server's has loaded, it is the bundled contract:
 * every behaviour as it was before servers reported one.
 */
export const ConfigContractContext = createContext<t.ConfigContract>(BUNDLED_CONFIG_CONTRACT);

/** Reads the server's contract once for the whole app (see `getAdminConfigMetaFn`). */
export function ConfigContractProvider({ children }: t.ConfigContractProviderProps) {
  const { data } = useQuery(configContractOptions);
  return (
    <ConfigContractContext.Provider value={data ?? BUNDLED_CONFIG_CONTRACT}>
      {children}
    </ConfigContractContext.Provider>
  );
}
