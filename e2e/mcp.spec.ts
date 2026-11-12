import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, lockBase } from './live';

/**
 * MCP server journeys (WS12) from the MCP audit. They need a real LibreChat
 * backend whose librechat.yaml defines the remote server E2E_MCP_REMOTE
 * (with an Authorization header) and the stdio server E2E_MCP_STDIO: run
 * with E2E_LIVE=1 and E2E_BASE_URL.
 */
const REMOTE = process.env.E2E_MCP_REMOTE ?? 'github';
const PLAIN = process.env.E2E_MCP_PLAIN ?? 'cloudflare';
const STDIO = process.env.E2E_MCP_STDIO ?? 'everything';

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });

async function openMcp(page: Page) {
  await page.goto('/configuration?tab=mcp');
  await page.waitForLoadState('networkidle');
}

/** The expanded card of the server `key`. */
async function card(page: Page, key: string): Promise<Locator> {
  const entry = page.locator(`[data-mcp-server="${key}"]`);
  await expect(entry).toHaveCount(1);
  const header = entry.locator('button[aria-expanded]').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  return entry;
}

async function openGroup(entry: Locator, title: string) {
  const trigger = entry.locator('.settings-group-header button', { hasText: title }).first();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
}

async function openMenu(page: Page, key: string) {
  await page
    .locator(`[data-mcp-server="${key}"]`)
    .getByRole('button', { name: `Actions for ${key}` })
    .click();
}

async function menu(page: Page, key: string, item: string | RegExp) {
  await openMenu(page, key);
  await page.getByRole('menuitem', { name: item }).click();
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

test.describe('Configuration: MCP servers', () => {
  test.skip(!LIVE, LIVE_SKIP_REASON);
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  lockBase();

  test('turning Show in chat menu on and back to Default leaves nothing to save (MCP-6)', async ({
    page,
  }) => {
    await openMcp(page);
    const entry = await card(page, PLAIN);
    await openGroup(entry, 'Display');
    const choice = entry.locator(`#mcpServers-${PLAIN}-chatMenu`);
    await choice.getByRole('button', { name: 'On', exact: true }).click();
    await expect(unsavedBar(page)).toBeVisible();
    await choice.getByRole('button', { name: /^Default/ }).click();
    await expect(unsavedBar(page)).toHaveCount(0);
  });

  test('a librechat.yaml header and the transport cannot be removed or changed (MCP-5)', async ({
    page,
  }) => {
    await openMcp(page);
    const entry = await card(page, REMOTE);
    await expect(entry.locator(`#mcpServers-${REMOTE}-headers`)).toBeVisible();
    await expect(
      entry.locator(`#mcpServers-${REMOTE}-headers`).getByRole('button', { name: /^Delete / }),
    ).toHaveCount(0);
    await expect(entry.locator(`select#mcpServers-${REMOTE}-type`)).toHaveCount(0);
    await openMenu(page, REMOTE);
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('a stdio server is read-only (D10)', async ({ page }) => {
    await openMcp(page);
    const entry = await card(page, STDIO);
    await expect(entry.getByRole('note').first()).toContainText('local process');
    await expect(entry.locator(`input#mcpServers-${STDIO}-command`)).toHaveCount(0);
    await openGroup(entry, 'Display');
    await expect(entry.locator(`input#mcpServers-${STDIO}-title`)).toHaveCount(0);
  });

  test('create, rename with an edit, and delete a server (MCP-4, MCP-9, MCP-12)', async ({
    page,
  }) => {
    const name = `e2e-${Date.now()}`;
    const renamed = `${name}-2`;
    await openMcp(page);

    await page.getByRole('button', { name: 'Create MCP server' }).click();
    const create = page.getByRole('dialog');
    await expect(create.locator('#mcpDraft-transport-streamable-http')).toBeChecked();
    await expect(create.locator('#mcpDraft-transport-stdio')).toBeDisabled();
    await create.getByLabel('Server name').fill(name);
    await expect(create).toContainText('Still needed: Server URL');
    await setText(create.locator('#mcpDraft-url'), 'https://mcp.e2e.example/mcp');
    await create.getByRole('button', { name: 'API key', exact: true }).click();
    const key = create.locator('#mcpDraft-apiKey-key');
    await expect(key).toHaveAttribute('type', 'password');
    await setText(key, 'sk-e2e-secret');
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(create).toHaveCount(0);

    let dialog = await review(page);
    await expect(dialog).toContainText(`Added MCP server ${name}`);
    await expect(dialog).not.toContainText('sk-e2e-secret');
    await saveAndWait(page);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await menu(page, name, 'Rename');
    const input = page.getByRole('textbox', { name: `Rename ${name}` });
    await input.fill(renamed);
    await input.press('Enter');
    const entry = await card(page, renamed);
    await openGroup(entry, 'Display');
    await setText(entry.locator(`#mcpServers-${renamed}-title`), 'Renamed in e2e');
    dialog = await review(page);
    await expect(dialog).toContainText(`(${name} → ${renamed})`);
    await expect(dialog).toContainText('Renamed in e2e');
    await saveAndWait(page);

    await menu(page, renamed, 'Delete');
    const ghost = page.locator(`[data-mcp-deleted="${renamed}"]`);
    await expect(ghost).toContainText('Will be deleted');
    await ghost.getByRole('button', { name: `Undo deleting ${renamed}` }).click();
    await expect(page.locator(`[data-mcp-server="${renamed}"]`)).toHaveCount(1);
    await menu(page, renamed, 'Delete');
    dialog = await review(page);
    await expect(dialog).toContainText(`Removed MCP server ${renamed}`);
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`[data-mcp-server="${renamed}"]`)).toHaveCount(0);
  });
});
