import type * as t from '@/types';

/**
 * Field metadata of custom endpoints (WS10): the one value of `provider`
 * read as what it does. Help text uses the derived
 * `com_config_desc_endpoints_custom_*` keys.
 */
export const ENDPOINT_FIELD_META: t.FieldMetaRegistry = {
  'endpoints.custom[].provider': {
    enumLabels: { anthropic: 'com_config_ce_provider_anthropic' },
  },
};
