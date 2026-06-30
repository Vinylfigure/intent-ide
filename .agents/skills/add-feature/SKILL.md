---
name: add-feature
description: Add a new feature to Intent IDE across all layers (types, plugins, stores, API routes, components). Use for features that touch multiple parts of the stack.
---

# Add Feature

Implement a feature bottom-up across all necessary layers.

## Steps

1. **Analyze scope** — which layers does this feature touch?
   - Types (`src/lib/{domain}/types.ts`)
   - ProseMirror plugin (`src/lib/prosemirror/plugins/`)
   - Zustand store (`src/stores/`)
   - API route (`src/app/api/`)
   - React components (`src/components/`)
   - Prompts (`src/lib/ai/prompts.ts`)

2. **Build bottom-up** in this order:
   a. **Types** — Add interfaces/types to the appropriate `types.ts`
   b. **ProseMirror plugin** — If the feature needs editor state, create or extend a plugin following the project pattern (PluginKey, typed state, init/apply)
   c. **Zustand store** — Add state + actions to existing store, or create new store with `persist` middleware
   d. **API route** — Create in `src/app/api/{name}/route.ts` with input validation and typed responses
   e. **Components** — Create or update React components, wire to stores
   f. **Prompts** — Add any LLM prompts to `src/lib/ai/prompts.ts`

3. **Check for patterns** — Before writing new code, look at similar existing features for reference:
   - How annotations work → model new annotation-like features similarly
   - How voice pipeline works → model new pipelines similarly
   - How existing API routes handle streaming → follow same pattern

4. **Integration** — Wire the feature into the existing component tree and test the flow end-to-end
