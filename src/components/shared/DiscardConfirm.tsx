import { useEffect, useRef } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/**
 * A create form's footer while closing would throw away what was typed:
 * "Discard this new …?" with Keep editing (focused, so a stray Escape or
 * Enter loses nothing) and Discard.
 */
export function DiscardConfirm({ message, onKeep, onDiscard }: t.DiscardConfirmProps) {
  const localize = useLocalize();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="alert"
      className="flex w-full flex-wrap items-center justify-between gap-2"
    >
      <span className="text-sm text-(--cui-color-text-default)">{message}</span>
      <div className="ms-auto flex items-center gap-2">
        <Button
          type="secondary"
          htmlType="button"
          label={localize('com_ui_keep_editing')}
          onClick={onKeep}
        />
        <Button
          type="danger"
          htmlType="button"
          label={localize('com_ui_discard')}
          onClick={onDiscard}
        />
      </div>
    </div>
  );
}
