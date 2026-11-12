import path from 'path';
import { fileURLToPath } from 'url';

import { test as setup, expect } from '@playwright/test';

const authFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../playwright/.auth/admin.json',
);

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

setup('authenticate as admin', async ({ page }) => {
  if (!email || !password) {
    throw new Error(
      'Missing E2E_ADMIN_EMAIL or E2E_ADMIN_PASSWORD environment variables. ' +
        'Set them to valid admin credentials before running e2e tests:\n' +
        '  E2E_ADMIN_EMAIL=you@example.com E2E_ADMIN_PASSWORD=secret npx playwright test',
    );
  }

  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  await page.locator('input:not([type="password"])').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  const errorBanner = page.locator('[role="alert"]');
  await expect(errorBanner).not.toBeVisible({ timeout: 5_000 });

  await page.waitForURL('**/', { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
