import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * End-to-end coverage for the reading experience: how a real document renders,
 * and how the annotation surfaces behave around it.
 *
 * LLM traffic is intercepted (the pattern `cascade-review.spec.ts` established)
 * so this suite is deterministic and can gate CI. The local-model behaviours
 * that mocking cannot reach — context sizing, reasoning suppression — live in
 * `local-model.spec.ts` behind LIVE_LOCAL=1.
 */

/**
 * The real study guide, when it is on this machine, else a fixture carrying the
 * same shapes. Both matter: the fixture pins the behaviour in CI, the real
 * document is what actually exposed the bug (41 GFM tables, including the
 * single-cell callouts a Google Docs export emits).
 */
const REAL_DOC = path.join(os.homedir(), 'Downloads', 'Sierra_Onsite_Deep_Study_Guide.md')

const FIXTURE_DOC = [
  '# Deep Study Guide',
  '',
  '## 1. Capability map',
  '',
  '| Area | Current evidence | Gap | Priority |',
  '| :---- | :---- | :---- | :---- |',
  '| Control engineering | Branch protection as preventive control. | None conceptually. | MEDIUM |',
  '| GCP | Aegis reference: CAI discovery, Cloud Run, Pub/Sub. | Breadth of service vocabulary. | HIGH |',
  '',
  '## 2. Terraform / Atlantis "sniff test"',
  '',
  'The stated process was IaC, but engineers could apply Terraform locally with',
  'powerful cloud credentials. The deeper issue was an uncontrolled path to',
  'production and key-management changes.',
  '',
  '## 3. Jira + Splunk access-grant reconciliation',
  '',
  'You pulled access evidence and approval-ticket data, automated matching, and',
  'discovered real source-data issues such as account naming inconsistencies.',
  '',
  '| A strong answer: my production history is heavier in AWS, so I would not pretend otherwise. |',
  '| :---- |',
  '',
].join('\n')

async function loadDocument(page: Page, text: string) {
  await page.goto('/')
  const modal = page.locator('.fixed.inset-0').first()
  if (await modal.isVisible().catch(() => false)) {
    const paste = page.getByRole('button', { name: /paste/i }).first()
    if (await paste.isVisible().catch(() => false)) await paste.click()
    await page.locator('textarea').first().fill(text)
    await page.getByRole('button', { name: /load document/i }).first().click()
  }
  await page.waitForSelector('.ProseMirror', { timeout: 60_000 })
}

test.describe('tables render as tables, not as dark code blocks', () => {
  test('a pasted GFM document produces real table nodes', async ({ page }) => {
    await loadDocument(page, FIXTURE_DOC)

    await expect(page.locator('.ProseMirror table')).toHaveCount(2)

    // The regression itself: the old parser emitted every table as a
    // code_block, which the editor styles light-on-near-black. A <pre>
    // carrying a pipe is that bug, whatever else is on the page.
    const pipeInPre = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ProseMirror pre')).some((el) =>
        (el.textContent ?? '').includes('|'),
      ),
    )
    expect(pipeInPre).toBe(false)
  })

  test('single-cell callout tables survive, not just multi-column grids', async ({ page }) => {
    // The Google Docs export shape: one header cell, a delimiter row, no body.
    await loadDocument(page, FIXTURE_DOC)
    await expect(
      page.locator('.ProseMirror table', { hasText: 'my production history is heavier in AWS' }),
    ).toHaveCount(1)
  })

  test('table text is readable — not light-on-dark', async ({ page }) => {
    await loadDocument(page, FIXTURE_DOC)
    const bg = await page
      .locator('.ProseMirror table td')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    // Parse rgb() and assert a light ground; the code-block treatment is #2d2a26.
    const [r, g, b] = (bg.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
    expect((r + g + b) / 3).toBeGreaterThan(200)
  })

  test('the real study guide renders every table', async ({ page }) => {
    test.skip(!fs.existsSync(REAL_DOC), 'Sierra study guide not present on this machine')
    await loadDocument(page, fs.readFileSync(REAL_DOC, 'utf8'))

    const tables = await page.locator('.ProseMirror table').count()
    expect(tables).toBeGreaterThan(30)

    const pipeInPre = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ProseMirror pre')).some((el) =>
        (el.textContent ?? '').includes('|'),
      ),
    )
    expect(pipeInPre).toBe(false)
  })
})

test.describe('documents stored before tables existed', () => {
  test('a legacy table-as-code_block document converts on load', async ({ page }) => {
    // Only docJson is persisted — never the markdown it came from — so a
    // document imported under the old parser can only be recovered on read.
    await loadDocument(page, FIXTURE_DOC)

    const legacy = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('intent-ide-doc:'))
      if (!key) return null
      localStorage.setItem(
        key,
        JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'code_block',
              attrs: { blockId: 'legacy-1' },
              content: [
                {
                  type: 'text',
                  text: '| Area | Gap |\n| :---- | :---- |\n| GCP | Breadth |',
                },
              ],
            },
          ],
        }),
      )
      return key
    })
    expect(legacy).not.toBeNull()

    await page.reload()
    await page.waitForSelector('.ProseMirror', { timeout: 60_000 })

    await expect(page.locator('.ProseMirror table')).toHaveCount(1)
    await expect(page.locator('.ProseMirror pre')).toHaveCount(0)
  })
})
