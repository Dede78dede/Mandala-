import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PREINSTALLED_CHROMIUM_SHELL = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const executablePath = fs.existsSync(PREINSTALLED_CHROMIUM_SHELL)
  ? PREINSTALLED_CHROMIUM_SHELL
  : undefined;

const launchOptions = executablePath
  ? {
      executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }
  : {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'reports/playwright-html' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions,
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        hasTouch: true,
        isMobile: true,
        launchOptions,
      },
    },
  ],
  webServer: {
    command: './node_modules/.bin/vite preview --port 4173 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
