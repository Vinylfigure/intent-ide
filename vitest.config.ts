import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Source .tsx files rely on Next.js's own SWC pipeline for the JSX
  // automatic runtime (tsconfig's `jsx: "preserve"` is a no-op outside that
  // pipeline) and never import React themselves, so esbuild — the transform
  // vitest uses directly — needs the same runtime told explicitly, or every
  // JSX call compiles to a bare `React.createElement` with no such import in
  // scope.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
