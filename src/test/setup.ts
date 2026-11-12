import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Unmounts before the test ends and lets one macrotask pass, so timers Radix
 * schedules on unmount (focus-scope's focus restore) run while jsdom is still
 * up instead of firing into a torn-down window as unhandled errors.
 */
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
