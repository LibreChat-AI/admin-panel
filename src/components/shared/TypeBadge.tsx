import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';

export function TypeBadge({ type }: t.TypeBadgeProps) {
  const localize = useLocalize();
  const config = getScopeTypeConfig(type);

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap text-ink2">
      <span aria-hidden="true" className="inline-flex" style={{ color: config.color }}>
        <Icon name={config.icon} width="11px" height="11px" />
      </span>
      {localize(config.labelKey)}
    </span>
  );
}
