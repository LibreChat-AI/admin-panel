import { Badge } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { ROW, ROW_BUTTON } from './rows';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function GrantTableRow({ row, isLast, onOpen, buttonRef }: t.GrantTableRowProps) {
  const localize = useLocalize();

  return (
    <tr className={cn(ROW, !isLast && 'border-b border-(--cui-color-stroke-default)')}>
      <td className="px-4 py-3 font-medium text-(--cui-color-text-default)">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={localize('com_cap_edit_title', { name: row.name })}
          onClick={onOpen}
          className={ROW_BUTTON}
        >
          {row.name}
        </button>
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">
        {row.grantCount === 0
          ? localize('com_grants_no_capabilities')
          : localize('com_grants_capability_count', { count: row.grantCount })}
      </td>
      <td className="px-4 py-3">
        <Badge
          size="sm"
          state={row.isActive ? 'success' : 'danger'}
          text={row.isActive ? localize('com_ui_active') : localize('com_ui_paused')}
        />
      </td>
    </tr>
  );
}
