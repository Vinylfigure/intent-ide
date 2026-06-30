---
name: add-cascade-edit
description: Scaffold the Wave 3 cascade-edit pattern for Intent IDE — a multi-region ProposedEdit producer, a structured /api/structured route with a propose_edit tool, a read-line-aware ProseMirror decoration with inline Accept/Reject, and a single sorted transaction gated through SemanticCommitModal. Use when adding cascade / multi-region semantic edits.
---

# Add Cascade Edit

Implements a "Semantic Commit" that spans multiple document regions: the agent proposes several edits at once, they are surfaced quietly below the read-line (loudly above it), and the user accepts/rejects each before they apply in one transaction behind a confirmation gate.

## Steps

1. **Define the ProposedEdit type** in `src/lib/annotations/types.ts` (or a new `src/lib/edits/types.ts`):
   ```ts
   export interface ProposedEdit {
     id: string
     from: number          // ProseMirror doc position
     to: number
     newText: string
     reason: string        // why the agent proposes this region change
     status: 'pending' | 'accepted' | 'rejected'
   }
   ```

2. **Add the structured route** at `src/app/api/structured/route.ts` (follow the `add-api-route` skill). Read the API key from `x-api-key`, validate the body, and call the LLM with a single tool, `propose_edit(from, to, newText, reason)`, that the model invokes once per region. Return the collected tool calls as a `ProposedEdit[]`:
   ```ts
   // tool schema passed to the client abstraction in src/lib/ai/client.ts
   const proposeEditTool = {
     name: 'propose_edit',
     description: 'Propose a replacement for one document region.',
     input_schema: {
       type: 'object',
       properties: {
         from: { type: 'number' },
         to: { type: 'number' },
         newText: { type: 'string' },
         reason: { type: 'string' },
       },
       required: ['from', 'to', 'newText', 'reason'],
     },
   }
   ```
   Keep the prompt template in `src/lib/ai/prompts.ts`. Never bundle API keys into client code.

3. **Add the producer** in `src/lib/ai/` (e.g. `cascade.ts`): given an annotation/resolution, POST to `/api/structured`, validate every returned region against the live doc length, drop or clamp out-of-range `from`/`to`, and return a sanitized `ProposedEdit[]`.

4. **Create the decoration plugin** at `src/lib/prosemirror/plugins/cascadeEditPlugin.ts`, modeled on `conflictPlugin.ts` (follow the `add-prosemirror-plugin` skill):
   - Export a `cascadeEditPluginKey = new PluginKey<CascadeEditPluginState>('cascadeEdits')`.
   - State holds the `ProposedEdit[]` and a `DecorationSet`; map both through every transaction (`decorations.map(tr.mapping, tr.doc)` and `tr.mapping.map(pos)` for each region).
   - Read the read-line position from `readLinePlugin` state. For edits **above** the read-line, build a prominent inline decoration (e.g. `class: 'cascade-edit cascade-flag'`). For edits **at or below** the read-line, render quietly (`class: 'cascade-edit cascade-quiet'`) so they do not break flow state.
   - Use `Decoration.widget` to mount inline **Accept / Reject** controls per region; dispatch plugin meta (`setCascadeEditMeta`) to flip a region's `status`.

5. **Buffer reveals at breakpoints**: do not surface above-read-line flags mid-paragraph. Hold them in plugin state and reveal at the next natural reading breakpoint (end of paragraph), consistent with the Flow State / event-segmentation rule.

6. **Apply in ONE transaction, gated**: when the user confirms, collect every `accepted` region, sort **descending by `from`** (so earlier replacements don't shift later positions), and apply them in a single `tr` with `tr.replaceWith` / `tr.insertText`. Route the whole commit through `SemanticCommitModal` — never auto-apply. If the resolution `usedMADS` and a provocation exists, the modal's gated-apply acknowledgment must be satisfied first.

7. **Wire the UI**: surface the pending cascade in the changes/annotation panel and open `SemanticCommitModal` on commit. Register the plugin in `src/lib/prosemirror/plugins/index.ts`.

8. **Audit**: log the applied cascade to the Prisma v7 + SQLite ledger as append-only entries (old text / new text per region).

## Rules

- Apply accepted regions in exactly one transaction, sorted descending by `from`. Never apply region-by-region in a loop without re-mapping.
- Validate and clamp every `from`/`to` against the live document before applying; positions from the model may be stale.
- Use `tr.mapping.map()` for positions and `DecorationSet.map()` when carrying decorations across transactions.
- Read store state via `useStore.getState()` inside plugin code, not hooks.
- **HITL is mandatory:** the cascade only applies through `SemanticCommitModal` / a `<Confirmation>` step. No auto-apply.
- **No XSS:** render `newText` / `reason` via assistant-ui / Streamdown — never `innerHTML` / `dangerouslySetInnerHTML`.
- Use `@/` path aliases and named exports. Export the plugin, its PluginKey, and meta helpers.
