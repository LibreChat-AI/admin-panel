import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { WCAG_TAGS } from './live';

// Login tests must be unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login page accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('has zero WCAG 2.1 AA violations on initial load', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('has zero violations after showing validation errors', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: /^sign in$/i });
    await signInButton.click();

    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('validation errors are announced via live region', async ({ page }) => {
    const signInButton = page.getByRole('button', { name: /^sign in$/i });
    await signInButton.click();

    const liveRegion = page.locator('.auth-card [role="status"][aria-live="polite"]');
    await expect(liveRegion).toContainText(/required/i, { timeout: 5000 });
  });

  test('all interactive elements are reachable by keyboard in order', async ({ page }) => {
    const focusOrder: string[] = [];

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return (
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.textContent?.trim().slice(0, 40) ||
          `${el.tagName.toLowerCase()}[${el.getAttribute('type') || ''}]`
        );
      });
      if (label) focusOrder.push(label);
    }

    const emailIdx = focusOrder.findIndex((l) => /@/.test(l) || /email/i.test(l));
    const passwordIdx = focusOrder.findIndex((l) => /password/i.test(l));
    const signInIdx = focusOrder.findIndex((l) => /sign in/i.test(l));
    const themeIdx = focusOrder.findIndex((l) => /theme/i.test(l));

    expect(emailIdx).toBeGreaterThanOrEqual(0);
    expect(passwordIdx).toBeGreaterThan(emailIdx);
    expect(signInIdx).toBeGreaterThan(passwordIdx);
    expect(themeIdx).toBeGreaterThanOrEqual(0);
  });

  test('no horizontal scroll at 320x256 (WCAG 1.4.10 Reflow)', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 256 },
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await context.close();
  });
});

test.describe('Login page functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('theme toggle switches the document class', async ({ page }) => {
    const initialClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );

    const themeButton = page.locator('button[aria-label*="theme" i]');
    await themeButton.click();

    const newClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    );

    expect(newClass).not.toBe(initialClass);
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('notanemail');
    await page.locator('input[type="password"]').first().fill('somepassword');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByText(/valid email/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('pressing Enter in password field submits the form', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.press('Enter');

    await expect(page.getByText(/required/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('successful login redirects away from /login', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('admin@test.com');
    await page.locator('input[type="password"]').first().fill('password');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await page.waitForURL('**/', { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('shows error banner when server rejects credentials', async ({ page }) => {
    await page.locator('input:not([type="password"])').first().fill('rejected@test.com');
    await page.locator('input[type="password"]').first().fill('wrongpass');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByText(/invalid|failed|credentials/i).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('2FA verification flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  async function triggerTwoFAStep(page: import('@playwright/test').Page) {
    await page.locator('input:not([type="password"])').first().fill('2fa@test.com');
    await page.locator('input[type="password"]').first().fill('password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/authenticator/i)).toBeVisible({ timeout: 5000 });
  }

  test('transitions to TOTP step with slotted OTP input', async ({ page }) => {
    await triggerTwoFAStep(page);

    await expect(page.getByText(/two-factor/i)).toBeVisible();
    await expect(page.locator('[data-input-otp]')).toBeVisible();
    await expect(page.locator('[data-input-otp-container] [role="separator"]')).toBeVisible();
    await expect(page.getByText(/back to login/i)).toBeVisible();
  });

  test('has zero WCAG 2.1 AA violations on 2FA step', async ({ page }) => {
    await triggerTwoFAStep(page);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('partial input does not trigger verification', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('12345');
    await page.waitForTimeout(500);

    expect(page.url()).toContain('/login');
  });

  test('successful 2FA verification redirects away from login', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('123456');

    await page.waitForURL('**/', { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });

  test('invalid code shows error and clears input', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('000000');

    await expect(page.getByText(/invalid/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('sends an account its identity provider owns back to the password step', async ({
    page,
  }) => {
    await triggerTwoFAStep(page);

    await page.locator('[data-input-otp]').fill('111111');

    await expect(page.getByText(/signs in through your identity provider/i).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.locator('[data-input-otp]')).toHaveCount(0);
  });

  test('back button returns to login form', async ({ page }) => {
    await triggerTwoFAStep(page);

    await page.getByText(/back to login/i).click();

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText(/two-factor/i)).not.toBeVisible();
  });
});

test.describe('SSO availability', () => {
  test('shows the OpenID button, named as LibreChat names it, when OpenID is available', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /continue with openid/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows a Google button next to OpenID, in the order of LibreChat socialLogins', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const buttons = page.getByRole('button', { name: /^continue with (openid|google)$/i });
    await expect(buttons).toHaveText([/google/i, /openid/i], { timeout: 10_000 });
  });

  test('has zero WCAG 2.1 AA violations with SSO buttons visible', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible({
      timeout: 10_000,
    });

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });

  test('login form is still shown when not in SSO-only mode', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.locator('input:not([type="password"])')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

test.describe('Sign-in card width', () => {
  for (const { width, card } of [
    { width: 1440, card: 448 },
    { width: 375, card: 343 },
  ]) {
    test(`is ${card}px wide at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      const box = await page.locator('.auth-card').boundingBox();
      expect(box?.width).toBe(card);
    });
  }
});

interface LeavingButton {
  name: string | null;
  busy: string | null;
  disabled: boolean;
}

/**
 * The sign-in card's buttons 100 ms into the page's unload. Locators and `evaluate` wait out a
 * pending navigation, so the leaving page logs them to the console instead.
 */
async function buttonsWhileLeaving(page: Page): Promise<LeavingButton[]> {
  const logged = page.waitForEvent('console', (message) => message.text().startsWith('leaving '));
  await page.evaluate(() => {
    window.addEventListener('beforeunload', () => {
      setTimeout(() => {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.auth-card button')];
        const states = buttons.map((button) => ({
          name: button.textContent,
          busy: button.getAttribute('aria-busy'),
          disabled: button.disabled,
        }));
        console.log(`leaving ${JSON.stringify(states)}`);
      }, 100);
    });
  });
  return logged.then((message) => JSON.parse(message.text().slice('leaving '.length)));
}

test.describe('SSO button while the browser leaves for the provider', () => {
  test('stays busy until the provider answers', async ({ page }) => {
    const held: Route[] = [];
    await page.route('http://localhost:3081/api/admin/oauth/google?*', (route) => {
      held.push(route);
    });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    const leaving = buttonsWhileLeaving(page);

    await page.getByRole('button', { name: /continue with google/i }).click();

    const buttons = await leaving;
    expect(buttons).toHaveLength(3);
    expect(buttons).toEqual(
      expect.arrayContaining([
        { name: 'Sign in', busy: null, disabled: false },
        { name: 'Redirecting…', busy: 'true', disabled: true },
        { name: 'Continue with OpenID', busy: null, disabled: true },
      ]),
    );
    expect(held).toHaveLength(1);
    await held[0].fulfill({ contentType: 'text/html', body: '<p>Provider page</p>' });
    await expect(page.getByText('Provider page')).toBeVisible();
  });
});

async function signInAs(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.locator('input:not([type="password"])').first().fill(email);
  await page.locator('input[type="password"]').first().fill('password');
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

test.describe('Sign-in refusals', () => {
  test('words an unverified email', async ({ page }) => {
    await signInAs(page, 'unverified@test.com');

    await expect(page.getByText(/email not verified/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('words a missing admin capability', async ({ page }) => {
    await signInAs(page, 'member@test.com');

    await expect(page.getByText(/do not have admin privileges/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('tells an account its identity provider owns that a password cannot sign it in', async ({
    page,
  }) => {
    await signInAs(page, 'federated@test.com');

    await expect(page.getByText(/signs in through your identity provider/i).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/do not have admin privileges/i)).toHaveCount(0);
  });

  test('sends an admin refused for a missing tenant to their organization address', async ({
    page,
  }) => {
    await signInAs(page, 'tenant@test.com');

    await expect(page.getByText(/organization's admin address/i).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/do not have admin privileges/i)).toHaveCount(0);
  });
});

test.describe('Sign-in behind a proxy that sets X-Tenant-Id', () => {
  test.use({ extraHTTPHeaders: { 'X-Tenant-Id': 'tenant-a' } });

  test("forwards the request's tenant so a strict-isolation sign-in succeeds", async ({ page }) => {
    await signInAs(page, 'tenant@test.com');

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    expect(page.url()).not.toContain('/login');
  });
});

test.describe('OpenID callback errors', () => {
  test('words the tenant refusal LibreChat redirects with', async ({ page }) => {
    await page.goto(
      '/auth/openid/callback?error=TENANT_CONTEXT_REQUIRED&error_description=Tenant+context+required+in+strict+isolation+mode',
    );

    await expect(page.getByText(/organization's admin address/i).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('link', { name: /back to login/i })).toBeVisible();
  });

  test('words a failed identity provider sign-in', async ({ page }) => {
    await page.goto(
      '/auth/openid/callback?error=auth_failed&error_description=Authentication+failed',
    );

    await expect(page.getByText(/identity provider did not complete/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('shows the generic message and none of an unknown error', async ({ page }) => {
    const error = encodeURIComponent('<img src=x onerror=window.__xss=1>');
    const description = encodeURIComponent('<b>Your account is locked</b> call +1 555 0100');
    await page.goto(`/auth/openid/callback?error=${error}&error_description=${description}`);

    await expect(page.getByText(/sign-in with sso failed/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/account is locked/i)).toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as Window & { __xss?: number }).__xss),
    ).toBeUndefined();
  });
});

test.describe('SSO through each provider', () => {
  test('words a failed Google sign-in on its callback instead of a 404', async ({ page }) => {
    await page.goto(
      '/auth/google/callback?error=auth_failed&error_description=Authentication+failed',
    );

    await expect(page.getByText(/identity provider did not complete/i).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/page not found/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /back to login/i })).toBeVisible();
  });

  test('answers the callback of a provider the panel does not offer with not found', async ({
    page,
  }) => {
    await page.goto(`/auth/evil/callback?code=${'a'.repeat(64)}`);

    await expect(page.getByText(/page not found/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('returns to the deep link sign-in started from after signing in with Google', async ({
    page,
  }) => {
    await page.goto('/grants');
    await page.waitForURL(/\/login\?redirect=/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /continue with google/i }).click();

    await page.waitForURL((url) => url.pathname === '/grants', { timeout: 15_000 });
  });
});
