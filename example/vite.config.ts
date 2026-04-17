import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const electronExternal = ['electron', 'electron-ipc-react-hooks', 'zod', 'os', 'path']

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: electronExternal,
              output: { format: 'cjs' }
            }
          }
        }
      },
      {
        entry: 'src/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: electronExternal,
              output: { format: 'cjs' }
            }
          }
        }
      }
    ]),
    renderer()
  ]
})
