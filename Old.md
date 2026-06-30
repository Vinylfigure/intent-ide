# Intent IDE

Voice-first AI document review tool. Phase 0 prototype — no auth, no database.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (localhost:3000) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | tsc --noEmit |
| `npm run test` | Vitest |

## Tech Stack

- Next.js 14+ (App Router), React 18, TypeScript, Tailwind CSS
- ProseMirror for text editing (annotation anchoring, transactions, change tracking)
- Zustand for state management (with localStorage persist)
- Whisper API (OpenAI) for voice transcription
- Claude API (default) + OpenAI-compatible for BYOK LLM calls

## Architecture

```
src/app/              Next.js pages and API routes
src/components/       React components by feature (Editor, Annotations, Voice, Changes, DocInput, Layout, Settings)
src/lib/prosemirror/  ProseMirror schema, plugins, decorations, commands
src/lib/voice/        Voice recording and transcription
src/lib/ai/           LLM client, classifier, resolver, prompts, context engine
src/lib/annotations/  Annotation types, anchoring, lifecycle
src/lib/changes/      Change log, diff engine, version control
src/lib/docInput/     Document parsing and generation
src/lib/utils/        Shared utilities (hotkeys, storage, id)
src/stores/           Zustand stores
```

## Key Patterns

### ProseMirror Plugins
- Every plugin exports a `PluginKey` for external access
- Plugin communication via `tr.setMeta(pluginKey, payload)` and `pluginKey.getState(state)`
- Decorations managed in plugin state, mapped through transactions via `decorations.map(tr.mapping, tr.doc)`
- Plugins that need Zustand state use `useStore.getState()` (not hooks)

### Zustand Stores
- All stores use `persist` middleware with `intent-ide-` prefixed localStorage keys
- Access outside React: `useStore.getState()` and `useStore.subscribe()`
- Each store in its own file in `src/stores/`

### Components
- Named function exports (not default exports)
- Props interface defined above component when needed
- Tailwind CSS only — no CSS modules, no styled-components
- Client components marked with `'use client'` at top

### API Routes
- Located in `src/app/api/{name}/route.ts`
- Read API keys from request headers (user's BYOK keys)
- Return typed JSON responses
- Use streaming for LLM responses (`ReadableStream`)

### Prompts
- All LLM prompts live in `src/lib/ai/prompts.ts`
- Never inline prompt strings in other files
- Use template literals with `{{placeholder}}` for variable injection

## Annotation Types
- `question` — "What does this mean?" → explain
- `fix` — "Change this to X" → suggest correction
- `explore` — "Tell me more" → research, don't auto-change
- `thought` — "Hmm, interesting" → research the thought
- `correction` — "The number is X not Y" → verify and apply
- `restructure` — "Flip these paragraphs" → reorganize

## Scope System
- `phrase` — selection < 1 sentence
- `sentence` — selection = 1 sentence
- `paragraph` — selection spans sentences in one paragraph
- `section` — selection spans paragraphs or includes heading

## Conventions
- Use `nanoid` for all ID generation (via `src/lib/utils/id.ts`)
- File naming: `camelCase.ts` for lib, `PascalCase.tsx` for components
- Imports use `@/` path alias (maps to `src/`)
- No default exports except Next.js pages/layouts
