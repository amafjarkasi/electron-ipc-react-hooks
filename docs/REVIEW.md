# Code Review: electron-ipc-react-hooks v1.3.2

Review date: 2026-07-11  
Scope: library `src/`, example app, tests, docs accuracy, performance notes.

## Feature matrix

| Feature | API | Unit | Mock harness | Electron E2E |
|---------|-----|------|--------------|--------------|
| Nested query | `system.getInfo.useQuery` | yes | yes | yes |
| Context query | `helloContext.useQuery` | yes | yes | yes |
| Mutation | `echoReverse.useMutation` | yes | yes | yes |
| Structured error | `throwError` / `IpcTypedError` | yes | yes | yes |
| Zod validation | `saveProfile` | yes | yes | yes |
| Subscription | `clock.useSubscription` | yes | yes | yes |
| Channel | `fileUploadStream.useChannel` | yes | yes | yes |
| Infinite query | `getLogs.useInfiniteQuery` | yes | yes | yes |
| AbortSignal | `slowQuery` | yes | yes | yes |
| Batching | `mathSquare` / `__ipc_batch` | yes | yes | yes |
| Nested batching | `system.*` via `__ipc_batch` | yes (H2) | yes | — |
| Shared store | `createReactIpcStore` | yes | yes | yes |
| Invalidation | `useIpcInvalidator` | yes | yes | yes |
| Rate limiter | `createRateLimiter` | yes | — | — |
| DevTools | `createDevTools` | yes | — | — |
| Preload bridge | `exposeIpc` | — | via mock | yes |

## High severity (fixed this pass)

| ID | Finding | Fix |
|----|---------|-----|
| **H1** | Nested `bindIpcRouter` discarded child dispose functions — nested handlers leaked after root dispose | Collect and invoke child dispose fns |
| **H2** | Root `__ipc_batch` only saw root-level `registeredProcedures` — nested paths failed when batched | Share procedure map across recursive binds |
| **H3** | Example omitted `{ webContents }` — invalidate + store multi-window sync were no-ops | Pass `webContents` into both binds |
| **H4** | Store `updateState` invoked IPC inside `setState` updater — StrictMode double-send | Compute next state via ref; IPC outside updater |
| **H5** | `bindIpcStore` dispose did not unsubscribe `store.subscribe` | Keep unsubscribe and call it on dispose |
| **H6** | `ProcedureBuilder` returned `AnyProcedure` (`_type: any`) — React hook types collapsed to a union | Preserve literal `_type` via `Procedure<..., TType, ...>` |

## Verification status

- `npm test` — library Vitest suite (unit + browser mock harness) — **passing**
- `npm run test:harness` — included in `npm test` via `src/integration/` — **passing**
- `npm run test:e2e` — Playwright Electron against `/example` — **9/9 passing**

## Medium severity (documented; deferred)

_None remaining from the original review pass._

## Medium severity (fixed this pass)

| ID | Finding | Fix |
|----|---------|-----|
| **M1** | `onData` not in subscription/channel effect deps — stale callbacks | Keep `onData` / `onError` in refs; effect only depends on channel + input |
| **M2** | Subscription/channel errors only `console.error` on main — renderer never notified | Main sends `{ __subId, __error }`; hooks expose `onError` |
| **M3** | DevTools `pendingCalls` keyed by path only — concurrent same-path overwrites | Queue per key + optional `id`; FIFO when id omitted |
| **M4** | Rate limiter Map never deletes empty keys | Prune expired empty keys on each check |
| **M5** | `useIpcInvalidator` froze `apiRef` at first render | Re-read `window[apiKey]` inside the effect |
| **M6** | Re-binding router without dispose duplicated `ipcMain.on` listeners | `removeAllListeners` / `removeHandler` before re-register |
| **M7** | Subscription resolver that omits cleanup fn cannot be unsubscribed on main | Dev-time `console.warn` when cleanup is missing |
| **M8** | Transport failure of `__ipc_batch` rejected the entire queue | Fall back to per-request `invoke`; isolate missing/error items |

## Low / DX / docs

| ID | Finding |
|----|---------|
| **L1** | README claimed `ipcMain.handle('ipc:invoke', ...)` — corrected to dotted paths + `__ipc_batch` |
| **L2** | Hero graphic refreshed to a cleaner `hero-v4.svg` |
| **L3** | Test badge updated to reflect current suite size |
| **L4** | CI workflow added at `.github/workflows/ci.yml` |
| **L5** | `example/README.md` updated with run/test instructions |
| **L6** | DevTools not auto-wired into `bindIpcRouter` (manual instrumentation only) |
| **L7** | Query keys use `stableSerialize` (sorted object keys) instead of raw `JSON.stringify` |
| **L8** | Legacy unscoped subscription payloads gated behind `legacyUnscopedPayloads: true` (default off) |

## Performance notes

- **Batching (default 10ms):** Correct for flat and nested paths after H2. Application errors are per-item; transport failure of `__ipc_batch` falls back to individual invokes (M8).
- **Query keys:** `[channel, stableSerialize(input)]` — object key order no longer affects cache identity.
- **Legacy subscription fallback:** Opt-in via `createReactIpc(..., { legacyUnscopedPayloads: true })`; default ignores unscoped payloads.
- **Rate limiter:** Sliding window is O(n) per call on the timestamp array; empty keys are pruned (M4).

## Out of scope (follow-ups)

- Auto-instrument DevTools inside `bindIpcRouter`
- SSR / browser graceful degradation (hooks currently throw if preload API missing)
- API redesigns (codegen, React Native, form helpers from README roadmap)
