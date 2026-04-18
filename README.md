<div align="center">
  <img src="./.github/assets/hero-v2.png" alt="electron-ipc-react-hooks hero graphic" width="100%">

  <br />
  <br />

  [![npm version](https://img.shields.io/npm/v/electron-ipc-react-hooks?style=for-the-badge&color=00d8ff&logo=react)](https://www.npmjs.com/package/electron-ipc-react-hooks)
  [![License](https://img.shields.io/npm/l/electron-ipc-react-hooks?style=for-the-badge&color=2b3137)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
  [![tRPC Inspired](https://img.shields.io/badge/tRPC-Inspired-2596be?style=for-the-badge&logo=trpc)](https://trpc.io)

  <p><h3><b>100% Type-Safe • Zero Code Gen • Seamless React Query Integration</b></h3></p>
</div>

---

**Electron-IPC-React-Hooks** is a state-of-the-art Inter-Process Communication (IPC) boundary orchestrator for Electron Javascript Applications. It provides a **tRPC-inspired architectural pattern** that delivers end-to-end type safety between your Main (Node.js) and Renderer (React) processes without running expensive compiler CLI tools or configuring complex typing files natively.

> [!NOTE] 
> **The Problem with Legacy Tooling**
> Legacy frameworks solved type safety via convoluted CLI step generation or highly complex, manually matched `React.Context` bindings. This required redundant schema definitions and wrapping plain `useEffect` functions to try and mock functionality already perfected by data-fetching libraries.

**Our Solution**: You define a native router in the Main Process. The type of that router securely bridges back across the preload context script directly to your renderer inside a **TanStack React Query wrapper**. This provides native `{ data, isLoading, error }` state-management inside React—giving you the most powerful developer experience possible.

---

## 🛠 Features & Technology Stack

The framework leverages modern tools to deliver the fastest and safest developer experience:
* **`Typescript` (End-to-End Type Safety)**: The arguments and returned values of your main process backend handlers instantly manifest into autocomplete suggestions in your React front end.
* **`Zod` Validation**: Automatically validates data sent between the React front end and the Node.js backend to ensure it is safe at runtime.
* **`@tanstack/react-query`**: No more manual loading state indicators, error catches, or repetitive `useEffect` calls in React. The unified `useQuery` / `useMutation` API gives your components absolute control.
* **`Vitest` Integration Capabilities**: Handlers built into your IPC router execute flawlessly in standard Unit Tests, making TDD an absolute breeze.

---

## 📦 Installation

This framework leverages `zod` and `@tanstack/react-query` as core peer dependencies:

```bash
npm install electron-ipc-react-hooks zod @tanstack/react-query
npm install -D typescript
```

---

## 📖 Deep Dive Usage Guide

### 1. Build The Main Router (`src/main.ts`)

You create your "backend" endpoints inside the Main Process environment utilizing the routing builder block. This is identical to spinning up an Express or tRPC router!

```typescript
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { fetchSecureDatabaseRecord } from './custom-db-logic';

const t = initIpc();

const appRouter = t.router({
  // -------------------------------------------------------------
  // DEFINING A "QUERY" (Used for fetching data from the Main process)
  // -------------------------------------------------------------
  getUserProfile: t.procedure
    // Zod enforces input is a string that looks like an email:
    .input(z.string().email()) 
    .query(async ({ input }) => {
      // Logic inside the Node.js main process environment!
      const user = await fetchSecureDatabaseRecord(input);
      return { id: user.uuid, name: user.displayName, role: user.role };
    }),

  // -------------------------------------------------------------
  // DEFINING A "MUTATION" (Used for altering state or saving data)
  // -------------------------------------------------------------
  saveSettings: t.procedure
    .input(z.object({ theme: z.enum(['dark', 'light']), notifications: z.boolean() }))
    .mutation(async ({ input }) => {
      // Modify a local persistent settings file, etc.
      console.log(`Setting theme to ${input.theme}`);
      return { success: true };
    })
});

// IMPORTANT: Export ONLY the Type of your router! This allows your React 
// frontal code to see the backend footprint without leaking Node.js dependencies!
export type AppRouter = typeof appRouter;

// Finally, connect your router to the core Electron instance
bindIpcRouter(ipcMain, appRouter);
```

### 2. Configure the IPC Bridge (`src/preload.ts`)

Electron's absolute best-practice Context Isolation strategy requires developers to manually wire specific functions through the `contextBridge`. Instead, our tool handles creating a generic `invoke/on` mapping that the React Query boundary hooks straight into.

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { exposeIpc } from 'electron-ipc-react-hooks/preload';

// Exposes a secure `window.electronIpc` containing generic invoke/on routers
exposeIpc(contextBridge, ipcRenderer);
```

### 3. Consume React Query Hooks (`src/App.tsx`)

Instantiate the framework passing the Type of the router over to the `createReactIpc` proxy.

```tsx
import { createReactIpc } from 'electron-ipc-react-hooks/renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppRouter } from './main'; // Import the TYPE only!

const ipc = createReactIpc<AppRouter>();

/** Component consuming a QUERY endpoint */
function UserProfile({ email }: { email: string }) {
  // Autocompletion will confirm `.getUserProfile` exists!
  // Type Safety natively flags that `useQuery` expects a valid email string.
  const { data, isLoading, error } = ipc.getUserProfile.useQuery(email, {
      staleTime: 60000, 
      refetchOnWindowFocus: true
  });

  if (isLoading) return <div className="spinner">Fetching DB...</div>;
  if (error) return <div className="error-card">Failed to fetch: {error.message}</div>;

  return <div>Welcome back, {data.name}!</div>;
}

/** Component consuming a MUTATION endpoint */
function SettingsPanel() {
  // Autocomplete sees that saveSettings exists and expects the theme/notifications object
  const mutation = ipc.saveSettings.useMutation({
    onSuccess: (data) => console.log('Saved successfully', data),
    onError: (err) => console.error('Failed to change theme', err)
  });

  return (
    <button onClick={() => mutation.mutate({ theme: 'dark', notifications: false })}>
      {mutation.isPending ? 'Saving...' : 'Switch to Dark Mode'}
    </button>
  );
}

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProfile email="test@sorrell.sh" />
      <SettingsPanel />
    </QueryClientProvider>
  )
}
```

---

## ⚡ Advanced Features (v1.1)

### 1. Middleware Support
Implement cross-cutting concerns (logging, auth, performance) using the `.use()` pipeline. Middlewares can intercept inputs, modify context, or block execution.

```typescript
const t = initIpc<{ user?: string }>();

const loggingMiddleware = t.middleware(async ({ next, path, type }) => {
  const start = Date.now();
  const result = await next();
  console.log(`[IPC] ${path} (${type}) took ${Date.now() - start}ms`);
  return result;
});

// Middleware that modifies context
const authMiddleware = t.middleware(async ({ next, ctx }) => {
  if (!ctx.user) throw new Error('Unauthorized');
  return next({
    ctx: { ...ctx, user: ctx.user + '_verified' } // Infers new context type automatically!
  });
});

const protectedProcedure = t.procedure.use(loggingMiddleware).use(authMiddleware);

const appRouter = t.router({
  getSensitiveData: protectedProcedure.query(({ ctx }) => ({ secret: '42', user: ctx.user })),
});
```

### 2. Context Injection
Inject Electron events or authenticated user data into every procedure. Define the context type in `initIpc` and provide a creator function in `bindIpcRouter`.

```typescript
// main.ts
type Context = { event: IpcMainInvokeEvent; user?: string };
const t = initIpc<Context>();

const appRouter = t.router({
  whoami: t.procedure.query(({ ctx }) => ctx.user || 'Guest'),
});

bindIpcRouter(ipcMain, appRouter, async (event) => ({
  event,
  user: await authenticate(event), // Custom auth logic
}));
```

### 3. Nested Sub-Routers
Organize large API surfaces into logical namespaces. The framework handles recursive path resolution automatically.

```typescript
const systemRouter = t.router({
  getInfo: t.procedure.query(() => ({ platform: process.platform })),
});

const appRouter = t.router({
  system: systemRouter, // Nested at .system.getInfo
  echo: t.procedure.input(z.string()).query(({ input }) => input),
});
```

### 4. Structured Error Handling (`IpcError` & `ZodError`)
Throw structured errors in the Main process and catch them natively in React with `code` and `data` metadata. Any failed Zod validation automatically surfaces as a structured `BAD_REQUEST` error containing the validation issues.

```typescript
// main.ts
import { IpcError } from 'electron-ipc-react-hooks';

const appRouter = t.router({
  saveProfile: t.procedure
    .input(z.object({ name: z.string().min(3) }))
    .mutation(({ input }) => {
      if (input.name === 'admin') {
        throw new IpcError('Reserved username', 'FORBIDDEN', { reason: 'restricted_word' });
      }
      return { success: true };
    }),
});

// renderer.ts (React)
const mutation = ipc.saveProfile.useMutation();

// If the Zod validation fails (e.g. name is 2 characters):
// mutation.error.code === 'BAD_REQUEST'
// mutation.error.data === [{ code: 'too_small', minimum: 3, ... }]

// If the IpcError is thrown:
// mutation.error.code === 'FORBIDDEN'
// mutation.error.data === { reason: 'restricted_word' }
```

### 5. Auto-Canceling IPC Queries (`AbortSignal`)
When a React component unmounts or a query is manually canceled via React Query, `electron-ipc-react-hooks` automatically forwards an abort signal across the IPC bridge. This injects an `AbortSignal` into your procedure context, allowing you to elegantly halt long-running database queries, expensive file reads, or HTTP requests on the main process to conserve resources!

```typescript
// main.ts
const appRouter = t.router({
  heavyTask: t.procedure
    .input(z.string())
    .query(async ({ input, signal }) => {
      for (let i = 0; i < 50; i++) {
        // Halt if the user navigated away from the React component!
        if (signal?.aborted) throw new Error('Task aborted early');
        await new Promise(r => setTimeout(r, 100)); 
      }
      return `Completed task: ${input}`;
    }),
});
```

### 6. Cross-Window State Sync (Pub/Sub Invalidation)
Electron apps often struggle to keep state synchronized across multiple open windows (e.g., mutating settings in a Preferences window and reflecting those changes in a Main window). `electron-ipc-react-hooks` provides a built-in `broadcast` object to automatically invalidate and refetch React Queries globally!

```typescript
// main.ts
const appRouter = t.router({
  updateTheme: t.procedure
    .input(z.string())
    .mutation(async ({ input, broadcast }) => {
      await saveThemeToDisk(input);
      // Immediately invalidates the 'getTheme' query across EVERY open Electron window!
      broadcast.invalidate('getTheme');
    }),
});
```

To enable this on the frontend, simply mount the `useIpcInvalidator` hook near the root of your React application:

```tsx
// App.tsx
import { useQueryClient } from '@tanstack/react-query';
import { useIpcInvalidator } from 'electron-ipc-react-hooks/renderer';

export default function App() {
  const queryClient = useQueryClient();
  // Automatically listens for 'broadcast.invalidate' messages and triggers TanStack Query!
  useIpcInvalidator(queryClient);

  return <MyComponents />;
}
```

---

## ⚡ Handling Real-Time Streams (Subscriptions)

One critical pain point with Electron IPC is subscribing bidirectional streams or Main-driven continuous events without writing tedious `ipcRenderer.on` triggers mixed with messy `useEffect` cleanup procedures.

With `electron-ipc-react-hooks`, you can natively subscribe directly inside your Main process router via the framework. Simply return a cleanup function from your procedure to prevent memory leaks across the Javascript event loops.

```typescript
// main.ts
const appRouter = t.router({
  onDownloadProgress: t.procedure
    .subscription(({ emit }) => {
        // Assume NativeDownloadHandler is some Node script piping out data chunks
        const handler = (pct) => emit(pct);
        NativeDownloadHandler.on('progress', handler);

        // Return a cleanup function! When the React component unmounts,
        // this function automatically triggers to stop memory leaks.
        return () => {
           NativeDownloadHandler.off('progress', handler);
        };
    })
})
```

Then, easily consume the stream on the frontend using the generated `useSubscription` hook. It handles IPC setup and teardown automatically when the component mounts and unmounts!

```tsx
// App.tsx
function DownloadTracker() {
  const [progress, setProgress] = useState(0);

  ipc.onDownloadProgress.useSubscription(undefined, {
    onData: (pct) => setProgress(pct),
  });

  return <div>Download Progress: {progress}%</div>;
}
```

React Query's robust background mechanisms guarantee memory leaks across the Javascript event loops are contained and removed effectively!

---

## 🌐 Shared Reactive State (`createIpcStore`)

Need to synchronize a global state object (like user settings or a theme) between your Main process and *every* open Electron Renderer window? `createIpcStore` creates a fully reactive store that automatically broadcasts changes everywhere.

```typescript
// main.ts
import { createIpcStore, bindIpcStore } from 'electron-ipc-react-hooks/main';

// 1. Create the store
export const settingsStore = createIpcStore({ theme: 'system', volume: 50 });

// 2. Bind it to IPC (pass webContents to enable broadcasting to all windows)
app.whenReady().then(() => {
  const win = new BrowserWindow({ ... });
  bindIpcStore(ipcMain, 'settings', settingsStore, { webContents: win.webContents });
});
```

```tsx
// ipc.ts (Renderer)
import { createReactIpcStore } from 'electron-ipc-react-hooks/renderer';
// Generate our type-safe React global store hook!
export const useSettingsStore = createReactIpcStore('settings', { theme: 'system', volume: 50 });

// App.tsx
function SettingsPanel() {
  const [settings, setSettings] = useSettingsStore();

  return (
    <div>
      <p>Current Theme: {settings.theme}</p>
      <button onClick={() => setSettings({ theme: 'dark' })}>Set Dark Mode</button>
    </div>
  );
}
```

Whenever any window calls `setSettings()`, the state is updated on the Main process, and the new state is instantly broadcasted to all other React windows!

---

## 📡 Bi-directional Data Streams (`.channel()`)

While `.subscription()` is great for Main-to-Renderer streams, `.channel()` allows the Renderer to continuously stream chunks of data *up* to the Main process while receiving responses back. Perfect for uploading large files without locking the IPC bridge.

```typescript
// main.ts
const appRouter = t.router({
  fileUpload: t.procedure
    .input(z.object({ filename: z.string() }))
    .channel(async ({ input, onData, emit }) => {
      let totalBytes = 0;
      
      // Listen for chunks from the Renderer
      onData((chunk) => {
        if (chunk.done) {
          emit({ status: 'complete', totalBytes });
          return;
        }
        totalBytes += chunk.bytes;
        emit({ status: 'receiving', bytesReceived: totalBytes });
      });

      return () => console.log('Client disconnected!');
    })
});

// App.tsx
function Uploader() {
  const { send } = ipc.fileUpload.useChannel(
    { filename: 'data.zip' },
    {
      onData: (response) => console.log('Main process says:', response)
    }
  );

  return (
    <button onClick={() => {
      send({ bytes: 1024 }); // Send a chunk
      send({ done: true });  // Finish stream
    }}>
      Start Upload
    </button>
  );
}
```

---

## 📜 Infinite Query Pagination

Seamlessly paginate over large local datasets (like reading a huge file or querying an SQLite database) using the generated `useInfiniteQuery` hook. `electron-ipc-react-hooks` handles forwarding the `pageParam` as the `cursor` to your Main process.

```typescript
// main.ts
const appRouter = t.router({
  getLogs: t.procedure
    .input(z.object({ cursor: z.number().optional(), limit: z.number() }))
    .query(async ({ input }) => {
      const logs = await localDatabase.getLogs(input.cursor || 0, input.limit);
      return {
        items: logs,
        nextCursor: logs.length === input.limit ? (input.cursor || 0) + input.limit : undefined,
      };
    }),
});

// React
function LogsViewer() {
  const { data, fetchNextPage, hasNextPage } = ipc.getLogs.useInfiniteQuery(
    { limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: 0,
    }
  );
  
  return (
    <div>
      {data?.pages.map((page) => page.items.map(log => <div key={log.id}>{log.message}</div>))}
      <button onClick={() => fetchNextPage()} disabled={!hasNextPage}>Load More</button>
    </div>
  );
}
```

---

## Unit Testing Strategy
Because your Main Handlers detach into a unified `AppRouter` object constructed inside of `main.ts`, implementing test-driven development (TDD) via software like **Vitest** is native. 

Simply bypass Electron IPC entirely, mock inputs, and trigger functions across the pure JSON object map.

```typescript
import { expect, test } from 'vitest';
import { appRouter } from './main';

test('Zod strictly blocks malformed profiles', async () => {
    // Should throw a Zod error due to passing a number down into the string/email pipeline
    await expect(appRouter.getUserProfile({ input: 12345 })).rejects.toThrow();
});
```

---

## 🚀 Example Application

A fully working Electron + Vite + React example app lives in the [`/example`](./example/) directory.
It demonstrates all three IPC patterns — query, mutation, and error handling — in a running desktop application.

### Running the example

```bash
cd example
npm install
npm run build
npx electron .
```

The example features:
- **System Context** — a `useQuery` that fetches real `process.platform`, Electron version, Node version, etc. from the main process
- **Native Dialogs** — a `useMutation` showcasing full access to the Node backend to trigger a system file picker and read file stats
- **Global Reactive Store** — multiple windows synchronizing themes and settings with native IPC broadcasts and one-click resets
- **IPC Mutation** — a `useMutation` that sends text to the main process, waits 500ms, and returns the reversed string (proving async round-trip works)
- **Error Boundaries** — a mutation that intentionally throws inside the main process and surfaces the error cleanly through React Query's `error` state, with no uncaught promise rejections

### Example tech stack

| Layer | Tool |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) |
| Bundler | [Vite](https://vitejs.dev/) + [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) |
| UI framework | [React 19](https://react.dev/) |
| IPC layer | `electron-ipc-react-hooks` (this library, linked via `file:..`) |

---

## 🔧 Troubleshooting

### Duplicate React / `useContext is null` crash

When consuming this library via a local `file:` link (e.g. `"electron-ipc-react-hooks": "file:.."`), npm may install a second copy of `react` and `@tanstack/react-query` inside the library's `node_modules`. This causes React's context system to fail with:

```
TypeError: Cannot read properties of null (reading 'useContext')
```

**Fix** — add `resolve.dedupe` and explicit aliases to your `vite.config.ts`:

```ts
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: {
      'react': resolve('./node_modules/react'),
      'react-dom': resolve('./node_modules/react-dom'),
      '@tanstack/react-query': resolve('./node_modules/@tanstack/react-query'),
    }
  },
  // ...
})
```

This pins all React imports to your app's `node_modules`, eliminating the duplicate instance.

---

### Chromium disk cache errors on Windows

When launching with `npx electron .`, you may see repeated errors like:

```
[ERROR:disk_cache.cc:284] Unable to create cache
[ERROR:gpu_disk_cache.cc:725] Gpu Cache Creation failed: -2
```

These occur because multiple Electron processes share the same default `userData`/cache path and Windows file locking prevents concurrent writes.

**Fix** — call `app.setPath()` **before** `app.whenReady()` in your `main.ts` to point Electron at a dedicated, writable directory:

```ts
import { app } from 'electron'
import { join } from 'path'
import * as os from 'os'

// Must be called before app.whenReady()
app.setPath('userData', join(os.homedir(), '.your-app-name'))

app.whenReady().then(() => { /* ... */ })
```

---

## 🗺️ Roadmap & Upcoming Features

We are constantly exploring new ways to push the boundaries of Electron IPC. Some features currently under consideration:

- **Shared State Synchronization**: APIs to maintain a global reactive state object that seamlessly syncs between the Main process and all active Renderer windows.
- **Request Batching**: Grouping multiple IPC queries executed in the same React render cycle into a single batched IPC message to minimize bridge overhead.
- **UI Form Generation**: Utility hooks to automatically generate fully typed UI forms in React directly from the backend Zod schemas.

---

<div align="center">
  <sub>Built to exponentially expand the boundaries of the Electron developer experience.</sub>
</div>
