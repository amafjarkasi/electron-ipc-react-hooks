//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let path = require("path");
let os = require("os");
os = __toESM(os);
let zod = require("zod");
//#region ../dist/main.js
var ProcedureBuilder = class ProcedureBuilder {
	schema;
	middlewares = [];
	constructor(schema, middlewares = []) {
		this.schema = schema;
		this.middlewares = middlewares;
	}
	input(schema) {
		return new ProcedureBuilder(schema, [...this.middlewares]);
	}
	use(middleware) {
		return new ProcedureBuilder(this.schema, [...this.middlewares, middleware]);
	}
	query(resolver) {
		return this.createProcedure("query", resolver);
	}
	mutation(resolver) {
		return this.createProcedure("mutation", resolver);
	}
	subscription(resolver) {
		return this.createProcedure("subscription", resolver);
	}
	createProcedure(type, resolver) {
		const procedure = async (opts) => {
			let validInput = opts.input;
			if (this.schema) validInput = await this.schema.parseAsync(opts.input);
			const callRecursive = async (index, currentCtx) => {
				if (index >= this.middlewares.length) return resolver({
					input: validInput,
					ctx: currentCtx
				});
				const middleware = this.middlewares[index];
				return middleware({
					input: validInput,
					ctx: currentCtx,
					next: ({ ctx }) => callRecursive(index + 1, ctx)
				});
			};
			return callRecursive(0, opts.ctx);
		};
		procedure._type = type;
		procedure._input = null;
		procedure._output = null;
		procedure._ctx = null;
		return procedure;
	}
};
function initIpc() {
	return {
		procedure: new ProcedureBuilder(),
		router(routerObj) {
			return routerObj;
		}
	};
}
function bindIpcRouter(ipcMain, router, createContext, path = "") {
	for (const [key, value] of Object.entries(router)) {
		const currentPath = path ? `${path}.${key}` : key;
		if (typeof value === "function" && "_type" in value) {
			const procedure = value;
			if (procedure._type === "query" || procedure._type === "mutation") ipcMain.handle(currentPath, async (event, input) => {
				try {
					return { data: await procedure({
						input,
						ctx: createContext ? await createContext(event) : { event }
					}) };
				} catch (error) {
					return {
						error: error.message || "Unknown error",
						code: error.code
					};
				}
			});
			else if (procedure._type === "subscription") ipcMain.on(currentPath, async (event, input) => {
				try {
					await procedure({
						input,
						ctx: createContext ? await createContext(event) : { event }
					});
				} catch (error) {
					console.error(`Error in subscription ${currentPath}:`, error);
				}
			});
		} else bindIpcRouter(ipcMain, value, createContext, currentPath);
	}
}
//#endregion
//#region src/main.ts
electron.app.setPath("userData", (0, path.join)(os.homedir(), ".electron-ipc-example"));
var t = initIpc();
var loggerMiddleware = t.procedure.use(async ({ input, ctx, next }) => {
	const start = Date.now();
	console.log(`[IPC] ${ctx.event.senderFrame.url} called with:`, input);
	const result = await next({ ctx });
	const duration = Date.now() - start;
	console.log(`[IPC] Response in ${duration}ms`);
	return result;
});
var systemRouter = t.router({ getInfo: loggerMiddleware.query(() => ({
	platform: process.platform,
	arch: process.arch,
	nodeVersion: process.versions.node,
	electronVersion: process.versions.electron,
	chromeVersion: process.versions.chrome
})) });
var appRouter = t.router({
	system: systemRouter,
	echoReverse: loggerMiddleware.input(zod.z.object({ text: zod.z.string() })).mutation(async ({ input }) => {
		await new Promise((r) => setTimeout(r, 500));
		return input.text.split("").reverse().join("");
	}),
	throwError: t.procedure.input(zod.z.object({ shouldThrow: zod.z.boolean() })).mutation(() => {
		throw new Error("This is an expected error thrown from the main process!");
	})
});
function createWindow() {
	bindIpcRouter(electron.ipcMain, appRouter, (event) => ({
		event,
		timestamp: Date.now()
	}));
	const win = new electron.BrowserWindow({
		width: 920,
		height: 700,
		minWidth: 700,
		minHeight: 500,
		webPreferences: {
			preload: (0, path.join)(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else win.loadFile((0, path.join)(__dirname, "../dist/index.html"));
}
electron.app.whenReady().then(createWindow);
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
//#endregion
