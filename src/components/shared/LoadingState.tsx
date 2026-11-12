import type * as t from '@/types';
import { DecorativeIcon } from './DecorativeIcon';
import { useLocalize } from '@/hooks';

export function LoadingState({ className }: t.LoadingStateProps) {
  const localize = useLocalize();

  return (
    <div
      role="status"
      className={
        className ??
        'flex items-center justify-center gap-2 py-12 text-sm text-(--cui-color-text-muted)'
      }
    >
      <DecorativeIcon name="loading-animated" size="sm" />
      {localize('com_ui_loading')}
    </div>
  );
}
