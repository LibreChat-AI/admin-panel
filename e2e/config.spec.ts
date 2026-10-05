import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

const TABS = ['providers', 'custom', 'specs', 'mcp', 'features', 'files', 'system'];
const TEXT_INPUTS =
  'form input[type=text]:visible:enabled, form input[type=number]:visible:enabled, form input:not([type]):visible:enabled';
const MAX_INPUTS_PER_TAB = 30;

async function openTab(page: Page, tab: string) {
  await page.goto(`/configuration?tab=${tab}`);
  await page.waitForLoadState('networkidle');
}

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
  const cards = await page.locator('form [role=button][aria-expanded=false]').all();
  for (const card of cards.slice(0, 3)) await card.click({ timeout: 1_000 }).catch(() => undefined);
}

const unsavedBar = (page: Page) => page.getByText('Unsaved changes');

test.describe('Configuration: Enter never edits another field', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const tab of TABS) {
    test(`Enter in each input on the ${tab} tab leaves the page clean`, async ({ page }) => {
      await openTab(page, tab);
      await expandAll(page);
      await expect(unsavedBar(page)).toHaveCount(0);
      const inputs = page.locator(TEXT_INPUTS);
      const count = Math.min(await inputs.count(), MAX_INPUTS_PER_TAB);
      const cardsBefore = await page.locator('form [role=button][aria-expanded]').count();
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        await input.focus();
        await input.press('Enter');
        await expect(unsavedBar(page), `Enter in input #${i} made the page dirty`).toHaveCount(0);
      }
      await expect(page.locator('form [role=button][aria-expanded]')).toHaveCount(cardsBefore);
    });
  }

  test('Enter after editing a value marks only that field', async ({ page }) => {
    await openTab(page, 'system');
    const field = page.locator('#balance-startBalance');
    await field.fill('424242');
    await field.press('Enter');
    await expect(unsavedBar(page)).toHaveCount(1);
    await page
      .getByRole('button', { name: /^Save$/ })
      .last()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1 field will be updated');
    await expect(dialog).toContainText('balance.startBalance');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
  });

  test('Enter in a create dialog still submits that dialog', async ({ page }) => {
    await openTab(page, 'custom');
    await page
      .getByRole('button', { name: /Create endpoint/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#create-endpoint-name').fill('Enter Endpoint');
    await dialog.locator('#create-endpoint-apiKey').fill('key');
    const baseURL = dialog.locator('#create-endpoint-baseURL');
    await baseURL.fill('https://enter.example.com/v1');
    await baseURL.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(unsavedBar(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Discard' }).click();
  });
});

test.describe('Configuration: delete buttons', () => {
  test('every delete button is announced as "Delete <item>"', async ({ page }) => {
    await openTab(page, 'custom');
    const deleteButtons = page.locator('form button.icon-btn-danger');
    test.skip((await deleteButtons.count()) === 0, 'No custom endpoints to delete');
    await expect(page.locator('form button[aria-label="trash"]')).toHaveCount(0);
    for (const label of await deleteButtons.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? ''),
    )) {
      expect(label).toMatch(/^Delete \S/);
    }
    const results = await new AxeBuilder({ page })
      .include('form')
      .withRules(['button-name'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('keyboard Enter on a card trash button deletes the entry without toggling the card', async ({
    page,
  }) => {
    await openTab(page, 'custom');
    const headers = page.locator('form [role=button][aria-expanded]');
    const before = await headers.count();
    test.skip(before === 0, 'No custom endpoints to delete');
    const header = headers.first();
    const trash = header.locator('button.icon-btn-danger');
    await trash.focus();
    await page.keyboard.press('Enter');
    await expect(headers).toHaveCount(before - 1);
    await expect(headers.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(unsavedBar(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Discard' }).click();
  });
});
