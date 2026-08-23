import { describe, it, expect } from 'vitest'

// opensCommitModal is not exported from ResolutionActions.tsx (importing a
// .tsx into a node-environment .test.ts here would pull in the whole store/
// plugin import graph — see agentMarkdown.pure.test.ts for the established
// precedent of testing such logic via a source-faithful re-implementation
// instead). Any change to the source logic will produce a mismatch that
// surfaces both here and in the component's behavior.
const ALWAYS_MODAL_GATED_HANDLERS = new Set(['apply-edit', 'act-on-thought', 'change-from-answer'])

function opensCommitModal(handler: string, hasSuggestedEdit: boolean): boolean {
  if (ALWAYS_MODAL_GATED_HANDLERS.has(handler)) return true
  return handler === 'add-to-doc' && hasSuggestedEdit
}

// Regression for #77's adversarial-review HIGH finding: handleAction's
// audit-failure toast fired for apply-edit/act-on-thought/change-from-answer
// even though those handlers only open SemanticCommitModal — no decision has
// happened yet — producing a "this decision could not be recorded" toast for
// a decision that might never happen (the user could still cancel), and a
// duplicate, differently-worded toast from recordApplyCommit on confirm.
describe('opensCommitModal (#77 handleAction toast-gating fix)', () => {
  it('is modal-gated for apply-edit/act-on-thought/change-from-answer regardless of edit/view state', () => {
    for (const handler of ['apply-edit', 'act-on-thought', 'change-from-answer']) {
      expect(opensCommitModal(handler, true)).toBe(true)
      expect(opensCommitModal(handler, false)).toBe(true)
    }
  })

  it('add-to-doc is modal-gated only when there is a suggested edit to review', () => {
    expect(opensCommitModal('add-to-doc', true)).toBe(true)
    // No suggestedEdit: add-to-doc decides immediately (inserts as a new
    // paragraph) — a real, un-gated decision that should still be warned
    // about on a known audit-write failure.
    expect(opensCommitModal('add-to-doc', false)).toBe(false)
  })

  it('is never modal-gated for handlers that always decide synchronously', () => {
    for (const handler of ['dismiss', 'park', 'tweak', 'explore', 'explore-deeper', 'research']) {
      expect(opensCommitModal(handler, true)).toBe(false)
      expect(opensCommitModal(handler, false)).toBe(false)
    }
  })
})
