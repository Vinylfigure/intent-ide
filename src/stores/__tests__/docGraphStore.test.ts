// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { schema } from '@/lib/prosemirror/schema'
import { getDocGraph, invalidateDocGraphCache } from '@/lib/graphrag/docGraph'
import { useDocGraphStore } from '@/stores/docGraphStore'
import type { LLMConfig } from '@/stores/settingsStore'

const CONFIG: LLMConfig = { provider: 'claude', apiKey: 'test-key', model: 'test-model' }

function doc() {
  return schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b1' }, [schema.text('hello world')]),
  ])
}

/** publishDocGraph is fire-and-forget via dynamic import — poll until it lands. */
async function waitForStatus(status: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (useDocGraphStore.getState().status !== status) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for status "${status}" (got "${useDocGraphStore.getState().status}")`,
      )
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeEach(() => {
  invalidateDocGraphCache()
  useDocGraphStore.setState({ graph: null, status: 'idle' })
})

describe('docGraphStore publication (browser only)', () => {
  it('getDocGraph publishes the built graph and ready status', async () => {
    const graph = await getDocGraph(doc(), CONFIG, { skipLlm: true, skipEmbeddings: true })
    await waitForStatus('ready')
    expect(useDocGraphStore.getState().graph).toBe(graph)
  })

  it('cache hits publish too (fresh page, warm cache)', async () => {
    const graph = await getDocGraph(doc(), CONFIG, { skipLlm: true, skipEmbeddings: true })
    await waitForStatus('ready')
    // Simulate a fresh UI store with a warm graph cache.
    useDocGraphStore.setState({ graph: null, status: 'idle' })
    const again = await getDocGraph(doc(), CONFIG, { skipLlm: true, skipEmbeddings: true })
    expect(again).toBe(graph)
    await waitForStatus('ready')
    expect(useDocGraphStore.getState().graph).toBe(graph)
  })
})
