import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import * as os from 'os'
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks/main'
import { z } from 'zod'

// Point Electron's cache/userData to a writable location
app.setPath('userData', join(os.homedir(), '.electron-ipc-example'))

// 1. Initialise IPC with a custom Context type
type Context = {
  event: Electron.IpcMainInvokeEvent;
  timestamp: number;
}
const t = initIpc<Context>()

// 2. Define a simple Logging Middleware
const loggerMiddleware = t.middleware(async ({ input, ctx, path, type, next }) => {
  const start = Date.now()
  const senderUrl = ctx.event.senderFrame?.url || 'Unknown';
  console.log(`[IPC] [${type}] ${path} called by ${senderUrl} with:`, input)
  
  const result = await next()
  
  const duration = Date.now() - start
  console.log(`[IPC] [${type}] ${path} responded in ${duration}ms`)
  return result
})

const protectedProcedure = t.procedure.use(loggerMiddleware)

// 3. Define a "system" sub-router
const systemRouter = t.router({
  getInfo: protectedProcedure.query(() => ({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
  }))
})

// 4. Define the main App Router with nesting
const appRouter = t.router({
  // Sub-router
  system: systemRouter,
  
  // Root level procedures
  echoReverse: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      await new Promise(r => setTimeout(r, 500))
      return input.text.split('').reverse().join('')
    }),

  helloContext: protectedProcedure.query(({ ctx }) => {
    // Show context-aware handler (e.g., "Hello from [Window Title]")
    const sender = ctx.event.sender;
    const windowTitle = BrowserWindow.fromWebContents(sender)?.getTitle() || 'Unknown Window';
    return `Hello from ${windowTitle}`;
  }),

  throwError: t.procedure
    .input(z.object({ shouldThrow: z.boolean() }))
    .mutation(() => {
      throw new Error('This is an expected error thrown from the main process!')
    })
})

export type AppRouter = typeof appRouter

function createWindow() {
  // Bind IPC router with context injection
  bindIpcRouter(
    ipcMain, 
    appRouter, 
    (event) => ({ event, timestamp: Date.now() })
  )

  const win = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    title: 'My Electron App',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
