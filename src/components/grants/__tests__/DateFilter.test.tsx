import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { nestedControls } from '@/test/a11y';
import { DateFilter } from '../DateFilter';

const DATE = new Date(2026, 9, 28);

function renderFilter(date: Date | undefined, resetKey = 0) {
  return render(
    <DateFilter
      id="audit-date-from"
      label="From"
      date={date}
      resetKey={resetKey}
      onSelectDate={vi.fn()}
    />,
  );
}

describe('DateFilter', () => {
  it('keeps the date input out of focus inside the trigger, after a reset too', () => {
    const { container, rerender } = renderFilter(undefined);
    expect(nestedControls(container)).toEqual([]);

    rerender(<DateFilter id="audit-date-from" label="From" resetKey={1} onSelectDate={vi.fn()} />);
    expect(nestedControls(container)).toEqual([]);
    expect(container.querySelector('input')).toHaveAttribute('inert');
  });

  it('names the trigger with its label until a date is chosen', () => {
    renderFilter(undefined);

    const trigger = screen.getByRole('button', { name: 'From' });
    expect(trigger).toHaveAttribute('id', 'audit-date-from');
    expect(screen.getByText('From', { selector: 'label' })).toHaveAttribute(
      'for',
      'audit-date-from',
    );
  });

  it('names the trigger with its label and the chosen date', () => {
    renderFilter(DATE);

    const input = document.getElementById('audit-date-from-value');
    expect(input).toHaveValue();
    expect(screen.getByRole('button', { name: /^From / })).toHaveAttribute(
      'aria-labelledby',
      'audit-date-from-label audit-date-from-value',
    );
  });
});
