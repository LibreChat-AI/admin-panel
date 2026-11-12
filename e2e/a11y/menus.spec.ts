import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, THEMES, SELECTS, LIVE_SKIP_REASON } from '../live';

/**
 * click-ui rings the keyboard-highlighted option of its Select and Dropdown
 * menus. The ring is drawn in the app's focus color, and none of its sides is
 * cut off by the menu: a Select's option list is as wide as its trigger, 2px
 * wider than the popover's clip box. Needs a live backend (see ../live.ts).
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

/** The option's ring style and color, the app's focus color, and the ring sides that the option's clipping ancestors cut off. */
function readRing(item: Element) {
  const style = getComputedStyle(item);
  const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
  const box = item.getBoundingClientRect();
  const ring = {
    left: box.left - reach,
    top: box.top - reach,
    right: box.right + reach,
    bottom: box.bottom + reach,
  };
  const clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  const menu = item.closest('[data-input-modality]');
  for (let node = item.parentElement; node; node = node.parentElement) {
    const nodeStyle = getComputedStyle(node);
    if (nodeStyle.overflowX !== 'visible' || nodeStyle.overflowY !== 'visible') {
      const nodeBox = node.getBoundingClientRect();
      const left = nodeBox.left + node.clientLeft;
      const top = nodeBox.top + node.clientTop;
      clip.left = Math.max(clip.left, left);
      clip.top = Math.max(clip.top, top);
      clip.right = Math.min(clip.right, left + node.clientWidth);
      clip.bottom = Math.min(clip.bottom, top + node.clientHeight);
    }
    if (node === menu) break;
  }
  const probe = document.createElement('span');
  probe.style.color = 'var(--focus-ring-color)';
  document.body.append(probe);
  const focusColor = getComputedStyle(probe).color;
  probe.remove();
  const clipped = (['left', 'top', 'right', 'bottom'] as const).filter((side) =>
    side === 'left' || side === 'top' ? ring[side] < clip[side] : ring[side] > clip[side],
  );
  return { style: style.outlineStyle, color: style.outlineColor, focusColor, clipped };
}

/** Moves the keyboard highlight to the menu's second option and checks that option's ring. */
async function expectWholeRingOnSecond(page: Page, options: Locator) {
  const second = options.nth(1);
  await page.keyboard.press('ArrowDown');
  await expect(second).toHaveAttribute('data-highlighted');
  const { focusColor, ...ring } = await second.evaluate(readRing);
  expect(ring).toEqual({ style: 'solid', color: focusColor, clipped: [] });
}

for (const theme of THEMES) {
  test.describe(`keyboard highlight ring in menus: ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 } });

    for (const select of SELECTS) {
      test(`${select.name}: the highlighted option has its whole ring in the focus color`, async ({
        page,
      }) => {
        const trigger = await select.open(page);
        await trigger.focus();
        await page.keyboard.press('Enter');
        const options = page.locator('[data-input-modality] [cui-select-item]');
        await expect(options.first()).toHaveAttribute('data-highlighted');
        await expectWholeRingOnSecond(page, options);
      });
    }

    test('the user menu: the highlighted item has its whole ring in the focus color', async ({
      page,
    }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /, user menu for / }).focus();
      await page.keyboard.press('Enter');
      const items = page.getByRole('menu').getByRole('menuitem');
      await expect(items.first()).toBeFocused();
      await expectWholeRingOnSecond(page, items);
    });
  });
}
