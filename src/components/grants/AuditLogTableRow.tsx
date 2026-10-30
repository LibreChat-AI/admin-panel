import { Badge } from '@clickhouse/click-ui';
import type * as t from '@/types';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  auditSubject,
  auditTargetConfig,
  formatTimestamp,
} from './auditLogUtils';
import { DecorativeIcon } from '@/components/shared';
import { ROW, ROW_BUTTON } from './rows';
import { useLocalize, useLanguage } from '@/hooks';
import { cn } from '@/utils';

/** One audit entry; its target's name is the button that opens the entry's drawer. */
export function AuditLogTableRow({ entry, isLast, onOpen, buttonRef }: t.AuditLogTableRowProps) {
  const localize = useLocalize();
  const { language } = useLanguage();
  const targetConfig = auditTargetConfig(entry.target.type);
  const subject = auditSubject(entry, localize);
  const target = entry.target.name ?? entry.target.id ?? '';
  return (
    <tr className={cn(ROW, !isLast && 'border-b border-(--cui-color-stroke-default)')}>
      <td className="px-4 py-3">
        <Badge
          size="sm"
          state={ACTION_BADGE_STATE[entry.action]}
          text={localize(ACTION_LABEL_KEY[entry.action])}
        />
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-2">
          <Badge
            size="sm"
            state="neutral"
            text={
              <span className="inline-flex items-center gap-1">
                <DecorativeIcon name={targetConfig.icon} size="xs" />
                {localize(targetConfig.labelKey)}
              </span>
            }
          />
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="dialog"
            aria-label={localize('com_a11y_audit_row_open', { target })}
            onClick={onOpen}
            className={cn(ROW_BUTTON, 'text-(--cui-color-text-default)')}
          >
            {target}
          </button>
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="text-(--cui-color-text-default)">{subject.label}</span>
          <span aria-hidden="true" className="text-[10px] text-(--cui-color-text-muted)">
            {subject.value}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-(--cui-color-text-default)">{entry.actor.name}</td>
      <td className="px-4 py-3 text-xs whitespace-nowrap text-(--cui-color-text-muted)">
        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp, language)}</time>
      </td>
    </tr>
  );
}
