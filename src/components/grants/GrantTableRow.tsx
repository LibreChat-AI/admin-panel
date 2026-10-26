import type * as t from '@/types';
import { StatusPill, TypeBadge } from '@/components/shared';
import { useLocalize } from '@/hooks';

export function GrantTableRow({ row, onClick, onKeyDown, rowRef }: t.GrantTableRowProps) {
  const localize = useLocalize();

  return (
    <tr
      ref={rowRef}
      tabIndex={0}
      role="button"
      aria-label={localize('com_cap_edit_title', { name: row.name })}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td>
        <span className="flex items-center gap-2.5">
          <TypeBadge type={row.principalType} />
          <span className="font-semibold text-ink">{row.name}</span>
        </span>
      </td>
      <td className="text-muted tabular-nums">
        {row.grantCount === 0
          ? localize('com_grants_no_capabilities')
          : localize('com_grants_capability_count', { count: row.grantCount })}
      </td>
      <td>
        <StatusPill
          tone={row.isActive ? 'success' : 'danger'}
          label={row.isActive ? localize('com_ui_active') : localize('com_ui_paused')}
        />
      </td>
    </tr>
  );
}
