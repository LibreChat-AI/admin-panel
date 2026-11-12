import { createStart, createCsrfMiddleware } from '@tanstack/react-start';
import { csrfOptions, parseOrigins, invalidOrigins } from '@/utils';

const trustedOrigins =
  typeof process === 'undefined' ? undefined : process.env.ADMIN_PANEL_TRUSTED_ORIGINS;
const ignoredOrigins = invalidOrigins(trustedOrigins);

if (ignoredOrigins.length > 0) {
  console.warn(
    `[start] ADMIN_PANEL_TRUSTED_ORIGINS: ignoring ${ignoredOrigins.join(', ')}; list full origins such as https://admin.example.com`,
  );
}

const csrfMiddleware: ReturnType<typeof createCsrfMiddleware> = createCsrfMiddleware(
  csrfOptions(parseOrigins(trustedOrigins)),
);

export const startInstance = createStart(() => ({ requestMiddleware: [csrfMiddleware] }));
