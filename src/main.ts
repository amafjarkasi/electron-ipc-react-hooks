import type { ZodType } from "zod";
import type { IpcMain, IpcMainInvokeEvent } from "electron";

export class IpcError extends Error {
  constructor(
    public message: string,
    public code: string = 'INTERNAL_SERVER_ERROR',
    public data?: any
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

type ProcedureType = 'query' | 'mutation' | 'subscription' | 'channel';

export interface Procedure<TInput, TOutput, TType extends ProcedureType, TContext> {
  _type: TType;
  _input: TInput;
  _output: TOutput;
  _ctx: TContext;
  (opts: { input: TInput; ctx: TContext; path: string; emit?: (data: TOutput) => void; onData?: (listener: (data: any) => void) => void; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }): Promise<any>;
}

export type AnyProcedure = Procedure<any, any, any, any>;
export type AnyRouter = { [key: string]: AnyProcedure | AnyRouter };

export type Middleware<TInput, TContext, TNewContext> = (opts: {
  input: TInput;
  ctx: TContext;
  path: string;
  type: ProcedureType;
  signal?: AbortSignal;
  broadcast: { invalidate: (path: string) => void };
  next: (opts?: { ctx: TNewContext }) => Promise<any>;
}) => Promise<any>;

export class ProcedureBuilder<TInput = void, TContext = any> {
  private schema?: ZodType<any>;
  private middlewares: Middleware<any, any, any>[] = [];

  constructor(schema?: ZodType<TInput>, middlewares: Middleware<any, any, any>[] = []) {
    this.schema = schema;
    this.middlewares = middlewares;
  }

  input<TNewInput>(schema: ZodType<TNewInput>): ProcedureBuilder<TNewInput, TContext> {
    return new ProcedureBuilder<TNewInput, TContext>(schema, [...this.middlewares]);
  }

  use<TNewContext>(middleware: Middleware<TInput, TContext, TNewContext>): ProcedureBuilder<TInput, TNewContext> {
    return new ProcedureBuilder<TInput, TNewContext>(this.schema, [...this.middlewares, middleware]);
  }

  query<TOutput>(resolver: (opts: { input: TInput; ctx: TContext; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'query', TContext> {
    return this.createProcedure('query', resolver);
  }

  mutation<TOutput>(resolver: (opts: { input: TInput; ctx: TContext; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'mutation', TContext> {
    return this.createProcedure('mutation', resolver);
  }

  subscription<TOutput>(resolver: (opts: { input: TInput; ctx: TContext; emit: (data: TOutput) => void; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => Promise<void | (() => void)> | void | (() => void)): Procedure<TInput, TOutput, 'subscription', TContext> {
    return this.createProcedure('subscription', resolver as any);
  }

  channel<TOutput>(resolver: (opts: { input: TInput; ctx: TContext; emit: (data: TOutput) => void; onData: (listener: (data: any) => void) => void; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => Promise<void | (() => void)> | void | (() => void)): Procedure<TInput, TOutput, 'channel', TContext> {
    return this.createProcedure('channel', resolver as any);
  }

  private createProcedure<TOutput, TType extends ProcedureType>(
    type: TType,
    resolver: (opts: { input: TInput; ctx: TContext; emit: (data: any) => void; onData: (listener: (data: any) => void) => void; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => any
  ): Procedure<TInput, TOutput, TType, TContext> {
    const procedure = async (opts: { input: TInput; ctx: TContext; path: string; emit?: (data: TOutput) => void; onData?: (listener: (data: any) => void) => void; signal?: AbortSignal; broadcast: { invalidate: (path: string) => void } }) => {
      let validInput = opts.input;
      if (this.schema) {
        validInput = await this.schema.parseAsync(opts.input);
      }

      // Chain middlewares
      const callRecursive = async (index: number, currentCtx: any): Promise<any> => {
        if (index >= this.middlewares.length) {
          return resolver({ input: validInput, ctx: currentCtx, emit: opts.emit || (() => {}), onData: opts.onData || (() => {}), signal: opts.signal, broadcast: opts.broadcast });
        }

        const middleware = this.middlewares[index];
        return middleware({
          input: validInput,
          ctx: currentCtx,
          path: opts.path,
          type: type,
          signal: opts.signal,
          broadcast: opts.broadcast,
          next: (nextOpts?: { ctx: any }) => callRecursive(index + 1, nextOpts?.ctx ?? currentCtx),
        });
      };

      return callRecursive(0, opts.ctx);
    };

    procedure._type = type;
    procedure._input = null as unknown as TInput;
    procedure._output = null as unknown as TOutput;
    procedure._ctx = null as unknown as TContext;

    return procedure as any;
  }
}

export function initIpc<TContext = { event: IpcMainInvokeEvent }>() {
  return {
    procedure: new ProcedureBuilder<void, TContext>(),
    router<TRouter extends AnyRouter>(routerObj: TRouter): TRouter {
      return routerObj;
    },
    middleware<TNewContext = TContext>(
      fn: Middleware<any, TContext, TNewContext>
    ) {
      return fn;
    }
  };
}

export function createIpcStore<T extends Record<string, any>>(initialState: T) {
  let state = { ...initialState };
  const subscribers: Set<(state: T) => void> = new Set();

  return {
    get: () => state,
    set: (newState: Partial<T> | ((prev: T) => Partial<T>)) => {
      const updates = typeof newState === 'function' ? newState(state) : newState;
      state = { ...state, ...updates };
      subscribers.forEach(sub => sub(state));
    },
    subscribe: (callback: (state: T) => void) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}

export function bindIpcStore<T extends Record<string, any>>(
  ipcMain: IpcMain,
  storeName: string,
  store: ReturnType<typeof createIpcStore<T>>,
  options: { webContents?: any } = {}
) {
  const wContents = options.webContents || (() => {
    try {
      return require('electron').webContents;
    } catch {
      return null;
    }
  })();

  const broadcast = (state: T) => {
    if (wContents && wContents.getAllWebContents) {
      wContents.getAllWebContents().forEach((wc: any) => {
        wc.send(`__ipc_store_${storeName}_update`, state);
      });
    }
  };

  store.subscribe(broadcast);

  ipcMain.handle(`__ipc_store_${storeName}_get`, () => store.get());
  
  ipcMain.handle(`__ipc_store_${storeName}_set`, (_event, updates: Partial<T>) => {
    store.set(updates);
    return store.get();
  });
}

const registeredProcedures = new Map<string, AnyProcedure>();
const globalActiveRequests = new Map<string, AbortController>();

export function bindIpcRouter(
  ipcMain: IpcMain,
  router: AnyRouter,
  createContext?: (event: IpcMainInvokeEvent) => any | Promise<any>,
  options: { webContents?: any } = {},
  path = ''
) {
  const wContents = options.webContents || (() => {
    try {
      return require('electron').webContents;
    } catch {
      return null;
    }
  })();

  const broadcast = {
    invalidate: (queryKey: string) => {
      if (wContents && wContents.getAllWebContents) {
        wContents.getAllWebContents().forEach((wc: any) => {
          wc.send('__ipc_invalidate', queryKey);
        });
      }
    }
  };

  if (path === '') {
    try {
      ipcMain.removeHandler('__ipc_batch');
    } catch (e) {}

    ipcMain.handle('__ipc_batch', async (event, requests: Array<{ channel: string, input: any, invokeId?: string }>) => {
      const results = await Promise.all(requests.map(async (req) => {
        const procedure = registeredProcedures.get(req.channel);
        if (!procedure) return { error: `Procedure ${req.channel} not found` };
        
        let controller: AbortController | undefined;
        if (req.invokeId) {
          controller = new AbortController();
          globalActiveRequests.set(req.invokeId, controller);
        }

        try {
          const ctx = createContext ? await createContext(event) : { event };
          const result = await procedure({ 
            input: req.input, 
            ctx, 
            path: req.channel,
            signal: controller?.signal,
            broadcast
          });
          return { data: result };
        } catch (e: any) {
          if (e && e.name === 'ZodError' && e.issues) {
            return { error: 'Validation failed', code: 'BAD_REQUEST', data: e.issues };
          }
          if (e instanceof IpcError) {
            return { error: e.message, code: e.code, data: e.data };
          }
          return { error: e.message || 'Unknown error' };
        } finally {
          if (req.invokeId) {
            globalActiveRequests.delete(req.invokeId);
          }
        }
      }));
      return results;
    });
  }

  for (const [key, value] of Object.entries(router)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Check if it's a procedure or a sub-router
    if (typeof value === 'function' && '_type' in value) {
      const procedure = value as AnyProcedure;
      registeredProcedures.set(currentPath, procedure);
      
      if (procedure._type === 'query' || procedure._type === 'mutation') {
        // Listen for explicit abort messages from the renderer
        ipcMain.on(`${currentPath}.abort`, (_event, invokeId: string) => {
          const controller = globalActiveRequests.get(invokeId);
          if (controller) {
            controller.abort();
            globalActiveRequests.delete(invokeId);
          }
        });

        ipcMain.handle(currentPath, async (event, input, invokeId?: string) => {
          let controller: AbortController | undefined;
          
          if (invokeId) {
            controller = new AbortController();
            globalActiveRequests.set(invokeId, controller);
          }

          try {
            const ctx = createContext ? await createContext(event) : { event };
            const result = await procedure({ 
              input, 
              ctx, 
              path: currentPath,
              signal: controller?.signal,
              broadcast
            });
            return { data: result };
          } catch (e: any) {
            if (e && e.name === 'ZodError' && e.issues) {
              return {
                error: 'Validation failed',
                code: 'BAD_REQUEST',
                data: e.issues
              };
            }
            if (e instanceof IpcError) {
              return { 
                error: e.message, 
                code: e.code, 
                data: e.data 
              };
            }
            return { error: e.message || 'Unknown error' };
          } finally {
            if (invokeId) {
              globalActiveRequests.delete(invokeId);
            }
          }
        });
      } else if (procedure._type === 'subscription' || procedure._type === 'channel') {
        const activeSubscriptions = new Map<string, () => void>();
        const activeListeners = new Map<string, (data: any) => void>();

        ipcMain.on(currentPath, async (event, payload) => {
          try {
            if (payload && payload.__action === 'subscribe') {
              const { __subId, input } = payload;
              const ctx = createContext ? await createContext(event as any) : { event };
              const emit = (data: any) => {
                if (event.sender && !event.sender.isDestroyed()) {
                  event.sender.send(currentPath, { __subId, payload: data });
                }
              };
              
              const onData = (listener: (data: any) => void) => {
                activeListeners.set(__subId, listener);
              };
              
              const cleanup = await procedure({ input, ctx, path: currentPath, emit, onData, broadcast });
              
              if (typeof cleanup === 'function') {
                const destroyListener = () => {
                  const cleanupFn = activeSubscriptions.get(__subId);
                  if (cleanupFn) {
                    cleanupFn();
                    activeSubscriptions.delete(__subId);
                    activeListeners.delete(__subId);
                  }
                };
                event.sender.once('destroyed', destroyListener);
                
                activeSubscriptions.set(__subId, () => {
                  event.sender.removeListener('destroyed', destroyListener);
                  activeListeners.delete(__subId);
                  cleanup();
                });
              }
            } else if (payload && payload.__action === 'unsubscribe') {
              const { __subId } = payload;
              const cleanup = activeSubscriptions.get(__subId);
              if (cleanup) {
                cleanup();
                activeSubscriptions.delete(__subId);
                activeListeners.delete(__subId);
              }
            } else if (payload && payload.__action === 'send') {
               const { __subId, data } = payload;
               const listener = activeListeners.get(__subId);
               if (listener) {
                 listener(data);
               }
            } else {
              // Legacy support for basic subscription calls without teardown wrapper
              const ctx = createContext ? await createContext(event as any) : { event };
              const emit = (data: any) => {
                if (event.sender && !event.sender.isDestroyed()) {
                  event.sender.send(currentPath, data);
                }
              };
              await procedure({ input: payload, ctx, path: currentPath, emit, broadcast });
            }
          } catch (error) {
            console.error(`Error in subscription ${currentPath}:`, error);
          }
        });
      }
    } else {
      // Nested router
      bindIpcRouter(ipcMain, value as AnyRouter, createContext, options, currentPath);
    }
  }
}

