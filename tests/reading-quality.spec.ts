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

  // WAIT for the first-run modal rather than sampling whether it is visible
  // right now. The point-in-time check this replaces returned false on a cold
  // CI page before the modal had mounted, silently skipped the paste, and left
  // the test asserting against an empty editor — a failure that reproduced
  // only in CI and said nothing about why.
  await expect(page.getByRole('heading', { name: 'Load Document' })).toBeVisible({
    timeout: 60_000, // first dev-server compile
  })
  await page.getByRole('button', { name: /^paste$/i }).click()
  await page.locator('textarea').first().fill(text)
  await page.getByRole('button', { name: /load document/i }).first().click()

  await page.waitForSelector('.ProseMirror', { timeout: 60_000 })
  // The paste is applied through a store update; wait for content rather than
  // for the element, or an assertion can run against a mounted-but-empty doc.
  await expect(page.locator('.ProseMirror')).not.toBeEmpty({ timeout: 30_000 })
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

// ── the annotation surfaces ──────────────────────────────────────────────────
//
// A document whose deterministic graph has real, non-hub edges: "Pilot
// Program" is defined once and used twice, so those two blocks genuinely bear
// on the definer and on each other. Chosen over a synthetic fixture because
// the point of these tests is that the SAME rules a reader hits produce the
// links they see.
const LINKED_DOC = [
  '# Programme handbook',
  '',
  '## 1. Definitions',
  '',
  '"Pilot Program" means the limited trial rollout of the reconciliation service.',
  '',
  '## 2. Funding',
  '',
  'Funding for the Pilot Program comes from the reconciliation reserve and is',
  'reviewed each quarter against the trial rollout milestones.',
  '',
  '## 3. Unrelated matters',
  '',
  'Catering arrangements for the annual offsite are handled by the events desk.',
  '',
].join('\n')

/** Fake out the LLM boundary so the suite is deterministic. */
async function interceptLlm(page: Page, answer = 'A short grounded answer.') {
  await page.route('**/api/graphiti', (route) => route.abort())
  await page.route('**/api/embed', (route) => route.fulfill({ json: { vectors: [] } }))
  await page.route('**/api/classify', (route) => route.fulfill({ json: { type: 'dig' } }))
  await page.route('**/api/structured', (route) => route.fulfill({ json: { toolCalls: [] } }))
  await page.route('**/api/resolve', (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean }
    if (body.stream) {
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          `data: ${JSON.stringify({ responseId: 'rq-1' })}\n\n` +
          `data: ${JSON.stringify({ text: answer })}\n\n`,
      })
    }
    return route.fulfill({ json: { content: answer, responseId: 'rq-1', logprobs: null } })
  })
}

/** Select a paragraph and ask something about it, then wait for the answer. */
async function annotate(page: Page, containing: string, question: string) {
  const target = page.locator('.ProseMirror p', { hasText: containing }).first()
  await target.click({ clickCount: 3 })
  const composer = page.getByPlaceholder("What's on your mind?")
  await composer.waitFor({ state: 'visible', timeout: 30_000 })
  await composer.fill(question)
  await composer.press('Enter')
  await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 60_000 })
}

test.describe('related passages', () => {
  test('shows a genuinely related passage, described in words a reader can act on', async ({ page }) => {
    await interceptLlm(page)
    await loadDocument(page, LINKED_DOC)
    await annotate(page, 'Funding for the Pilot Program', 'what does this depend on?')

    const card = page.locator('[aria-label^="Blast radius preview"]')
    await expect(card).toBeVisible({ timeout: 30_000 })

    // The old UI showed raw machine provenance — `references ("Pilot
    // Program")` — which tells a reader nothing about why they should look.
    await expect(card).toContainText('Pilot Program')
    await expect(card).not.toContainText('references (')
    await expect(card).toContainText('trial rollout')
  })

  test('does not offer the unrelated passage from the same document', async ({ page }) => {
    await interceptLlm(page)
    await loadDocument(page, LINKED_DOC)
    await annotate(page, 'Funding for the Pilot Program', 'what does this depend on?')

    const card = page.locator('[aria-label^="Blast radius preview"]')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).not.toContainText('Catering')
  })

  test('a related passage is a real button that scrolls the editor to it', async ({ page }) => {
    await interceptLlm(page)
    await loadDocument(page, LINKED_DOC)
    await annotate(page, 'Funding for the Pilot Program', 'what does this depend on?')

    // Addressed by role, not by position in the card — the card also holds the
    // "Check these" judge button.
    const passage = page.getByRole('button', { name: /Go to related passage/ }).first()
    await expect(passage).toBeVisible({ timeout: 30_000 })
    await passage.click()
    // The target block is briefly marked so the eye lands on it. Asserted on
    // the overlay rather than a class on the block: ProseMirror strips a class
    // within a frame of the scroll, which is why the marker lives outside it.
    await expect(page.locator('.block-pulse-overlay')).toHaveCount(1)
  })
})

test.describe('threads can be closed', () => {
  test('dismissing removes the card and decrements the review count', async ({ page }) => {
    await interceptLlm(page)
    await loadDocument(page, LINKED_DOC)
    await annotate(page, 'Catering arrangements', 'is this needed?')

    await expect(page.getByText('1 review item')).toBeVisible()
    const card = page.locator('[aria-label^="Blast radius preview"], .annotation-card').first()

    // "Got it" is the dig-type accept action; it routes through the same
    // dismiss case as "Dismiss" and "Keep it".
    await page.getByRole('button', { name: /^(Got it|Dismiss|Keep it)$/ }).first().click()

    // The header keeps rendering — it now reads zero. (Asserting the whole
    // "review item" phrase disappears would pass for the wrong reason: "0
    // review items" still contains it.)
    await expect(page.getByText('0 review items')).toBeVisible({ timeout: 15_000 })
    await expect(card).toBeHidden()
    await expect(page.getByRole('button', { name: /show 1 resolved/i })).toBeVisible()
  })

  test('nothing is destroyed — Show resolved brings it back', async ({ page }) => {
    await interceptLlm(page)
    await loadDocument(page, LINKED_DOC)
    await annotate(page, 'Catering arrangements', 'is this needed?')
    await page.getByRole('button', { name: /^(Got it|Dismiss|Keep it)$/ }).first().click()
    await expect(page.getByText('0 review items')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /show \d+ resolved/i }).click()
    await expect(page.getByText('1 review item')).toBeVisible()
    // Still dismissed, just visible again — restoring must not resurrect it
    // into the reader's queue.
    await expect(page.getByText('Dismissed').first()).toBeVisible()
  })
})
