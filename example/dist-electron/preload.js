let electron = require("electron");
//#region ../dist/preload.js
function exposeIpc(contextBridge, ipcRenderer, apiKey = "electronIpc") {
	contextBridge.exposeInMainWorld(apiKey, {
		invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
		on: (channel, listener) => {
			ipcRenderer.on(channel, listener);
		},
		off: (channel, listener) => {
			ipcRenderer.off(channel, listener);
		}
	});
}
//#endregion
//#region src/preload.ts
exposeIpc(electron.contextBridge, electron.ipcRenderer);
electron.contextBridge.exposeInMainWorld("env", { mode: process.env.NODE_ENV });
//#endregion
