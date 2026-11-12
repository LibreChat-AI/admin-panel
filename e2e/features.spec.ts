import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, lockBase, openConfigTab } from './live';

/**
 * Features tab journeys (WS13): the memory agent switch, allowlists, web
 * search credentials, the summarization trigger and the content filters
 * summary. They need a live LibreChat backend (E2E_LIVE=1, E2E_BASE_URL) and
 * clean up what they save. The memory journey runs only when librechat.yaml
 * defines the memory agent by ID.
 */

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });
const section = (page: Page, id: string) => page.locator(`#section-${id}`);

async function review(page: Page): Promise<Locator> {
  await unsavedBar(page)
    .getByRole('button', { name: /^Review & save$/ })
    .click();
  return page.getByRole('dialog');
}

async function saveAndWait(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Save$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Changes saved', { exact: true }).last()).toBeVisible();
}

async function setText(field: Locator, value: string) {
  await field.fill(value);
  await field.press('Tab');
}

test.describe('Features editors', () => {
  test.skip(!LIVE, LIVE_SKIP_REASON);
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  lockBase();

  test('the memory agent switches from a librechat.yaml ID to an inline model and back', async ({
    page,
  }) => {
    await openConfigTab(page, 'features');
    const memory = section(page, 'memory');
    const existing = memory.getByRole('button', { name: 'Existing agent' });
    test.skip(
      (await existing.getAttribute('aria-pressed')) !== 'true',
      'librechat.yaml does not define the memory agent by ID',
    );
    await memory.getByRole('button', { name: 'Provider and model' }).click();
    await expect(memory.getByText(/Saving hides Agent ID from librechat\.yaml/)).toBeVisible();
    await setText(memory.getByLabel('Provider', { exact: true }), 'openAI');
    await setText(memory.getByLabel('Model', { exact: true }), 'gpt-4o-mini');
    const dialog = await review(page);
    await expect(dialog).toContainText('Agent › Agent ID');
    await expect(dialog).toContainText('Hidden');
    await saveAndWait(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(memory.getByRole('button', { name: 'Provider and model' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(memory.getByLabel('Model', { exact: true })).toHaveValue('gpt-4o-mini');

    await memory.getByRole('button', { name: /^Revert to librechat\.yaml \(.*\): Agent$/ }).click();
    await review(page);
    await saveAndWait(page);
    await expect(memory.getByRole('button', { name: 'Existing agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('an Actions allowlist entry is validated and never blank', async ({ page }) => {
    await openConfigTab(page, 'features');
    const actions = section(page, 'actions');
    const input = actions.getByLabel('Allowed domains: add a domain');
    await input.press('Enter');
    await expect(unsavedBar(page)).toHaveCount(0);
    await input.fill('not a/domain');
    await input.press('Enter');
    await expect(actions.getByRole('alert')).toContainText('is not a domain');
    await input.fill('api.example.com');
    await input.press('Enter');
    await expect(actions.getByText(/^Only these domains are allowed \(1\)/)).toBeVisible();
    await review(page);
    await saveAndWait(page);

    await actions.getByRole('button', { name: 'Remove api.example.com' }).click();
    await expect(actions.getByRole('alertdialog')).toContainText('Remove the last domain?');
    await actions.getByRole('button', { name: 'Remove restriction' }).click();
    await expect(actions.getByText(/^No restriction: agent actions can call any/)).toBeVisible();
    await review(page);
    await saveAndWait(page);
  });

  test('a web search key is masked, reviewed as hidden and stored encrypted', async ({ page }) => {
    await openConfigTab(page, 'features');
    const web = section(page, 'webSearch');
    await web.getByLabel('Search provider', { exact: true }).selectOption('serper');
    const key = web.getByLabel('Serper API key', { exact: true });
    await key.fill('serper-e2e-secret-1234567890');
    await expect(key).toHaveAttribute('type', 'password');
    await key.press('Tab');
    await expect(web.getByText('Will be stored encrypted when you save.')).toBeVisible();
    const dialog = await review(page);
    await expect(dialog).not.toContainText('serper-e2e-secret');
    await saveAndWait(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(web.getByLabel('Serper API key is configured; value hidden')).toHaveValue(
      '...7890',
    );
    await expect(
      web.getByText('Stored encrypted. Only the last characters are shown.'),
    ).toBeVisible();

    await web
      .getByRole('button', { name: /^(Revert to .+|Remove override): Serper API key$/ })
      .click();
    await web
      .getByRole('button', { name: /^(Revert to .+|Remove override): Search provider$/ })
      .click();
    await review(page);
    await saveAndWait(page);
  });

  test('the summarization trigger saves a typed trigger and a valid number', async ({ page }) => {
    await openConfigTab(page, 'features');
    const summarization = section(page, 'summarization');
    await summarization.getByLabel('Trigger: when to summarize').selectOption('token_ratio');
    await expect(summarization.getByLabel('Trigger: value')).toHaveValue('0.8');
    await expect(
      summarization.getByText("Summarizes once 80% of the model's context window is used."),
    ).toBeVisible();
    const dialog = await review(page);
    await expect(dialog).toContainText('Token ratio');
    await saveAndWait(page);

    await summarization.getByLabel('Trigger: when to summarize').selectOption({ index: 0 });
    await review(page);
    await saveAndWait(page);
  });

  test('content filters are a read-only summary', async ({ page }) => {
    await openConfigTab(page, 'features');
    const filters = section(page, 'filters');
    const show = filters.getByRole('button', { name: /show all fields/i });
    if (await show.count()) await show.click();
    await expect(filters.getByText(/librechat\.yaml/).first()).toBeVisible();
    await expect(filters.locator('input, textarea, select')).toHaveCount(0);
  });
});
