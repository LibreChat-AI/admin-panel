import { defineConfig, devices } from '@playwright/test';

/**
 * E2E_BASE_URL points the suite at a running admin panel (with a real LibreChat
 * backend) instead of starting the dev server and the mock backend. Specs that
 * need configuration data also require E2E_LIVE=1 (see e2e/live.ts).
 */
const liveBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL: liveBaseURL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: liveBaseURL
    ? undefined
    : [
        {
          command: 'npx vite dev --port 3000',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 30_000,
          env: { ...process.env, VITE_API_BASE_URL: 'http://localhost:3081' },
        },
        {
          command: 'node e2e/mock-backend.mjs',
          url: 'http://localhost:3081/api/admin/oauth/openid/check',
          reuseExistingServer: true,
          timeout: 10_000,
        },
      ],
});
