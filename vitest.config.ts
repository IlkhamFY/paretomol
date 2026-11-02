import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scoped to the unit suite. Without this, Vitest's default glob also
    // collects the Playwright specs under e2e/, which use a different runner
    // and fail immediately on collection. The two suites are run separately:
    // `npm test` for units, `npm run test:e2e` for the browser tests.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
