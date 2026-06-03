import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Three-layer build: main (Node), preload (Node bridge), renderer (web).
// Renderer is MULTI-ENTRY: separate overlay + control HTML windows.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // Emit CommonJS (.cjs) so the preload works under `sandbox:true` (SPEC §11);
      // sandboxed renderers cannot load ESM preload scripts.
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        // Two independent renderer entry points → two windows.
        input: {
          overlay: resolve('src/renderer/overlay.html'),
          control: resolve('src/renderer/control.html')
        }
      }
    }
  }
})
