import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from '@tanstack/react-router';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { localizeEn } from '@/test/coverage';
import { ruleBody } from '@/test/styles';
import { Sidebar } from '../Sidebar';

const USER = { id: 'u1', name: 'Test Admin', email: 'admin@test.local' };
const CLIPS = /^(truncate|overflow(-[xy])?-(hidden|clip|auto|scroll))$/;
const AVATAR = localizeEn('com_nav_user_menu_label', { initials: 'TA', name: USER.name });

/** jsdom has no matchMedia; the theme provider (for the settings dialog) reads the system scheme with it. */
window.matchMedia ??= (media: string): MediaQueryList => ({
  media,
  matches: false,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
/** jsdom does not implement scrolling; the router resets the scroll when it loads a page. */
window.scrollTo = () => {};

/** The real Sidebar under a real `/_app` route, with the user's capabilities already loaded. */
async function renderSidebar(collapsed: boolean): Promise<HTMLElement> {
  const rootRoute = createRootRoute();
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_app',
    beforeLoad: () => ({ user: USER }),
    component: () => <Sidebar user={USER} collapsed={collapsed} onToggle={() => {}} />,
  });
  const indexRoute = createRoute({ getParentRoute: () => appRoute, path: '/' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([indexRoute])]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(['effectiveCapabilities', USER.id], {
    available: true,
    capabilities: [],
  });
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  const nav = await screen.findByRole('navigation');
  const aside = nav.closest('aside');
  if (!aside) throw new Error('the sidebar renders no <aside>');
  return aside;
}

/** The logo, each nav icon and the avatar, each with the row it sits in and the label beside it. */
function railRows(aside: HTMLElement): { row: Element | null; label: Element | null }[] {
  const logo = screen.getByRole('img', { name: localizeEn('com_a11y_logo_alt') });
  const icons = [...aside.querySelectorAll<HTMLElement>('nav a > span[aria-hidden="true"]')];
  const avatarRow = screen.getByRole('button', { name: AVATAR }).parentElement?.parentElement;
  if (!avatarRow) throw new Error('the avatar has no row');
  return [
    { row: logo.parentElement, label: logo.nextElementSibling },
    ...icons.map((icon) => ({ row: icon.parentElement, label: icon.nextElementSibling })),
    { row: avatarRow, label: avatarRow.lastElementChild },
  ];
}

/** The class of every element between `el` and `stop` (both excluded) that clips its overflow. */
function clippingAncestors(el: HTMLElement, stop: HTMLElement): string[] {
  const found: string[] = [];
  for (let node = el.parentElement; node && node !== stop; node = node.parentElement) {
    if ([...node.classList].some((name) => CLIPS.test(name))) found.push(node.className);
  }
  return found;
}

describe('Sidebar', () => {
  it('centers the logo, nav icons and avatar alone in rail-width rows when collapsed', async () => {
    const rows = railRows(await renderSidebar(true));

    expect(rows).toHaveLength(5);
    for (const { row, label } of rows) {
      expect(row).toHaveClass('w-[calc(--spacing(10)-1px)]', 'justify-center', 'gap-0');
      expect(label).toHaveClass('w-0', 'flex-none', 'overflow-hidden');
    }
  });

  it('lays the rows out from the left with their labels when expanded', async () => {
    const rows = railRows(await renderSidebar(false));

    for (const { row, label } of rows) {
      expect(row).toHaveClass('gap-2.5');
      expect(row).not.toHaveClass('justify-center');
      expect(label).not.toHaveClass('w-0');
    }
    expect(screen.getByText(USER.email)).toBeVisible();
  });

  it.each([true, false])(
    'clips nothing around the avatar focus ring and lets the name shrink (collapsed: %s)',
    async (collapsed) => {
      const aside = await renderSidebar(collapsed);
      const avatar = screen.getByRole('button', { name: AVATAR });

      expect(clippingAncestors(avatar, aside)).toEqual([]);
      expect(avatar.parentElement?.parentElement).toHaveClass('min-w-0');
    },
  );

  it.each([true, false])(
    'names the avatar with the initials it shows, then whose menu it opens (collapsed: %s)',
    async (collapsed) => {
      await renderSidebar(collapsed);
      const avatar = screen.getByRole('button', { name: AVATAR });

      expect(AVATAR).toBe('TA, user menu for Test Admin');
      expect(avatar).toHaveTextContent(/^TA$/);
    },
  );

  it.each([
    [true, 'com_nav_expand_sidebar'],
    [false, 'com_nav_collapse_sidebar'],
  ] as const)(
    'rings the collapse toggle inside its edges (collapsed: %s)',
    async (collapsed, key) => {
      await renderSidebar(collapsed);

      expect(screen.getByRole('button', { name: localizeEn(key) })).toHaveClass('sidebar-toggle');
      expect(ruleBody('.sidebar-toggle:focus-visible')).toBe(
        'outline-offset: calc(-1 * var(--focus-ring-width)) !important;',
      );
    },
  );

  it('gives focus back to the avatar when its menu closes with Escape', async () => {
    await renderSidebar(false);
    const avatar = screen.getByRole('button', { name: AVATAR });
    avatar.focus();
    fireEvent.keyDown(avatar, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(avatar).toHaveFocus());
  });
});
