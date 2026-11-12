import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import {
  mimeListKind,
  getValueAtPath,
  mimeEndpointKey,
  DEFAULT_MIME_LISTS,
  usesDefaultEntryList,
  isStringList,
} from '@/utils';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';

const DEFAULT_ENTRY_LIST = 'fileConfig.endpoints.default.supportedMimeTypes';

/**
 * The MIME list a field uses while it has no list of its own (FX-7): the
 * layer beneath (librechat.yaml, or Base in a profile) when it sets one, else
 * what LibreChat falls back to: the Default entry's list for endpoints that
 * use it, or LibreChat's built-in list.
 */
export function useInheritedMimeList(
  path: string,
  fieldDefault: t.FieldDefault,
): t.InheritedMimeList {
  const values = useContext(ConfigValuesContext);
  const root = values?.configValues ?? values?.layers?.effective ?? null;
  const defaultEntryList = getValueAtPath(root, DEFAULT_ENTRY_LIST);
  return useMemo((): t.InheritedMimeList => {
    if (isStringList(fieldDefault.value)) {
      return { patterns: fieldDefault.value, origin: fieldDefault.source };
    }
    const kind = mimeListKind(path) ?? 'endpoint';
    const endpointKey = mimeEndpointKey(path);
    if (
      kind === 'endpoint' &&
      endpointKey &&
      usesDefaultEntryList(endpointKey) &&
      isStringList(defaultEntryList)
    ) {
      return { patterns: defaultEntryList, origin: 'defaultEntry' };
    }
    return { patterns: [...DEFAULT_MIME_LISTS[kind]], origin: 'runtimeDefault' };
  }, [path, fieldDefault.value, fieldDefault.source, defaultEntryList]);
}
