/**
 * Expose the IPC API to the renderer process via Electron's context bridge.
 *
 * @param contextBridge - Electron's contextBridge module.
 * @param ipcRenderer - Electron's ipcRenderer module.
 * @param apiKey - The window property name to expose the API under (default: 'electronIpc').
 *
 * @example
 * ```ts
 * import { contextBridge, ipcRenderer } from 'electron';
 * import { exposeIpc } from 'electron-ipc-react-hooks/preload';
 *
 * exposeIpc(contextBridge, ipcRenderer);
 * ```
 */
export function exposeIpc(
  contextBridge: { exposeInMainWorld: (apiKey: string, api: object) => void },
  ipcRenderer: { invoke: (channel: string, ...args: any[]) => Promise<any>; send: (channel: string, ...args: any[]) => void; on: (channel: string, listener: (...args: any[]) => void) => void; off: (channel: string, listener: (...args: any[]) => void) => void },
  apiKey = 'electronIpc'
) {
  contextBridge.exposeInMainWorld(apiKey, {
    invoke: (channel: string, payload?: any, invokeId?: string) => ipcRenderer.invoke(channel, payload, invokeId),
    send: (channel: string, payload?: any) => ipcRenderer.send(channel, payload),
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcRenderer.on(channel, listener);
    },
    off: (channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcRenderer.off(channel, listener);
    }
  });
}