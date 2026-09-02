import { test, expect, type Page } from '@playwright/test'

/**
 * Opt-in suite driving the REAL local model.
 *
 * Run with:  LIVE_LOCAL=1 npx playwright test tests/local-model.spec.ts
 *
 * Everything here is a behaviour a mocked LLM cannot expose, because the bug
 * is in how the app and Ollama talk to each other rather than in what the
 * model says:
 *
 *  - `options.num_ctx` is silently IGNORED by Ollama's OpenAI-compatibility
 *    endpoint. A request asking for 16384 leaves `/api/ps` reporting 4096, and
 *    an over-long prompt is then truncated with no error at all.
 *  - A thinking model's tokens go to a `reasoning` field over that endpoint,
 *    so `message.content` can come back empty while the budget was spent.
 *  - Whether the model actually obeys the computed "this document does not
 *    define X" fact, rather than inventing a definition from nearby words.
 *
 * Skipped by default and skipped automatically when Ollama is unreachable, so
 * CI stays deterministic.
 */

const LIVE = process.env.LIVE_LOCAL === '1'
const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
const MODEL = process.env.LIVE_LOCAL_MODEL ?? 'qwen3:8b'
const CONTEXT_TOKENS = 16384

/** Long enough for a cold model load plus generation on CPU/Metal. */
const LIVE_TIMEOUT = 300_000

test.describe('local model (Ollama)', () => {
  test.skip(!LIVE, 'LIVE_LOCAL=1 not set — this suite drives a real local model')
  test.setTimeout(LIVE_TIMEOUT)

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${OLLAMA}/api/tags`).catch(() => null)
    test.skip(!res || !res.ok(), `Ollama not reachable at ${OLLAMA}`)
    const names: string[] = ((await res!.json()).models ?? []).map((m: { name: string }) => m.name)
    test.skip(!names.includes(MODEL), `${MODEL} not installed (have: ${names.join(', ')})`)
  })

  /** POST through the app's own proxy, so the dialect under test is the real one. */
  async function resolve(page: Page, content: string, extra: Record<string, unknown> = {}) {
    return page.request.post('/api/resolve', {
      headers: {
        'Content-Type': 'application/json',
        'x-provider': 'ollama',
        'x-model': MODEL,
        'x-base-url': OLLAMA,
        'x-context-tokens': String(CONTEXT_TOKENS),
      },
      data: { messages: [{ role: 'user', content }], maxTokens: 400, temperature: 0.2, ...extra },
      timeout: LIVE_TIMEOUT,
    })
  }

  test('the configured context window actually reaches Ollama', async ({ page, request }) => {
    // The whole reason the native /api/chat dialect exists. Over the
    // OpenAI-compat endpoint this assertion reads 4096 however large the ask.
    const res = await resolve(page, 'Reply with exactly: OK')
    expect(res.ok()).toBe(true)

    const ps = await request.get(`${OLLAMA}/api/ps`)
    const loaded = ((await ps.json()).models ?? []).find((m: { name: string }) => m.name === MODEL)
    expect(loaded, 'model should be resident after a request').toBeTruthy()
    expect(loaded.context_length).toBe(CONTEXT_TOKENS)
  })

  test('answers arrive with no reasoning leaked into the body', async ({ page }) => {
    const res = await resolve(page, 'In one short sentence, what is a pull request?')
    const body = await res.json()
    expect(body.error).toBeUndefined()
    expect(body.content.trim().length).toBeGreaterThan(0)
    for (const tag of ['<think>', '</think>', '<thinking>', '</thinking>']) {
      expect(body.content).not.toContain(tag)
    }
  })

  test('a streamed answer also arrives clean and non-empty', async ({ page }) => {
    // Streaming is a separate wire format (NDJSON, not SSE) and a separate
    // parser branch — a fix that only works non-streaming fixes nothing, since
    // the app streams every annotation resolution.
    const res = await resolve(page, 'Reply with exactly: STREAM OK', { stream: true })
    expect(res.ok()).toBe(true)

    const raw = await res.text()
    let assembled = ''
    let sawDelta = false
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const payload = JSON.parse(line.slice(6))
        if (typeof payload.text === 'string') {
          assembled += payload.text
          sawDelta = true
        }
      } catch {
        // meta/done frames carry no text
      }
    }
    expect(sawDelta, 'stream should emit at least one delta').toBe(true)
    expect(assembled).not.toContain('<think>')
    expect(assembled.trim().length).toBeGreaterThan(0)
  })

  test('tool calling works, which the doc graph depends on', async ({ page }) => {
    // Ollama returns `arguments` as an object, unlike OpenAI's JSON string —
    // parsing it twice throws on every call and the graph silently loses all
    // its LLM edges.
    const res = await page.request.post('/api/structured', {
      headers: {
        'Content-Type': 'application/json',
        'x-provider': 'ollama',
        'x-model': MODEL,
        'x-base-url': OLLAMA,
        'x-context-tokens': String(CONTEXT_TOKENS),
      },
      data: {
        messages: [{ role: 'user', content: 'Call link_blocks once with from="a" and to="b". You must use the tool.' }],
        tools: [
          {
            name: 'link_blocks',
            description: 'Record a dependency between two blocks',
            input_schema: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' } },
              required: ['from', 'to'],
            },
          },
        ],
        maxTokens: 200,
      },
      timeout: LIVE_TIMEOUT,
    })
    const body = await res.json()
    expect(body.toolCalls?.[0]?.name).toBe('link_blocks')
    expect(body.toolCalls[0].input).toMatchObject({ from: 'a', to: 'b' })
  })

  test('it says so when the document does not define a term', async ({ page }) => {
    // The reported question, with the fact the app now computes and states.
    // Asking the model to WORK OUT for itself whether the term was defined
    // made it worse — it glossed "Atlantis" as "a Terraform sniff test", the
    // words beside it. A stated fact is obeyed; a judgement call is not.
    const prompt = `ANNOTATION:
  Type: dig
  User said: "tell me more about what atlantis is"
  Selected text: "Atlantis"

CONTEXT:
  Local block: "2. Terraform / Atlantis “sniff test”"
  Section: "The stated process was IaC, but engineers could apply Terraform locally with powerful cloud credentials."

THIS DOCUMENT DOES NOT DEFINE "Atlantis". It names the term without explaining it.
Begin your answer with: This document does not define "Atlantis".
Then, under a line reading "From outside the document:", explain what it is from your own
knowledge. Do NOT construct a definition out of the surrounding sentences — the words next to
a term are not its meaning.`

    const body = await (await resolve(page, prompt)).json()
    expect(body.content.toLowerCase()).toContain('does not define')
    expect(body.content).toContain('From outside the document:')
    // Grounded knowledge and the model's own must be separable by the reader.
    // NOTE: this asserts the SHAPE, not the accuracy of the second half —
    // an 8B model's world knowledge is thin, and it has answered this one
    // wrongly (Plato; then "a staging environment"; Atlantis is in fact
    // Terraform pull-request automation). The labelling is what makes that
    // survivable, and the labelling is what is under test here.
    expect(body.content.indexOf('does not define')).toBeLessThan(
      body.content.indexOf('From outside the document:'),
    )
  })
})
