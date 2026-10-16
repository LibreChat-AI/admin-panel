import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON } from './live';

/**
 * The YAML import wizard needs LibreChat's admin config API, which the mock
 * backend does not serve: run against a live stack with E2E_LIVE=1.
 */
test.skip(!LIVE, LIVE_SKIP_REASON);
test.describe.configure({ mode: 'serial', timeout: 90_000 });

async function openWizard(page: Page, yaml: string, scope?: string) {
  await page.goto(`/configuration?tab=system${scope ? `&scope=${scope}` : ''}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Import YAML/ }).click();
  await page.getByRole('tab', { name: 'Paste YAML' }).click();
  await page.getByRole('textbox', { name: 'Paste YAML' }).fill(yaml);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Where should these settings go?')).toBeVisible();
}

async function previewAndApply(page: Page, target: RegExp) {
  await page.getByRole('button', { name: 'Preview changes' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/selected for/)).toBeVisible();
  const apply = dialog.getByRole('button', { name: /^Import \d+ settings? into / });
  await expect(apply).toHaveText(target);
  return { dialog, apply };
}

/** Opens the USER role's profile, creating it on a clean database. */
async function ensureUserProfile(page: Page) {
  await page.goto('/configuration?tab=system&scope=role:USER');
  await page.waitForLoadState('networkidle');
  const create = page.getByRole('button', { name: 'Create profile' });
  if ((await create.count()) === 0) return;
  await create.click();
  await expect(page.getByRole('button', { name: /^Select scope: USER/ })).toBeVisible();
}

async function startBalanceIn(page: Page, scope?: string) {
  await page.goto(`/configuration?tab=system${scope ? `&scope=${scope}` : ''}`);
  await page.waitForLoadState('networkidle');
  return page.locator('#balance-startBalance');
}

test('imports a snippet into Base, previewing exactly its keys', async ({ page }) => {
  const value = 100000 + (Date.now() % 100000);
  await openWizard(
    page,
    `version: 1.3.3\nbalance:\n  startBalance: ${value}\ninterface:\n  prompts: false\n`,
  );
  await page.getByRole('radio', { name: /^Base configuration/ }).click();
  const { dialog, apply } = await previewAndApply(page, /into Base configuration$/);
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByText('Start balance')).toBeVisible();
  await expect(dialog.getByText(/Prompts: managed with role permissions/)).toBeVisible();
  await apply.click();
  await expect(
    page.getByText(/Imported 1 value into the base configuration/).first(),
  ).toBeVisible();
  await expect(await startBalanceIn(page)).toHaveValue(String(value));
});

test('imports into an existing profile, comparing with its own values', async ({ page }) => {
  const value = 200000 + (Date.now() % 100000);
  await ensureUserProfile(page);
  await openWizard(page, `balance:\n  startBalance: ${value}\n`, 'role:USER');
  await expect(page.getByRole('radio', { name: /This profile \(USER\)/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const { apply } = await previewAndApply(page, /into Role: USER$/);
  await apply.click();
  await expect(page.getByText(/Imported 1 value into Role: USER/).first()).toBeVisible();
  await expect(await startBalanceIn(page, 'role:USER')).toHaveValue(String(value));
});

test('imports into a role that has no profile yet', async ({ page }) => {
  await openWizard(page, `interface:\n  customWelcome: Imported ${Date.now()}\n`);
  await page.getByRole('radio', { name: /^A role, group or user/ }).click();
  const admin = page.getByRole('radio', { name: /ADMIN/ });
  await admin.click();
  const { dialog, apply } = await previewAndApply(page, /into Role: ADMIN$/);
  await expect(dialog.getByText('Custom welcome')).toBeVisible();
  await apply.click();
  await expect(page.getByText(/Imported 1 value into Role: ADMIN/).first()).toBeVisible();
});

test('creating a new role is a separate, labelled option', async ({ page }) => {
  const name = `Imported ${Date.now()}`;
  await openWizard(page, 'balance:\n  refillIntervalValue: 9\n');
  await page.getByRole('radio', { name: /^Create a new role or group/ }).click();
  await expect(page.getByText(/Also creates the role or group itself/)).toBeVisible();
  await page.getByLabel('Name').fill(name);
  const { apply } = await previewAndApply(page, new RegExp(`into New Role: ${name}$`));
  await apply.click();
  await expect(
    page.getByText(new RegExp(`Imported 1 value into Role: ${name}`)).first(),
  ).toBeVisible();
});

test('a YAML syntax error shows its line and column', async ({ page }) => {
  await page.goto('/configuration?tab=system');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Import YAML/ }).click();
  await page.getByRole('tab', { name: 'Paste YAML' }).click();
  await page.getByRole('textbox', { name: 'Paste YAML' }).fill('balance:\n  startBalance: [1\n');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/^Line \d+, column \d+$/)).toBeVisible();
});
