import { defineConfig } from 'vitest/config'

// Vitest runs the TS unit tests; the ported legacy suite (node:test) runs via `pnpm test:legacy`.
export default defineConfig({ test: { include: ['test/*.test.ts'] } })
