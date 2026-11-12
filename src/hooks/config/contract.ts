import { useContext, useCallback } from 'react';
import type * as t from '@/types';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { useLocalize } from '../useLocalize';
import { getWriteRules } from '@/constants';
import { isUnsafeConfigKey } from '@/utils';

/** The connected server's admin config contract (the bundled one until it loads, or without one). */
export function useConfigContract(): t.ConfigContract {
  return useContext(ConfigContractContext);
}

/** Which admin config behaviours the connected server has (all off for an older server). */
export function useConfigFeatures(): t.ConfigFeatures {
  return useContext(ConfigContractContext).features;
}

/** Where the panel may write on the connected server: read-only sections and librechat.yaml-only fields. */
export function useConfigWriteRules(): t.ConfigWriteRules {
  return getWriteRules(useContext(ConfigContractContext));
}

/**
 * Why a record key can't be saved, or null: a key the admin API would drop
 * (`$`-prefixed, a prototype name, and before `dottedKeys` any key with a dot).
 */
export function useConfigKeyProblem(): (key: string) => string | null {
  const localize = useLocalize();
  const { dottedKeys } = useConfigFeatures();
  return useCallback(
    (key: string) => {
      if (!isUnsafeConfigKey(key, dottedKeys)) return null;
      return localize(dottedKeys ? 'com_config_reserved_key_error' : 'com_config_unsafe_key_error');
    },
    [dottedKeys, localize],
  );
}
