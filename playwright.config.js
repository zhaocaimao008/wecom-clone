// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // tests share a live server — run serially to avoid collisions
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],

  use: {
    baseURL: 'http://127.0.0.1:3001',
    headless: true,
    viewport: { width: 1280, height: 800 },
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Don't rely on system Chromium — use Playwright's bundled build
    channel: undefined,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
