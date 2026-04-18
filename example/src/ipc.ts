import { createReactIpc, createReactIpcStore } from 'electron-ipc-react-hooks/renderer'
import type { AppRouter } from './main'

// Generate our type-safe React Query hooks!
export const ipc = createReactIpc<AppRouter>()

// Generate our type-safe React global store hook!
export const useSettingsStore = createReactIpcStore('settings', { theme: 'system', notifications: true })
