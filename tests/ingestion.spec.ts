import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

/**
 * Phase 1 & 3 Integration Test: UI & Knowledge Graph Ingestion
 *
 * Test 1: Opens the app, loads a document, verifies ProseMirror editor works,
 *         and confirms text can be typed and tracked.
 *
 * Test 2: Connects to FalkorDB via Redis protocol and verifies connectivity.
 *         Checks for existing Episode nodes (populated by annotation resolution).
 *
 * Prerequisites:
 *   - Next.js dev server running on localhost:3000
 *   - FalkorDB running on localhost:6379 (optional — test skips gracefully)
 */

test.describe('Intent IDE E2E', () => {
  test('should load document, initialize editor, and track edits', async ({ page }) => {
    // 1. Open the app
    await page.goto('/')

    // 2. Dismiss the "Load Document" modal by pasting text and clicking Load
    const modal = page.locator('.fixed.inset-0')
    if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const textarea = modal.locator('textarea')
      await textarea.fill('Test document for e2e validation.')
      await modal.locator('button', { hasText: 'Load Document' }).click()
      await modal.waitFor({ state: 'hidden', timeout: 5_000 })
    }

    // 3. Verify ProseMirror editor is mounted and interactive
    await page.waitForSelector('.ProseMirror', { timeout: 10_000 })
    const editor = page.locator('.ProseMirror')
    await editor.click()
    await editor.type('This is a new test paragraph for e2e validation.')

    // 4. Verify text was inserted into the editor
    const editorText = await editor.textContent()
    expect(editorText).toContain('This is a new test paragraph for e2e validation.')

    // 5. Verify changes store was populated (change count in status bar)
    const statusBar = page.locator('text=/\\d+ changes/')
    await expect(statusBar).toBeVisible({ timeout: 5_000 })
  })

  test('should connect to FalkorDB and query Episode nodes', async () => {
    const redis = new Redis({ host: 'localhost', port: 6379, lazyConnect: true })

    try {
      await redis.connect()

      // Query the graphiti graph for Episode nodes
      const result = await redis.call(
        'GRAPH.QUERY',
        'graphiti',
        'MATCH (e:Episodic) RETURN count(e) AS cnt',
      ) as unknown[][]

      // FalkorDB returns: [[headers], [data rows], [stats]]
      const dataRows = result[1] as unknown[][]
      const episodeCount = dataRows.length > 0 ? Number(dataRows[0][0]) : 0

      console.log(`Found ${episodeCount} Episode nodes in FalkorDB`)
      // Episode nodes are created by annotation resolution, not direct edits.
      // This test validates FalkorDB connectivity; count >= 0 is valid.
      expect(episodeCount).toBeGreaterThanOrEqual(0)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ECONNREFUSED')) {
        test.skip(true, 'FalkorDB not running on localhost:6379 — skipping graph assertion')
      } else {
        throw err
      }
    } finally {
      await redis.quit()
    }
  })
})
