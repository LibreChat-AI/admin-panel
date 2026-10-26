import type * as t from '@/types';

export function EmptyState({ message, className }: t.EmptyStateProps) {
  return <div className={className ?? 'px-4 py-10 text-center text-sm text-muted'}>{message}</div>;
}
