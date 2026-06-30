---
name: build-component
description: Create a new React component for Intent IDE. Use when adding a UI component to any feature area (Editor, Annotations, Voice, Changes, DocInput, Layout, Settings).
---

# Build Component

Create a new React component following Intent IDE conventions.

## Steps

1. **Determine feature area** from the component description:
   - Editor, Annotations, Voice, Changes, DocInput, Settings, Layout
   - Component goes in `src/components/{Area}/{ComponentName}.tsx`

2. **Check existing components** in that area for patterns, imports, and shared state

3. **Create the component file** with this structure:
   ```tsx
   'use client'

   import { /* stores, types */ } from '@/...'

   interface ComponentNameProps {
     // props if needed
   }

   export function ComponentName({ }: ComponentNameProps) {
     // Zustand stores for state (not prop drilling)
     // const editorView = useEditorStore(s => s.view)

     return (
       <div className="...">
         {/* Tailwind CSS only */}
       </div>
     )
   }
   ```

4. **Conventions**:
   - Named export (not default)
   - `'use client'` directive if component uses hooks, event handlers, or browser APIs
   - Tailwind CSS for all styling — no CSS modules
   - Get state from Zustand stores, not prop drilling
   - If it interacts with ProseMirror, get the view from `useEditorStore`
   - Use annotation type colors from tailwind config: `annotation-question`, `annotation-fix`, etc.

5. **Wire it up**: Update the parent component to render this new component

6. **Add types** if needed to the appropriate `types.ts` file
