import type * as t from '@/types';

/** Message of each `allowedAddresses` entry problem (AP-7). */
export const ADDRESS_ISSUE_KEYS: Readonly<Record<t.AddressIssue, string>> = {
  empty: 'com_config_providers_network_issue_empty',
  url: 'com_config_providers_network_issue_url',
  port: 'com_config_providers_network_issue_port',
  public: 'com_config_providers_network_issue_public',
  format: 'com_config_providers_network_issue_format',
};
