import { useContext } from 'react';
import type * as t from '@/types';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { useFieldState } from './field';

/** librechat.yaml as LibreChat loaded it (no admin overrides), or null outside the page. */
export function useYamlConfig(): t.ConfigRecord | null {
  return useContext(ConfigValuesContext)?.layers?.yamlEffective ?? null;
}

/** Field states of `fileStrategy` and every `fileStrategies` key (FX-6). */
export function useStorageStates(): t.StorageFieldStates {
  return {
    primary: useFieldState('fileStrategy'),
    default: useFieldState('fileStrategies.default'),
    avatar: useFieldState('fileStrategies.avatar'),
    image: useFieldState('fileStrategies.image'),
    document: useFieldState('fileStrategies.document'),
    skills: useFieldState('fileStrategies.skills'),
  };
}
