import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, openConfigTab } from './live';

/**
 * Files & storage and System journeys (WS14). They need a live LibreChat
 * backend: run with E2E_LIVE=1 and E2E_BASE_URL. Each journey discards or
 * reverts what it changes.
 */
const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

async function discard(page: Page) {
  await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
  await expect(unsavedBar(page)).toHaveCount(0);
}

test.describe('Files & storage and System editors', () => {
  test.skip(!LIVE, LIVE_SKIP_REASON);
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('switching the storage backend asks first and names what it needs', async ({ page }) => {
    await openConfigTab(page, 'files');
    const backend = page.getByLabel('Storage backend', { exact: true });
    const before = await backend.inputValue();
    await backend.selectOption('s3');
    const dialog = page.getByRole('dialog', { name: 'Switch file storage to Amazon S3?' });
    await expect(dialog).toContainText('AWS_BUCKET_NAME');
    await expect(dialog).toContainText('Nothing is moved');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(backend).toHaveValue(before);
    await expect(unsavedBar(page)).toHaveCount(0);

    await backend.selectOption('s3');
    await page.getByRole('button', { name: 'Switch to Amazon S3' }).click();
    await expect(backend).toHaveValue('s3');
    await discard(page);
  });

  test('a MIME list starts from the list in effect, so adding a type extends it', async ({
    page,
  }) => {
    await openConfigTab(page, 'files');
    await page.locator('button.settings-trigger', { hasText: 'OCR-eligible MIME types' }).click();
    const list = page.locator('#fileConfig-ocr-supportedMimeTypes');
    await expect(list).toContainText("Uses LibreChat's default list (8 patterns).");
    await list.getByRole('button', { name: 'Customize' }).click();
    await list.getByRole('button', { name: 'Add pattern' }).click();
    await page.getByRole('textbox', { name: 'New MIME type pattern' }).fill('.*');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Match every file type?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await list.getByRole('button', { name: 'Add pattern' }).click();
    await page.getByRole('textbox', { name: 'New MIME type pattern' }).fill('^text\\/rtf$');
    await page.keyboard.press('Enter');
    await expect(list).toContainText('Custom list (9 patterns)');
    await list.getByRole('textbox', { name: 'Test a MIME type' }).fill('text/rtf');
    await expect(list).toContainText('text/rtf files are sent to OCR');
    await discard(page);
  });

  test('an endpoint key outside the ones LibreChat looks up is refused', async ({ page }) => {
    await openConfigTab(page, 'files');
    const group = page.locator('[id="section-fileConfig.endpoints"]');
    await group.getByRole('button', { name: 'Add endpoint' }).first().click();
    const key = group.getByRole('combobox', { name: 'Key' });
    await key.fill('Agents');
    await key.press('Enter');
    await expect(group.getByRole('alert')).toContainText('Did you mean agents?');
    await group.getByRole('button', { name: 'Cancel' }).click();
    await expect(unsavedBar(page)).toHaveCount(0);
  });

  test('emptying the allowed sign-up domains asks first', async ({ page }) => {
    await openConfigTab(page, 'system');
    const chips = page.locator('#registration-allowedDomains li');
    const count = await chips.count();
    test.skip(count === 0, 'librechat.yaml sets no allowed domains');
    for (let i = 0; i < count; i++) {
      await chips.first().getByRole('button').click();
    }
    await expect(page.getByRole('dialog', { name: 'Let anyone sign up?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await discard(page);
  });

  test('starting credits read separators, and rate limits are a read-only table', async ({
    page,
  }) => {
    await openConfigTab(page, 'system');
    const start = page.getByLabel('Starting credits', { exact: true });
    await start.fill('2,500,000');
    await start.press('Tab');
    await expect(start).toHaveValue('2,500,000');
    await expect(page.getByText('Worth about $2.50 of model usage')).toBeVisible();
    await discard(page);

    const table = page.getByRole('table', { name: 'Rate limits' });
    await expect(table.getByRole('row', { name: /File uploads/ })).toContainText('requests /');
    await expect(table.getByRole('spinbutton')).toHaveCount(0);
  });
});
