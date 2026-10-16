import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CONFIG_TABS, LIVE, LIVE_SKIP_REASON, openConfigTab } from '../live';

/**
 * Accessibility and visual-system guardrails for the configuration page (VS-12):
 * axe on every tab at 1440 and 390 px in both themes, layout invariants of the
 * settings grid, and screenshot baselines. Needs a live backend (see ../live.ts);
 * refresh baselines with `--update-snapshots` after intended visual changes.
 */
test.skip(!LIVE, LIVE_SKIP_REASON);

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
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

    test('the import wizard', async ({ page }) => {
      await openConfigTab(page, 'system');
      await page.getByRole('button', { name: 'Import YAML' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await dialogViolations(page)).toEqual([]);
    });
  });
}

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

for (const variant of VISUAL_VARIANTS) {
  test.describe(`visual baseline: ${variant.label}`, () => {
    test.use({
      colorScheme: variant.colorScheme,
      viewport: { width: variant.width, height: variant.height },
    });

    for (const tab of VISUAL_TABS) {
      test(`${tab}`, async ({ page }) => {
        await openConfigTab(page, tab);
        await hideDevtools(page);
        await expect(page).toHaveScreenshot(`${tab}-${variant.label}.png`, {
          animations: 'disabled',
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}
