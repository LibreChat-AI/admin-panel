import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { Header } from '../Header';

vi.mock('@/hooks', () => ({ useLocalize: () => (key: string) => key }));

describe('Header search button', () => {
  it('is named by the label and shortcut it shows, which phones keep as screen-reader text', () => {
    render(<Header title="Grants" onSearchClick={vi.fn()} />);

    const search = screen.getByRole('button', { name: /^com_ui_search/ });
    expect(search).not.toHaveAttribute('aria-label');
    expect(search).not.toHaveAttribute('title');
    expect(search).toHaveAccessibleName(search.textContent ?? '');
    expect(screen.getByText('com_ui_search')).toHaveClass('sr-only', 'sm:not-sr-only');
    expect(screen.getByText('Ctrl+K').tagName).toBe('KBD');
  });

  it('opens the command menu', async () => {
    const onSearchClick = vi.fn();
    render(<Header title="Grants" onSearchClick={onSearchClick} />);

    await userEvent.click(screen.getByRole('button', { name: /^com_ui_search/ }));

    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });
});
