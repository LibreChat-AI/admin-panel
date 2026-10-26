import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function LoadingState({ className }: t.LoadingStateProps) {
  const localize = useLocalize();

  return (
    <div className={className ?? 'flex items-center justify-center gap-2 py-12 text-sm text-muted'}>
      <Icon name="loading-animated" size="sm" />
      {localize('com_ui_loading')}
    </div>
  );
}
