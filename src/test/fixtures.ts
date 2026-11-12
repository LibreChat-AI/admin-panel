import type * as t from '@/types';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';

export function createField(overrides: Partial<t.SchemaField> & { key: string }): t.SchemaField {
  return {
    path: overrides.path ?? overrides.key,
    type: 'string',
    isOptional: false,
    isNullable: false,
    isArray: false,
    isObject: false,
    depth: 0,
    ...overrides,
  };
}

/**
 * The contract of a server that reports `GET /api/admin/config/meta`, with
 * the given features on and rules changed; every other part is the bundled one.
 */
export function createServerContract(
  features: Partial<t.ConfigFeatures> = {},
  rules: Partial<t.ConfigRules> = {},
): t.ConfigContract {
  return {
    source: 'server',
    features: { ...BUNDLED_CONFIG_CONTRACT.features, ...features },
    limits: BUNDLED_CONFIG_CONTRACT.limits,
    rules: { ...BUNDLED_CONFIG_CONTRACT.rules, ...rules },
  };
}
