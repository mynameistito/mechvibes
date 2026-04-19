import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { builtinModules } from 'module'
import tailwindcss from '@tailwindcss/vite'

const rendererNodeExternals = [
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  'electron-store', 'adm-zip', 'fs-extra', 'glob', 'mime-types',
]

export default defineConfig({
  main: {
    build: {
      outDir: resolve('dist/main'),
      rollupOptions: {
        output: { format: 'es' },
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  renderer: {
    plugins: [tailwindcss()],
    root: resolve('src/renderer'),
    build: {
      outDir: resolve('dist/renderer'),
      rollupOptions: {
        external: rendererNodeExternals,
        input: {
          app: resolve('src/renderer/app/index.html'),
          editor: resolve('src/renderer/editor/index.html'),
          dialog: resolve('src/renderer/dialog/index.html'),
          debug: resolve('src/renderer/debug/index.html'),
          install: resolve('src/renderer/install/index.html'),
        },
      },
    },
  },
})
