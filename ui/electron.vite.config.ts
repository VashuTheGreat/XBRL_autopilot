import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preload: bundle everything into one CJS file.
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload/index.ts') } },
    },
  },
  renderer: {
    root: __dirname,
    resolve: {
      alias: { '@': resolve(__dirname, 'src'), '@shared': shared },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'index.html') } },
    },
  },
})
