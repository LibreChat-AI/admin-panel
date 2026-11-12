import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Sidebar geometry a DOM test cannot see: the collapsed rail centers its
 * icons, and keyboard focus rings on the avatar and the collapse toggle are
 * drawn whole instead of clipped by the panel or the viewport.
 */

/** Headless Chromium hides scrollbars by default; the rail must also fit beside a real one. */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

const COLLAPSED_KEY = 'admin-panel:sidebar-collapsed';
/** The sidebar controls whose focus rings sit against a clipped edge, by accessible name. */
const RINGED = [
  ['avatar', /, user menu for /],
  ['collapse toggle', /^(Collapse|Expand) sidebar$/],
] as const;

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function openSidebar(page: Page, collapsed: boolean) {
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [COLLAPSED_KEY, String(collapsed)],
  );
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('aside')).toHaveCSS('width', collapsed ? '56px' : '252px');
}

/** Moves keyboard focus with Tab until `target` has it, so it shows its focus-visible ring. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Tab never reached the target');
}

/** How far the focused element's outline reaches past each clipping ancestor and the viewport. */
async function ringClipping(target: Locator): Promise<Record<string, Edges>> {
  return target.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const grow = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    const ring = {
      left: box.left - grow,
      top: box.top - grow,
      right: box.right + grow,
      bottom: box.bottom + grow,
    };
    const overflow = (clip: Edges): Edges => ({
      left: Math.max(0, clip.left - ring.left),
      top: Math.max(0, clip.top - ring.top),
      right: Math.max(0, ring.right - clip.right),
      bottom: Math.max(0, ring.bottom - clip.bottom),
    });
    const clips: Record<string, Edges> = {};
    const viewport = overflow({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    if (Object.values(viewport).some(Boolean)) clips.viewport = viewport;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      if (nodeStyle.overflowX === 'visible' && nodeStyle.overflowY === 'visible') continue;
      const rect = node.getBoundingClientRect();
      const cut = overflow({
        left: rect.left + parseFloat(nodeStyle.borderLeftWidth),
        top: rect.top + parseFloat(nodeStyle.borderTopWidth),
        right: rect.right - parseFloat(nodeStyle.borderRightWidth),
        bottom: rect.bottom - parseFloat(nodeStyle.borderBottomWidth),
      });
      if (Object.values(cut).some(Boolean)) clips[`${node.tagName} ${node.className}`] = cut;
    }
    return clips;
  });
}

test.describe('Sidebar rail', () => {
  test('centers the logo, nav icons and avatar in the collapsed rail from the first frame', async ({
    page,
  }) => {
    await openSidebar(page, false);
    const frames = await page.evaluate(
      (label) =>
        new Promise<{ width: number; center: number; icons: number[] }[]>((resolve) => {
          const aside = document.querySelector('aside');
          const toggle = aside?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
          if (!aside || !toggle) throw new Error('no sidebar');
          const icons = [
            aside.querySelector('img'),
            ...aside.querySelectorAll('nav a > span[aria-hidden="true"]'),
            aside.querySelector('button[aria-haspopup]'),
          ].filter((icon): icon is Element => icon != null);
          const frame = () => {
            const left = aside.getBoundingClientRect().left;
            return {
              width: aside.getBoundingClientRect().width,
              center: aside.clientWidth / 2,
              icons: icons.map((icon) => {
                const rect = icon.getBoundingClientRect();
                return Math.round((rect.left + rect.width / 2 - left) * 100) / 100;
              }),
            };
          };
          toggle.click();
          requestAnimationFrame(() => {
            const first = frame();
            const settle = (event: TransitionEvent) => {
              if (event.target !== aside || event.propertyName !== 'width') return;
              aside.removeEventListener('transitionend', settle);
              resolve([first, frame()]);
            };
            aside.addEventListener('transitionend', settle);
          });
        }),
      'Collapse sidebar',
    );
    const [first, last] = frames;
    const rail = last.center;

    expect(last.width).toBe(56);
    expect(first.width).toBeGreaterThan(last.width);
    expect(last.icons.length).toBeGreaterThan(2);
    expect(last.icons).toEqual(last.icons.map(() => rail));
    expect(first.icons).toEqual(last.icons);
  });

  test('keeps the collapsed nav icons centered without a sideways scroll when the nav scrolls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 300 });
    await openSidebar(page, true);
    const nav = await page.getByRole('navigation').evaluate((el) => {
      const left = el.getBoundingClientRect().left + el.clientLeft;
      return {
        scrolls: el.scrollHeight > el.clientHeight,
        sideways: el.scrollWidth > el.clientWidth,
        center: el.clientWidth / 2,
        icons: [...el.querySelectorAll('a > span[aria-hidden="true"]')].map((icon) => {
          const rect = icon.getBoundingClientRect();
          return rect.left + rect.width / 2 - left;
        }),
      };
    });

    expect(nav.scrolls).toBe(true);
    expect(nav.sideways).toBe(false);
    for (const icon of nav.icons) expect(Math.abs(icon - nav.center)).toBeLessThanOrEqual(0.5);
  });

  for (const collapsed of [true, false]) {
    for (const [name, label] of RINGED) {
      test(`draws the ${name} focus ring whole when ${collapsed ? 'collapsed' : 'expanded'}`, async ({
        page,
      }) => {
        await openSidebar(page, collapsed);
        const target = page.getByRole('button', { name: label });

        await tabTo(page, target);
        expect(await ringClipping(target)).toEqual({});
      });
    }
  }

  test('truncates a long name and email inside the expanded panel', async ({ page }) => {
    await openSidebar(page, false);
    const aside = page.locator('aside');
    const texts = aside.locator('span.block.truncate');
    await expect(texts).toHaveCount(2);
    await texts.evaluateAll((spans) =>
      spans.forEach((span, i) => {
        span.textContent =
          i === 0
            ? 'Maximiliana Bartholomew-Featherstonehaugh'
            : 'maximiliana.bartholomew-featherstonehaugh@example.org';
      }),
    );
    const edge = await aside.evaluate((el) => el.getBoundingClientRect().left + el.clientWidth);

    for (const span of await texts.all()) {
      const fit = await span.evaluate((el) => ({
        right: el.getBoundingClientRect().right,
        ellipsized: el.scrollWidth > el.clientWidth,
      }));
      expect(fit.right).toBeLessThanOrEqual(edge);
      expect(fit.ellipsized).toBe(true);
    }
  });

  test('gives focus back to the avatar when its menu closes with Escape', async ({ page }) => {
    await openSidebar(page, false);
    const avatar = page.getByRole('button', { name: RINGED[0][1] });
    await avatar.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(avatar).toBeFocused();
  });
});
