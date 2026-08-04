import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The browser binary is taken from the image when one is present: the pinned
 * @playwright/test version and the preinstalled Chromium build do not always
 * match, and downloading a second copy in CI wastes minutes for no benefit.
 */
const LOCAL_CHROME = process.env.PARETOMOL_CHROME;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker: three browser engines each instantiating a 7 MB WebAssembly
  // module contend badly for CPU, and the failures that produces are timeouts
  // rather than findings.
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  // Generous, because the RDKit WebAssembly module is 7 MB and Firefox in
  // particular takes appreciably longer to instantiate it than Chromium; a
  // tighter budget fails on load time rather than on behaviour.
  timeout: 240_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  // Three engines, because a browser-based tool that is only tested in one is
  // only known to work in one. Chromium may use a preinstalled binary; Firefox
  // and WebKit come from Playwright's own download.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: LOCAL_CHROME ? { executablePath: LOCAL_CHROME } : {},
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
