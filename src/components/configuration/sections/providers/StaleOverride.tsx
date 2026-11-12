import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/** The notice's text and button for each state of the override (`StaleOverrideState`). */
const TEXT_KEYS: Readonly<Record<t.StaleOverrideState, t.StaleOverrideTextKeys>> = {
  stale: {
    shown: 'com_config_providers_azure_stale',
    pending: 'com_config_stale_override_pending',
    remove: 'com_config_remove_stale_override',
  },
  inert: {
    shown: 'com_config_providers_azure_stale_merge',
    pending: 'com_config_stale_override_pending',
    remove: 'com_config_remove_stale_override',
  },
  applied: {
    shown: 'com_config_providers_azure_override_applied',
    pending: 'com_config_providers_azure_override_pending',
    remove: 'com_config_remove_azure_override',
  },
};

/**
 * A stored Azure groups override while the panel can't edit groups (D13,
 * HF-9). Before `azureGroupSecrets` LibreChat does not apply it: it has no
 * effect today but would take over once LibreChat re-processes overrides
 * (`stale`). A server that merges groups by `group` but leaves overrides
 * inert until its operator turns re-derivation on (`inert`) would merge it
 * into the groups beneath then. One that applies it (`applied`) replaces the
 * groups beneath with it. Either way it can be queued for removal. Where
 * LibreChat derives groups again, the editor shows the override itself.
 */
export function StaleOverride({ pendingRemoval, onRemove, state }: t.StaleOverrideProps) {
  const localize = useLocalize();
  const keys = TEXT_KEYS[state];
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-default)"
    >
      <span className="flex-1">{localize(pendingRemoval ? keys.pending : keys.shown)}</span>
      {onRemove && !pendingRemoval && (
        <Button
          htmlType="button"
          type="secondary"
          label={localize(keys.remove)}
          onClick={onRemove}
        />
      )}
    </div>
  );
}
