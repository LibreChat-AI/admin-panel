import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, lockBase } from './live';

/**
 * AI providers editor (WS9) journeys. They need a live LibreChat backend
 * whose librechat.yaml defines an `endpoints.all` block that sets activity
 * labels, Azure OpenAI groups, and no Anthropic model list: run with
 * E2E_LIVE=1 against such a stack. Set E2E_DISABLED_PROVIDER to a provider
 * the server does not enable (default `assistants`).
 */
test.skip(!LIVE, LIVE_SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 120_000 });
lockBase();

const DISABLED_PROVIDER = process.env.E2E_DISABLED_PROVIDER ?? 'assistants';

async function openProviders(page: Page) {
  await page.goto('/configuration?tab=providers');
  await expect(page.locator('form[aria-label]')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/** The provider card, opened. */
async function provider(page: Page, key: string): Promise<Locator> {
  const card = page.locator(`[id="section-endpoints.${key}"]`);
  const trigger = card.locator('.settings-section-trigger').first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return card;
}

/** A purpose group of a provider card, opened. */
async function group(card: Locator, providerKey: string, key: string): Promise<Locator> {
  const section = card.locator(`[id="section-endpoints.${providerKey}-${key}"]`);
  const trigger = section.locator('button[aria-expanded]').first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return section;
}

async function reviewAndSave(page: Page) {
  await page
    .getByRole('region', { name: 'Unsaved changes' })
    .getByRole('button', { name: /^Review & save$/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Save$/ }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

test('Global overrides come first and the tab lists Network access', async ({ page }) => {
  await openProviders(page);
  const cards = page.locator('section[data-settings-section][id^="section-endpoints."]');
  await expect(cards.first()).toHaveAttribute('id', 'section-endpoints.all');
  await expect(cards.last()).toHaveAttribute('id', 'section-endpoints.allowedAddresses');
  await expect(page.locator('[data-toc-id="section-endpoints.allowedAddresses"]')).toHaveText(
    'Network access',
  );
});

test('a provider the server does not enable says so in its header', async ({ page }) => {
  await openProviders(page);
  const header = page.locator(`[id="section-endpoints.${DISABLED_PROVIDER}"] .settings-heading`);
  await expect(header.getByText('Not enabled')).toBeVisible();
});

test('a provider title model shows that Global overrides win (D11)', async ({ page }) => {
  await openProviders(page);
  const titles = await group(await provider(page, 'openAI'), 'openAI', 'titles');
  await expect(titles.locator('.settings-banner')).toContainText(
    'LibreChat reads title settings only from them',
  );
  const model = page.locator('#endpoints-openAI-titleModel');
  await model.fill('gpt-e2e-title');
  await model.press('Tab');
  await expect(titles.getByText(/^Overridden by Global/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Discard$/ }).click();
});

test('Azure groups are read-only, with details in a drawer', async ({ page }) => {
  await openProviders(page);
  const card = await provider(page, 'azureOpenAI');
  await expect(card.getByText(/Azure groups are managed in librechat.yaml/)).toBeVisible();
  const details = card.getByRole('button', { name: /^Details of Azure group / }).first();
  await details.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Read-only. Change this group in librechat.yaml.')).toBeVisible();
  await expect(drawer.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(details).toBeFocused();
});

test('the Anthropic model list never ends up empty', async ({ page }) => {
  await openProviders(page);
  const models = await group(await provider(page, 'anthropic'), 'anthropic', 'models');
  await expect(models.getByRole('button', { name: 'Use provider defaults' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await models.getByRole('button', { name: 'Only these models' }).click();
  const input = models.getByPlaceholder(/Add models/);
  await input.fill('claude-e2e-model');
  await input.press('Enter');
  await reviewAndSave(page);
  await expect(models.getByText('claude-e2e-model')).toBeVisible();

  await models.getByRole('button', { name: 'Remove claude-e2e-model' }).click();
  await expect(models.getByText(/default model list is used/)).toBeVisible();
  await reviewAndSave(page);
  await expect(models.getByRole('button', { name: 'Start from defaults' })).toBeVisible({
    timeout: 30_000,
  });
});

test('Network access checks each address as it is typed', async ({ page }) => {
  await openProviders(page);
  const card = await provider(page, 'allowedAddresses');
  await card.getByRole('button', { name: /Add address/ }).click();
  const input = card.getByPlaceholder('host:port, e.g. localhost:11434');
  await input.fill('localhost');
  await input.press('Enter');
  await expect(card.getByRole('alert')).toHaveText('Add a port, for example localhost:11434.');
  await input.fill('http://localhost:11434');
  await input.press('Enter');
  await expect(card.getByRole('alert')).toHaveText(
    'Enter only host:port, without http:// or a path.',
  );
});
