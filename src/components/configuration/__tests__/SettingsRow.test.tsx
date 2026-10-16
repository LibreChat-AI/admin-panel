import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsRow } from '../SettingsRow';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('SettingsRow', () => {
  it('renders every slot in place', () => {
    const { container } = render(
      <SettingsRow
        label="Start balance"
        htmlFor="balance-startBalance"
        description="Credits granted to new users"
        control={<input id="balance-startBalance" />}
        chips={<span data-testid="chip" />}
        hint={<span>default: 0</span>}
        actions={<button type="button">Reset</button>}
        error="Must be a number"
      />,
    );
    expect(screen.getByLabelText('Start balance')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByTestId('chip')).toBeTruthy();
    expect(screen.getByText('default: 0')).toBeTruthy();
    expect(screen.getByText('Credits granted to new users')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Must be a number');
    expect(container.firstElementChild?.className).toContain('items-start');
  });

  it('centers a bare row and dims it on request', () => {
    const { container } = render(
      <SettingsRow label="Cache" control={<input aria-label="Cache" />} dimmed />,
    );
    const row = container.firstElementChild;
    expect(row?.className).toContain('items-center');
    expect(row?.className).toContain('opacity-50');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
