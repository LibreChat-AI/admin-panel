import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { getPageNumbers, Pagination } from './Pagination';

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => null,
}));

const TRANSLATIONS: Record<string, string> = {
  com_a11y_pagination: 'Pagination',
  com_a11y_previous_page: 'Previous page',
  com_a11y_next_page: 'Next page',
  com_a11y_page_n: 'Page {{page}}',
};

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, opts?: Record<string, string>) => {
    let str = TRANSLATIONS[key] ?? key;
    if (opts) for (const [k, v] of Object.entries(opts)) str = str.replace(`{{${k}}}`, v);
    return str;
  },
  useLocalize: () => (key: string, opts?: Record<string, string | number>) => {
    let str = TRANSLATIONS[key] ?? key;
    if (opts) for (const [k, v] of Object.entries(opts)) str = str.replace(`{{${k}}}`, String(v));
    return str;
  },
}));

describe('getPageNumbers', () => {
  it('returns all pages when total <= 7', () => {
    expect(getPageNumbers(1, 1)).toEqual([1]);
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows right ellipsis when current is near start', () => {
    expect(getPageNumbers(1, 10)).toEqual([1, 2, 'ellipsis', 10]);
  });

  it('shows left ellipsis when current is near end', () => {
    expect(getPageNumbers(10, 10)).toEqual([1, 'ellipsis', 9, 10]);
  });

  it('shows both ellipses when current is in the middle', () => {
    expect(getPageNumbers(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });

  it('suppresses left ellipsis when window touches page 2', () => {
    expect(getPageNumbers(3, 10)).toEqual([1, 2, 3, 4, 'ellipsis', 10]);
  });

  it('suppresses right ellipsis when window touches second-to-last', () => {
    expect(getPageNumbers(8, 10)).toEqual([1, 'ellipsis', 7, 8, 9, 10]);
  });

  it('handles exactly 8 pages (boundary for ellipsis)', () => {
    expect(getPageNumbers(1, 8)).toEqual([1, 2, 'ellipsis', 8]);
    expect(getPageNumbers(4, 8)).toEqual([1, 'ellipsis', 3, 4, 5, 'ellipsis', 8]);
    expect(getPageNumbers(8, 8)).toEqual([1, 'ellipsis', 7, 8]);
  });
});

describe('Pagination', () => {
  it('renders nothing when totalPages <= 1', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders a page button per page and marks the current one', () => {
    const { getByRole, getAllByRole } = render(
      <Pagination currentPage={2} totalPages={5} onPageChange={() => {}} />,
    );
    expect(getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(getAllByRole('button', { name: /^Page \d$/ })).toHaveLength(5);
    expect(getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
    expect(getByRole('button', { name: 'Page 3' })).not.toHaveAttribute('aria-current');
  });

  it('calls onPageChange for prev, next, and page buttons', () => {
    const onPageChange = vi.fn();
    const { getByRole } = render(
      <Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />,
    );
    fireEvent.click(getByRole('button', { name: 'Previous page' }));
    fireEvent.click(getByRole('button', { name: 'Next page' }));
    fireEvent.click(getByRole('button', { name: 'Page 5' }));
    expect(onPageChange.mock.calls).toEqual([[1], [3], [5]]);
  });

  it('disables prev on the first page and next on the last page', () => {
    const { getByRole, rerender } = render(
      <Pagination currentPage={1} totalPages={3} onPageChange={() => {}} />,
    );
    expect(getByRole('button', { name: 'Previous page' })).toBeDisabled();
    rerender(<Pagination currentPage={3} totalPages={3} onPageChange={() => {}} />);
    expect(getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
