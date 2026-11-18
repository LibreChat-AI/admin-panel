import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

const backendURL = `http://localhost:${process.env.SESSION_E2E_BACKEND_PORT ?? '4182'}`;
const unavailable = 'AUTH_SESSION_CHECK_UNAVAILABLE';

async function setSession(
  request: APIRequestContext,
  state: {
    refreshStatus?: number;
    rejectBearer?: boolean;
    refreshes?: number;
    writes?: number;
    startBalance?: number;
  },
) {
  const response = await request.post(`${backendURL}/__test/session`, { data: state });
  expect(response.ok()).toBe(true);
}

async function recordState(request: APIRequestContext, testInfo: TestInfo) {
  const response = await request.get(`${backendURL}/__test/session`);
  const state = (await response.json()) as { refreshes: number; writes: number };
  await testInfo.attach('backend-state', {
    body: JSON.stringify(state),
    contentType: 'application/json',
  });
  return state;
}

async function signIn(page: Page, path = '/') {
  const target = new URL(path, 'http://localhost');
  await page.goto(`/login?redirect=${encodeURIComponent(path)}`);
  await page.getByRole('button', { name: 'Continue with OpenID', exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === target.pathname && url.search === target.search,
  );
  await expect(page.locator('aside')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'session-recovery', 'Run with playwright.session.config.ts.');
  await setSession(request, {
    refreshStatus: 200,
    rejectBearer: false,
    refreshes: 0,
    writes: 0,
    startBalance: 1000,
  });
});

test('OpenID reload can recover from a temporary renewal failure without another sign-in', async ({
  page,
  request,
}, testInfo) => {
  await signIn(page, '/access');
  await setSession(request, { refreshStatus: 503, refreshes: 0 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/session=unavailable/);
  expect((await recordState(request, testInfo)).refreshes).toBeGreaterThan(0);
  await setSession(request, { refreshStatus: 200 });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/access');
  await expect(page.getByRole('button', { name: /^create role$/i })).toBeVisible();
  expect((await recordState(request, testInfo)).writes).toBe(0);
});

test('a protected form keeps its draft through the real session-error header and retries only reads', async ({
  page,
  request,
}, testInfo) => {
  await signIn(page, '/access');
  await page.getByRole('button', { name: /^create role$/i }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.locator('#create-role-name');
  await name.fill('Retained browser draft');
  await setSession(request, { refreshStatus: 503, rejectBearer: true, refreshes: 0 });
  const failed = page.waitForResponse(
    (response) => response.headers()['x-admin-session-error'] === unavailable,
  );
  await dialog.getByRole('button', { name: /^create role$/i }).click();
  const response = await failed;
  await testInfo.attach('session-header', {
    body: JSON.stringify({
      status: response.status(),
      code: response.headers()['x-admin-session-error'],
    }),
    contentType: 'application/json',
  });
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/access');
  await expect(name).toHaveValue('Retained browser draft');
  await expect(dialog.getByText(/After signing in again/)).toHaveCount(0);
  expect((await recordState(request, testInfo)).writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('role-recovery.png') });
  await setSession(request, { refreshStatus: 200 });
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('Retained browser draft');
  expect((await recordState(request, testInfo)).writes).toBe(0);
});

test('a caught server error keeps its session header on the serialized fallback response', async ({
  page,
  request,
}, testInfo) => {
  await signIn(page);
  const builtServer = readFileSync('dist/server/server.js', 'utf8');
  const id = builtServer.match(
    /"([a-f0-9]{64})":\s*\{\s*functionName:\s*"getAdminConfigMetaFn_createServerFn_handler"/,
  )?.[1];
  expect(id, 'The built server registers the real config-contract server function').toBeTruthy();
  await setSession(request, { refreshStatus: 503, rejectBearer: true, refreshes: 0 });
  const response = await page.request.get(`/_serverFn/${id}`, {
    headers: { 'x-tsr-serverFn': 'true', Origin: new URL(page.url()).origin },
  });
  const body = await response.text();
  expect(response.status()).toBe(200);
  expect(response.headers()['x-admin-session-error']).toBe(unavailable);
  expect(body).toContain('acceptedSections');
  await testInfo.attach('fallback-response', {
    body: JSON.stringify({
      status: response.status(),
      code: response.headers()['x-admin-session-error'],
      body,
    }),
    contentType: 'application/json',
  });
  expect((await recordState(request, testInfo)).writes).toBe(0);
});

test('an invalid nested config input survives a protected Preview failure and Retry', async ({
  page,
  request,
}, testInfo) => {
  await signIn(page, '/configuration?tab=system');
  const field = page.locator('#balance-startBalance');
  await expect(field).toBeVisible();
  await field.fill('-');
  await setSession(request, { refreshStatus: 503, rejectBearer: true, refreshes: 0 });
  const failed = page.waitForResponse(
    (response) => response.headers()['x-admin-session-error'] === unavailable,
  );
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await failed;
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === '/configuration');
  await expect(field).toHaveValue('-');
  await page.screenshot({ path: testInfo.outputPath('nested-config-recovery.png') });
  await setSession(request, { refreshStatus: 200, startBalance: 12345 });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('-');
  expect((await recordState(request, testInfo)).writes).toBe(0);
});

test('Retry gives a visible still-signed-out result and keeps the form draft', async ({
  page,
  request,
}, testInfo) => {
  await signIn(page, '/access');
  await page.getByRole('button', { name: /^create role$/i }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.locator('#create-role-name');
  await name.fill('Rejected-session draft');
  await setSession(request, { refreshStatus: 401, rejectBearer: true, refreshes: 0 });
  const failed = page.waitForResponse(
    (response) => response.headers()['x-admin-session-error'] === 'OPENID_SESSION_ENDED',
  );
  await dialog.getByRole('button', { name: /^create role$/i }).click();
  await failed;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    dialog.getByText('You are still signed out. Sign in in another tab, then select Retry.'),
  ).toBeVisible();
  await expect(name).toHaveValue('Rejected-session draft');
  await expect(page).toHaveURL((url) => url.pathname === '/access');
  expect((await recordState(request, testInfo)).writes).toBe(0);
});
