import { test, expect } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, SELECTS, THEMES } from '../live';

/**
 * An open click-ui Select keeps focus in its search input. Unless the Select
 * shows its search, that input is zero height, and the app's input focus ring
 * on it drew a line across the popover's first option. A shown search input
 * keeps its ring. Needs a live backend (see ../live.ts).
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

/** Gives the input click-ui's class for a shown search (`showSearch`), read from its stylesheet. */
function showSearch(input: HTMLElement) {
  const css = Array.from(document.styleSheets, (sheet) =>
    Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n'),
  ).join('\n');
  const shown = css.match(/\.(search-bar_show-search[\w-]*)/)?.[1];
  if (shown) input.classList.add(shown);
  return shown ?? null;
}

for (const theme of THEMES) {
  test.describe(`Select search input ring: ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 } });

    for (const select of SELECTS) {
      test(`${select.name}: the hidden search input draws no ring, a shown one does`, async ({
        page,
      }) => {
        const trigger = await select.open(page);
        await trigger.click();
        const search = page.getByTestId('select-search-input');
        const height = () => search.evaluate((input) => input.getBoundingClientRect().height);
        await expect(search).toBeFocused();
        expect(await height()).toBe(0);
        await expect(search).toHaveCSS('outline-style', 'none');

        expect(await search.evaluate(showSearch)).not.toBeNull();
        expect(await height()).toBeGreaterThan(0);
        await expect(search).toBeFocused();
        await expect(search).toHaveCSS('outline-style', 'solid');
        await expect(search).toHaveCSS('outline-width', '2px');
      });
    }
  });
}
