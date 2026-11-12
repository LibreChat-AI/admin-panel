import type * as t from '@/types';
import { OverrideCount } from '@/components/shared';
import { useLocalize } from '@/hooks';

/**
 * "3 set" beside a provider or group title (AP-10): how many settings have a
 * value from librechat.yaml or the panel (the tooltip says so), plus the blue
 * "N override" count of admin overrides among them. Nothing when none is set.
 */
export function SetBadge({ count, overrides = 0 }: t.SetBadgeProps) {
  const localize = useLocalize();
  if (count <= 0) return null;
  const label = localize('com_config_providers_customized', { count });
  return (
    <>
      <span
        className="config-count-badge config-count-badge-active"
        title={localize('com_config_providers_customized_desc', { count })}
      >
        <span className="sr-only">, </span>
        {label}
      </span>
      {overrides > 0 && <OverrideCount count={overrides} />}
    </>
  );
}
