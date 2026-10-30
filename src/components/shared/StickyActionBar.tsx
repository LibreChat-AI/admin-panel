import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';

export function StickyActionBar({
  discardLabel,
  saveLabel,
  onDiscard,
  onSave,
  message,
  label,
}: t.StickyActionBarProps) {
  return (
    <div
      role="region"
      aria-label={label}
      className="flex shrink-0 animate-[slideUp_200ms_ease-out] flex-wrap items-center gap-2 border-t border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-6 py-3"
    >
      {message && (
        <span className="min-w-0 flex-1 text-sm text-(--cui-color-text-default)">{message}</span>
      )}
      <div className="ms-auto flex items-center gap-2">
        <Button htmlType="button" type="secondary" label={discardLabel} onClick={onDiscard} />
        <Button htmlType="button" type="primary" label={saveLabel} onClick={onSave} />
      </div>
    </div>
  );
}
