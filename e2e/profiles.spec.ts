import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON } from './live';

/**
 * Profile (scope) lifecycle against a live LibreChat backend: the mock backend
 * serves no admin config routes. Run with E2E_LIVE=1 and
 * E2E_PROFILE_USER set to the email of a user that has no profile yet.
 */
const USER_EMAIL = process.env.E2E_PROFILE_USER ?? '';

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });
const contextBar = (page: Page) => page.getByRole('region', { name: 'Profile being edited' });

async function openSelector(page: Page) {
  await page.getByRole('button', { name: /^Select scope:/ }).click();
  return page.getByPlaceholder('Search profiles…');
}

test.describe('Configuration: profile lifecycle', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  test.skip(!LIVE || !USER_EMAIL, `${LIVE_SKIP_REASON}, and E2E_PROFILE_USER`);

  test('create, find, edit, gate, guard and delete a user profile', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });
    await page.goto('/configuration?tab=system');
    await page.waitForLoadState('networkidle');

    await openSelector(page);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByPlaceholder('Search roles, groups and users…').fill(USER_EMAIL);
    const candidate = page.getByRole('option', { name: new RegExp(USER_EMAIL) });
    await candidate.click();

    const bar = contextBar(page);
    await expect(bar).toContainText('Editing overrides for');
    await expect(bar).toContainText(`(${USER_EMAIL})`);
    await expect(bar).toContainText('Priority 100');
    await expect(bar).toContainText('No overrides yet');
    const name = (await bar.locator('strong').innerText()).replace(/^User: /, '').split(' (')[0];

    const search = await openSelector(page);
    await search.fill(name.split(' ')[0].toLowerCase());
    await expect(page.getByRole('option', { name: new RegExp(`^${name}`) })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator('#section-registration [role=note]')).toContainText(
      'applies to everyone',
    );
    await expect(page.locator('#section-registration input:not([disabled])')).toHaveCount(0);

    const startBalance = page.locator('#balance-startBalance');
    await startBalance.fill('4321');
    await startBalance.press('Tab');
    await expect(unsavedBar(page)).toHaveCount(1);

    await openSelector(page);
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    expect(dialogs).toEqual([]);
    await expect(unsavedBar(page)).toHaveCount(1);
    await expect(startBalance).toHaveValue('4321');

    await openSelector(page);
    const trash = page.getByRole('option', { name: new RegExp(`^Delete profile ${name}`) });
    await expect(trash).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    await unsavedBar(page)
      .getByRole('button', { name: /^Review & save$/ })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Save$/ })
      .click();
    await expect(unsavedBar(page)).toHaveCount(0);
    await expect(bar).toContainText('1 override');

    await openSelector(page);
    await page.getByRole('option', { name: new RegExp(`^Delete profile ${name}`) }).click({
      force: true,
    });
    await page.getByRole('button', { name: 'Delete configuration' }).click();
    await expect(page.getByRole('option', { name: new RegExp(`^${name}`) })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(contextBar(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Select scope: Base configuration' }),
    ).toBeVisible();
  });
});
