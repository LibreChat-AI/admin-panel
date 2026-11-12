import type * as t from '@/types';
import { RATE_LIMITERS } from '@/constants';

const SKILL_SOURCE_FIELDS = [
  'id',
  'owner',
  'repo',
  'ref',
  'paths',
  'skillDiscoveryDepth',
  'credentialKey',
  'token',
  'tenantId',
];

/** Runtime defaults of every limiter, including agent events (per user only). */
function rateLimitMeta(): t.FieldMetaRegistry {
  const entries: t.FieldMetaRegistry = {};
  for (const limiter of RATE_LIMITERS) {
    for (const [field, value] of Object.entries(limiter.defaults)) {
      entries[`rateLimits.${limiter.key}.${field}`] = { runtimeDefault: value };
    }
  }
  return entries;
}

function skillSourceMeta(): t.FieldMetaRegistry {
  const entries: t.FieldMetaRegistry = {
    'skillSync.github': { order: ['enabled', 'intervalMinutes', 'runOnStartup', 'sources'] },
    'skillSync.github.sources': { labelKey: 'com_config_skillsync_sources' },
    'skillSync.github.sources[]': { order: SKILL_SOURCE_FIELDS },
  };
  for (const key of SKILL_SOURCE_FIELDS) {
    const path = `skillSync.github.sources[].${key}`;
    entries[path] = {
      ...entries[path],
      labelKey: `com_config_skillsync_source_${key}`,
      descriptionKey: `com_config_skillsync_source_${key}_desc`,
    };
  }
  return entries;
}

/**
 * System tab field metadata (WS14): plain-language balance labels, sign-up
 * domains whose empty list is a value (anyone can sign up), rate-limit
 * defaults for every limiter, and skill sync source fields.
 */
export const SYSTEM_FIELD_META: t.FieldMetaRegistry = {
  ...rateLimitMeta(),
  ...skillSourceMeta(),
  'balance.enabled': { labelKey: 'com_config_credits_enabled' },
  'balance.startBalance': { labelKey: 'com_config_credits_start' },
  'balance.autoRefillEnabled': { labelKey: 'com_config_credits_auto_refill' },
  'balance.refillAmount': { labelKey: 'com_config_credits_refill_amount' },
  'balance.refillIntervalValue': { labelKey: 'com_config_credits_refill_every' },
  'balance.refillIntervalUnit': { labelKey: 'com_config_credits_refill_unit' },
  'balance.reservationTtlMs': { labelKey: 'com_config_credits_reservation' },
  'balance.refillMode': { labelKey: 'com_config_credits_refill_mode' },
  'balance.display': { labelKey: 'com_config_credits_display' },
  'transactions.enabled': { labelKey: 'com_config_credits_transactions' },
  'registration.allowedDomains': { emptyListIsValue: true },
};
