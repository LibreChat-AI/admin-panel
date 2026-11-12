import { test, expect } from '@playwright/test';
import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';
import { LIVE, LIVE_SKIP_REASON, lockBase, lockUserProfile, withBaseLock } from './live';

/**
 * Model specs journeys (WS11, the audit's specs journeys). They need a live
 * LibreChat backend whose librechat.yaml defines at least one model spec:
 * run with E2E_LIVE=1. They also need a Base that stores no spec list of its
 * own, so the list goes back to librechat.yaml before the first journey (a
 * failed run may have left one) and after every journey, passed or failed.
 */
const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });
const cards = (page: Page) => page.locator('#section-modelSpecs\\.list [data-entry-card]');

async function openSpecs(page: Page, search = '') {
  await page.goto(`/configuration?tab=specs${search}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /^Specs/ })).toBeVisible();
}

async function expand(card: Locator) {
  const header = card.locator('button[aria-expanded]').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
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

/**
 * Puts the spec list back to librechat.yaml when Base stores a list of its own.
 * It opens a page in a context of its own, so it runs before the first journey,
 * which has no page yet, and after each journey whatever that journey left on
 * its page: a review dialog, unsaved edits or a phone-width viewport.
 */
async function revertList(browser: Browser, { baseURL, storageState }: BrowserContextOptions) {
  const context = await browser.newContext({ baseURL, storageState });
  try {
    const page = await context.newPage();
    await openSpecs(page);
    const revert = page.getByRole('button', { name: 'Revert list to librechat.yaml' });
    if ((await revert.count()) === 0) return;
    await revert.click();
    await review(page);
    await saveAndWait(page);
    await expect(revert).toHaveCount(0);
  } finally {
    await context.close();
  }
}

/**
 * Adds a spec with the four required fields, and returns its card. A new spec
 * opens on Label, with Basics before the open Model group (Endpoint, Model),
 * the order a saved spec shows.
 */
async function addSpec(page: Page, label: string, endpoint: string, model: string) {
  await page.getByRole('button', { name: 'Add spec' }).click();
  const card = cards(page).last();
  await expect(card.getByLabel(/^Label\*?$/)).toBeFocused();
  await card.getByLabel(/^Label\*?$/).fill(label);
  await card.getByLabel(/^Label\*?$/).press('Tab');
  await card.getByLabel(/^Endpoint\*?$/).selectOption(endpoint);
  await card.getByRole('combobox', { name: /^Model\*?$/ }).fill(model);
  await card.getByRole('combobox', { name: /^Model\*?$/ }).press('Tab');
  return card;
}

test.describe('Model specs', () => {
  test.skip(!LIVE, LIVE_SKIP_REASON);
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  test.beforeAll(({ browser }, testInfo) =>
    withBaseLock(testInfo, () => revertList(browser, testInfo.project.use)),
  );
  lockBase(({ browser }, testInfo) => revertList(browser, testInfo.project.use));

  test('the tab says how users pick models and what they will see', async ({ page }) => {
    await openSpecs(page);
    await expect(page.getByRole('group', { name: 'How users pick models' })).toBeVisible();
    await expect(page.getByText('Users will see:')).toBeVisible();
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByText('List order is the order of the model menu.')).toBeVisible();
  });

  test('a new spec asks for Endpoint and Model up front and saves at the end of the list', async ({
    page,
  }) => {
    await openSpecs(page);
    const before = await cards(page).count();
    const card = await addSpec(page, 'E2E Spec', 'openAI', 'gpt-4o-mini');
    await expect(card.getByLabel(/^Name\*?$/)).toHaveValue('e2e-spec');
    const dialog = await review(page);
    await expect(dialog).toContainText('Added model spec');
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(cards(page)).toHaveCount(before + 1);
    await expect(cards(page).last()).toContainText('E2E Spec');
    await expect(cards(page).last()).toContainText('OpenAI · gpt-4o-mini');
  });

  test('duplicate names and incomplete specs block Save', async ({ page }) => {
    await openSpecs(page);
    const first = cards(page).first();
    await expand(first);
    const name = await first.getByLabel(/^Name\*?$/).inputValue();
    const card = await addSpec(page, 'Copy', 'openAI', 'gpt-4o');
    await card.getByLabel(/^Name\*?$/).fill(name);
    await card.getByLabel(/^Name\*?$/).press('Tab');
    await expect(card.getByText('already uses this name')).toBeVisible();
    const dialog = await review(page);
    await expect(dialog.getByText(/must be fixed before saving/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Save$/ })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
  });

  test('only one spec can be the default', async ({ page }) => {
    await openSpecs(page);
    await addSpec(page, 'E2E A', 'openAI', 'gpt-4o');
    const b = await addSpec(page, 'E2E B', 'openAI', 'gpt-4o');
    const a = cards(page).nth((await cards(page).count()) - 2);
    for (const card of [a, b]) {
      await expand(card);
      await card.getByRole('button', { name: /^New chats/ }).click();
      await card.getByRole('button', { name: 'Default', exact: true }).click();
    }
    const pressed = (card: Locator) =>
      card.getByRole('button', { name: 'Default', exact: true }).getAttribute('aria-pressed');
    expect(await pressed(a)).toBe('false');
    expect(await pressed(b)).toBe('true');
    await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
  });

  test('reordering is saved (list order is menu order)', async ({ page }) => {
    await openSpecs(page);
    await addSpec(page, 'E2E Last', 'openAI', 'gpt-4o');
    await review(page);
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Move E2E Last up' }).click();
    const dialog = await review(page);
    await expect(dialog).toContainText('Order changed');
    await saveAndWait(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    const count = await cards(page).count();
    await expect(cards(page).nth(count - 2)).toContainText('E2E Last');
  });

  test('Enter in a spec field never adds or removes an endpoint next to the specs', async ({
    page,
  }) => {
    await openSpecs(page);
    const card = cards(page).first();
    await expand(card);
    await card.getByLabel(/^Label\*?$/).press('Enter');
    await card.getByRole('combobox', { name: /^Model\*?$/ }).press('Enter');
    await card.getByLabel('Model label', { exact: true }).press('Enter');
    await expect(unsavedBar(page)).toHaveCount(0);
    const picker = page.locator('#modelSpecs-addedEndpoints-add');
    await expect(picker.locator('option[value=""]')).toHaveCount(0);
  });

  test('an Anthropic spec offers only Anthropic parameters', async ({ page }) => {
    await openSpecs(page);
    const card = await addSpec(page, 'E2E Claude', 'anthropic', 'claude-sonnet-4-5');
    await card.getByRole('button', { name: /^Parameters/ }).click();
    await expect(card.getByLabel('Top K', { exact: true })).toBeVisible();
    await expect(card.getByLabel('Thinking budget', { exact: true })).toBeVisible();
    await expect(card.getByLabel('Frequency penalty', { exact: true })).toHaveCount(0);
    await expect(card.getByLabel('Reasoning effort', { exact: true })).toHaveCount(0);
    await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
  });

  test('a deleted spec waits for Save with Undo', async ({ page }) => {
    await openSpecs(page);
    const before = await cards(page).count();
    const title = (await cards(page).first().locator('span.truncate').first().innerText()).trim();
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(page.getByRole('button', { name: new RegExp(`Undo.*${title}`) })).toBeFocused();
    await page.getByRole('button', { name: new RegExp(`Undo.*${title}`) }).click();
    await expect(cards(page)).toHaveCount(before);
    await expect(unsavedBar(page)).toHaveCount(0);
  });

  test.describe('the USER role profile', () => {
    lockUserProfile();

    test('a profile shows the specs it inherits read-only until it customizes the list', async ({
      page,
    }) => {
      await openSpecs(page, '&scope=role:USER');
      const customize = page.getByRole('button', { name: /^Override for Role: USER/ });
      test.skip((await customize.count()) === 0, 'Needs a USER role profile without its own list');
      await expect(page.getByRole('button', { name: 'Add spec' })).toHaveCount(0);
      await expect(cards(page).first()).toBeVisible();
      await customize.click();
      await expect(page.getByRole('button', { name: 'Add spec' })).toBeVisible();
      await expect(page.getByText(/replaces Base's list/)).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('button', { name: 'Add spec' })).toHaveCount(0);
    });
  });

  test('the tab filter finds spec fields and phone width has no sideways scroll', async ({
    page,
  }) => {
    await openSpecs(page);
    await page.getByPlaceholder('Filter this tab…').fill('soft default');
    await expect(page.getByText('Default for new chats').first()).toBeVisible();
    await page.getByPlaceholder('Filter this tab…').fill('');
    await page.setViewportSize({ width: 390, height: 900 });
    await expand(cards(page).first());
    const overflow = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.scrollbar-gutter-stable');
      return el ? el.scrollWidth - el.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
