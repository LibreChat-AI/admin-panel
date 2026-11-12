import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CodeField } from '../CodeField';
import '@/locales/i18n';

describe('CodeField', () => {
  it('writes nothing when focused and left without a change', () => {
    const onChange = vi.fn();
    render(
      <CodeField
        id="backoff"
        value={[300000, 600000, 1200000]}
        onChange={onChange}
        aria-label="Discovery backoff"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Discovery backoff' });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes nothing when the text changes but the value does not', () => {
    const onChange = vi.fn();
    render(<CodeField id="list" value={[1, 2]} onChange={onChange} aria-label="List" />);
    const input = screen.getByRole('textbox', { name: 'List' });
    fireEvent.change(input, { target: { value: '[1, 2]' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('writes an edited value, and clears an emptied one', () => {
    const onChange = vi.fn();
    render(<CodeField id="list" value={[1, 2]} onChange={onChange} aria-label="List" />);
    const input = screen.getByRole('textbox', { name: 'List' });
    fireEvent.change(input, { target: { value: '- 1\n- 3' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith([1, 3]);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
