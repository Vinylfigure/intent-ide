---
name: add-prosemirror-plugin
description: Create a new ProseMirror plugin for Intent IDE with PluginKey, typed state, decorations. Use when adding editor behavior or tracking.
---

# Add ProseMirror Plugin

## Steps

1. Create a new plugin file at `src/lib/prosemirror/plugins/{name}Plugin.ts`.

2. Define and export a `PluginKey` for the plugin:
   ```ts
   export const {name}PluginKey = new PluginKey<{Name}PluginState>('{name}');
   ```

3. Define a typed state interface for the plugin:
   ```ts
   interface {Name}PluginState {
     // Plugin-specific state fields
   }
   ```

4. Create the plugin with `state.init` and `state.apply`:
   ```ts
   export const {name}Plugin = new Plugin<{Name}PluginState>({
     key: {name}PluginKey,
     state: {
       init(_, state): {Name}PluginState {
         // Return initial state
       },
       apply(tr, value, oldState, newState): {Name}PluginState {
         // Return updated state based on transaction
       },
     },
   });
   ```

5. Optionally add `view`, `decorations`, or `appendTransaction` as needed by the feature.

6. Register the plugin in `src/lib/prosemirror/plugins/index.ts` by adding it to the exported plugins array.

7. Create helper functions for dispatching plugin meta:
   ```ts
   export function set{Name}Meta(tr: Transaction, value: Partial<{Name}PluginState>): Transaction {
     return tr.setMeta({name}PluginKey, value);
   }
   ```

## Rules

- Use `tr.mapping.map()` when mapping positions across transactions.
- Use `DecorationSet.map()` when carrying decorations forward in `state.apply`.
- Access Zustand store state via `useStore.getState()` (not hooks) inside plugin code.
- Use `@/` path aliases for all imports.
- Export the plugin, the PluginKey, and any helper functions as named exports.
