import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { InfoBanner } from './InfoBanner';
import { useLocalize } from '@/hooks';

/**
 * Explains why a field is read-only because LibreChat only applies it from
 * librechat.yaml (`kind` `startup`: reads it only while it starts; `count`: the
 * settings below it the notice covers). When the edit target still holds an
 * override for them (written before they became read-only), offers to queue
 * its removal.
 */
export function ManagedNotice({
  kind = 'yaml',
  count = 1,
  hasOverride,
  pendingRemoval,
  onRemoveOverride,
}: t.ManagedNoticeProps) {
  const localize = useLocalize();
  const text = {
    startup: localize('com_config_startup_only_field', { count }),
    baseOnly: localize('com_config_base_only_field', { count }),
    yaml: localize('com_config_yaml_managed_field'),
  }[kind];
  return (
    <div className="mb-2 flex flex-col gap-2">
      <InfoBanner text={text} dismissible={false} />
      {hasOverride && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-xs text-(--cui-color-text-default)"
        >
          <span className="flex-1">
            {localize(
              pendingRemoval ? 'com_config_stale_override_pending' : 'com_config_stale_override',
            )}
          </span>
          {onRemoveOverride && !pendingRemoval && (
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_config_remove_stale_override')}
              onClick={onRemoveOverride}
            />
          )}
        </div>
      )}
    </div>
  );
}
