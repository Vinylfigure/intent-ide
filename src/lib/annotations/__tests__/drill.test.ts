// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAnnotationStore } from '@/stores/annotationStore'
import type { Annotation } from '../types'

const capture = vi.fn()
vi.mock('@/lib/voice/pipeline', () => ({
  captureAndResolveInBackground: (...args: unknown[]) => capture(...args),
}))

import { drillFromAnswer } from '../drill'

function ann(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'parent',
    documentId: 'doc',
    locationGroupKey: 'doc:10:31',
    type: 'ask',
    status: 'resolved',
    transcript: 'what is tokenization in this context?',
    anchor: { from: 10, to: 31, scope: 'sentence', text: 'What is tokenization?' },
    resolution: null,
    conversation: [],
    parentId: null,
    childIds: [],
    createdAt: 0,
    resolvedAt: null,
    verbosity: 'normal',
    ...over,
  }
}

beforeEach(() => {
  capture.mockClear()
  useAnnotationStore.setState({ annotations: [ann()] })
})

describe('drillFromAnswer', () => {
  it('anchors the child at the parent position but keeps the quote as its subject', () => {
    // The deliberate split: there is no document position for text that only
    // exists inside an answer, so position is inherited while subject is not.
    drillFromAnswer('parent', {
      blockText: 'Workload Identity Federation',
      quote: 'Workload Identity Federation',
      transcript: 'explain this in plain language',
      suggestedIntent: 'dig',
    })

    expect(capture).toHaveBeenCalledTimes(1)
    const [type, transcript, from, to, opts] = capture.mock.calls[0]
    expect(type).toBe('dig')
    expect(transcript).toBe('explain this in plain language')
    expect(from).toBe(10)
    expect(to).toBe(31)
    expect(opts).toMatchObject({
      parentId: 'parent',
      quote: 'Workload Identity Federation',
    })
  })

  it('defaults to dig when no intent was suggested', () => {
    drillFromAnswer('parent', {
      blockText: 'x',
      quote: 'x',
      transcript: 'say more',
      suggestedIntent: null,
    })
    expect(capture.mock.calls[0][0]).toBe('dig')
  })

  it('forwards skipClassify so a one-click action does not pay for a classify round-trip', () => {
    drillFromAnswer('parent', {
      blockText: 'x',
      quote: 'x',
      transcript: 'Define this.',
      suggestedIntent: 'ask',
      skipClassify: true,
    })
    expect(capture.mock.calls[0][4]).toMatchObject({ skipClassify: true })
  })

  it('falls back to position 0 when the parent has gone', () => {
    // A card can outlive its annotation if the store was cleared underneath it;
    // capturing at 0 is survivable, throwing inside a click handler is not.
    useAnnotationStore.setState({ annotations: [] })
    drillFromAnswer('missing', {
      blockText: 'x',
      quote: 'x',
      transcript: 'q',
      suggestedIntent: 'dig',
    })
    expect(capture.mock.calls[0][2]).toBe(0)
    expect(capture.mock.calls[0][3]).toBe(0)
  })
})
