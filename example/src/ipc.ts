import { createReactIpc } from 'electron-ipc-react-hooks/renderer'
import type { AppRouter } from './main'

// Generate our type-safe React Query hooks!
export const ipc = createReactIpc<AppRouter>()
