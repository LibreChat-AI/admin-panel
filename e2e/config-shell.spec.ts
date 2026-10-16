import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON } from './live';

/**
 * Configuration page shell (WS5): loading and error routes, Expand all,
 * field-level search with deep links, URL-driven profile scope, the
 * unsaved-changes guard and the 390 px layout.
 *
 * Needs a LibreChat backend with admin config routes (the default mock backend
 * has none): run with E2E_LIVE=1 against a real stack.
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

const TABS = ['providers', 'custom', 'specs', 'mcp', 'features', 'files', 'system'];
/** Collapsed sections, groups and cards (not a model chip's inline editor or a select). */
const COLLAPSED =
  'form [aria-expanded="false"]:not([aria-haspopup]):not([role=combobox]):not([role=tab]):not(.icon-btn)';

async function openTab(page: Page, tab: string, extra = '') {
  await page.goto(`/configuration?tab=${tab}${extra}`);
  await expect(page.locator('form[aria-label]')).toBeVisible();
}

/** Fails the server function whose real response contains `marker` (no build ids needed). */
function failServerFn(marker: string) {
  return async (route: Route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes(marker)) {
      await route.fulfill({ status: 500, body: 'boom' });
      return;
    }
    await route.fulfill({ response, body });
  };
}

test.describe('Configuration shell: loading and errors', () => {
  test('a slow load shows a skeleton and never an editable form before the data', async ({
    page,
  }) => {
    await page.route('**/_serverFn/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await page.goto('/configuration?tab=system', { waitUntil: 'commit' });
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#balance-startBalance')).toHaveCount(0);
    await expect(page.locator('#balance-startBalance')).not.toHaveValue('', { timeout: 30_000 });
  });

  test('a failing base config shows an error card with Retry, inside the layout', async ({
    page,
  }) => {
    await page.route('**/_serverFn/**', failServerFn('yamlPaths'));
    await page.goto('/configuration?tab=system');
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't load the configuration" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('form[aria-label]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import YAML' })).toHaveCount(0);
    await expect(page.locator('aside')).toBeVisible();

    await page.unroute('**/_serverFn/**');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('#balance-startBalance')).toBeVisible({ timeout: 30_000 });
  });

  test('a failing schema keeps the sidebar and header and recovers on Retry', async ({ page }) => {
    await page.goto('/');
    await page.route('**/_serverFn/**', failServerFn('"totalFields"'));
    await page.locator('aside a[href*="/configuration"]').first().click();
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't load the configuration" });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('header h1')).toBeVisible();
    await page.unroute('**/_serverFn/**');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('form[aria-label]')).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Configuration shell: toolbar', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const tab of TABS) {
    test(`Expand all opens every group and card on the ${tab} tab; Collapse all closes them`, async ({
      page,
    }) => {
      await openTab(page, tab);
      await page.getByRole('button', { name: 'Expand all' }).click();
      await expect(page.locator(COLLAPSED)).toHaveCount(0);
      await page.getByRole('button', { name: 'Collapse all' }).click();
      await expect(page.locator('form [aria-expanded="true"]:not([role=tab])')).toHaveCount(0);
    });
  }

  test('the toolbar never covers an Add button scrolled to the top', async ({ page }) => {
    await openTab(page, 'features');
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator(COLLAPSED)).toHaveCount(0);
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const covered = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('main .overflow-auto');
      const buttons = [...document.querySelectorAll<HTMLElement>('form .config-add-btn')];
      if (!scroller || buttons.length === 0) return ['no add buttons'];
      return buttons.slice(0, 8).flatMap((button) => {
        const view = scroller.getBoundingClientRect();
        scroller.scrollTop += button.getBoundingClientRect().top - view.top - view.height / 2;
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && button.contains(hit) ? [] : [button.textContent ?? ''];
      });
    });
    expect(covered).toEqual([]);
  });

  test('"Set values only" lives in the URL and has a way out of its empty state', async ({
    page,
  }) => {
    await openTab(page, 'files');
    await page.getByLabel('Set values only').click();
    await expect(page).toHaveURL(/customized=1/);
    await page.reload();
    await expect(page.getByLabel('Set values only')).toBeChecked();
    const showAll = page.getByRole('button', { name: 'Show all settings' });
    if (await showAll.count()) {
      await showAll.click();
      await expect(page).not.toHaveURL(/customized=1/);
    }
  });
});

test.describe('Configuration shell: search and deep links', () => {
  async function search(page: Page, query: string) {
    await page.keyboard.press('Control+k');
    await page.keyboard.type(query);
    await expect(page.locator('[cmdk-item]').first()).toBeVisible();
    await page.keyboard.press('Enter');
  }

  test('Ctrl+K "start balance" lands focused on the field', async ({ page }) => {
    await openTab(page, 'providers');
    await search(page, 'start balance');
    await expect(page.locator('#balance-startBalance')).toBeFocused({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/field=/);
    await expect(page).toHaveURL(/tab=system/);
  });

  test('Ctrl+K on a custom endpoint name opens its card', async ({ page }) => {
    await openTab(page, 'custom');
    const first = page.locator('form [data-entry-card] button[aria-expanded]').first();
    const name = (await first.locator('span[title]').first().getAttribute('title')) ?? '';
    test.skip(!name, 'No custom endpoints');
    await openTab(page, 'system');
    await search(page, name);
    const card = page.locator('form [data-entry-card] button[aria-expanded="true"]', {
      hasText: name,
    });
    await expect(card.first()).toBeVisible({ timeout: 10_000 });
  });

  test('a deep link to a nested field expands its ancestors', async ({ page }) => {
    await page.goto('/configuration?tab=system&field=rateLimits.fileUploads.ipMax');
    await expect(page.locator('#rateLimits-fileUploads-ipMax')).toBeInViewport({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/field=/);
  });

  test('a deep link without a tab opens the tab that holds the field', async ({ page }) => {
    await page.goto('/configuration?field=interface.privacyPolicy.externalUrl');
    await expect(page.locator('#interface-privacyPolicy-externalUrl')).toBeFocused({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/tab=features/);
  });

  test('an invalid tab is normalized', async ({ page }) => {
    await page.goto('/configuration?tab=bogus');
    await expect(page).toHaveURL(/tab=providers/);
  });
});

test.describe('Configuration shell: profile scope and guard', () => {
  async function openScopeSelector(page: Page) {
    await page.getByRole('button', { name: /^Select scope/ }).click();
    return page.getByRole('dialog');
  }

  /** Opens the USER role's profile; on a clean database, creating it opens it. */
  async function selectUserRole(page: Page) {
    const dialog = await openScopeSelector(page);
    const user = dialog.getByText('USER', { exact: true });
    if ((await user.count()) === 0) {
      await dialog.getByRole('button', { name: 'Create' }).click();
      await dialog.getByText('USER', { exact: true }).first().click();
      return;
    }
    await user.first().click();
  }

  test('Back after selecting a profile restores Base in the URL and the UI', async ({ page }) => {
    await openTab(page, 'system');
    await selectUserRole(page);
    await expect(page).toHaveURL(/scope=role(%3A|:)USER/);
    await expect(page.getByRole('button', { name: /^Select scope: USER/ })).toBeVisible();
    await page.goBack();
    await expect(page).not.toHaveURL(/scope=/);
    await expect(page.getByRole('button', { name: /^Select scope: Base/ })).toBeVisible();
  });

  test('a fresh visit opens Base, an unknown profile says so', async ({ page }) => {
    await openTab(page, 'system');
    await expect(page.getByRole('button', { name: /^Select scope: Base/ })).toBeVisible();
    await openTab(page, 'system', '&scope=role:NO_SUCH_ROLE');
    await expect(
      page.getByRole('status').filter({ hasText: 'There is no role named NO_SUCH_ROLE' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create profile' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Import YAML/ })).toHaveCount(0);
  });

  test('leaving with unsaved edits asks in a themed dialog, never window.confirm', async ({
    page,
  }) => {
    let nativeDialogs = 0;
    page.on('dialog', (dialog) => {
      nativeDialogs += 1;
      void dialog.dismiss();
    });
    await openTab(page, 'system');
    await page.locator('#balance-startBalance').fill('424242');
    await page.locator('#balance-startBalance').blur();
    await page.locator('aside a[href*="/access"]').first().click();
    const guard = page.getByRole('dialog', { name: /Leave and discard 1 change/ });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/configuration/);
    await expect(page.locator('#balance-startBalance')).toHaveValue('424242');
    await page.locator('aside a[href*="/access"]').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/access/);
    expect(nativeDialogs).toBe(0);
  });
});

test.describe('Configuration shell: 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('header actions never overlap the title and Import YAML is reachable', async ({
    page,
  }, testInfo) => {
    await openTab(page, 'custom');
    const title = await page.locator('header h1').boundingBox();
    const buttons = page.locator('header button:visible');
    for (const box of await buttons.evaluateAll((els) =>
      els.map((el) => {
        const { left, right, top, bottom } = el.getBoundingClientRect();
        return { left, right, top, bottom };
      }),
    )) {
      const overlaps =
        title != null &&
        box.left < title.x + title.width &&
        box.right > title.x &&
        box.top < title.y + title.height &&
        box.bottom > title.y;
      expect(overlaps).toBe(false);
    }
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
    await testInfo.attach('config-390', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Configuration actions' }).click();
    await page.getByRole('menuitem', { name: 'Import YAML' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
