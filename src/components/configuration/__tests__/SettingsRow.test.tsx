import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoleFieldContext } from '@/contexts/SettingsContext';
import { SettingsRow } from '../SettingsRow';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join('|')}` : key,
}));

describe('SettingsRow', () => {
  it("keeps the control's own description current as the row error comes and goes", () => {
    const control = (warning: boolean) => (
      <input id="name" aria-label="Name" aria-describedby={warning ? 'name-rename' : undefined} />
    );
    const { rerender } = render(
      <SettingsRow label="Name" htmlFor="name" control={control(true)} />,
    );
    const input = screen.getByRole('textbox');
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(true)} error="Required" />);
    expect(input.getAttribute('aria-describedby')).toBe('name-rename name-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(false)} />);
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('leaves aria-invalid to the control once its own error replaces the row error', () => {
    const control = (invalid: boolean) => (
      <input id="name" aria-label="Name" aria-invalid={invalid ? true : undefined} />
    );
    const { rerender } = render(
      <SettingsRow label="Name" htmlFor="name" control={control(false)} error="Taken" />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(true)} />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(true)} error="Taken" />);
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(false)} error="Taken" />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    rerender(<SettingsRow label="Name" htmlFor="name" control={control(false)} />);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('renders every slot in its grid cell', () => {
    const { container } = render(
      <SettingsRow
        label="Start balance"
        htmlFor="balance-startBalance"
        description="Credits granted to new users"
        control={<input id="balance-startBalance" aria-describedby="balance-startBalance-error" />}
        chips={<span data-testid="chip" />}
        hint={<span>default: 0</span>}
        actions={<button type="button">Reset</button>}
        error="Must be a number"
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('settings-row');
    expect(screen.getByLabelText('Start balance')).toBeInstanceOf(HTMLInputElement);

    const label = row.querySelector('.settings-row-label');
    expect(label?.textContent).toContain('default: 0');
    expect(label?.textContent).toContain('Credits granted to new users');

    const controlCell = row.querySelector('.settings-row-control');
    expect(controlCell?.querySelector('input')).toBeTruthy();
    expect(screen.getByRole('alert').parentElement).toBe(controlCell);
    expect(screen.getByRole('alert').id).toBe('balance-startBalance-error');
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('Must be a number');

    const trailing = row.querySelector('.settings-row-trailing');
    expect(trailing?.contains(screen.getByTestId('chip'))).toBe(true);
    expect(trailing?.contains(screen.getByRole('button', { name: 'Reset' }))).toBe(true);
  });

  it('never fades a row and omits the trailing cell when it has no chips or actions', () => {
    const { container } = render(
      <SettingsRow label="Cache" control={<input aria-label="Cache" />} />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).not.toMatch(/opacity/);
    expect(row.style.opacity).toBe('');
    expect(row.querySelector('.settings-row-trailing')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(row.querySelector('.settings-row-control')?.getAttribute('data-width')).toBe('auto');
  });

  it('applies the width token, the required mark and the pending-change marker', () => {
    const { container } = render(
      <SettingsRow
        label="Base URL"
        control={<input aria-label="Base URL" />}
        width="L"
        marker="edited"
        required
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.dataset.marker).toBe('edited');
    expect(row.querySelector('.settings-row-control')?.getAttribute('data-width')).toBe('L');
    expect(row.querySelector('.settings-required')?.textContent).toBe('*');
  });

  it('in a single-field section, drops the label and names the control after the section', () => {
    render(
      <SoleFieldContext.Provider value={{ headingId: 'h-tx', sectionTitle: 'Transactions' }}>
        <h2 id="h-tx">Transactions</h2>
        <SettingsRow
          label="Enabled"
          htmlFor="transactions-enabled"
          control={
            <button
              type="button"
              role="switch"
              aria-checked
              id="transactions-enabled"
              aria-label="Enabled"
            />
          }
          chips={<span data-testid="chip" />}
        />
      </SoleFieldContext.Provider>,
    );
    expect(screen.queryByText('Enabled', { selector: 'label' })).toBeNull();
    expect(screen.getByRole('switch')).toHaveAccessibleName(
      'com_config_ui_sole_name:Transactions|Enabled',
    );
    expect(screen.getByTestId('chip').closest('.settings-row-trailing')).toBeTruthy();
  });

  it('uses the section title alone when the field label repeats it', () => {
    render(
      <SoleFieldContext.Provider value={{ headingId: 'h-sil', sectionTitle: 'Secure image links' }}>
        <SettingsRow
          label="Secure image links"
          htmlFor="secureImageLinks"
          control={<input id="secureImageLinks" type="checkbox" />}
        />
      </SoleFieldContext.Provider>,
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleName('Secure image links');
  });

  it("keeps a button's own text as its name, described by the field's name (an empty list's Add)", () => {
    render(
      <SoleFieldContext.Provider value={{ headingId: 'h-ft', sectionTitle: 'Filtered tools' }}>
        <SettingsRow
          label="Hidden tools"
          htmlFor="filteredTools"
          control={
            <div id="filteredTools">
              <button type="button">Add tool</button>
            </div>
          }
        />
      </SoleFieldContext.Provider>,
    );
    const add = screen.getByRole('button');
    expect(add).not.toHaveAttribute('aria-labelledby');
    expect(add).toHaveAccessibleName('Add tool');
    expect(add).toHaveAccessibleDescription('com_config_ui_sole_name:Filtered tools|Hidden tools');
  });
});
