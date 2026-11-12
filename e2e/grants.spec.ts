import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { createRole, deleteFromList, grantReadUsage, searchField, uniqueName } from './access';
import {
  LIVE,
  WCAG_TAGS,
  MOCK_BACKEND_URL,
  MOCK_ADMIN_HEADERS,
  MOCK_FIXTURES_SKIP_REASON,
  AUDITED_WRITES_SKIP_REASON,
} from './live';

async function hideTanStackDevtools(page: Page) {
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('button[aria-label="Open TanStack Devtools"]')
      ?.style.setProperty('display', 'none');
  });
}

/** LibreChat's audit-log CSV columns, in order: `CSV_COLUMNS` in its admin `auditLog.ts`. */
const AUDIT_CSV_COLUMNS = [
  'Timestamp',
  'Category',
  'Action',
  'Outcome',
  'Severity',
  'Actor type',
  'Actor',
  'Actor ID',
  'Target type',
  'Target',
  'Target ID',
  'Capability',
  'Details',
  'IP',
  'Request ID',
  'Seq',
  'Hash',
];

/**
 * Exports the audit log and returns the CSV's rows keyed by column, after
 * checking the download, the response headers, the BOM and the header row.
 * None of the rows checked here quotes a comma, so a plain split reads them.
 */
async function exportAuditRows(page: Page) {
  const [download, response] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse(
      (res) => res.url().includes('/_serverFn/') && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /export all matching/i }).click(),
  ]);
  const filename = download.suggestedFilename();
  expect(filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(response.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(response.headers()['content-disposition']).toBe(`attachment; filename="${filename}"`);
  const [header, ...lines] = (await readFile(await download.path(), 'utf8')).split('\r\n');
  expect(header).toBe(`\uFEFF${AUDIT_CSV_COLUMNS.join(',')}`);
  expect(lines.pop()).toBe('');
  return lines.map((line) => {
    const cells = line.split(',');
    expect(cells).toHaveLength(AUDIT_CSV_COLUMNS.length);
    return Object.fromEntries(AUDIT_CSV_COLUMNS.map((column, i) => [column, cells[i]]));
  });
}

// ---------------------------------------------------------------------------
// Management tab (default)
// ---------------------------------------------------------------------------

test.describe('Grants page - Management tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
  });

  test('renders page header and management tab', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /system grants/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /management/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /audit log/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('management tab is active by default', async ({ page }) => {
    const mgmtTab = page.getByRole('tab', { name: /management/i });
    await expect(mgmtTab).toHaveAttribute('data-state', 'active');
  });

  test('shows all roles even with 0 grants', async ({ page }) => {
    test.skip(LIVE, MOCK_FIXTURES_SKIP_REASON);
    const rows = page.locator('tbody tr');
    const userRow = rows.filter({
      has: page.getByRole('button', { name: 'Edit capabilities for USER' }),
    });
    await expect(userRow).toContainText('No capabilities');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('lists roles only: every row edits a role', async ({ page }) => {
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await rows.nth(i).getByRole('button').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog').locator('.badge-role')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
  });

  test('search filters by name', async ({ page }) => {
    await searchField(page).fill('admin');
    await expect(page.getByText('ADMIN', { exact: true }).first()).toBeVisible();
  });

  test('click a row opens EditCapabilitiesDialog', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('dialog shows principal type badge', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    const badge = page.getByRole('dialog').locator('.badge-role');
    await expect(badge).toBeVisible();
    await expect(badge.getByRole('img')).toHaveCount(0);
  });

  test('dialog cancel discards changes', async ({ page }) => {
    await hideTanStackDevtools(page);
    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /cancel/i })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Audit Log tab
// ---------------------------------------------------------------------------

test.describe('Grants page - Audit Log tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
  });

  test('renders audit log table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /system grants/i })).toBeVisible();
    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await expect(auditTab).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('Clear dates gives focus to the From date picker', async ({ page }) => {
    await page.getByRole('button', { name: 'From', exact: true }).click();
    await page.getByRole('gridcell').filter({ hasText: /^1$/ }).first().click();
    const clear = page.getByRole('button', { name: 'Clear date filters' });
    await clear.focus();
    await page.keyboard.press('Enter');

    await expect(clear).toHaveCount(0);
    await expect(page.locator('#audit-date-from')).toBeFocused();
    await expect(page.locator('#audit-date-from')).toHaveAccessibleName('From');
  });

  for (const width of [390, 320]) {
    test(`the filters wrap at ${width}px: no sideways scroll, Export on screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const filters = page.getByRole('group', { name: 'Filters' });
      await expect(filters).toBeVisible();

      const overflow = await filters.evaluate((el) => {
        let box = el.parentElement;
        while (box && getComputedStyle(box).overflowY !== 'auto') box = box.parentElement;
        return box ? box.scrollWidth - box.clientWidth : 0;
      });
      expect(overflow).toBeLessThanOrEqual(0);
      const exportBox = await page
        .getByRole('button', { name: /export all matching/i })
        .boundingBox();
      expect(exportBox).not.toBeNull();
      expect(exportBox!.x).toBeGreaterThanOrEqual(0);
      expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(width);
    });
  }

  test('empty state when no entries match filters', async ({ page }) => {
    await searchField(page).fill('zzzznonexistent');
    await page.waitForTimeout(500);
    await expect(page.getByText(/no audit log entries found/i)).toBeVisible();
  });

  /**
   * These read the mock's seeded grant history. The describe skips them live
   * before the hook above opens the log, since LibreChat audits every read of it.
   */
  test.describe('seeded history', () => {
    test.skip(LIVE, MOCK_FIXTURES_SKIP_REASON);

    test('shows diverse audit entries', async ({ page }) => {
      const rows = page.getByRole('button', { name: 'Open audit log entry' });
      await expect(rows.first()).toBeVisible();
      const count = await rows.count();
      expect(count).toBeGreaterThan(5);
    });

    test('action type filter shows only granted entries', async ({ page }) => {
      await page.getByRole('button', { name: /^Granted$/i }).click();
      const rows = page.locator('tbody tr');
      await expect(rows.filter({ hasNotText: 'Granted' })).toHaveCount(0);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).getByText('Granted', { exact: true })).toBeVisible();
      }
    });

    test('action type filter shows only revoked entries', async ({ page }) => {
      await page.getByRole('button', { name: /^Revoked$/i }).click();
      const rows = page.locator('tbody tr');
      await expect(rows.filter({ hasNotText: 'Revoked' })).toHaveCount(0);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).getByText('Revoked', { exact: true })).toBeVisible();
      }
    });

    test('search filters by actor/target name', async ({ page }) => {
      await searchField(page).fill('Alice');
      const rows = page.locator('tbody tr');
      await expect(rows.filter({ hasNotText: /alice/i })).toHaveCount(0);
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent();
        expect(text?.toLowerCase()).toContain('alice');
      }
    });

    test('Export keeps focus on its button while it runs', async ({ page }) => {
      const exportButton = page.getByRole('button', { name: /export all matching/i });
      await exportButton.focus();
      const download = page.waitForEvent('download');
      await page.keyboard.press('Enter');
      await download;

      await expect(exportButton).toBeFocused();
      await expect(exportButton).not.toHaveAttribute('aria-busy');
    });

    test('Export writes the seeded entry the filters match', async ({ page }) => {
      await searchField(page).fill('Alice');
      await page.getByRole('button', { name: /^Revoked$/i }).click();
      await expect(page.locator('tbody tr')).toHaveCount(1);

      expect(await exportAuditRows(page)).toEqual([
        {
          Timestamp: '2026-01-05T16:00:00.000Z',
          Category: 'grant',
          Action: 'grant.removed',
          Outcome: 'success',
          Severity: 'warning',
          'Actor type': 'user',
          Actor: 'Alice Chen',
          'Actor ID': expect.stringMatching(/^[0-9a-f]{24}$/),
          'Target type': 'role',
          Target: 'USER',
          'Target ID': 'USER',
          Capability: 'read:agents',
          Details: '"{""capability"":""read:agents""}"',
          IP: '',
          'Request ID': '',
          Seq: '7',
          Hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ]);
    });

    test('a permalink opens its seeded entry in the detail drawer', async ({ page }) => {
      await searchField(page).fill('Alice');
      await page.getByRole('button', { name: /^Revoked$/i }).click();
      await expect(page.locator('tbody tr')).toHaveCount(1);
      await page.getByRole('button', { name: 'Open audit log entry' }).click();
      await expect(page).toHaveURL(/entryId=/);
      const entryId = new URL(page.url()).searchParams.get('entryId');

      await page.goto(`/grants?tab=audit-log&entryId=${entryId}`);
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('Alice Chen').first()).toBeVisible();
      await expect(drawer.getByText('read:agents').first()).toBeVisible();
      await expect(drawer.getByText(/entry not found/i)).toHaveCount(0);

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .include('[role="dialog"]')
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test('copying a value from the drawer is announced', async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Open audit log entry for USER' }).click();
      const copy = page.getByRole('dialog').locator('button', { hasText: 'read:agents' });
      await copy.focus();
      await page.keyboard.press('Enter');

      await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveText(
        'Copied capability',
      );
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('read:agents');
    });

    test('closing a drawer opened from a permalink gives focus to its row', async ({ page }) => {
      const row = page.getByRole('button', { name: 'Open audit log entry for USER' });
      await row.click();
      const entryId = new URL(page.url()).searchParams.get('entryId');
      await page.goto(`/grants?tab=audit-log&entryId=${entryId}`);
      await expect(page.getByRole('dialog')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(row).toBeFocused();
    });

    test('the mock serves one entry by id, as LibreChat does', async ({ request }) => {
      const auditLog = `${MOCK_BACKEND_URL}/api/admin/audit-log`;
      const list = await request.get(auditLog, { headers: MOCK_ADMIN_HEADERS });
      const [first] = (await list.json()).entries;

      const one = await request.get(`${auditLog}/${first.id}`, { headers: MOCK_ADMIN_HEADERS });
      expect(one.status()).toBe(200);
      expect(await one.json()).toEqual({ entry: first });
      const malformed = await request.get(`${auditLog}/not-an-id`, { headers: MOCK_ADMIN_HEADERS });
      expect(malformed.status()).toBe(400);
      const unknown = await request.get(`${auditLog}/${'f'.repeat(24)}`, {
        headers: MOCK_ADMIN_HEADERS,
      });
      expect(unknown.status()).toBe(404);
    });

    test('capability column shows human-readable label with raw key', async ({ page }) => {
      const firstCapCell = page.locator('tbody tr').first().locator('td').nth(2);
      await expect(firstCapCell).toBeVisible();
      const text = await firstCapCell.textContent();
      expect(text).toContain(':');
    });
  });
});

test.describe('Grants page - Audit Log export', () => {
  test.skip(LIVE, AUDITED_WRITES_SKIP_REASON);
  let created: string | undefined;

  test.afterEach(async ({ page }) => {
    if (!created) return;
    await deleteFromList(page, 'roles', created);
    created = undefined;
  });

  test('Export downloads only the entries the filters match, as CSV', async ({ page }) => {
    const role = uniqueName('E2E Audited Role');
    created = role;
    await createRole(page, role);
    await grantReadUsage(page, role);
    await page.goto('/grants?tab=audit-log');
    await searchField(page).fill(role);
    await expect(page.locator('tbody tr')).toHaveCount(1);

    expect(await exportAuditRows(page)).toEqual([
      expect.objectContaining({
        Category: 'grant',
        Action: 'grant.assigned',
        Outcome: 'success',
        'Actor type': 'user',
        'Target type': 'role',
        Target: role,
        'Target ID': role,
        Capability: 'read:usage',
        Details: '"{""capability"":""read:usage""}"',
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

test.describe('Grants page - Tab switching', () => {
  test('switching tabs updates URL and content', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');

    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await auditTab.click();
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/tab=audit-log/);
    await expect(page.getByRole('button', { name: /export all matching/i })).toBeVisible();

    const mgmtTab = page.getByRole('tab', { name: /management/i });
    await mgmtTab.click();
    await page.waitForTimeout(300);

    await expect(page).toHaveURL(/tab=management/);
    await expect(page.getByRole('button', { name: 'Edit capabilities for ADMIN' })).toBeVisible();
  });

  test('direct URL to audit-log tab works', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
    const auditTab = page.getByRole('tab', { name: /audit log/i });
    await expect(auditTab).toHaveAttribute('data-state', 'active');
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test.describe('Grants page accessibility', () => {
  test('management tab has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('table')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('audit log tab has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('table')).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('edit dialog has zero WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await hideTanStackDevtools(page);

    const adminRow = page.locator('tbody tr').filter({ hasText: 'Admin' }).first();
    await adminRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('keyboard: Tab from the search field to the first row, Enter opens dialog', async ({
    page,
  }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');

    const searchBox = searchField(page);
    await searchBox.focus();
    await expect(searchBox).toBeFocused();

    const firstRow = page.locator('tbody tr').first().getByRole('button');
    await page.keyboard.press('Tab');
    await expect(firstRow).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('focus returns to row after dialog close', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await hideTanStackDevtools(page);

    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    await expect(firstRow.getByRole('button')).toBeFocused({ timeout: 3000 });
  });

  test('date pickers are named by their labels', async ({ page }) => {
    await page.goto('/grants?tab=audit-log');
    await page.waitForLoadState('networkidle');

    for (const [id, label] of [
      ['audit-date-from', 'From'],
      ['audit-date-to', 'To'],
    ]) {
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
        'id',
        id,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Capability enforcement
// ---------------------------------------------------------------------------

test.describe('Grants page enforcement', () => {
  test('sidebar shows Grants link for admin user', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'Grants', exact: true })).toBeVisible();
  });

  test('grants page is accessible with full grants', async ({ page }) => {
    await page.goto('/grants');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Access Denied/i)).not.toBeVisible();
  });
});
