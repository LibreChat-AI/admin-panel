import type * as t from '@/types';
import {
  useLocalize,
  useEndpointModels,
  useConfigFeatures,
  useEndpointStatus,
  useCatalogEndpoint,
} from '@/hooks';
import { STATUS_KEYS, providerStatus, statusDescriptionKey } from './status';
import { EnvStatusNote } from '../../fields/EnvStatus';

/**
 * Active / Not enabled badge of a provider card header (AP-5), from the edit
 * target's scope catalog (`catalogApi`) or `/api/endpoints`. Nothing while
 * the status loads; the explanation and the controlling environment
 * variables are in its tooltip and the card's status row.
 */
export function ProviderStatusBadge({ provider }: t.ProviderStatusBadgeProps) {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const { data, isLoading, isError } = useEndpointStatus();
  const catalogEntry = useCatalogEndpoint(provider);
  if (isLoading || (!data && !isError)) return null;
  const status = providerStatus(provider, data, features);
  const keys = STATUS_KEYS[status.kind];
  const descKey = statusDescriptionKey(status.kind, catalogEntry);
  const hint = [localize(descKey), status.credentialsKey && localize(status.credentialsKey)]
    .filter(Boolean)
    .join(' ');
  return (
    <span className="provider-status" data-status={status.kind} title={hint}>
      <span className="provider-status-dot" aria-hidden="true" />
      <span className="sr-only">, </span>
      {localize(keys.label)}
    </span>
  );
}

/**
 * The "Status" row at the top of a provider card (AP-5, "Status &
 * credentials"): whether LibreChat serves the provider to the edit target's
 * users, where its credentials come from, and how many models it offers.
 * With the scope catalog (`catalogApi`) a provider that is not served says
 * why, and with `envStatus` each environment variable it reads says whether
 * the server has it set. Built-in providers take their credentials from the
 * server environment, so this is read-only.
 */
export function ProviderStatusRow({ provider }: t.ProviderStatusRowProps) {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const { data, isError } = useEndpointStatus();
  const models = useEndpointModels();
  const catalogEntry = useCatalogEndpoint(provider);
  const status = providerStatus(provider, data, features);
  const keys = STATUS_KEYS[status.kind];
  const descKey = statusDescriptionKey(status.kind, catalogEntry);
  const modelCount = models.data?.[provider]?.length;
  const showsCount = modelCount != null && modelCount > 0 && status.kind !== 'disabled';
  const loading = !data && !isError;

  return (
    <div className="settings-row provider-status-row">
      <div className="settings-row-label">
        <span className="settings-label">{localize('com_config_providers_status_label')}</span>
      </div>
      <div className="settings-row-control" data-width="L">
        <p className="m-0 flex flex-col gap-1 text-sm text-(--cui-color-text-default)">
          {!loading && (
            <span>
              <span className="provider-status" data-status={status.kind}>
                <span className="provider-status-dot" aria-hidden="true" />
                {localize(keys.label)}
              </span>
              {status.kind !== 'active' && (
                <span className="text-(--cui-color-text-muted)"> {localize(descKey)}</span>
              )}
            </span>
          )}
          {status.credentialsKey && (
            <span className="settings-help m-0">{localize(status.credentialsKey)}</span>
          )}
          {showsCount && (
            <span className="settings-help m-0">
              {localize('com_config_providers_status_models', { count: modelCount })}
            </span>
          )}
          {status.kind === 'disabled' && !catalogEntry?.reason && (
            <span className="settings-help m-0">
              {localize('com_config_providers_status_endpoints_note')}
            </span>
          )}
        </p>
        {catalogEntry && catalogEntry.envVars.length > 0 && (
          <EnvStatusNote names={catalogEntry.envVars} optional />
        )}
      </div>
    </div>
  );
}
