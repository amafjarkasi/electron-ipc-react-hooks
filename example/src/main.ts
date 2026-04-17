import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import * as os from 'os'
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks/main'
import { z } from 'zod'

// Point Electron's cache/userData to a writable location before the app is ready.
// This prevents Chromium's "Unable to create cache / Access is denied" errors that
// occur when another Electron instance holds a lock on the default temp path.
app.setPath('userData', join(os.homedir(), '.electron-ipc-example'))

// Create a builder
const t = initIpc()

// Define our router
const appRouter = t.router({
  // A simple query to get system environment
  getSystemInfo: t.procedure.query(() => {
    return {
      platform: process.platform,
      arch: os.arch(),
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    }
  }),
  
  // A mutation example that reverses a string and tracks hits
  echoReverse: t.procedure
    .input(z.object({ text: z.string() }))
    .mutation(async (req) => {
      // Simulate network/processing delay
      await new Promise(resolve => setTimeout(resolve, 500))
      return req.input.text.split('').reverse().join('')
    }),

  // An error generating mutation to test react-query error states
  throwError: t.procedure
    .input(z.object({ shouldThrow: z.boolean() }))
    .mutation((req) => {
      if (req.input.shouldThrow) {
        throw new Error('This is an expected error thrown from the main process!')
      }
      return { success: true }
    })
})

export type AppRouter = typeof appRouter

// Initialization
app.whenReady().then(() => {
  // Bind our router to ipcMain
  bindIpcRouter(ipcMain, appRouter)

  const win = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Security best practices
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  // In dev mode, Vite runs the dev server on port 5173
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
