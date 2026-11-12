import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectFocusBack, openFrom, pressEscape, renderWithOpener } from '@/test/focus';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CommandMenu } from '../CommandMenu';

const navigate = vi.fn(() => Promise.resolve());

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate, state: { location: { pathname: '/', search: {} } } }),
}));

vi.mock('@/hooks', async () => {
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  return {
    useLocalize: () => (key: string, options?: Record<string, string | number>) =>
      options ? `${key}(${Object.values(options).join(',')})` : key,
    useSearchIndex: () => ({ items: [], loading: false }),
    useReturnFocus,
  };
});

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

beforeEach(() => {
  navigate.mockClear();
});

/** The menu beside the header button that opens it, under the page's title. */
function renderMenu(): HTMLElement {
  return renderWithOpener(
    (open, close) => (
      <CommandMenu
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      />
    ),
    (node) => (
      <ThemeProvider>
        <header>
          <h1 tabIndex={-1}>Access management</h1>
        </header>
        {node}
      </ThemeProvider>
    ),
  );
}

describe('CommandMenu focus', () => {
  it('gives focus back to the control that opened it on Escape', async () => {
    const opener = renderMenu();
    pressEscape(await openFrom(opener));
    await expectFocusBack(opener);
  });

  it('gives focus back to that control after an action that stays on the page', async () => {
    const opener = renderMenu();
    await openFrom(opener);
    fireEvent.click(screen.getByRole('option', { name: 'com_cmdk_set_theme(com_nav_theme_dark)' }));
    await expectFocusBack(opener);
  });

  it('puts focus on the title of the page a navigation command opens', async () => {
    const opener = renderMenu();
    await openFrom(opener);
    fireEvent.click(screen.getByRole('option', { name: 'com_nav_access' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/access', search: undefined });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Access management' })).toHaveFocus(),
    );
    expect(opener).not.toHaveFocus();
  });
});

describe('CommandMenu with no results', () => {
  it('says so in a status message outside the listbox, and shows no empty list', async () => {
    const opener = renderMenu();
    await openFrom(opener);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzxx' } });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('com_cmdk_no_results');
    expect(status.closest('[role="listbox"]')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
    expect(list).toHaveAttribute('hidden');
  });
});
