import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { builtinModules } from 'module'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const rendererNodeExternals = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  'electron-store', 'adm-zip', 'fs-extra', 'glob', 'mime-types',
]

// Named exports required per module (only what the renderer actually uses)
const namedExports: Record<string, string[]> = {
  'electron': ['ipcRenderer', 'shell', 'app', 'dialog', 'nativeImage', 'clipboard', 'nativeTheme', 'contextBridge', 'webFrame', 'ipcMain', 'remote'],
  'howler': ['Howler', 'Howl'],
  'mime-types': ['lookup', 'extension', 'charset', 'contentType'],
}

function electronRendererNodePlugin(): Plugin {
  const prefix = '\0__evshim__:'
  const shouldShim = (id: string) =>
    rendererNodeExternals.includes(id) ||
    id === 'howler' ||
    builtinModules.includes(id.replace(/^node:/, ''))

  return {
    name: 'vite:electron-renderer-node-shim',
    enforce: 'pre',
    apply: 'serve',
    resolveId(id) {
      if (shouldShim(id)) return prefix + id
    },
    load(id) {
      if (!id.startsWith(prefix)) return
      const mod = id.slice(prefix.length)
      const named = namedExports[mod] ?? []
      const namedExportLines = named.map(k => `export const ${k} = _m.${k};`).join('\n')
      return [
        `const _m = globalThis.require(${JSON.stringify(mod)});`,
        `export default (_m && _m.__esModule ? _m.default : _m) ?? _m;`,
        namedExportLines,
      ].join('\n')
    },
  }
}

export default defineConfig({
  preload: {
    build: {
      outDir: resolve('dist/preload'),
      rollupOptions: {
        input: {
          dialog: resolve('src/main/preloads/dialog.ts'),
        },
      },
    },
  },
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
    plugins: [tailwindcss(), electronRendererNodePlugin()],
    root: resolve('src/renderer'),
    optimizeDeps: {
      exclude: rendererNodeExternals,
    },
    build: {
      outDir: resolve('dist/renderer'),
      rollupOptions: {
        external: rendererNodeExternals,
        input: {
          app: resolve('src/renderer/app/index.html'),
          editor: resolve('src/renderer/editor/index.html'),
          dialog: resolve('src/renderer/dialog/index.html'),
          install: resolve('src/renderer/install/index.html'),
        },
      },
    },
  },
})
