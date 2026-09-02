import { beforeEach, describe, expect, it } from 'vitest'
import { useDocumentStore } from '@/stores/documentStore'

// loadDocumentJson is the single choke point every document read funnels
// through (editor mount and document switch alike), so it is where the
// legacy table-as-code_block recovery hooks in. These tests exercise it at
// that boundary rather than through the migration module, which has its own
// suite — what matters here is that a read migrates AND persists.

class MemoryStorage {
  store = new Map<string, string>()
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

/** Reads work, writes always fail — a full or blocked localStorage. */
class ReadOnlyStorage extends MemoryStorage {
  setItem(): void {
    throw new Error('QuotaExceededError')
  }
}

const DOC_ID = 'doc-1'
const KEY = `intent-ide-doc:${DOC_ID}`

const LEGACY_DOC = {
  type: 'doc',
  content: [
    {
      type: 'code_block',
      attrs: { blockId: 'blk-1' },
      content: [
        { type: 'text', text: ['| Area | Gap |', '| :---- | :---- |', '| GCP | Breadth |'].join('\n') },
      ],
    },
  ],
}

function typesIn(docJson: unknown): string[] {
  const seen: string[] = []
  const walk = (n: { type?: string; content?: unknown[] }) => {
    if (n?.type) seen.push(n.type)
    if (Array.isArray(n?.content)) n.content.forEach((c) => walk(c as typeof n))
  }
  walk(docJson as { type?: string; content?: unknown[] })
  return seen
}

let storage: MemoryStorage

function useStorage(s: MemoryStorage) {
  storage = s
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true })
}

beforeEach(() => {
  useStorage(new MemoryStorage())
})

describe('documentStore.loadDocumentJson — legacy table recovery', () => {
  it('converts a stored table-as-code_block on read', () => {
    storage.setItem(KEY, JSON.stringify(LEGACY_DOC))
    const loaded = useDocumentStore.getState().loadDocumentJson(DOC_ID)
    expect(typesIn(loaded)).toContain('table')
    expect(typesIn(loaded)).not.toContain('code_block')
  })

  it('writes the migration back so it is not redone on every load', () => {
    // Left unpersisted, a later save from a caller holding the pre-migration
    // JSON would quietly reinstate the code_block.
    storage.setItem(KEY, JSON.stringify(LEGACY_DOC))
    useDocumentStore.getState().loadDocumentJson(DOC_ID)
    expect(typesIn(JSON.parse(storage.getItem(KEY) as string))).toContain('table')
  })

  it('still returns the migrated document when persisting it fails', () => {
    // A full localStorage costs a repeat conversion next load — it must not
    // cost the user their tables for this session.
    useStorage(new ReadOnlyStorage())
    storage.store.set(KEY, JSON.stringify(LEGACY_DOC))
    const loaded = useDocumentStore.getState().loadDocumentJson(DOC_ID)
    expect(typesIn(loaded)).toContain('table')
  })

  it('leaves an already-migrated document byte-identical', () => {
    storage.setItem(KEY, JSON.stringify(LEGACY_DOC))
    useDocumentStore.getState().loadDocumentJson(DOC_ID)
    const afterFirst = storage.getItem(KEY)
    useDocumentStore.getState().loadDocumentJson(DOC_ID)
    expect(storage.getItem(KEY)).toBe(afterFirst)
  })

  it('does not rewrite storage for a document with nothing to migrate', () => {
    const plain = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const raw = JSON.stringify(plain)
    storage.setItem(KEY, raw)
    useDocumentStore.getState().loadDocumentJson(DOC_ID)
    expect(storage.getItem(KEY)).toBe(raw)
  })

  it('returns null for a missing document and does not throw on corrupt JSON', () => {
    expect(useDocumentStore.getState().loadDocumentJson('nope')).toBeNull()
    storage.setItem(KEY, '{not json')
    expect(useDocumentStore.getState().loadDocumentJson(DOC_ID)).toBeNull()
  })
})
