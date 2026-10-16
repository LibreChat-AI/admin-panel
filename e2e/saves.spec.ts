import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON } from './live';

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

/** The expanded card of the custom endpoint named `name`. */
async function card(page: Page, name: string): Promise<Locator> {
  const entry = page.locator('[id^="section-endpoints-custom-"]').filter({
    has: page.locator('span.truncate').getByText(name, { exact: true }),
  });
  await expect(entry).toHaveCount(1);
  const header = entry.locator('button[aria-expanded]').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  return entry;
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

  test('editing one field of a librechat.yaml endpoint saves only that change', async ({
    page,
  }) => {
    await openCustomEndpoints(page);
    const label = (await card(page, YAML_ENDPOINT)).getByLabel('Model display label');
    const original = await label.inputValue();
    const edited = `E2E ${Date.now()}`;
    await setText(label, edited);
    const dialog = await review(page);
    await expect(dialog).toContainText('Save 1 change to the base configuration?');
    await expect(dialog).toContainText(YAML_ENDPOINT);
    await expect(dialog).toContainText('Model display label');
    await saveAndWait(page);
    await expect(page.getByText('Changes saved', { exact: true })).toBeVisible();

    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloaded = (await card(page, YAML_ENDPOINT)).getByLabel('Model display label');
    await expect(reloaded).toHaveValue(edited);
    await setText(reloaded, original);
    await review(page);
    await saveAndWait(page);
  });

  test('a librechat.yaml endpoint cannot be removed or renamed (D1)', async ({ page }) => {
    await openCustomEndpoints(page);
    await expect(page.locator(`button[aria-label="Delete ${YAML_ENDPOINT}"]`)).toHaveCount(0);

    const yamlCard = await card(page, YAML_ENDPOINT);
    await expect(yamlCard.getByRole('textbox', { name: /^Name/ })).toHaveCount(0);
    await expect(yamlCard.locator('[data-static-value][id$="-name"]')).toHaveText(YAML_ENDPOINT);
  });

  test('an endpoint added in the panel can be renamed and deleted', async ({ page }) => {
    const name = `E2E Endpoint ${Date.now()}`;
    await openCustomEndpoints(page);
    await page
      .getByRole('button', { name: /Create endpoint/ })
      .first()
      .click();
    const create = page.getByRole('dialog');
    await create.locator('#create-endpoint-name').fill(name);
    await create.locator('#create-endpoint-apiKey').fill('user_provided');
    await create.locator('#create-endpoint-baseURL').fill('https://e2e.example.com/v1');
    const model = create.getByLabel('Add models, comma-separated');
    await model.fill('e2e-model');
    await model.press('Enter');
    await create.getByRole('button', { name: /^Create$/ }).click();
    await review(page);
    await saveAndWait(page);

    await setText((await card(page, name)).getByLabel(/^Name\s*\*?$/), `${name} 2`);
    const dialog = await review(page);
    await expect(dialog).toContainText(`${name} 2`);
    await saveAndWait(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator(`button[aria-label="Delete ${name} 2"]`).click();
    await review(page);
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`button[aria-label="Delete ${name} 2"]`)).toHaveCount(0);
  });
});
