import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // First Next.js dev compile of the page can take well over 30s.
  timeout: 120_000,
  retries: 0,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
