import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const PAGE_PILL =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[13px] font-semibold tabular-nums';

export function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis')[] = [1];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(total - 1, current + 1);
  if (windowStart > 2) pages.push('ellipsis');
  for (let i = windowStart; i <= windowEnd; i++) pages.push(i);
  if (windowEnd < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

export function Pagination({ currentPage, totalPages, onPageChange }: t.PaginationProps) {
  const localize = useLocalize();
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={localize('com_a11y_pagination')}
      className="flex items-center justify-center gap-1 py-2"
    >
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label={localize('com_a11y_previous_page')}
        className="aimo-icon-btn border border-accent text-link hover:bg-soft-blue"
      >
        <Icon name="chevron-left" size="sm" />
      </button>
      {getPageNumbers(currentPage, totalPages).map((page, i) =>
        page === 'ellipsis' ? (
          <span key={`ellipsis-${i}`} aria-hidden="true" className={cn(PAGE_PILL, 'text-muted')}>
            …
          </span>
        ) : (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            aria-label={localize('com_a11y_page_n', { page })}
            aria-current={page === currentPage ? 'page' : undefined}
            className={cn(
              PAGE_PILL,
              'cursor-pointer transition-colors',
              page === currentPage ? 'bg-accent text-white' : 'text-ink hover:bg-fill',
            )}
          >
            {page}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label={localize('com_a11y_next_page')}
        className="aimo-icon-btn border border-accent text-link hover:bg-soft-blue"
      >
        <Icon name="chevron-right" size="sm" />
      </button>
    </nav>
  );
}
