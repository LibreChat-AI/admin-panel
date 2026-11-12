import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getPageNumbers, Pagination } from './Pagination';
import '@/locales/i18n';

/** A pager that turns pages the way its callers do: the page lives in their state. */
function Pager({ initialPage, totalPages }: { initialPage: number; totalPages: number }) {
  const [page, setPage] = useState(initialPage);
  return <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />;
}

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

  it('names its controls in words, not by their icons or the page number', () => {
    render(<Pagination currentPage={2} totalPages={5} onPageChange={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toContainElement(screen.getByRole('button', { name: 'Previous page' }));
    expect(nav).toContainElement(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('spinbutton', { name: 'Page 2 of 5' })).toHaveValue(2);
    expect(nav).toHaveTextContent('of 5');
    expect(screen.queryByRole('button', { name: /chevron/ })).toBeNull();
  });

  it('turns pages with Previous, Next and the page field', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const field = screen.getByRole('spinbutton', { name: 'Page 2 of 5' });
    fireEvent.change(field, { target: { value: '4' } });
    fireEvent.change(field, { target: { value: '9' } });
    fireEvent.change(field, { target: { value: '0' } });
    expect(onPageChange.mock.calls).toEqual([[1], [3], [4]]);
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(
      <Pagination currentPage={1} totalPages={3} onPageChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
    rerender(<Pagination currentPage={3} totalPages={3} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('keeps focus on an enabled control when Next reaches the last page', () => {
    render(<Pager initialPage={2} totalPages={3} />);
    const next = screen.getByRole('button', { name: 'Next page' });
    next.focus();
    fireEvent.click(next);
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
    expect(next).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveFocus();
  });

  it('keeps focus on an enabled control when Previous reaches the first page', () => {
    render(<Pager initialPage={2} totalPages={3} />);
    const previous = screen.getByRole('button', { name: 'Previous page' });
    previous.focus();
    fireEvent.click(previous);
    expect(screen.getByRole('spinbutton')).toHaveValue(1);
    expect(previous).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveFocus();
  });

  it('leaves focus on Next while there are pages after the new one', () => {
    render(<Pager initialPage={1} totalPages={3} />);
    const next = screen.getByRole('button', { name: 'Next page' });
    next.focus();
    fireEvent.click(next);
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();
  });
});
