import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  LIVE,
  THEMES,
  WCAG_TAGS,
  lockBase,
  CONFIG_TABS,
  openConfigTab,
  lockUserProfile,
  LIVE_SKIP_REASON,
  selectUserRoleProfile,
  deleteUserRoleProfile,
} from '../live';

/**
 * Accessibility and visual-system guardrails for the configuration page (VS-12):
 * axe on every tab at 1440 and 390 px in both themes, layout invariants of the
 * settings grid, and screenshot baselines. Needs a live backend (see ../live.ts).
 * The baselines show librechat.yaml values only: refresh them with
 * `--update-snapshots` after intended visual changes, on a Base that stores no
 * admin overrides.
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
] as const;
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);
const MAX_EXPAND_CLICKS = 250;

/** Opens collapsed sections and groups (not entry cards or select triggers) so axe sees their rows. */
async function expandSections(page: Page) {
  const triggers = page.locator(
    'form :is(h2, h3, h4, h5, h6) > button[aria-expanded="false"]:not([aria-haspopup])',
  );
  for (let clicks = 0; clicks < MAX_EXPAND_CLICKS; clicks++) {
    const next = triggers.first();
    if ((await next.count()) === 0) break;
    await next.click();
  }
  await expect(page.locator('form .config-section-grid-closed:not([inert])')).toHaveCount(0);
  await page.waitForTimeout(300);
}

async function hideDevtools(page: Page) {
  await page.addStyleTag({
    content: 'button[aria-label="Open TanStack Devtools"] { display: none !important; }',
  });
}

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`axe: ${theme} ${viewport.label}px`, () => {
      test.use({
        colorScheme: theme,
        viewport: { width: viewport.width, height: viewport.height },
      });
      test.describe.configure({ timeout: 120_000 });

      for (const tab of CONFIG_TABS) {
        test(`${tab} has no serious or critical violations`, async ({ page }) => {
          await openConfigTab(page, tab);
          await hideDevtools(page);
          await expandSections(page);
          const results = await new AxeBuilder({ page }).analyze();
          const blocking = results.violations
            .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
            .map((violation) => ({
              rule: violation.id,
              impact: violation.impact,
              targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
            }));
          expect(blocking).toEqual([]);
        });
      }
    });
  }
}

/** Serious or critical axe violations inside the open dialog. */
async function dialogViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    }));
}

for (const theme of THEMES) {
  test.describe(`axe on dialogs: ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1440, height: 900 } });

    test('search, with a result selected', async ({ page }) => {
      await openConfigTab(page, 'system');
      await page.keyboard.press('Control+k');
      await page.keyboard.type('title');
      await expect(page.locator('[cmdk-item]').first()).toBeVisible();
      await page.keyboard.press('ArrowDown');
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the change review', async ({ page }) => {
      await openConfigTab(page, 'system');
      const field = page.locator('#balance-refillAmount');
      await field.fill('12345');
      await field.press('Tab');
      await page.getByRole('button', { name: 'Review & save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the change review of a spec list taking over librechat.yaml (its warning text)', async ({
      page,
    }) => {
      await openConfigTab(page, 'specs');
      const card = page.locator('[data-entry-card]').first();
      test.skip((await card.count()) === 0, 'No model specs');
      await card.locator('button[aria-expanded]').first().click();
      const label = page.locator('#modelSpecs-list-0-label');
      await label.fill(`${await label.inputValue()} (review)`);
      await label.press('Tab');
      await page.getByRole('button', { name: 'Review & save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the import wizard', async ({ page }) => {
      await openConfigTab(page, 'system');
      await page.getByRole('button', { name: 'Import YAML' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
}

/** The Wave 2 editors' overlays at phone width, where their bodies scroll. */
for (const theme of THEMES) {
  test.describe(`axe on editor overlays: ${theme} 390px`, () => {
    test.use({ colorScheme: theme, viewport: { width: 390, height: 844 } });

    test('the Azure group details drawer', async ({ page }) => {
      await openConfigTab(page, 'providers');
      await page.locator('#section-endpoints\\.azureOpenAI .settings-section-trigger').click();
      /** The group with the longest model list, so the drawer body scrolls at this height. */
      const counts = await page
        .locator('.azure-groups-table tbody tr .azure-col-number')
        .allInnerTexts();
      const longest = counts.reduce(
        (best, text, i) => (Number(text) > Number(counts[best]) ? i : best),
        0,
      );
      await page
        .getByRole('button', { name: /^Details of Azure group/ })
        .nth(longest)
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('the custom endpoint editor drawer', async ({ page }) => {
      await openConfigTab(page, 'custom');
      await page.locator('li[data-endpoint-row] button[aria-haspopup="dialog"]').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('Create endpoint', async ({ page }) => {
      await openConfigTab(page, 'custom');
      await page.getByRole('button', { name: 'Create endpoint' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });

    test('Create MCP server', async ({ page }) => {
      await openConfigTab(page, 'mcp');
      await page.getByRole('button', { name: 'Create MCP server' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
}

test.describe('row action menus', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('custom: an action that opens the editor leaves focus in it', async ({ page }) => {
    await openConfigTab(page, 'custom');
    const trigger = page.getByRole('button', { name: /^Actions for / }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => drawer.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
  });

  for (const tab of ['custom', 'mcp'] as const) {
    test(`${tab}: Escape returns focus to the menu button`, async ({ page }) => {
      await openConfigTab(page, tab);
      const trigger = page.getByRole('button', { name: /^Actions for / }).first();
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  }
});

test.describe('settings layout invariants (1440px, light)', () => {
  test.use({
    colorScheme: 'light',
    contextOptions: { reducedMotion: 'reduce' },
    viewport: { width: 1440, height: 900 },
  });
  test.describe.configure({ timeout: 120_000 });

  for (const tab of CONFIG_TABS) {
    test(`${tab}: full-opacity rows, one control column, headed sections`, async ({ page }) => {
      await openConfigTab(page, tab);
      await expandSections(page);

      const report = await page.evaluate(() => {
        const CONTAINERS = [
          'settings-section-body',
          'settings-group-body',
          'settings-section',
          'settings-group',
          'settings-section-sole',
          'config-section-inner',
          'config-section-grid',
        ];
        const form = document.querySelector('form.settings-content');
        const rows = [...document.querySelectorAll<HTMLElement>('form .settings-row')].filter(
          (row) => !row.closest('[inert]'),
        );

        const faded = rows.filter((row) => {
          for (let el: HTMLElement | null = row; el && el !== form; el = el.parentElement) {
            if (Number(getComputedStyle(el).opacity) < 1) return true;
          }
          return false;
        });

        /** Rows placed by the settings containers themselves (not inside entry cards). */
        const gridRows = rows.filter((row) => {
          for (let el = row.parentElement; el && el !== form; el = el.parentElement) {
            if (!CONTAINERS.some((name) => el.classList.contains(name))) return false;
          }
          return row.getBoundingClientRect().height > 0;
        });
        /** The control cell, or a bare control a single-field section places in that column. */
        const controlCell = (row: HTMLElement) =>
          row.querySelector(
            ':scope > .settings-row-control, :scope > .settings-row-sole > .settings-row-control',
          ) ??
          row.querySelector(
            ':scope > :not(.settings-row-label, .settings-row-trailing, .settings-row-sole)',
          );
        const controlXs = new Set(
          gridRows.map((row) => Math.round(controlCell(row)?.getBoundingClientRect().left ?? -1)),
        );

        const unheadedSections = [
          ...document.querySelectorAll<HTMLElement>('form section[data-settings-section]'),
        ].filter((section) => !section.querySelector('h2'));
        const unheadedGroups = [
          ...document.querySelectorAll<HTMLElement>('form section.settings-group'),
        ].filter((group) => !group.querySelector(':scope > div :is(h3, h4, h5, h6)'));

        return {
          rows: rows.length,
          faded: faded.map((row) => row.querySelector('.settings-label')?.textContent ?? ''),
          gridRows: gridRows.length,
          controlXs: [...controlXs],
          unheadedSections: unheadedSections.map((s) => s.id),
          unheadedGroups: unheadedGroups.map((g) => g.id),
        };
      });

      expect(report.faded, 'rows drawn below full opacity').toEqual([]);
      expect(report.unheadedSections).toEqual([]);
      expect(report.unheadedGroups).toEqual([]);
      if (report.gridRows > 0) {
        expect(report.controlXs, 'every settings control starts at the same x').toHaveLength(1);
      }
    });
  }
});

const VISUAL_TABS = ['system', 'features', 'custom'] as const;
const VISUAL_VARIANTS = [
  { label: 'light-1440', colorScheme: 'light', width: 1440, height: 1100 },
  { label: 'dark-1440', colorScheme: 'dark', width: 1440, height: 1100 },
  { label: 'light-390', colorScheme: 'light', width: 390, height: 1100 },
] as const;

/**
 * Opens a tab and checks that Base stores no admin overrides. An override draws
 * its tab's override count into every baseline, the header's revert action into
 * the 1440 px ones, and its chip and section count into its own tab's. Each
 * journey that saves to Base holds the Base lock until it has reverted, and the
 * baseline holds it until its screenshot is taken, so an override found here was
 * left by a run that failed before reverting, or saved by a test that does not
 * take the lock. It fails naming its tabs ("System: 1 admin override") before a
 * screenshot is compared or written by `--update-snapshots`.
 */
async function openWithoutBaseOverrides(page: Page, tab: string) {
  await openConfigTab(page, tab);
  await expect(
    page.getByRole('tab', { selected: true }).locator('.config-tab-count').first(),
  ).toBeVisible();
  const overridden = await page
    .getByRole('tab')
    .filter({ has: page.locator('.config-tab-count-override') })
    .evaluateAll((tabs: HTMLElement[]) =>
      tabs.map((el) => {
        const count = el.querySelector('.config-tab-count-override')?.getAttribute('title');
        return `${el.innerText.split('\n')[0]}: ${count}`;
      }),
    );
  expect(overridden, 'Tabs where Base stores admin overrides, which no baseline shows').toEqual([]);
}

for (const variant of VISUAL_VARIANTS) {
  test.describe(`visual baseline: ${variant.label}`, () => {
    test.use({
      colorScheme: variant.colorScheme,
      viewport: { width: variant.width, height: variant.height },
    });
    lockBase();
    lockUserProfile();

    for (const tab of VISUAL_TABS) {
      test(`${tab}`, async ({ page }) => {
        await openWithoutBaseOverrides(page, tab);
        await hideDevtools(page);
        await expect(page).toHaveScreenshot(`${tab}-${variant.label}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}

test.describe('dialogs give focus back to what opened them', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('Create MCP server, closed with Escape', async ({ page }) => {
    await openConfigTab(page, 'mcp');
    const create = page.getByRole('button', { name: 'Create MCP server' });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(create).toBeFocused();
  });

  test('the change review, closed with Escape', async ({ page }) => {
    await openConfigTab(page, 'system');
    const field = page.locator('#balance-refillAmount');
    await field.fill('12345');
    await field.press('Tab');
    const review = page.getByRole('button', { name: 'Review & save' });
    await review.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(review).toBeFocused();
  });
});

test.describe('custom endpoint drawer', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('a section link scrolls the drawer to its section', async ({ page }) => {
    await openConfigTab(page, 'custom');
    await page.locator('li[data-endpoint-row] button[aria-haspopup="dialog"]').first().click();
    const drawer = page.locator('[data-endpoint-drawer]');
    await expect(drawer).toBeVisible();
    const links = drawer.locator('nav a');
    await links.last().click();
    await expect(links.last()).toHaveAttribute('aria-current', 'location');
    const scrolled = () =>
      drawer.locator('nav').evaluate((nav) => {
        let node = nav.parentElement;
        while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
          node = node.parentElement;
        }
        return node?.scrollTop ?? 0;
      });
    await expect.poll(scrolled).toBeGreaterThan(0);
  });
});

/** Every WCAG 2.0 and 2.1 A and AA violation axe finds, in `selector` when given. */
async function wcagViolations(page: Page, selector?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  const results = await (selector ? builder.include(selector) : builder).analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
  }));
}

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'Unsaved changes' });
const activeTab = (page: Page) => page.locator('[role="tab"][data-state="active"]');

/** Marks the status regions on the page now, so a test can tell a message put into one from a region mounted with it. */
async function markStatusRegions(page: Page) {
  await page
    .locator('[role="status"]')
    .evaluateAll((regions) =>
      regions.forEach((region) => region.setAttribute('data-e2e-before', '')),
    );
  return page.locator('[role="status"][data-e2e-before]');
}

/** Waits two frames, so focus a deferred restore would move has moved. */
async function settleFrames(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function reviewAndSave(page: Page) {
  await unsavedBar(page)
    .getByRole('button', { name: /^Review & save$/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Save$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(unsavedBar(page)).toHaveCount(0);
}

/** Opens Create endpoint and starts a blank endpoint; returns the drawer. */
async function startBlankEndpoint(page: Page) {
  await openConfigTab(page, 'custom');
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  const drawer = page.getByRole('dialog');
  const blank = drawer.getByRole('button', { name: /^Blank endpoint/ });
  await blank.focus();
  await page.keyboard.press('Enter');
  return drawer;
}

/**
 * Views a dialog swaps in place of another: the control that swapped them is
 * gone, so focus must land in the new view (not on the dialog itself), and
 * the new view must pass the WCAG scan.
 */
for (const theme of THEMES) {
  test.describe(`views swapped in place: ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1440, height: 900 } });

    test('Create endpoint, its blank form: focus on Name, no WCAG violations', async ({ page }) => {
      const drawer = await startBlankEndpoint(page);
      await expect(drawer.locator('#endpoints-custom-9999-name')).toBeFocused();
      expect(await wcagViolations(page, '[role="dialog"]')).toEqual([]);
    });

    test('the Preview drawer after Change: focus in the search, no WCAG violations', async ({
      page,
    }) => {
      await openConfigTab(page, 'system');
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', { name: 'Change' }).focus();
      await page.keyboard.press('Enter');
      await expect(drawer.getByRole('combobox')).toBeFocused();
      expect(await wcagViolations(page, '[role="dialog"]')).toEqual([]);
    });

    test('Import YAML, its second step: focus on its first choice, no WCAG violations', async ({
      page,
    }) => {
      await openConfigTab(page, 'system');
      await page.getByRole('button', { name: 'Import YAML' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('tab', { name: 'Paste YAML' }).click();
      await dialog
        .getByRole('textbox', { name: 'Paste YAML' })
        .fill('balance:\n  startBalance: 777\n');
      await dialog.getByRole('button', { name: 'Continue' }).focus();
      await page.keyboard.press('Enter');
      await expect(dialog.getByText('Where should these settings go?')).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /^Base configuration/ })).toBeFocused();
      expect(await wcagViolations(page, '[role="dialog"]')).toEqual([]);
    });
  });
}

/** Starting credits and its row's action: Remove override where the open profile sets its own. */
function startBalanceRow(page: Page) {
  const field = page.locator('#balance-startBalance');
  const action = page
    .locator('.settings-row', { has: field })
    .locator('button.settings-row-action');
  return { field, action };
}

/** Waits until the USER role's profile is open with its own values loaded. */
async function expectUserProfileOpen(page: Page) {
  await expect(page.getByRole('region', { name: 'Profile being edited' })).toContainText(
    'Role: USER',
  );
  await expect(startBalanceRow(page).field).toBeVisible();
}

/** Removes the USER role profile's own Starting credits, if it has one, and saves. */
async function removeUserStartBalance(page: Page) {
  await openConfigTab(page, 'system', 'role:USER');
  await expectUserProfileOpen(page);
  const { action } = startBalanceRow(page);
  if ((await action.count()) === 0) return;
  await action.click();
  await reviewAndSave(page);
}

test.describe('a role profile with an override of its own', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.describe.configure({ timeout: 180_000 });
  /**
   * What the test saved to the USER role's profile, for cleanup to undo in a
   * page of its own (a failure can leave the test's page mid-edit): the
   * profile, when it created it, or Starting credits, on a profile that had
   * none of its own. A Starting credits the profile already had is never
   * written: the test uses it as it is and discards its removal.
   */
  let saved: 'profile' | 'override' | null = null;

  lockUserProfile(async ({ page }) => {
    const undo = saved;
    saved = null;
    if (undo == null) return;
    const own = await page.context().newPage();
    try {
      if (undo === 'profile') await deleteUserRoleProfile(own, true);
      else await removeUserStartBalance(own);
    } finally {
      await own.close();
    }
  });

  test('has no WCAG violations with its sections open, and Remove override keeps focus on the field', async ({
    page,
  }) => {
    await openConfigTab(page, 'system');
    if (await selectUserRoleProfile(page)) saved = 'profile';
    await expect(page).toHaveURL(/scope=role(%3A|:)USER/);
    await expectUserProfileOpen(page);
    const { field: start, action: remove } = startBalanceRow(page);
    if ((await remove.count()) === 0) {
      saved ??= 'override';
      await start.fill('4321');
      await start.press('Tab');
      await reviewAndSave(page);
    }

    await hideDevtools(page);
    await expandSections(page);
    await expect(remove).toHaveText(/^Remove override \(inherits /);
    for (const colorScheme of THEMES) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(() => document.getAnimations().length === 0);
      expect(await wcagViolations(page)).toEqual([]);
    }

    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(remove).toHaveCount(0);
    await expect(start).toBeFocused();
    await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(remove).toHaveText(/^Remove override \(inherits /);
  });
});

test.describe('focus stays on the page when a control takes itself away', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });

  test('Discard in the unsaved-changes bar puts focus on the open tab', async ({ page }) => {
    await openConfigTab(page, 'system');
    const regions = await markStatusRegions(page);
    const field = page.locator('#balance-refillAmount');
    await field.fill('12345');
    await field.press('Tab');
    await expect(regions.filter({ hasText: /^1 unsaved change/ })).toHaveCount(1);
    await unsavedBar(page).getByRole('button', { name: 'Discard' }).focus();
    await page.keyboard.press('Enter');
    await expect(unsavedBar(page)).toHaveCount(0);
    await expect(activeTab(page)).toBeFocused();
  });

  test('Jump to puts focus on the heading of the section it scrolls to', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openConfigTab(page, 'features');
    await page.getByRole('button', { name: 'Jump to…' }).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.matches(
              'form :is(h2, h3, h4, h5, h6) > button, form button[data-section-id]',
            ) ?? false,
        ),
      )
      .toBe(true);
  });

  test('an MCP server rename gives focus back to its header on Escape or Enter, and leaves it where a click or Tab moved it', async ({
    page,
  }) => {
    await openConfigTab(page, 'mcp');
    await page.getByRole('button', { name: 'Create MCP server' }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Server name').fill('e2e-focus');
    await create.locator('#mcpDraft-url').fill('https://mcp.e2e.example/mcp');
    await create.locator('#mcpDraft-url').press('Tab');
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(create).toHaveCount(0);

    const card = page.locator('[data-mcp-server="e2e-focus"]');
    const header = card.locator('button[data-section-id]');
    const rename = page.getByRole('textbox', { name: 'Rename e2e-focus' });
    const startRename = async () => {
      await card.getByRole('button', { name: 'Actions for e2e-focus' }).click();
      await page.getByRole('menuitem', { name: /^Rename/ }).click();
      await expect(rename).toBeFocused();
    };

    for (const key of ['Escape', 'Enter']) {
      await startRename();
      await page.keyboard.press(key);
      await expect(rename).toHaveCount(0);
      await expect(header).toBeFocused();
    }

    const filter = page.getByRole('textbox', { name: 'Filter this tab…' });
    await startRename();
    await filter.click();
    await expect(rename).toHaveCount(0);
    await settleFrames(page);
    await expect(filter).toBeFocused();
    await page.keyboard.type('e2e');
    await expect(filter).toHaveValue('e2e');
    await filter.fill('');

    const other = page
      .locator('[data-mcp-server]:not([data-mcp-server="e2e-focus"]) button[data-section-id]')
      .first();
    await startRename();
    await other.click();
    await expect(rename).toHaveCount(0);
    await settleFrames(page);
    await expect(other).toBeFocused();

    await startRename();
    await page.keyboard.press('Tab');
    await expect(rename).toHaveCount(0);
    await settleFrames(page);
    await expect(header).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

    await unsavedBar(page).getByRole('button', { name: 'Discard' }).click();
    await expect(card).toHaveCount(0);
  });

  test("an MCP card's chips and summary show their tooltips and still open and close the card", async ({
    page,
  }) => {
    await openConfigTab(page, 'mcp');
    const card = page.locator('[data-mcp-server]').first();
    const header = card.locator('button[data-section-id]');
    const facts = card.locator(`[id="${await header.getAttribute('aria-describedby')}"]`);
    const chip = facts.locator('.state-chip').first();
    await expect(chip).toHaveAttribute('title', /\S/);
    const hits = await facts.evaluate((line) =>
      [line.querySelector('.state-chip'), line.querySelector('[title]:not(.state-chip)')].map(
        (el) => {
          if (!el) return 'missing';
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit != null && el.contains(hit)
            ? 'itself'
            : (hit?.outerHTML.slice(0, 80) ?? 'none');
        },
      ),
    );
    expect(hits).toEqual(['itself', 'itself']);

    const expanded = await header.getAttribute('aria-expanded');
    await chip.click();
    await expect(header).not.toHaveAttribute('aria-expanded', expanded ?? '');
    await chip.click();
    await expect(header).toHaveAttribute('aria-expanded', expanded ?? '');
  });

  test('Escape asks before discarding a name typed into a blank endpoint', async ({ page }) => {
    const drawer = await startBlankEndpoint(page);
    const name = drawer.locator('#endpoints-custom-9999-name');
    await name.fill('Draft endpoint');
    await page.keyboard.press('Escape');
    await expect(drawer.getByText('Discard this new endpoint?')).toBeVisible();
    await expect(name).toHaveValue('Draft endpoint');
  });
});
