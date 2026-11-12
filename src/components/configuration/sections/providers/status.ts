import { EModelEndpoint } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  editsAzureGroups,
  BUNDLED_CONFIG_FEATURES,
  PROVIDER_CREDENTIALS_KEYS,
  AZURE_GROUP_CREDENTIALS_KEY,
  CATALOG_ENDPOINT_REASON_KEYS,
} from '@/constants';

/**
 * A provider's runtime status from `/api/endpoints` (AP-5): served (with the
 * server's credentials, or each user's), not enabled (left out of the list),
 * or unknown while the list is missing. Where the panel edits Azure groups
 * (`editsAzureGroups`), their keys can be stored here too.
 */
export function providerStatus(
  provider: string,
  endpoints: t.EndpointStatusMap | undefined,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): t.ProviderStatusInfo {
  const credentialsKey =
    provider === EModelEndpoint.azureOpenAI && editsAzureGroups(features)
      ? AZURE_GROUP_CREDENTIALS_KEY
      : PROVIDER_CREDENTIALS_KEYS[provider];
  if (!endpoints) return { kind: 'unknown', credentialsKey };
  const entry = endpoints[provider];
  if (!entry) return { kind: 'disabled', credentialsKey };
  return { kind: entry.userProvide ? 'userProvided' : 'active', credentialsKey };
}

/** Locale keys of a status kind's label and explanation. */
export const STATUS_KEYS: Readonly<Record<t.ProviderStatusKind, { label: string; desc: string }>> =
  {
    active: {
      label: 'com_config_providers_status_active',
      desc: 'com_config_providers_status_active_desc',
    },
    userProvided: {
      label: 'com_config_providers_status_userProvided',
      desc: 'com_config_providers_status_userProvided_desc',
    },
    disabled: {
      label: 'com_config_providers_status_disabled',
      desc: 'com_config_providers_status_disabled_desc',
    },
    unknown: {
      label: 'com_config_providers_status_unknown',
      desc: 'com_config_providers_status_unknown_desc',
    },
  };

/**
 * Locale key of a status kind's explanation: for a provider the scope catalog
 * says is not served, why (`ENDPOINTS` leaves it out, or its credentials are
 * missing); else the kind's own.
 */
export function statusDescriptionKey(
  kind: t.ProviderStatusKind,
  catalogEntry: t.CatalogEndpoint | undefined,
): string {
  if (kind === 'disabled' && catalogEntry?.reason) {
    return CATALOG_ENDPOINT_REASON_KEYS[catalogEntry.reason];
  }
  return STATUS_KEYS[kind].desc;
}
