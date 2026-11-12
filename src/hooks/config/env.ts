import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import { collectEnvReferences, readEnvReferences } from '@/utils';
import { useLiveQueryClient } from './options';
import { useConfigFeatures } from './contract';
import { envStatusOptions } from '@/server';

const NO_REFERENCES: t.EnvReference[] = [];
const NO_NAMES: readonly string[] = [];

/**
 * How each `${NAME}` a value at `path` references reads on the server, plus
 * `names` (env names the setting at `path` reads without a reference, such as
 * a provider's credentials): set, empty, `user_provided`, outside the
 * server's override allowlist (`envAllowlist`) or not reported. Empty on a
 * server without `envStatus`, while the status loads, and for a value that
 * references nothing; the status is fetched once for the page, and only once
 * some value references a name.
 */
export function useEnvReferences(
  value: t.ConfigValue,
  path = '',
  names: readonly string[] = NO_NAMES,
): t.EnvReference[] {
  const { envStatus, envAllowlist } = useConfigFeatures();
  const { client, live } = useLiveQueryClient();
  const references = useMemo(() => {
    const collected = collectEnvReferences(value, path);
    for (const name of names) {
      const sites = collected.get(name);
      if (sites) sites.push(path);
      else collected.set(name, [path]);
    }
    return collected;
  }, [value, path, names]);
  const wanted = envStatus && live && references.size > 0;
  const { data } = useQuery({ ...envStatusOptions, enabled: wanted }, client);
  return useMemo(
    () => (wanted && data ? readEnvReferences(references, data, envAllowlist) : NO_REFERENCES),
    [wanted, data, references, envAllowlist],
  );
}
