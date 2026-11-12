import type * as t from '@/types';
import { lowerSource } from '@/utils';

const usdFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** A dollar amount for a credit figure's hint ("$1.00", "$0.02"). */
export function formatUsd(amount: number): string {
  return usdFormat.format(amount);
}

/** Layers whose value is a setting someone made (shown as the value), not a default (a placeholder). */
const SETTING_SOURCES: ReadonlySet<t.ProvenanceSource> = new Set([
  'yaml',
  'inherited',
  'admin',
  'scope',
]);

/**
 * What an input shows for a field: its own value, else a value librechat.yaml
 * or Base sets (as the value, like the generic rows), with a default only as
 * the placeholder.
 */
export function inputValues(field: t.OwnedField): {
  value: t.ConfigValue;
  placeholder: t.ConfigValue;
} {
  if (field.own !== undefined) return { value: field.own, placeholder: field.fallback };
  if (SETTING_SOURCES.has(lowerSource(field.state))) {
    return { value: field.fallback, placeholder: undefined };
  }
  return { value: undefined, placeholder: field.fallback };
}
