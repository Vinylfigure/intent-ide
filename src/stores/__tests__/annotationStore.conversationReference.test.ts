import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation, ConversationMessage } from '@/lib/annotations/types'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

function makeAnnotation(conversation: ConversationMessage[]): Annotation {
  return {
    id: 'ann-1',
    documentId: 'doc-1',
    locationGroupKey: 'doc-1:0:10',
    type: 'flag',
    status: 'resolved',
    transcript: 'annotation',
    anchor: { from: 0, to: 10, scope: 'phrase', text: 'x' },
    resolution: null,
    conversation,
    parentId: null,
    childIds: [],
    createdAt: Date.now(),
    resolvedAt: null,
    verbosity: 'normal',
  }
}

async function loadStore() {
  vi.resetModules()
  return import('@/stores/annotationStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

// Regression for #92: the "Simplify thread" stale-write guard in
// ResolutionActions.tsx detects an in-flight write on another annotation
// field by comparing `conversation` array *references*, not deep equality.
// That guard is only correct if annotationStore's own actions honor this
// contract: a patch that doesn't touch `conversation` must leave its
// reference untouched, and any action that does touch it must produce a new
// array. These tests exercise the real store (not a re-implementation) so a
// future refactor of annotationStore.ts that breaks the contract fails here,
// not just silently reopening #92 behind an untouched pure-logic test.
describe('annotationStore conversation-reference contract (#92)', () => {
  it('update() with a patch that does not touch conversation preserves the array reference', async () => {
    const { useAnnotationStore } = await loadStore()
    const conversation: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', suggestedEdit: null, timestamp: 1 },
    ]
    useAnnotationStore.getState().add(makeAnnotation(conversation))

    useAnnotationStore.getState().update('ann-1', { status: 'applied' })

    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).toBe(conversation)
  })

  it('update() with a patch that replaces conversation changes the reference', async () => {
    const { useAnnotationStore } = await loadStore()
    const conversation: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', suggestedEdit: null, timestamp: 1 },
    ]
    useAnnotationStore.getState().add(makeAnnotation(conversation))

    const replacement: ConversationMessage[] = [
      { id: 'm2', role: 'agent', content: 'summary', suggestedEdit: null, timestamp: 2 },
    ]
    useAnnotationStore.getState().update('ann-1', { conversation: replacement })

    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).not.toBe(conversation)
    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).toBe(replacement)
  })

  it('addMessage() changes the conversation reference', async () => {
    const { useAnnotationStore } = await loadStore()
    const conversation: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', suggestedEdit: null, timestamp: 1 },
    ]
    useAnnotationStore.getState().add(makeAnnotation(conversation))

    useAnnotationStore.getState().addMessage('ann-1', {
      id: 'm2', role: 'agent', content: 'reply', suggestedEdit: null, timestamp: 2,
    })

    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).not.toBe(conversation)
  })

  it('updateMessage() changes the conversation reference', async () => {
    const { useAnnotationStore } = await loadStore()
    const conversation: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', suggestedEdit: null, timestamp: 1 },
    ]
    useAnnotationStore.getState().add(makeAnnotation(conversation))

    useAnnotationStore.getState().updateMessage('ann-1', 'm1', { content: 'edited' })

    expect(useAnnotationStore.getState().getById('ann-1')?.conversation).not.toBe(conversation)
  })

  it('remove() leaves getById() returning undefined, mirroring the guard\'s "annotation deleted mid-flight" branch', async () => {
    const { useAnnotationStore } = await loadStore()
    const conversation: ConversationMessage[] = [
      { id: 'm1', role: 'user', content: 'hi', suggestedEdit: null, timestamp: 1 },
    ]
    useAnnotationStore.getState().add(makeAnnotation(conversation))

    useAnnotationStore.getState().remove('ann-1')

    expect(useAnnotationStore.getState().getById('ann-1')).toBeUndefined()
  })
})
