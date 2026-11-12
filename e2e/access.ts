import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A name no other test, worker or run holds, so parallel live runs never create
 * the same role (LibreChat refuses it) or two groups with one Delete button name.
 */
export function uniqueName(prefix: string) {
  return `${prefix} ${randomUUID()}`;
}

/** The tab's search field: click-ui's SearchField renders a textbox, not a searchbox. */
export const searchField = (page: Page) => page.getByRole('textbox', { name: /^search/i });

/** What each Access tab shows when its search matches nothing. */
const NO_MATCHES = { roles: 'No matching results', groups: 'No groups found' } as const;

const deleteButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Delete ${name}`, exact: true });

/**
 * Searches the tab for the name and reports whether it lists a role or group
 * with exactly that name. Searching finds it past the first page of the list.
 */
export async function isListed(page: Page, tab: 'roles' | 'groups', name: string) {
  await page.goto(`/access?tab=${tab}`);
  await searchField(page).fill(name);
  const row = deleteButton(page, name);
  await expect(row.or(page.getByText(NO_MATCHES[tab], { exact: true }))).toBeVisible();
  return row.isVisible();
}

async function deleteIfListed(page: Page, tab: 'roles' | 'groups', name: string) {
  if (!(await isListed(page, tab, name))) return;
  await deleteButton(page, name).click();
  const confirmDialog = page.getByRole('dialog');
  await confirmDialog.getByRole('button', { name: /delete/i }).click();
  await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });
  await expect(deleteButton(page, name)).toHaveCount(0);
}

/**
 * Deletes each listed role or group with its row's Delete button, so a test
 * leaves none behind. A name the tab does not list is skipped, and a failed
 * delete does not stop the others: the first failure is thrown at the end.
 */
export async function deleteFromList(page: Page, tab: 'roles' | 'groups', ...names: string[]) {
  const failures: Error[] = [];
  for (const name of names) {
    await deleteIfListed(page, tab, name).catch((error: Error) => failures.push(error));
  }
  if (failures.length > 0) throw failures[0];
}

/** Creates a group with the Create Group dialog, as a live run stages the groups a test lists. */
export async function createGroup(page: Page, name: string) {
  await page.goto('/access?tab=groups');
  await page.getByRole('button', { name: /create group/i }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('#create-group-name').fill(name);
  await dialog.getByRole('button', { name: /create group/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/** Creates a role with the Create Role dialog. */
export async function createRole(page: Page, name: string) {
  await page.goto('/access?tab=roles');
  await page.getByRole('button', { name: /create role/i }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('#create-role-name').fill(name);
  await dialog.getByRole('button', { name: /create role/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/** Renames a role in its Edit Role dialog. */
export async function renameRole(page: Page, from: string, to: string) {
  await page.goto('/access?tab=roles');
  await searchField(page).fill(from);
  await page.getByText(from, { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.locator('#edit-role-name').fill(to);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/**
 * Opens the Grants page on the role's row, which reads "No capabilities" or
 * "N capabilities"; a click anywhere on it presses its Edit capabilities button.
 */
export async function grantsRow(page: Page, role: string) {
  await page.goto('/grants');
  await searchField(page).fill(role);
  const edit = page.getByRole('button', { name: `Edit capabilities for ${role}`, exact: true });
  return page.getByRole('row').filter({ has: edit });
}

/** Grants the role Read usage on the Grants page. */
export async function grantReadUsage(page: Page, role: string) {
  await (await grantsRow(page, role)).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('System', { exact: true }).click();
  await dialog.getByRole('switch', { name: 'System: Read usage' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}
