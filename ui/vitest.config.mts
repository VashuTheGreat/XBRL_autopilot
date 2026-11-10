import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'shared'), '@': resolve(import.meta.dirname, 'src') } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
})
