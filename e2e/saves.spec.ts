import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, lockBase } from './live';

/**
 * Save-pipeline journeys for custom endpoints (WS1). They need a real
 * LibreChat backend whose librechat.yaml defines custom endpoints (the mock
 * backend serves no config routes): run with E2E_LIVE=1, and set
 * E2E_YAML_ENDPOINT to an endpoint defined in that librechat.yaml.
 */
const YAML_ENDPOINT = process.env.E2E_YAML_ENDPOINT ?? 'Moonshot';

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

async function openCustomEndpoints(page: Page) {
  await page.goto('/configuration?tab=custom');
  await page.waitForLoadState('networkidle');
}

/** The editor drawer of the custom endpoint named `name`. */
async function card(page: Page, name: string): Promise<Locator> {
  const row = page.locator(`form li[data-endpoint-row="${name}"]`);
  await expect(row).toHaveCount(1);
  await row.locator('button[aria-haspopup="dialog"]').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name, exact: true })).toBeVisible();
  return drawer;
}

async function closeEditor(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function review(page: Page) {
  await unsavedBar(page)
    .getByRole('button', { name: /^Review & save$/ })
    .click();
  return page.getByRole('dialog');
}

async function saveAndWait(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Save$/ }).click();
  await expect(dialog).toHaveCount(0);
}

async function setText(field: Locator, value: string) {
  await field.fill(value);
  await field.press('Tab');
}

test.describe('Configuration saves: custom endpoints by identity', () => {
  test.skip(!LIVE, LIVE_SKIP_REASON);
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  lockBase();

  test('editing one field of a librechat.yaml endpoint saves only that change', async ({
    page,
  }) => {
    await openCustomEndpoints(page);
    const label = (await card(page, YAML_ENDPOINT)).getByRole('textbox', {
      name: 'Model display label',
    });
    const original = await label.inputValue();
    const edited = `E2E ${Date.now()}`;
    await setText(label, edited);
    await closeEditor(page);
    const dialog = await review(page);
    await expect(dialog).toContainText('Save 1 change to the base configuration?');
    await expect(dialog).toContainText(YAML_ENDPOINT);
    await expect(dialog).toContainText('Model display label');
    await saveAndWait(page);
    await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloaded = (await card(page, YAML_ENDPOINT)).getByRole('textbox', {
      name: 'Model display label',
    });
    await expect(reloaded).toHaveValue(edited);
    await setText(reloaded, original);
    await closeEditor(page);
    await review(page);
    await saveAndWait(page);
  });

  test('a librechat.yaml endpoint cannot be removed or renamed (D1)', async ({ page }) => {
    await openCustomEndpoints(page);
    const yamlCard = await card(page, YAML_ENDPOINT);
    await expect(yamlCard.getByRole('button', { name: 'Delete endpoint' })).toHaveCount(0);
    await expect(yamlCard.getByRole('textbox', { name: /^Name/ })).toHaveCount(0);
    await expect(yamlCard.locator('[data-static-value][id$="-name"]')).toHaveText(YAML_ENDPOINT);
  });

  test('an endpoint added in the panel can be renamed and deleted', async ({ page }) => {
    const name = `E2E Endpoint ${Date.now()}`;
    await openCustomEndpoints(page);
    await page.getByRole('button', { name: 'Create endpoint' }).first().click();
    const create = page.getByRole('dialog');
    await create.getByRole('button', { name: /^Blank endpoint/ }).click();
    await create.locator('#endpoints-custom-9999-name').fill(name);
    await create.locator('#endpoints-custom-9999-apiKey').fill('user_provided');
    await create.locator('#endpoints-custom-9999-baseURL').fill('https://e2e.example.com/v1');
    const model = create.getByLabel('Add models, comma-separated');
    await model.fill('e2e-model');
    await model.press('Enter');
    await create.getByRole('button', { name: 'Create endpoint', exact: true }).click();
    await closeEditor(page);
    await review(page);
    await saveAndWait(page);

    const editor = await card(page, name);
    await setText(editor.getByLabel(/^Name\s*\*?$/), `${name} 2`);
    await closeEditor(page);
    const dialog = await review(page);
    await expect(dialog).toContainText(`${name} 2`);
    await saveAndWait(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    const renamed = await card(page, `${name} 2`);
    await renamed.getByRole('button', { name: 'Delete endpoint' }).click();
    await review(page);
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`form li[data-endpoint-row="${name} 2"]`)).toHaveCount(0);
  });

  test('renaming an endpoint whose key is stored asks for the key again (CE-1)', async ({
    page,
  }) => {
    const name = `E2E Keyed ${Date.now()}`;
    await openCustomEndpoints(page);
    await page.getByRole('button', { name: 'Create endpoint' }).first().click();
    const create = page.getByRole('dialog');
    await create.getByRole('button', { name: /^Blank endpoint/ }).click();
    await create.locator('#endpoints-custom-9999-name').fill(name);
    await create.locator('#endpoints-custom-9999-apiKey').fill('sk-e2e-literal-key-0000ABCD');
    await create.locator('#endpoints-custom-9999-baseURL').fill('https://e2e.example.com/v1');
    const model = create.getByLabel('Add models, comma-separated');
    await model.fill('e2e-model');
    await model.press('Enter');
    await create.getByRole('button', { name: 'Create endpoint', exact: true }).click();
    await closeEditor(page);
    await review(page);
    await saveAndWait(page);

    const editor = await card(page, name);
    await setText(editor.getByLabel(/^Name\s*\*?$/), `${name} 2`);
    await expect(
      editor.getByRole('alert').filter({ hasText: /Enter the API key again/ }),
    ).toBeVisible();
    await closeEditor(page);
    const blocked = await review(page);
    await expect(blocked.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await blocked.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    const cleanup = await card(page, name);
    await cleanup.getByRole('button', { name: 'Delete endpoint' }).click();
    await review(page);
    await saveAndWait(page);
  });
});
