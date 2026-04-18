import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { initIpc, bindIpcRouter, IpcError, createIpcStore, bindIpcStore } from 'electron-ipc-react-hooks/main'
import { z } from 'zod'

// Point Electron's cache/userData to a writable location
app.setPath('userData', join(os.homedir(), '.electron-ipc-example'))

// 1. Initialise IPC with a custom Context type
type Context = {
  event: Electron.IpcMainInvokeEvent;
  timestamp: number;
}
const t = initIpc<Context>()

// 1.5 Global Reactive Store
export const settingsStore = createIpcStore({ theme: 'system', notifications: true })

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
  })),

  openFileDialog: protectedProcedure.mutation(async ({ ctx }) => {
    const window = BrowserWindow.fromWebContents(ctx.event.sender);
    if (!window) throw new IpcError('No window found', 'NOT_FOUND');

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const stats = await fs.stat(filePath);

    return {
      path: filePath,
      name: basename(filePath),
      size: stats.size,
      created: stats.birthtime.toISOString()
    };
  })
})

// 4. Define the main App Router with nesting
const appRouter = t.router({
  // Sub-router
  system: systemRouter,
  
  // Root level procedures
  echoReverse: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input, broadcast }) => {
      await new Promise(r => setTimeout(r, 500))
      
      // Example of cross-window Pub/Sub invalidation:
      // Invalidate the 'system.getInfo' query whenever a reverse echo happens!
      broadcast.invalidate('system.getInfo')
      
      return input.text.split('').reverse().join('')
    }),

  helloContext: protectedProcedure.query(({ ctx }) => {
    // Show context-aware handler (e.g., "Hello from [Window Title]")
    const sender = ctx.event.sender;
    const windowTitle = BrowserWindow.fromWebContents(sender)?.getTitle() || 'Unknown Window';
    return `Hello from ${windowTitle}`;
  }),

  // Add a simple query to demonstrate batching
  mathSquare: protectedProcedure
    .input(z.number())
    .query(async ({ input }) => {
      // Small artificial delay to prove they resolve together
      await new Promise(r => setTimeout(r, 200));
      return input * input;
    }),

  getLogs: protectedProcedure
    .input(z.object({ cursor: z.number().optional(), limit: z.number() }))
    .query(async ({ input }) => {
      // Simulate fetching logs from a local database
      await new Promise(r => setTimeout(r, 150));
      const cursor = input.cursor || 0;
      const logs = Array.from({ length: input.limit }).map((_, i) => ({
        id: cursor + i,
        message: `Log entry #${cursor + i}`,
      }));
      return {
        items: logs,
        nextCursor: cursor + input.limit < 50 ? cursor + input.limit : undefined // Max 50 items for demo
      };
    }),

  throwError: t.procedure
    .input(z.object({ shouldThrow: z.boolean() }))
    .mutation(() => {
      throw new Error('This is an expected error thrown from the main process!')
    }),

  saveProfile: protectedProcedure
    .input(z.object({ name: z.string().min(3, "Name must be at least 3 characters long") }))
    .mutation(({ input }) => {
      if (input.name === 'admin') {
        throw new IpcError('Reserved username', 'FORBIDDEN', { reason: 'restricted_word' });
      }
      return { success: true };
    }),

  slowQuery: t.procedure
    .input(z.string())
    .query(async ({ input, signal }) => {
      // Simulate a slow database query or file read
      for (let i = 0; i < 50; i++) {
        // If the React component unmounts or cancels the query, the signal aborts
        if (signal?.aborted) {
          console.log(`[IPC] slowQuery aborted for input: ${input}`);
          throw new Error('Query was aborted');
        }
        await new Promise(r => setTimeout(r, 100)); // wait 100ms
      }
      return `Successfully completed slow task for: ${input}`;
    }),

  clock: t.procedure.subscription(({ emit }) => {
    emit(new Date().toISOString()) // Emit immediately
    const interval = setInterval(() => {
      emit(new Date().toISOString())
    }, 1000)

    // Return a cleanup function! When the React component unmounts,
    // this function is called to clear the interval and stop memory leaks.
    return () => {
      clearInterval(interval)
      console.log('[IPC] Clock subscription cleanly destroyed')
    }
  }),

  fileUploadStream: t.procedure
    .input(z.object({ filename: z.string() }))
    .channel(async ({ input, onData, emit }) => {
      console.log(`[IPC] Ready to receive chunks for file: ${input.filename}`);
      let totalBytes = 0;
      
      onData((chunk: { bytes: number, done?: boolean }) => {
        if (chunk.done) {
          console.log(`[IPC] File stream finished. Total received: ${totalBytes} bytes.`);
          emit({ status: 'complete', totalBytes });
          return;
        }
        
        totalBytes += chunk.bytes;
        emit({ status: 'receiving', bytesReceived: totalBytes });
      });

      return () => {
        console.log(`[IPC] Client disconnected or stream closed for ${input.filename}.`);
      };
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

  // Bind store with access to WebContents to broadcast state updates
  bindIpcStore(ipcMain, 'settings', settingsStore, { webContents: win.webContents })

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
