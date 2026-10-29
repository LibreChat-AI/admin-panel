import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function Editor() {
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState('');
  return (
    <>
      <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <output data-testid="theme">{theme}</output>
      <button onClick={() => setTheme('light')}>Light</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  document.cookie = 'aimo-theme=; Path=/; Max-Age=0';
  localStorage.clear();
});

it('syncs themes and cookie deletion without losing edits', () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => Object.assign(new EventTarget(), { matches: false }),
  });
  document.cookie = 'aimo-theme=dark; Path=/';
  render(
    <ThemeProvider>
      <Editor />
    </ThemeProvider>,
  );
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'Unsaved message' } });
  expect(screen.getByTestId('theme').textContent).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Light' }));
  expect(document.cookie).toContain('aimo-theme=light');
  act(() => {
    document.cookie = 'aimo-theme=dark; Path=/';
    window.dispatchEvent(new Event('focus'));
  });
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('color-theme', 'dark');
  act(() => {
    document.cookie = 'aimo-theme=; Path=/; Max-Age=0';
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(screen.getByTestId('theme').textContent).toBe('system');
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  expect(draft).toHaveValue('Unsaved message');
});
