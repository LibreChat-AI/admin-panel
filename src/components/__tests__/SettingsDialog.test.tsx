import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DIALOG_CLOSERS, expectFocusBack, findFocusedDialog } from '@/test/focus';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Sidebar } from '../Sidebar';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await (await import('@/test/router')).routerless(importOriginal)),
  useRouter: () => ({ state: { location: { pathname: '/' } } }),
}));

vi.mock('@/hooks', async () => {
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  const { useStripAriaExpanded } = await vi.importActual<
    typeof import('@/hooks/useStripAriaExpanded')
  >('@/hooks/useStripAriaExpanded');
  return {
    useLocalize: () => (key: string) => key,
    useCapabilities: () => ({ hasCapability: () => true }),
    useReturnFocus,
    useStripAriaExpanded,
  };
});

vi.mock('@/server', () => ({ adminLogoutFn: vi.fn() }));

beforeAll(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

/** Opens Settings the way a keyboard user does: the user menu's button, then its Settings item. */
async function openSettings(): Promise<{ userMenu: HTMLElement; dialog: HTMLElement }> {
  render(
    <ThemeProvider>
      <Sidebar
        user={{ name: 'Test Admin', email: 'admin@test.local' }}
        collapsed={false}
        onToggle={vi.fn()}
      />
    </ThemeProvider>,
  );
  const userMenu = screen.getByRole('button', { name: 'com_nav_user_menu_label' });
  userMenu.focus();
  fireEvent.keyDown(userMenu, { key: 'ArrowDown' });
  const item = await screen.findByRole('menuitem', { name: /com_ui_settings/ });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
  return { userMenu, dialog: await findFocusedDialog() };
}

describe('Settings from the user menu', () => {
  it('closes the menu and moves focus into the dialog', async () => {
    const { dialog } = await openSettings();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(dialog).toHaveAccessibleName('com_ui_settings');
  });

  it.each(DIALOG_CLOSERS)('gives focus back to the user menu button on %s', async (_, close) => {
    const { userMenu, dialog } = await openSettings();
    close(dialog);
    await expectFocusBack(userMenu);
  });
});
