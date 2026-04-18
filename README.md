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

### Install dependencies

```bash
npm install electron-ipc-react-hooks zod @tanstack/react-query
npm install -D typescript
```

**What each package does:**
- `electron-ipc-react-hooks` — The library itself. Provides the router builder, React hooks, preload bridge, error classes, rate limiter, DevTools, and shared state store. Zero external dependencies — it only uses React and Zod as peer dependencies.
- `zod` — Schema validation library. You define schemas for your procedure inputs (e.g., "email must be a valid email", "name must be at least 1 character"). These schemas run at the IPC boundary in the main process, rejecting malformed data before it reaches your handlers. TypeScript infers types from the same schemas, so you get both runtime validation and compile-time type safety from a single source of truth.
- `@tanstack/react-query` — The data-fetching library that powers `useQuery` and `useMutation` under the hood. It handles caching, background refetching, stale-while-revalidate, pagination, optimistic updates, and much more. This library integrates with it natively — every `.query()` becomes a `useQuery`, every `.mutation()` becomes a `useMutation`.
- `typescript` — Required for the type magic. The router you define in main is a TypeScript type that flows to the renderer through `typeof appRouter`. Without TypeScript, you still get runtime validation from Zod, but you lose the auto-complete and compile-time error checking that makes this library powerful.

---

### Step 1: Define your router in Main

The "main" process is Electron's Node.js backend — it has full access to the file system, databases, native APIs, and OS features. This is where you define your IPC router: a collection of procedures (queries, mutations, subscriptions, channels) that the renderer can call.

```typescript
// main.ts
import { initIpc, bindIpcRouter } from 'electron-ipc-react-hooks';
import { ipcMain } from 'electron';
import { z } from 'zod';

// Create an IPC builder — this is the foundation for building typed procedures
const t = initIpc();

// Define your router — a collection of procedures the renderer can call
const appRouter = t.router({
  // 📖 Query — read/fetch data from the main process
  // The renderer calls this like a React Query hook
  getUser: t.procedure
    .input(z.string().email())     // Validate: input must be a valid email
    .query(async ({ input }) => {   // .query = read-only data fetch
      const user = await db.users.findByEmail(input);
      return { id: user.uuid, name: user.displayName, avatar: user.avatarUrl };
    }),

  // ✏️ Mutation — create/update/delete data in the main process
  // The renderer calls this to trigger state changes
  saveProfile: t.procedure
    .input(z.object({ name: z.string().min(1), avatar: z.string().url() }))
    .mutation(async ({ input }) => { // .mutation = state-changing action
      await db.users.updateProfile(input);
      return { success: true };
    }),
});

// 🔒 Export ONLY the TypeScript type — NOT the runtime router.
// This prevents Node.js modules (fs, net, child_process) from leaking into the renderer.
// The renderer imports this type to get auto-complete and type checking.
export type AppRouter = typeof appRouter;

// Bind the router to Electron's ipcMain — this registers IPC handlers for every procedure.
// It returns a dispose function you can call to clean up (useful for tests and HMR).
const dispose = bindIpcRouter(ipcMain, appRouter);
```

**What's happening here:**
1. `initIpc()` creates a typed builder. Think of it like `new tRPC()` — it's the starting point.
2. `t.procedure.input(schema).query(handler)` creates a single IPC endpoint. The Zod schema validates input at runtime AND provides the TypeScript type at compile time.
3. `t.router({ ... })` collects all procedures into a single object. This becomes your API surface.
4. `bindIpcRouter(ipcMain, appRouter)` connects your router to Electron. It registers `ipcMain.handle('ipc:invoke', ...)` internally. You never deal with channel names.
5. `export type AppRouter` exports only the TypeScript shape — no runtime code. The renderer will import this type to know what procedures exist and what their signatures are.

---

### Step 2: Bridge through Preload

Electron's security model requires a "preload" script to expose specific APIs from the main process to the renderer. The preload runs in a privileged context and uses `contextBridge` to safely expose a limited API to the web page. This step creates the bridge that carries IPC calls between renderer and main.

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeIpc } from 'electron-ipc-react-hooks/preload';

// exposeIpc does three things:
// 1. Creates a safe API object on window.electronIpc (or a custom key)
// 2. Exposes invoke() — used by queries and mutations to call the main process
// 3. Exposes on(), off(), send() — used by subscriptions and channels for real-time data
exposeIpc(contextBridge, ipcRenderer);
// → window.electronIpc { invoke, on, off, send }
```

**Why this is necessary:** Electron's `contextBridge` is the only secure way to pass data between the main process and a renderer loaded from a URL or untrusted content. Without it, the renderer has no access to `ipcRenderer`. This library's `exposeIpc` wraps the bridge so that queries, mutations, subscriptions, and channels all flow through it transparently.

**Custom API key:** If you have multiple apps or need to avoid naming conflicts, pass a third argument: `exposeIpc(contextBridge, ipcRenderer, 'myCustomApi')` → `window.myCustomApi`.

---

### Step 3: Consume in React

The renderer is your React app — it runs in a Chromium browser context. Here you create a typed IPC client using the `AppRouter` type from Step 1, and call procedures as React hooks.

```tsx
// App.tsx
import { createReactIpc } from 'electron-ipc-react-hooks/renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppRouter } from './main'; // Type-only import! No Node.js code in renderer.

// Create a typed IPC client — TypeScript now knows every procedure in AppRouter.
// 'electronIpc' must match the key used in exposeIpc() (default: 'electronIpc')
const ipc = createReactIpc<AppRouter>();

// React Query client — manages caching, background refetching, and query state.
// Wrap your app with QueryClientProvider so all hooks share this client.
const queryClient = new QueryClient();

// ✅ Queries — fetch data with automatic caching, loading states, and error handling
function UserProfile({ email }: { email: string }) {
  // ipc.getUser.useQuery(email) is typed:
  // - email must be a string (from the Zod schema in main.ts)
  // - data is typed as { id: string, name: string, avatar: string }
  // - isLoading, error, refetch, etc. are all standard React Query returns
  const { data, isLoading, error } = ipc.getUser.useQuery(email, {
    staleTime: 60_000,            // Don't refetch for 60 seconds
    refetchOnWindowFocus: true,   // Auto-refetch when user returns to window
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorCard error={error} />;

  return <ProfileCard name={data.name} avatar={data.avatar} />;
}

// ✅ Mutations — change data with loading states and success/error callbacks
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

// Wrap your app with QueryClientProvider — required by React Query
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProfile email="alice@acme.com" />
      <EditProfile />
    </QueryClientProvider>
  );
}
```

**What's happening here:**
1. `createReactIpc<AppRouter>()` reads the TypeScript type of your router and generates typed hooks for every procedure. `ipc.getUser` exists because `getUser` is in your router. `useQuery` is available because `getUser` is a `.query()`.
2. `ipc.getUser.useQuery(email)` calls `window.electronIpc.invoke(...)` internally, which crosses the preload bridge, hits the router in main, validates input with Zod, runs the handler, and returns the result — all with full type safety.
3. `QueryClientProvider` wraps the app so React Query can manage cache, retries, refetching, and background updates for all queries.

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

> **🗣️ In plain English:** Instead of calling `ipcRenderer.invoke('some-string', data)` and hoping it works, you define a router like a menu of available operations. TypeScript then auto-completes every available operation and checks that you're passing the right arguments and using the return value correctly — just like calling a regular function.

---

### 2. 📖 Queries — Full TanStack React Query Integration

**What it is:** Every `.query()` procedure you define in the main process automatically becomes a `useQuery` hook in your renderer. But this isn't just a thin wrapper — it's a deep integration with TanStack React Query, the industry-standard data-fetching library for React. When you call `ipc.getUser.useQuery(userId)`, React Query takes over: it caches the result, shows stale data instantly while fetching fresh data in the background, retries on failure, pauses when the window loses focus, deduplicates identical requests from multiple components, and much more. You get all of this without writing any caching or state management logic yourself.

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

> **🗣️ In plain English:** When your React component needs data from the main process, you call a hook. It handles everything: showing a loading spinner while waiting, caching the result so the next component gets it instantly, refreshing the data when the user comes back to the window, and retrying if something fails. You never write `useState` for loading or data again.

---

### 3. ✏️ Mutations — State Changes with React Query

**What it is:** Every `.mutation()` procedure becomes a `useMutation` hook in your renderer. Mutations are for operations that change data — creating a user, updating a profile, deleting a file, sending a message. The hook gives you `mutate()` to trigger the action, `isPending` for loading states, `isSuccess`/`isError` for outcome tracking, and lifecycle callbacks (`onMutate`, `onSuccess`, `onError`, `onSettled`) that let you implement optimistic UI updates (show the result immediately, roll back if it fails), invalidate cached queries to refresh stale data, show toast notifications, navigate to a new page, or chain multiple mutations together sequentially.

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

> **🗣️ In plain English:** When your user clicks "Save" or "Delete", a mutation hook sends the action to the main process. It tracks whether it's still loading, succeeded, or failed. You can show the result instantly (optimistic UI) and automatically roll back if something goes wrong — giving users a snappy, app-like experience.

---

### 4. 🛡️ Structured Error Handling (`IpcError` → `IpcTypedError`)

**The Problem:** Electron's IPC serializes errors to plain strings. You lose `.code`, `.statusCode`, any structured data. Your renderer just gets `"Error: Something went wrong"`.

**Our Solution:** `IpcError` in main carries `.code` (machine-readable) and `.data` (any JSON context). Across IPC it becomes `IpcTypedError` — same `.code`, same `.data`. Zod validation failures auto-surface as `BAD_REQUEST` with the full validation issues array attached. This means your renderer can pattern-match on error codes and show completely different UI for each case — an `UNAUTHORIZED` error redirects to login, a `PLAN_LIMIT` error shows an upgrade prompt, a `CONFLICT` error shows "already exists", and a `BAD_REQUEST` error highlights the specific form fields that failed validation.

**🎯 Real-World Scenarios:**
- **Subscription/paywall flows** — `PLAN_LIMIT` error triggers an upgrade modal with `data.max` showing the current plan limit.
- **Invite systems** — `CONFLICT` shows "Already invited", `DOMAIN_RESTRICTED` shows the allowed domain.
- **Auth-protected actions** — `UNAUTHORIZED` redirects to login. All errors carry enough context for specific UI responses.
- **Form validation** — Zod errors map directly to form fields: `{ path: ['email'], message: 'Invalid email' }`.

**⚡ Improvement over vanilla Electron:** Electron serializes errors to plain strings across IPC. You get `"Error: Something went wrong"` — no code, no structured data, no way to show different UI for different error types. This library handles serialization automatically — throw `IpcError` in main, pattern-match `IpcTypedError.code` in renderer.

> **🗣️ In plain English:** Instead of getting a generic error message, every error comes with a category code and extra details. Your UI can check the code and react differently: show a login page for auth errors, an upgrade prompt for plan limits, or highlight the wrong form fields for validation errors. No more guessing what went wrong.

---

### 5. 🔗 Middleware Pipeline

**What it is:** Middleware lets you wrap every procedure with cross-cutting logic that runs before and after the handler — authentication checks, audit logging, rate limiting, input transformation, error handling — without modifying each procedure individually. You define a middleware once, attach it to a procedure builder with `.use()`, and every procedure created from that builder automatically runs through all middlewares. Middlewares compose and execute in order, each wrapping the next, like Express.js or Koa. You can even modify the context object as it flows through, enriching it with data for downstream middlewares and handlers (e.g., auth middleware resolves `userId`, adds it to context, and every subsequent handler receives it).

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

> **🗣️ In plain English:** Middleware is like a security checkpoint that every IPC call must pass through. You set it up once — "check if the user is logged in", "log this call for auditing", "don't allow more than 5 calls per second" — and it automatically runs for every operation. No more forgetting to add an auth check to a new endpoint.

---

### 6. 🧩 Context Injection

**What it is:** A context factory function that runs on every single IPC call, before the handler executes. It creates and injects a typed `ctx` object that every handler receives as its first argument. You can put anything in context: the authenticated `userId` (resolved from the Electron session), database connection pools, the raw `event` object (with sender frame info), feature flags, tenant IDs, admin status, trace IDs — anything the handler might need. This is dependency injection for IPC: instead of handlers importing global singletons (which creates hidden dependencies and makes testing hard), they receive everything they need through the context parameter.

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

> **🗣️ In plain English:** Every time the renderer calls an IPC function, a "context" object is automatically created with the current user's info, database connection, and anything else the handler needs. The handler just uses what's in the context — it doesn't care where it came from. This makes your code easier to test (just pass a fake context) and harder to break (no hidden global dependencies).

---

### 7. 📁 Nested Sub-Routers

**What it is:** Compose routers inside routers to create deeply nested API namespaces — just like organizing files into folders. Instead of having 50 flat procedures with names like `getUser`, `getBilling`, `adminBanUser`, you group them into logical routers: `users` router, `billing` router, `admin` router. Each router is defined in its own file and composed into a root router. The procedure paths are joined with dots: `admin.billing.getInvoices`. Nest as deep as you want. In the renderer, the types mirror the nesting: `ipc.admin.billing.getInvoices.useQuery(...)`. This keeps your codebase organized as it scales from 5 procedures to 500.

**🎯 Real-World Scenarios:**
- **Large SaaS apps** — Separate routers for `users`, `billing`, `admin`, `settings`. Each in its own file.
- **Plugin architectures** — Each plugin registers its own sub-router. Main app composes them.
- **Versioned APIs** — `v1.router(...)` and `v2.router(...)` with different procedure shapes.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has flat channel names — `'getUser'`, `'getBilling'`. No namespacing, no organization. As the app grows, channel names become inconsistent (`'user-get'` vs `'get-user'` vs `'users:get'`). Sub-routers give you hierarchical, typed namespacing.

> **🗣️ In plain English:** Organize your IPC endpoints into folders, just like you organize files on your computer. Instead of a messy list of 50 endpoints, you get `users.getProfile`, `billing.getInvoices`, `admin.users.ban` — cleanly grouped, easy to find, and TypeScript auto-completes the whole path.

---

### 8. 📡 Subscriptions (Main → Renderer Real-Time Streams)

**What it is:** Subscriptions let the main process push data to the renderer in real time, without the renderer asking for it each time. The main process calls `emit(data)` whenever new data is available (a notification arrives, a file download progresses, a build step completes), and the renderer receives each event through a `useSubscription` hook. The hook auto-subscribes when the component mounts and auto-unsubscribes when it unmounts — no manual cleanup. You can also pass input to parameterize the subscription (e.g., subscribe to events for a specific file ID).

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

> **🗣️ In plain English:** The main process can push updates to your React component whenever something happens — a download progresses, a notification arrives, a build step completes. Your component just says "I want to know about X" and gets called every time X happens. When the component disappears, the subscription automatically stops.

---

### 9. 🔄 Bidirectional Channels

**What it is:** Channels provide continuous two-way communication between main and renderer. Unlike subscriptions (one direction: main → renderer) or queries/mutations (request → response), channels keep an open connection where both sides can send data at any time. The main process uses `emit()` to send data to the renderer and `onData()` to receive data from the renderer. The renderer gets a `send()` function to push data to main and an `onData` callback to receive from main. This is essential for scenarios where both sides need to stream data continuously: terminal emulators, file processing with progress, live document editing, and real-time data pipelines.

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

> **🗣️ In plain English:** Imagine a phone call between the main process and the renderer — both sides can talk and listen at the same time. The renderer sends rows of a CSV, the main process processes them and sends back progress updates. When the component closes, the call hangs up automatically.

---

### 10. 🔒 Zod Input Validation

**What it is:** Every `.input(zodSchema)` call on a procedure adds runtime validation at the IPC boundary — the point where data crosses from the renderer (web browser) to the main process (Node.js). When the renderer sends data, it's validated against the Zod schema in the main process *before* the handler runs. If the data doesn't match the schema (wrong type, missing fields, email format invalid, string too short), the request is rejected immediately with a detailed `BAD_REQUEST` error listing every issue. Malformed data never reaches your business logic. The same Zod schema also provides TypeScript types, so the renderer gets compile-time errors if it sends the wrong shape.

**🎯 Real-World Scenarios:**
- **Form submissions** — Email validation, min/max lengths, enum values — all validated before the handler sees it.
- **Security boundary** — A compromised renderer can't inject malformed data. Zod rejects it with detailed errors.
- **API contracts** — Schemas serve as living documentation. Change a schema → TypeScript breaks at every call site.
- **Default values** — `z.number().default(24)` applies defaults on the main process side, renderer doesn't need to send them.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has zero runtime validation. Any data structure passes through. You'd need to manually validate in every handler with `if (!input.email || typeof input.name !== 'string')` — repetitive, error-prone, easy to forget. Zod schemas are declared once, enforced automatically, and provide detailed error messages.

> **🗣️ In plain English:** Every piece of data your renderer sends to the main process is checked against a schema before the handler runs. If someone sends a number where a string is expected, or forgets a required field, it's rejected with a clear error message listing exactly what's wrong. It's like a bouncer at the door checking IDs — only valid data gets through.

---

### 11. 🪝 AbortSignal — Auto-Canceling Queries

**What it is:** Every `.query()` handler receives a native `AbortSignal` — the same signal used by `fetch()`, PostgreSQL drivers, and Node.js streams. When the React component that initiated the query unmounts (user navigates to a different page, a modal closes, a tab switches), React Query automatically aborts the signal. This propagates to the main process handler, which can stop whatever it's doing — cancel the database query, abort the HTTP request, stop iterating the file stream. Resources are freed immediately instead of continuing to process data that nobody will see.

**🎯 Real-World Scenarios:**
- **Search pages** — User types "ele", query starts. User types "electron" → previous query cancels, new one starts.
- **Report generation** — User clicks "Generate Report" then navigates away → generation stops, CPU freed.
- **Modal detail views** — Open a modal, fetch details. Close modal → fetch cancels instantly.
- **Tab switching** — Each tab fetches different data. Switching tabs cancels the previous tab's queries.

**⚡ Improvement over vanilla Electron:** Vanilla `ipcRenderer.invoke()` has no cancellation mechanism. A query that takes 10 seconds keeps running even if the user navigated away 9 seconds ago. This wastes CPU, memory, and database resources. AbortSignals integrate natively with PostgreSQL, `fetch`, Node.js streams, and more.

> **🗣️ In plain English:** When a user navigates away from a page while data is still loading, the request automatically cancels. No more wasted processing — if nobody's waiting for the result, the work stops immediately. It's like hanging up a phone call when you realize you dialed the wrong number.

---

### 12. ⚡ Request Batching (Enabled by Default)

**What it is:** When a React component renders and triggers multiple queries at the same time (e.g., a dashboard that loads user info, organization data, and statistics simultaneously), the library automatically collects all those queries and sends them in a single IPC call instead of making separate calls for each one. This works by queueing queries in a microtask queue and flushing them together after a configurable timeout (default: 10ms). The main process handles each procedure individually and returns all results together. Each hook receives its own result transparently — no code changes needed. This significantly reduces Electron bridge overhead, which is the most expensive part of IPC communication.

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

> **🗣️ In plain English:** When your page loads and needs 5 different pieces of data, instead of making 5 separate trips to the main process, the library bundles them into one trip. It's like going to the grocery store once with a shopping list instead of making 5 separate trips for each item.

---

### 13. 📢 Cross-Window Invalidation

**What it is:** Electron apps often have multiple windows open at the same time — a main window, a settings window, a detached panel, a notification center. Each window has its own React Query cache. When a mutation in Window A changes data that Window B is displaying, Window B's cache becomes stale. This feature solves that: when your mutation handler calls `broadcast.invalidate('queryName')`, the main process sends an invalidation message to all other windows. Each window's `useIpcInvalidator` hook receives it and calls `queryClient.invalidateQueries()` for the matching keys. The data refreshes automatically across all windows.

**🎯 Real-World Scenarios:**
- **Main window + Settings window** — Change theme in Settings → Main window updates instantly.
- **Chat + Notifications** — Send a message in chat window → notification window clears the unread badge.
- **Admin + User views** — Admin bans a user → user's window shows "Account suspended" immediately.
- **Multi-monitor setups** — Different BrowserWindows showing different views of the same data.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has no built-in cache synchronization. You'd manually send invalidation messages via `webContents.send()` and handle them in each window. This requires tracking which windows exist, which queries they're running, and wiring up listeners. This library handles all of it — just call `broadcast.invalidate('queryName')` in your mutation handler.

> **🗣️ In plain English:** When you change data in one window (like marking all notifications as read), all other windows automatically know and refresh their data. It's like changing the TV channel in one room and having every other TV in the house update too.

---

### 14. 🪟 Shared Reactive State (`createIpcStore`)

**What it is:** A synchronized key-value store that lives in the main process and is automatically mirrored to all renderer windows in real time. You create it with `createIpcStore({ theme: 'system', sidebarCollapsed: false })` and bind it to IPC. When the main process updates the store (`store.set({ theme: 'dark' })`), every renderer gets the new value immediately through a React hook. When a renderer updates the store, the change goes to main first (single source of truth), then broadcasts to all other windows. This gives you a Zustand-like experience but synchronized across all Electron windows with full TypeScript inference.

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

> **🗣️ In plain English:** There's one shared settings object that lives in the main process. Any window can read or change it, and the change instantly appears in every other window. It's like a shared whiteboard — anyone can write, everyone sees the latest version.

---

### 15. 🗄️ Infinite Query Pagination

**What it is:** Full `useInfiniteQuery` support for cursor-based or offset-based pagination. Instead of loading all data at once, you load the first page (e.g., 20 items), then call `fetchNextPage()` to load more on demand. Each page is cached separately, so navigating back and forth is instant. The query handler in main returns `{ items, nextCursor }` — the library uses `getNextPageParam` to extract the cursor for the next request. You also get `hasNextPage`, `isFetchingNextPage`, and all standard React Query features like prefetching, placeholder data, and stale-while-revalidate.

**🎯 Real-World Scenarios:**
- **Activity feeds** — Show latest 20 activities, "Load More" fetches the next 20.
- **Chat history** — Scroll up to load older messages, infinite scroll pattern.
- **Audit logs** — Filter by type, paginate through thousands of entries.
- **File browsers** — Paginated directory listings for folders with thousands of files.

**⚡ Improvement over vanilla Electron:** Vanilla pagination requires manual page state management, loading indicators, and append logic for each list. No caching of previous pages. This library gives you the full `useInfiniteQuery` API — cached pages, `hasNextPage`, `fetchNextPage()`, prefetching, all for free.

> **🗣️ In plain English:** For lists with hundreds or thousands of items, you don't load everything at once. You load the first 20, show a "Load More" button, and fetch the next 20 when the user clicks. Previously loaded pages are cached, so scrolling back up is instant. It works exactly like Twitter's or Slack's infinite scroll.

---

### 16. ⏱️ Rate Limiter (`createRateLimiter`)

**What it is:** A production-ready sliding-window rate limiter that you use as middleware. It tracks a rolling window of request timestamps for each caller (identified by a custom key like user ID, IP, or procedure name). When a caller exceeds the maximum number of requests within the time window, the middleware throws an `IpcError` with code `RATE_LIMITED` and data containing the limit and window duration. Your renderer can catch this and show a "slow down" message. Configure limits globally, per-user, per-procedure, or with any custom key. No external dependencies — it's built into the library.

**🎯 Real-World Scenarios:**
- **Search endpoints** — Limit to 10 searches/second to prevent UI spam from fast typers.
- **Expensive operations** — Report generation: 1 per minute per user. Database export: 3 per hour.
- **Auth endpoints** — Login attempts: 5 per 15 minutes per IP to prevent brute force.
- **Free tier limits** — API calls: 100 per day per user, with custom error showing remaining quota.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has no rate limiting. You'd build a custom token bucket or sliding window, track timestamps per user, and manually check in each handler. This library provides a production-ready rate limiter as middleware — attach with `.use()`, configure limits, done.

> **🗣️ In plain English:** You can set a speed limit on any operation — "maximum 5 login attempts per 15 minutes" or "maximum 10 searches per second". If someone tries to go faster, they get a polite "slow down" error. This protects your app from accidental spam and intentional abuse without any extra code in your handlers.

---

### 17. 🔬 DevTools (`createDevTools`)

**What it is:** An observability and debugging layer that records every IPC call your app makes. It captures the procedure path, input data, duration, success/failure status, and error details for each call. You can query the history, get aggregated statistics (total calls, success rate, error rate, average duration, breakdown by procedure type), subscribe to real-time updates, and build a custom DevTools panel right inside your app. Enable/disable recording at runtime to capture specific scenarios. Set a max history size to control memory usage. It's like Chrome DevTools' Network tab, but for your IPC layer.

**🎯 Real-World Scenarios:**
- **Performance profiling** — Find the slowest IPC calls. Is `searchDocuments` taking 2s? Optimize it.
- **Error tracking** — See which procedures fail most often. Spot patterns before users complain.
- **Development debugging** — Watch IPC calls scroll in real-time as you interact with the UI.
- **QA testing** — Record all IPC traffic during a test session, export for analysis.

**⚡ Improvement over vanilla Electron:** Vanilla IPC has zero observability. You don't know which channels are called, how long they take, or how often they fail. You'd add `console.log` to every handler and remove them before shipping. This library provides structured recording, stats aggregation, and real-time subscriptions.

> **🗣️ In plain English:** A built-in dashboard that logs every IPC call your app makes — what was called, how long it took, and whether it succeeded or failed. It's like a flight recorder for your app's communication, helping you find slow operations, spot bugs, and understand how your app actually behaves.

---

### 18. 🧹 Cleanup & Dispose

**What it is:** Both `bindIpcRouter` and `bindIpcStore` return a dispose function. When you call it, all registered `ipcMain` handlers for that router or store are removed. This is essential for: (1) multi-window apps where each window has its own set of handlers — dispose when the window closes to prevent memory leaks and duplicate handlers; (2) testing — dispose between test cases so handlers from one test don't interfere with the next; (3) Hot Module Replacement — re-bind handlers on code change without restarting Electron; (4) dynamic plugin systems — load a plugin's router, then unload and clean up when the plugin is removed.

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

> **🗣️ In plain English:** When you're done with a router (window closed, test finished, plugin unloaded), you call one function and all the IPC handlers are cleaned up. No memory leaks, no duplicate handlers, no ghost processes. It's like unplugging an appliance when you're done using it.

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