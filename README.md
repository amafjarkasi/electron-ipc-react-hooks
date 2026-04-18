<div align="center">
  <img src="./.github/assets/hero-v2.png" alt="electron-ipc-react-hooks hero graphic" width="100%">

  <br />
  <br />

  [![npm version](https://img.shields.io/npm/v/electron-ipc-react-hooks?style=for-the-badge&color=61DAFB&logo=react)](https://www.npmjs.com/package/electron-ipc-react-hooks)
  [![License](https://img.shields.io/npm/l/electron-ipc-react-hooks?style=for-the-badge&color=7C4DFF)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
  [![tRPC Inspired](https://img.shields.io/badge/tRPC-Inspired-2596be?style=for-the-badge&logo=trpc)](https://trpc.io)
  [![Tests](https://img.shields.io/badge/Tests-35%20passing-4FC3F7?style=for-the-badge&logo=vitest)](https://vitest.dev/)

  <br />

  <p>
    <b>🧬 End-to-end type safety without code generation.</b><br/>
    <b>⚡ TanStack React Query — native.</b><br/>
    <b>🔒 Zod validation at the IPC boundary.</b><br/>
    <b>📦 26KB total — zero external deps.</b>
  </p>
</div>

---

> ### *"The Electron IPC layer you wished Electron shipped with."*
>
> Define a router in Main. Import its **type** in Renderer. Call `ipc.getUser.useQuery('email')` — and get back `{ data, isLoading, error }` powered by TanStack React Query. Your router types flow through the preload bridge automatically. **No code gen. No `any`. No compromise.**

---

## 🚀 30-Second Setup

```bash
npm install electron-ipc-react-hooks zod @tanstack/react-query
npm install -D typescript
```

### Step 1: Define your router in Main

```typescript
// main.ts
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks';
import { ipcMain } from 'electron';
import { z } from 'zod';

const t = initIpc();

const appRouter = t.router({
  // 📖 Query — fetch data
  getUser: t.procedure
    .input(z.string().email())
    .query(async ({ input }) => {
      const user = await db.users.findByEmail(input);
      return { id: user.uuid, name: user.displayName, avatar: user.avatarUrl };
    }),

  // ✏️ Mutation — alter state
  saveProfile: t.procedure
    .input(z.object({ name: z.string().min(1), avatar: z.string().url() }))
    .mutation(async ({ input }) => {
      await db.users.updateProfile(input);
      return { success: true };
    }),
});

// 🔒 Export ONLY the type — no Node.js leaks to the renderer!
export type AppRouter = typeof appRouter;

// Bind to Electron's IPC — returns a dispose function for cleanup
const dispose = bindIpcRouter(ipcMain, appRouter);
```

### Step 2: Bridge through Preload

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeIpc } from 'electron-ipc-react-hooks/preload';

exposeIpc(contextBridge, ipcRenderer);
// → window.electronIpc { invoke, on, off, send }
```

### Step 3: Consume in React

```tsx
// App.tsx
import { createReactIpc } from 'electron-ipc-react-hooks/renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppRouter } from './main'; // Type-only import!

const ipc = createReactIpc<AppRouter>();
const queryClient = new QueryClient();

function UserProfile({ email }: { email: string }) {
  const { data, isLoading, error } = ipc.getUser.useQuery(email, {
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorCard error={error} />;

  return <ProfileCard name={data.name} avatar={data.avatar} />;
}

function EditProfile() {
  const mutation = ipc.saveProfile.useMutation({
    onSuccess: () => toast.success('Profile saved!'),
  });

  return (
    <button onClick={() => mutation.mutate({ name: 'Alice', avatar: 'https://...' })}>
      {mutation.isPending ? 'Saving...' : 'Save'}
    </button>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProfile email="alice@acme.com" />
      <EditProfile />
    </QueryClientProvider>
  );
}
```

**That's it.** Full type safety. Full React Query power. Zero boilerplate.

---

## 🎯 Feature Deep Dives

### 1. 🧬 tRPC-Style Router with Full Type Safety

**The Problem:** Electron's IPC is stringly-typed. You call `ipcRenderer.invoke('getUser', data)` and hope the main process handles it. There's no compile-time check that `'getUser'` exists, that you passed the right arguments, or that the return type matches what you expect.

**Our Solution:** Define a router in main using a builder pattern (`t.procedure.input().query()`), then import only the *type* in your renderer. The `createReactIpc<AppRouter>()` call gives you a fully typed client — every procedure becomes a namespaced object with `.useQuery()`, `.useMutation()`, etc. If you add, rename, or change a procedure, TypeScript immediately flags every call site in your renderer.

**How it works under the hood:**
1. `initIpc()` returns `{ router, procedure, middleware }` — the building blocks.
2. You compose procedures into a router: `t.router({ getUser, saveProfile })`.
3. `typeof appRouter` captures the full shape: procedure names → input types → output types → procedure kind (query/mutation/subscription/channel).
4. In the renderer, `createReactIpc<AppRouter>()` reads that type and generates the correct hook signatures.
5. The preload bridge (`exposeIpc`) passes raw invoke/listen calls through Electron's `contextBridge`.

**🎯 Real-World Scenarios:**
- **SaaS admin panels** — 50+ IPC endpoints for CRUD. Rename a field → instant TypeScript errors everywhere.
- **Desktop editors** (code, text, image) — Commands like `formatDocument`, `applyFilter` typed end-to-end.
- **Multi-team projects** — New developers get auto-complete for every IPC call. No hunting through `ipcMain.handle` calls.

**⚡ Improvement over vanilla Electron:** Vanilla `ipcMain.handle('channel', handler)` is completely stringly-typed. No compile-time guarantee the channel exists, the input is correct, or the return type matches. You write separate type declarations and manually keep them in sync. This library eliminates all of that — the router *is* the source of truth, and types flow automatically.

---

### 2. 📖 Queries — Full TanStack React Query Integration

**What it is:** Every `.query()` procedure automatically becomes a `useQuery` hook in your renderer. Full TanStack React Query integration — caching, background refetching, stale-while-revalidate, window focus refetching, pause/resume, and all other React Query features.

**🎯 Real-World Scenarios:**
- **User profile pages** — Load once, cache for 60s. Navigate away and back → instant from cache, fresh data loads silently.
- **Dashboard widgets** — Multiple widgets showing different slices of the same data. One IPC call, shared across components.
- **Settings panels** — `enabled: !!userId` prevents fetching until the user session is confirmed.
- **Search with debounce** — `enabled: query.length > 2` avoids wasted IPC calls for short queries.

**⚡ Improvement over vanilla Electron:** Without this, you'd manually manage loading/error/data states with `useState` for every IPC call. No caching means re-fetching the same data on every mount. No background refetching means stale data stays stale until the user refreshes. You'd need to build all of this yourself.

```tsx
// Full React Query options available
function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, error, refetch } = ipc.getUser.useQuery(userId, {
    staleTime: 60_000,           // Don't refetch for 60s
    gcTime: 300_000,             // Keep in cache for 5 min after unmount
    refetchOnWindowFocus: true,  // Refetch when user returns to the window
    enabled: !!userId,           // Only run if userId is truthy
    retry: 3,                    // Retry failed requests 3 times
    select: (data) => ({ displayName: `${data.firstName} ${data.lastName}` }),
    placeholderData: keepPreviousData,  // Show previous data while loading new
  });
  // ...
}
```

---

### 3. ✏️ Mutations — State Changes with React Query

**What it is:** Every `.mutation()` procedure becomes a `useMutation` hook. You get `mutate()`, `mutateAsync()`, `isPending`, `isSuccess`, `isError`, plus full React Query mutation lifecycle callbacks.

**🎯 Real-World Scenarios:**
- **CRUD forms** — Create, update, delete with instant feedback. Button shows "Saving..." → "Saved ✓" → data refreshes everywhere.
- **File operations** — "Move to trash", "Rename", "Duplicate" with optimistic UI that rolls back if the OS operation fails.
- **Bulk actions** — "Select all → Delete" with `mutateAsync()` in a loop, progress bar tracking each mutation.
- **Multi-step wizards** — `mutateAsync()` for sequential steps: create project → upload files → send invites.

**⚡ Improvement over vanilla Electron:** Plain `ipcRenderer.invoke()` returns a Promise. You manually track `isPending`, handle errors with try/catch in every component, and invalidate cached data yourself. Optimistic UI is near-impossible without a proper mutation layer. This library gives you the full React Query mutation lifecycle for free.

```tsx
function CreateProjectForm() {
  const mutation = ipc.createProject.useMutation({
    onMutate: async (newProject) => {
      // Optimistic update — show immediately, roll back on error
      const previous = queryClient.getQueryData(['projects']);
      queryClient.setQueryData(['projects'], (old) => [...old, { ...newProject, id: 'temp' }]);
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Created "${data.name}"!`);
    },
    onError: (err, _, context) => {
      queryClient.setQueryData(['projects'], context?.previous); // Rollback
    },
  });
  // ...
}
```

---

### 4. 🛡️ Structured Error Handling (`IpcError` → `IpcTypedError`)

**The Problem:** Electron's IPC serializes errors to plain strings. You lose `.code`, `.statusCode`, any structured data. Your renderer just gets `"Error: Something went wrong"`.

**Our Solution:** `IpcError` in main carries `.code` (machine-readable) and `.data` (any JSON context). Across IPC it becomes `IpcTypedError` — same `.code`, same `.data`. Zod validation failures auto-surface as `BAD_REQUEST`.

**🎯 Real-World Scenarios:**
- **Subscription/paywall flows** — `PLAN_LIMIT` error triggers an upgrade modal with `data.max` showing the current plan limit.
- **Invite systems** — `CONFLICT` shows "Already invited", `DOMAIN_RESTRICTED` shows the allowed domain.
- **Auth-protected actions** — `UNAUTHORIZED` redirects to login. All errors carry enough context for specific UI responses.
- **Form validation** — Zod errors map directly to form fields: `{ path: ['email'], message: 'Invalid email' }`.

**⚡ Improvement over vanilla Electron:** Electron serializes errors to plain strings across IPC. You get `"Error: Something went wrong"` — no code, no structured data, no way to show different UI for different error types. This library handles serialization automatically — throw `IpcError` in main, pattern-match `IpcTypedError.code` in renderer.

---

### 5. 🔗 Middleware Pipeline

**What it is:** Wrap every procedure with cross-cutting logic — authentication, audit logging, rate limiting — without modifying each procedure individually. Middleware composes: stack with `.use()`, executes in order, each wrapping the next like Express/Koa.

**🎯 Real-World Scenarios:**
- **SaaS apps** — Auth middleware on every protected route. No procedure can accidentally bypass auth.
- **Audit/compliance** — Log every IPC call with user ID, timestamp, and duration for regulatory requirements.
- **Multi-tenant platforms** — Auth resolves `tenantId`, all downstream procedures automatically scope queries to that tenant.
- **Public vs private APIs** — Public endpoints (health check, login) skip auth middleware. Private endpoints require it.

**⚡ Improvement over vanilla Electron:** In vanilla Electron, every `ipcMain.handle` callback must manually check auth, log timing, and validate rate limits. Forget one → security hole. Middleware centralizes this — attach once to the builder, every procedure is protected.

```typescript
const protectedProc = t.procedure.use(auditLog).use(requireAuth).use(rateLimit);
// Every procedure from protectedProc now has all 3 middlewares
```

---

### 6. 🧩 Context Injection

**What it is:** A context factory function runs on every IPC call, injecting `userId`, `db` connections, the Electron `event` object, feature flags, etc. Every handler receives `ctx` as a typed object.

**🎯 Real-World Scenarios:**
- **Multi-tenant SaaS** — Context carries `tenantId` from the session. Every database query is automatically scoped. No cross-tenant data leaks.
- **Role-based UI** — Context includes `isAdmin`, `permissions[]`. Procedures enforce access control without importing auth logic.
- **Per-request resources** — Database connections, trace IDs, and feature flags created per-call and cleaned up automatically.
- **Testing without Electron** — Pass a mock `ctx` and call procedures directly in Vitest. No Electron binary needed.

**⚡ Improvement over vanilla Electron:** Vanilla handlers access global state (`db`, `sessionStore`) via imports. Hidden dependencies, Electron-required testing, no per-request scoping. Context injection gives every handler exactly what it needs, makes dependencies explicit, and enables fast unit testing.

```typescript
// Context factory — runs on EVERY IPC call
bindIpcRouter(ipcMain, appRouter, async (event) => {
  const session = await resolveSession(event);
  return { userId: session.userId, db: getDatabase(), isAdmin: session.role === 'admin' };
});
```

---

### 7. 📁 Nested Sub-Routers

**What it is:** Compose routers inside routers for deeply nested API namespaces. Keeps your codebase organized — instead of 50 flat procedures, group them into logical modules. Paths join with dots: `admin.billing.getInvoices`.

**🎯 Real-World Scenarios:**
- **Large SaaS apps** — Separate routers for `users`, `billing`, `admin`, `settings`. Each in its own file.
- **Plugin architectures** — Each plugin registers its own sub-router. Main app composes them.
- **Versioned APIs** — `v1.router(...)` and `v2.router(...)` with different procedure shapes.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has flat channel names — `'getUser'`, `'getBilling'`. No namespacing, no organization. As the app grows, channel names become inconsistent (`'user-get'` vs `'get-user'` vs `'users:get'`). Sub-routers give you hierarchical, typed namespacing.

---

### 8. 📡 Subscriptions (Main → Renderer Real-Time Streams)

**What it is:** Push real-time data from Main to Renderer without polling. Main calls `emit(data)`, renderer receives via `useSubscription` hook. Cleanup is automatic on unmount.

**🎯 Real-World Scenarios:**
- **Live notifications** — Push alerts to the UI as they arrive from a server or system events.
- **File processing** — Upload a file, stream progress updates (0% → 37% → 100%) to a progress bar.
- **System monitoring** — Push CPU/memory/disk stats to a real-time dashboard every second.
- **Build pipelines** — Stream build output lines to a terminal panel in the renderer.

**⚡ Improvement over vanilla Electron:** Vanilla approach: `ipcRenderer.on('channel', callback)` with manual cleanup. No React integration, no auto-cleanup on unmount, no type safety on the event data. You manage listener registration/deregistration yourself. This library wraps it in a hook that auto-subscribes on mount, auto-unsubscribes on unmount, and gives you fully typed events.

```tsx
ipc.onFileProgress.useSubscription({ fileId }, {
  onData: (update) => setProgress(update.percent),
});
// Auto-cleanup when component unmounts!
```

---

### 9. 🔄 Bidirectional Channels

**What it is:** Two-way continuous communication. Main can `emit()` to renderer AND listen via `onData()` from renderer. Perfect for file uploads, terminal emulators, live collaboration, and streaming data processing.

**🎯 Real-World Scenarios:**
- **CSV/data import** — Renderer sends rows one by one, Main processes and sends back progress + errors.
- **Terminal emulator** — Renderer sends keystrokes, Main sends stdout/stderr back in real-time.
- **Live document collaboration** — Both sides send edits in real-time with conflict resolution.
- **Log streaming** — Main sends log lines as they're written, Renderer displays them in a scrollable panel.

**⚡ Improvement over vanilla Electron:** Vanilla two-way IPC requires managing `ipcRenderer.send` + `ipcMain.on` + `ipcMain.send` + `ipcRenderer.on` — four separate channels, manual cleanup, no type safety. Channels unify this into a single typed connection with automatic lifecycle management.

```tsx
const { send } = ipc.csvImport.useChannel({ fileName: 'data.csv' }, {
  onData: (update) => setProgress(update.percent),
});
send({ row: parsedRow, totalRows: 1000 }); // Send TO main
```

---

### 10. 🔒 Zod Input Validation

**What it is:** Every `.input(zodSchema)` adds runtime validation at the IPC boundary. Data is validated *before* the handler runs. Malformed data never reaches your business logic.

**🎯 Real-World Scenarios:**
- **Form submissions** — Email validation, min/max lengths, enum values — all validated before the handler sees it.
- **Security boundary** — A compromised renderer can't inject malformed data. Zod rejects it with detailed errors.
- **API contracts** — Schemas serve as living documentation. Change a schema → TypeScript breaks at every call site.
- **Default values** — `z.number().default(24)` applies defaults on the main process side, renderer doesn't need to send them.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has zero runtime validation. Any data structure passes through. You'd need to manually validate in every handler with `if (!input.email || typeof input.name !== 'string')` — repetitive, error-prone, easy to forget. Zod schemas are declared once, enforced automatically, and provide detailed error messages.

---

### 11. 🪝 AbortSignal — Auto-Canceling Queries

**What it is:** Every `.query()` handler receives a native `AbortSignal`. When the React component unmounts (user navigates away, modal closes), the signal auto-aborts. In-flight database queries, HTTP requests, or file reads stop immediately.

**🎯 Real-World Scenarios:**
- **Search pages** — User types "ele", query starts. User types "electron" → previous query cancels, new one starts.
- **Report generation** — User clicks "Generate Report" then navigates away → generation stops, CPU freed.
- **Modal detail views** — Open a modal, fetch details. Close modal → fetch cancels instantly.
- **Tab switching** — Each tab fetches different data. Switching tabs cancels the previous tab's queries.

**⚡ Improvement over vanilla Electron:** Vanilla `ipcRenderer.invoke()` has no cancellation mechanism. A query that takes 10 seconds keeps running even if the user navigated away 9 seconds ago. This wastes CPU, memory, and database resources. AbortSignals integrate natively with PostgreSQL, `fetch`, Node.js streams, and more.

---

### 12. ⚡ Request Batching (Enabled by Default)

**What it is:** Multiple queries in the same render tick are automatically batched into a single `__ipc_batch` IPC call. Reduces Electron bridge overhead significantly.

**🎯 Real-World Scenarios:**
- **Dashboards** — Load user + org + stats + notifications in one batch instead of 4 separate IPC calls.
- **List + detail views** — Fetch the list and the selected item's details simultaneously.
- **Multi-widget layouts** — Each widget triggers a query, all batched transparently.

**⚡ Improvement over vanilla Electron:** Each `ipcRenderer.invoke()` is a separate synchronous bridge crossing with serialization overhead. 5 queries = 5 crossings. Batching sends all 5 in one crossing — ~5x less overhead. The best part: it's transparent. No code changes needed.

```tsx
function Dashboard() {
  // These 3 queries fire in same render tick → ONE IPC call
  const user  = ipc.getUser.useQuery('user-1');
  const org   = ipc.getOrg.useQuery('org-1');
  const stats = ipc.getStats.useQuery({ period: '7d' });
}
```

---

### 13. 📢 Cross-Window Invalidation

**What it is:** When a mutation in Window A changes data that Window B is displaying, Window B needs to know. This broadcasts invalidation messages across all windows so React Query caches stay fresh.

**🎯 Real-World Scenarios:**
- **Main window + Settings window** — Change theme in Settings → Main window updates instantly.
- **Chat + Notifications** — Send a message in chat window → notification window clears the unread badge.
- **Admin + User views** — Admin bans a user → user's window shows "Account suspended" immediately.
- **Multi-monitor setups** — Different BrowserWindows showing different views of the same data.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has no built-in cache synchronization. You'd manually send invalidation messages via `webContents.send()` and handle them in each window. This requires tracking which windows exist, which queries they're running, and wiring up listeners. This library handles all of it — just call `broadcast.invalidate('queryName')` in your mutation handler.

---

### 14. 🪟 Shared Reactive State (`createIpcStore`)

**What it is:** A synchronized key-value store in the main process, automatically mirrored to all renderer windows. Main updates → all renderers sync. Renderer updates → main applies and broadcasts to others.

**🎯 Real-World Scenarios:**
- **App settings** — Theme (light/dark/system), language, sidebar collapsed state — consistent across all windows.
- **Feature flags** — Toggle features from main process, all windows react immediately.
- **User session** — `activeUserId`, `isLoggedIn`, `permissions[]` — shared state accessible everywhere.
- **Recent files list** — Updated from any window, visible in all others.

**⚡ Improvement over vanilla Electron:** Vanilla approach: store state in main, send to renderers via `webContents.send()`, each renderer manages its own copy, manually sync on changes. Inconsistent state is common. This library gives you a single source of truth with automatic synchronization and React hooks.

```tsx
// Renderer — just use the hook, state syncs automatically
const [state, setState] = useAppStore();
setState({ theme: 'dark' }); // Updates main + all other windows
```

---

### 15. 🗄️ Infinite Query Pagination

**What it is:** Full `useInfiniteQuery` support for cursor-based pagination. Load the first page, then "load more" on demand. Perfect for activity feeds, audit logs, chat histories.

**🎯 Real-World Scenarios:**
- **Activity feeds** — Show latest 20 activities, "Load More" fetches the next 20.
- **Chat history** — Scroll up to load older messages, infinite scroll pattern.
- **Audit logs** — Filter by type, paginate through thousands of entries.
- **File browsers** — Paginated directory listings for folders with thousands of files.

**⚡ Improvement over vanilla Electron:** Vanilla pagination requires manual page state management, loading indicators, and append logic for each list. No caching of previous pages. This library gives you the full `useInfiniteQuery` API — cached pages, `hasNextPage`, `fetchNextPage()`, prefetching, all for free.

---

### 16. ⏱️ Rate Limiter (`createRateLimiter`)

**What it is:** Built-in sliding-window rate limiter middleware. Limit how often a procedure can be called — globally, per-user, per-procedure, or with any custom key. No external dependencies.

**🎯 Real-World Scenarios:**
- **Search endpoints** — Limit to 10 searches/second to prevent UI spam from fast typers.
- **Expensive operations** — Report generation: 1 per minute per user. Database export: 3 per hour.
- **Auth endpoints** — Login attempts: 5 per 15 minutes per IP to prevent brute force.
- **Free tier limits** — API calls: 100 per day per user, with custom error showing remaining quota.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has no rate limiting. You'd build a custom token bucket or sliding window, track timestamps per user, and manually check in each handler. This library provides a production-ready rate limiter as middleware — attach with `.use()`, configure limits, done.

---

### 17. 🔬 DevTools (`createDevTools`)

**What it is:** An observability layer for IPC traffic. Record every call, track success/error rates, measure latency, and build a custom DevTools panel in your app.

**🎯 Real-World Scenarios:**
- **Performance profiling** — Find the slowest IPC calls. Is `searchDocuments` taking 2s? Optimize it.
- **Error tracking** — See which procedures fail most often. Spot patterns before users complain.
- **Development debugging** — Watch IPC calls scroll in real-time as you interact with the UI.
- **QA testing** — Record all IPC traffic during a test session, export for analysis.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has zero observability. You don't know which channels are called, how long they take, or how often they fail. You'd add `console.log` to every handler and remove them before shipping. This library provides structured recording, stats aggregation, and real-time subscriptions.

---

### 18. 🧹 Cleanup & Dispose

**What it is:** Both `bindIpcRouter` and `bindIpcStore` return a dispose function. Call it to remove all registered `ipcMain` handlers. Essential for multi-window lifecycle, testing, and HMR.

**🎯 Real-World Scenarios:**
- **Multi-window apps** — Window closes → dispose its IPC handlers → no memory leaks.
- **Hot Module Replacement** — Re-bind handlers on code change without restarting Electron.
- **Testing** — Dispose between test cases → no cross-test contamination.
- **Dynamic plugins** — Load a plugin's router, unload it later, clean up completely.

**⚡ Improvement over vanilla Electron:** Vanilla `ipcMain.handle()` registers permanent listeners. There's no built-in way to remove specific handlers without keeping references to the original functions. If you re-register (HMR, tests), you get duplicate handlers causing double execution. This library returns a dispose function that cleans up everything.

```typescript
const dispose = bindIpcRouter(ipcMain, appRouter, createContext);
win.on('closed', () => dispose()); // Clean up on window close
```

---

## 📚 Complete API Reference

### Import Paths

```typescript
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks';        // everything
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks/main';    // main process only
import { exposeIpc } from 'electron-ipc-react-hooks/preload';              // preload only
import { createReactIpc } from 'electron-ipc-react-hooks/renderer';        // renderer only
```

### Main Process Exports

| Export | Signature | Purpose |
|---|---|---|
| `initIpc<TContext>()` | `() => { router, procedure, middleware }` | Create a typed IPC builder with your context type |
| `bindIpcRouter` | `(ipcMain, router, contextFactory?) => () => void` | Bind router to Electron's ipcMain. Returns dispose. |
| `createIpcStore` | `<T>(initialState: T) => { get, set, reset, subscribe }` | Create a shared reactive store |
| `bindIpcStore` | `(ipcMain, storeName, store, options: { webContents }) => () => void` | Bind store to IPC. Returns dispose. |
| `IpcError` | `class extends Error` | Structured error for Main → Renderer |
| `ProcedureBuilder` | Class | Chainable: `.input()`, `.use()`, `.query()`, `.mutation()`, `.subscription()`, `.channel()` |
| `createRateLimiter` | `(options) => Middleware` | Sliding-window rate limiting middleware |
| `createDevTools` | `(options?) => IpcDevTools` | IPC traffic observability |

### Procedure Builder Methods

```typescript
const t = initIpc<{ userId: string }>();

t.procedure
  .input(z.object({ name: z.string() }))   // Zod schema for runtime validation
  .use(myMiddleware)                         // Add middleware(s)
  .query(handler)                            // Read-only query (has AbortSignal)
  .mutation(handler)                         // State-changing mutation
  .subscription(handler)                     // Main → Renderer event stream
  .channel(handler)                          // Bidirectional data stream
```

### Handler Signatures

```typescript
// .query() — read data, auto-canceled on unmount
.query(async ({ input, ctx, signal, path, type, broadcast }) => { ... })

// .mutation() — change data, broadcast invalidation
.mutation(async ({ input, ctx, path, type, broadcast }) => { ... })

// .subscription() — push events to renderer
.subscription(({ input, ctx, emit }) => {
  emit(data);            // Push to renderer
  return () => cleanup(); // Called on unmount
})

// .channel() — two-way data stream
.channel(({ input, ctx, emit, onData }) => {
  emit(data);            // Send TO renderer
  onData((data) => {});  // Receive FROM renderer
  return () => cleanup();
})
```

### Middleware Signature

```typescript
const mw = t.middleware(async ({ next, input, ctx, path, type }) => {
  const result = await next();              // Call next middleware/handler
  return result;
  // Or modify context:
  // return next({ ctx: { ...ctx, extra: 'data' } });
});
```

### Preload Exports

| Export | Signature | Purpose |
|---|---|---|
| `exposeIpc` | `(contextBridge, ipcRenderer, apiKey?) => void` | Expose IPC on `window`. Default key: `'electronIpc'`. |

```typescript
// Custom API key for multi-app scenarios
exposeIpc(contextBridge, ipcRenderer, 'myCustomApi');
// → window.myCustomApi { invoke, on, off, send }
```

### Renderer Exports

| Export | Signature | Purpose |
|---|---|---|
| `createReactIpc<TRouter>` | `(apiKey?, options?) => ReactIpcClient` | Create typed hook client |
| `createReactIpcStore<T>` | `(storeName, initialState, apiKey?) => () => [T, setter, resetter]` | React hook for shared state |
| `useIpcInvalidator` | `(queryClient, apiKey?) => void` | Listen for cross-window invalidation |
| `IpcTypedError` | `class extends Error { code, data, toJSON() }` | Typed error from IPC |
| `createIpcErrorFromResponse` | `(response) => IpcTypedError` | Create IpcTypedError from raw object |

### `createReactIpc` Options

```typescript
const ipc = createReactIpc<AppRouter>('electronIpc', {
  batching: true,          // Enable request batching (default: true)
  batchingTimeout: 10,     // ms before flushing batch (default: 10)
});
```

### Hooks per Procedure Type

| Procedure | Hook | Returns |
|---|---|---|
| `.query()` | `ipc.x.useQuery(input, options?)` | `{ data, isLoading, error, refetch, ... }` |
| `.query()` | `ipc.x.useInfiniteQuery(input, options?)` | `{ data, fetchNextPage, hasNextPage, ... }` |
| `.mutation()` | `ipc.x.useMutation(options?)` | `{ mutate, mutateAsync, isPending, error, ... }` |
| `.subscription()` | `ipc.x.useSubscription(input, { onData, onError? })` | Auto-cleanup on unmount |
| `.channel()` | `ipc.x.useChannel(input, { onData? })` | `{ send }` |

### Error Classes

```typescript
// Main process
class IpcError extends Error {
  constructor(message: string, code?: string, data?: any);
  readonly code: string;   // e.g., 'UNAUTHORIZED', 'CONFLICT', 'BAD_REQUEST'
  readonly data?: any;
}

// Renderer — auto-created from IPC responses
class IpcTypedError extends Error {
  readonly code: string;
  readonly data?: any;
  toJSON(): object;
}

// Utility
function createIpcErrorFromResponse(response: { error: string; code?: string; data?: any }): IpcTypedError;
```

---

## 🧪 Testing

Your router is a plain object — call procedures directly. No Electron needed.

```typescript
import { expect, test, vi } from 'vitest';
import { appRouter } from './main';

test('getUser returns user profile', async () => {
  const result = await appRouter.getUser({
    input: 'alice@acme.com',
    ctx: { userId: 'u1', db: mockDb },
    path: 'getUser',
    broadcast: { invalidate: vi.fn() },
  });
  expect(result.name).toBe('Alice');
});

test('invalid email throws BAD_REQUEST', async () => {
  try {
    await appRouter.getUser({
      input: 'not-an-email',
      ctx: {},
      path: 'getUser',
      broadcast: { invalidate: vi.fn() },
    });
  } catch (e: any) {
    expect(e.code).toBe('BAD_REQUEST');
  }
});
```

---

## 📁 Example App

A working Electron + Vite + React app lives in [`/example`](./example/):

```bash
cd example && npm install && npm run build && npx electron .
```

---

## 🔧 Troubleshooting

### Duplicate React / `useContext is null`

When consuming via `file:` link, npm may install duplicate `react`. Fix in `vite.config.ts`:

```ts
import { resolve } from 'path'
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    alias: {
      'react': resolve('./node_modules/react'),
      'react-dom': resolve('./node_modules/react-dom'),
    }
  },
})
```

---

## 🗺️ Roadmap

| Coming Soon | Status |
|---|---|
| **UI Form Generation** — Auto-generate typed React forms from Zod schemas | 🔜 Planned |
| **React Native / Expo** — Extend the IPC pattern to mobile | 🔜 Planned |
| **Auto-Reconnecting Subscriptions** — Exponential backoff on focus/network restore | 🔜 Planned |
| **Optimistic Updates Helper** — Auto rollback on IPC error | 🔜 Planned |

---

<div align="center">
  <br />
  <sub> Built to exponentially expand the boundaries of the Electron developer experience. </sub>
  <br />
  <sub> Made with ☕ and an unreasonable amount of TypeScript. </sub>
</div>