import { contextBridge, ipcRenderer } from 'electron'
import { exposeIpc } from 'electron-ipc-react-hooks/preload'

// Exposes the `window.electronIpc` variable to the renderer processes
exposeIpc(contextBridge, ipcRenderer)

// (Optional) Expose anything else you need
contextBridge.exposeInMainWorld('env', {
  mode: process.env.NODE_ENV
})
