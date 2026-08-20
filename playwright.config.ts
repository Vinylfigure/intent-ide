import { defineConfig, devices } from '@playwright/test'

/**
 * Some sandboxes ship a Chromium that predates the revision this Playwright
 * version would download, and cannot fetch a new one. Point
 * PLAYWRIGHT_CHROMIUM_PATH at that binary to use it instead; unset (the CI
 * case, where `playwright install` runs normally) keeps the default browser.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: './tests',
  // First Next.js dev compile of the page can take well over 30s.
  timeout: 120_000,
  retries: 0,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
    // The audit + history API routes are real server-side SQLite (Prisma /
    // libsql) — point them explicitly at the repo-local dev database.
    env: { DATABASE_URL: 'file:./dev.db' },
  },
})
