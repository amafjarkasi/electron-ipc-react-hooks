export function exposeIpc(contextBridge: any, ipcRenderer: any, apiKey = 'electronIpc') {
  contextBridge.exposeInMainWorld(apiKey, {
    invoke: (channel: string, payload: any, invokeId?: string) => ipcRenderer.invoke(channel, payload, invokeId),
    send: (channel: string, payload: any) => ipcRenderer.send(channel, payload),
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcRenderer.on(channel, listener);
    },
    off: (channel: string, listener: (event: any, ...args: any[]) => void) => {
      ipcRenderer.off(channel, listener);
    }
  });
}
