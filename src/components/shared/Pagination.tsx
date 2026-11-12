import { useLayoutEffect, useRef } from 'react';
import { IconButton, NumberField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

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

/**
 * Previous, page number and Next, as click-ui's Pagination lays them out, with
 * localized names (click-ui names its buttons by their icons and the field by
 * its value). Pressing Previous on the second page or Next on the one before
 * last disables that button, which would drop focus on `<body>`, so focus
 * moves to the other button.
 */
export function Pagination({ currentPage, totalPages, onPageChange }: t.PaginationProps) {
  const localize = useLocalize();
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pressedRef = useRef<HTMLButtonElement | null>(null);
  const atFirst = currentPage <= 1;
  const atLast = currentPage >= totalPages;

  useLayoutEffect(() => {
    const pressed = pressedRef.current;
    pressedRef.current = null;
    if (!pressed?.disabled) return;
    const other = pressed === previousRef.current ? nextRef.current : previousRef.current;
    other?.focus();
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  const goTo = (page: number, pressed: HTMLButtonElement | null) => {
    pressedRef.current = pressed;
    onPageChange(page);
  };

  const handlePageInput = (value: string) => {
    const page = parseInt(value, 10);
    if (Number.isNaN(page) || page < 1 || page > totalPages) return;
    onPageChange(page);
  };

  return (
    <nav
      aria-label={localize('com_a11y_pagination')}
      className="flex w-full items-center justify-center gap-1"
    >
      <IconButton
        ref={previousRef}
        htmlType="button"
        icon="chevron-left"
        type="ghost"
        aria-label={localize('com_a11y_previous_page')}
        disabled={atFirst}
        onClick={() => goTo(currentPage - 1, previousRef.current)}
      />
      <div className="w-12.5">
        <NumberField
          value={currentPage}
          onChange={handlePageInput}
          aria-label={localize('com_a11y_page_of', { page: currentPage, total: totalPages })}
          min={1}
          max={totalPages}
          loading={false}
          hideControls
        />
      </div>
      <span aria-hidden="true" className="text-sm text-(--cui-color-text-muted)">
        {localize('com_ui_page_of_total', { total: totalPages })}
      </span>
      <IconButton
        ref={nextRef}
        htmlType="button"
        icon="chevron-right"
        type="ghost"
        aria-label={localize('com_a11y_next_page')}
        disabled={atLast}
        onClick={() => goTo(currentPage + 1, nextRef.current)}
      />
    </nav>
  );
}
