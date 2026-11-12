import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG_TABS, LIVE, LIVE_SKIP_REASON, openConfigTab } from './live';

test.skip(!LIVE, LIVE_SKIP_REASON);

const TEXT_INPUTS =
  'form input[type=text]:visible:enabled, form input[type=number]:visible:enabled, form input:not([type]):visible:enabled';
const MAX_INPUTS_PER_TAB = 30;

/** Opens collapsed sections and entry cards so their inputs can be reached (select triggers are left alone). */
async function expandAll(page: Page) {
  for (let round = 0; round < 2; round++) {
    const toggles = await page
      .locator('form button[aria-expanded=false]:not([aria-haspopup]):not([role=combobox])')
      .all();
    for (const toggle of toggles.slice(0, 12)) {
      await toggle.click({ timeout: 1_000 }).catch(() => undefined);
    }
  }
  const cards = await page.locator('form [data-entry-card] button[aria-expanded=false]').all();
  for (const card of cards.slice(0, 3)) await card.click({ timeout: 1_000 }).catch(() => undefined);
}

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

test.describe('Configuration: Enter never edits another field', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const tab of CONFIG_TABS) {
    test(`Enter in each input on the ${tab} tab leaves the page clean`, async ({ page }) => {
      await openConfigTab(page, tab);
      await expandAll(page);
      await expect(unsavedBar(page)).toHaveCount(0);
      const inputs = page.locator(TEXT_INPUTS);
      await expect
        .poll(() => inputs.count(), { message: `no editable inputs on the ${tab} tab` })
        .toBeGreaterThan(0);
      const count = Math.min(await inputs.count(), MAX_INPUTS_PER_TAB);
      const cardsBefore = await page
        .locator('form [data-entry-card] button[aria-expanded]')
        .count();
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        await input.focus();
        await input.press('Enter');
        await expect(unsavedBar(page), `Enter in input #${i} made the page dirty`).toHaveCount(0);
      }
      await expect(page.locator('form [data-entry-card] button[aria-expanded]')).toHaveCount(
        cardsBefore,
      );
    });
  }

  test('Enter after editing a value marks only that field', async ({ page }) => {
    await openConfigTab(page, 'system');
    const field = page.locator('#balance-startBalance');
    await field.fill('424242');
    await field.press('Enter');
    await expect(unsavedBar(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Review & save$/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Save 1 change to the base configuration?');
    await expect(dialog).toContainText('Starting credits');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
  });

  test('Enter in the create endpoint form still submits it', async ({ page }) => {
    await openConfigTab(page, 'custom');
    await page.getByRole('button', { name: 'Create endpoint' }).first().click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: /^Blank endpoint/ }).click();
    await drawer.locator('#endpoints-custom-9999-name').fill('Enter Endpoint');
    await drawer.locator('#endpoints-custom-9999-apiKey').fill('key');
    const models = drawer.getByPlaceholder(/Add models/);
    await models.fill('enter-model');
    await models.press('Enter');
    await expect(drawer.getByRole('heading', { name: 'Create endpoint' })).toBeVisible();
    const baseURL = drawer.locator('#endpoints-custom-9999-baseURL');
    await baseURL.fill('https://enter.example.com/v1');
    await baseURL.press('Enter');
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Enter Endpoint' }),
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(unsavedBar(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Discard' }).click();
  });
});

test.describe('Configuration: deleting a custom endpoint', () => {
  test('a librechat.yaml endpoint offers no delete; an added one is deleted with Undo (D1, D9)', async ({
    page,
  }) => {
    await openConfigTab(page, 'custom');
    const rows = page.locator('form li[data-endpoint-row]');
    await expect(rows.first()).toBeVisible();
    const names = await new AxeBuilder({ page })
      .include('form')
      .withRules(['button-name', 'list', 'listitem'])
      .analyze();
    expect(names.violations).toEqual([]);
    const yamlRow = rows.filter({ hasText: 'librechat.yaml' }).first();
    test.skip((await yamlRow.count()) === 0, 'No librechat.yaml endpoints');
    await yamlRow.locator('button[aria-haspopup="dialog"]').click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Delete endpoint' })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Done' }).click();

    const added = rows.filter({ hasText: 'Added in admin' }).first();
    test.skip((await added.count()) === 0, 'Every custom endpoint comes from librechat.yaml (D1)');
    const name = (await added.getAttribute('data-endpoint-row')) ?? '';
    await added.locator('button[aria-haspopup="dialog"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete endpoint' }).click();
    await expect(page.getByText('Will be deleted when you save')).toBeVisible();
    await expect(unsavedBar(page)).toHaveCount(1);
    await page.getByRole('button', { name: `Undo deleting ${name}` }).click();
    await expect(unsavedBar(page)).toHaveCount(0);
  });
});
