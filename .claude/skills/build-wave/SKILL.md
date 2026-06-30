---
name: build-wave
description: Build an entire implementation wave from the Intent IDE plan. Reads the plan, identifies which wave, creates all files in order.
---

# Build Wave

## Steps

1. Read the plan at `/Users/a/.claude/plans/iterative-conjuring-island.md`.

2. Identify the wave number from user input (e.g., "build wave 3").

3. Parse the wave section to find all files listed in numbered order.

4. Build each file in the wave's numbered order, one at a time.

5. After each milestone (or group of related files), verify the app compiles:
   ```
   npm run typecheck
   ```
   Fix any type errors before continuing to the next file.

6. After completing the entire wave, do a final verification with typecheck.

7. After the wave verifies clean, run the review agents — **`qa`** (edge/boundary tests) and **`troublemaker`** (adversarial review) — before declaring the wave done. Do this even if not explicitly asked. Then hand off to `code-librarian` to update the memory bank.

## Current Model IDs (BYOK defaults)

When a wave wires up or references LLM model identifiers, use the current IDs:
- `claude-opus-4-8` — deepest reasoning / complex multi-region work
- `claude-sonnet-4-6` — default balanced model
- `claude-haiku-4-5` — fast / cheap classification and lightweight calls
- `claude-fable-5` — narrative / long-form drafting

## Key Conventions

- Use `@/` import aliases for all project imports.
- Use named exports (not default exports).
- Use Tailwind CSS for all styling.
- Use Zustand with `persist` middleware for state management stores.
- ProseMirror plugins must follow the PluginKey pattern (see the `add-prosemirror-plugin` skill).
- All LLM prompts go in `src/lib/ai/prompts.ts`.
- Follow the file structure and naming conventions already established in the codebase.
