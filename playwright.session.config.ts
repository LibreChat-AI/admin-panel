import { defineConfig, devices } from '@playwright/test';

const port = process.env.SESSION_E2E_PORT ?? '4120';
const backendPort = process.env.SESSION_E2E_BACKEND_PORT ?? '4182';
const baseURL = `http://localhost:${port}`;
const backendURL = `http://localhost:${backendPort}`;

/** Tests the built app's server-function transport against controlled LibreChat HTTP replies. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'session.spec.ts',
  workers: 1,
  timeout: 45_000,
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'session-recovery' }],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer:
    process.env.SESSION_E2E_EXTERNAL === 'true'
      ? undefined
      : [
          {
            command: 'bun run build && bun run start',
            url: `${baseURL}/health`,
            timeout: 180_000,
            reuseExistingServer: false,
            env: {
              NODE_ENV: 'production',
              PORT: port,
              VITE_BASE_PATH: '/',
              VITE_API_BASE_URL: backendURL,
              API_SERVER_URL: backendURL,
              SESSION_SECRET: 'session-e2e-only-secret-with-at-least-32-characters',
              SESSION_COOKIE_SECURE: 'false',
              ADMIN_PANEL_REQUEST_LOG: 'false',
              ADMIN_PANEL_TRUSTED_ORIGINS: baseURL,
            },
          },
          {
            command: 'node e2e/mock-backend.mjs',
            url: `${backendURL}/api/admin/oauth/openid/check`,
            timeout: 15_000,
            reuseExistingServer: false,
            env: {
              MOCK_BACKEND_PORT: backendPort,
              MOCK_ADMIN_PANEL_URL: baseURL,
              MOCK_SESSION_CONTROL: 'true',
            },
          },
        ],
});
