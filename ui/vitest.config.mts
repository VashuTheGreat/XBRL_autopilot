import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'shared'), '@': resolve(import.meta.dirname, 'src') } },
  // global-setup: the tests' temporary folders live in one folder per run, removed at the end
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, globalSetup: ['test/global-setup.ts'] },
})
