import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

const electronExternal = ['electron', 'electron-ipc-react-hooks', 'zod', 'os', 'path']

// https://vitejs.dev/config/
export default defineConfig({
  // Force a single React instance — prevents "useContext null" crashes
  // when using locally-linked packages that ship their own node_modules
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: {
      'react': resolve('./node_modules/react'),
      'react-dom': resolve('./node_modules/react-dom'),
      '@tanstack/react-query': resolve('./node_modules/@tanstack/react-query'),
    }
  },
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
