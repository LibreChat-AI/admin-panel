import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Configuration specs need a LibreChat backend that serves the admin config
 * API; the default mock backend does not. Run them against a live stack with
 * `E2E_LIVE=1 E2E_BASE_URL=http://localhost:4386 npx playwright test`.
 */
export const LIVE = process.env.E2E_LIVE === '1';
export const LIVE_SKIP_REASON =
  'Needs a live LibreChat backend: set E2E_LIVE=1 and E2E_BASE_URL to a running admin panel';

export const CONFIG_TABS = [
  'providers',
  'custom',
  'specs',
  'mcp',
  'features',
  'files',
  'system',
] as const;

/** Opens a configuration tab and waits until its form has rendered real fields. */
export async function openConfigTab(page: Page, tab: string) {
  await page.goto(`/configuration?tab=${tab}`);
  const form = page.getByRole('form', { name: 'Configuration' });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}
