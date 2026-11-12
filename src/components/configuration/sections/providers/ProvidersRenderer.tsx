import { useContext } from 'react';
import type * as t from '@/types';
import { isPathSet, countConfigured, hasPendingValue } from '../../counts';
import { CUSTOM_KEY, NETWORK_KEY, providerFields } from './layout';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { NetworkAccessCard } from './NetworkAccess';
import { FieldRenderer } from '../../renderer';
import { isRowVisible } from '@/utils';
import { ProviderCard } from './Card';

/**
 * AI providers tab (WS9): Global overrides pinned first (AP-3), one card per
 * built-in provider grouped by purpose (AP-4), then the Network access card
 * (AP-7). Endpoint-wide settings the panel does not know yet render as plain
 * rows below, so the tab stays schema-driven; keys the schema doesn't know
 * are listed read-only (D8).
 */
export function ProvidersRenderer(props: t.FieldRendererProps) {
  const { fields, ...shared } = props;
  const { parentPath, showConfiguredOnly, configuredPaths, editedValues } = shared;
  const rowFilter = useContext(RowFilterContext);

  const providers = providerFields(fields).filter((field) =>
    isRowVisible(rowFilter, `${parentPath}.${field.key}`),
  );

  const visibleProviders = showConfiguredOnly
    ? providers.filter((field) => {
        const path = `${parentPath}.${field.key}`;
        return (
          hasPendingValue(path, editedValues) ||
          countConfigured(field.children ?? [], path, configuredPaths).configured > 0
        );
      })
    : providers;

  const network = fields.find((field) => field.key === NETWORK_KEY);
  const others = fields.filter(
    (field) =>
      field.key !== CUSTOM_KEY &&
      field.key !== NETWORK_KEY &&
      !field.children?.length &&
      (!showConfiguredOnly ||
        isPathSet(`${parentPath}.${field.key}`, configuredPaths, editedValues)),
  );

  return (
    <div className="flex flex-col gap-4">
      {visibleProviders.map((field) => (
        <ProviderCard key={field.key} field={field} {...shared} />
      ))}
      {network && <NetworkAccessCard field={network} {...shared} />}
      {others.length > 0 && <FieldRenderer {...shared} fields={others} />}
      {!rowFilter && (
        <UnknownSettings fields={fields} value={shared.parentValue} path={parentPath} />
      )}
    </div>
  );
}
