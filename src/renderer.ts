import { useQuery, useMutation, useInfiniteQuery, type UseQueryOptions, type UseMutationOptions, type UseInfiniteQueryOptions, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { IpcError } from './errors';
import type { ProcedureType, AnyProcedure, AnyRouter } from './types';

export { IpcError } from './errors';

/**
 * Type-safe error class for IPC responses on the renderer side.
 * Carries a machine-readable `code` and optional `data` payload,
 * enabling pattern-matching in UI error handling.
 */
export class IpcTypedError extends Error {
  /** Machine-readable error code (e.g., 'UNAUTHORIZED', 'RATE_LIMITED', 'BAD_REQUEST') */
  readonly code: string;
  /** Additional structured data about the error */
  readonly data?: any;

  constructor(message: string, code: string = 'UNKNOWN', data?: any) {
    super(message);
    this.name = 'IpcTypedError';
    this.code = code;
    this.data = data;
  }

  /** Serialize to a plain object for logging/transmission */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      data: this.data,
    };
  }
}

/**
 * Create an IpcTypedError from a raw IPC error response object.
 */
export function createIpcErrorFromResponse(response: { error: string; code?: string; data?: any }): IpcTypedError {
  return new IpcTypedError(response.error, response.code ?? 'UNKNOWN', response.data);
}

/**
 * Generate a unique subscription ID using crypto.randomUUID when available,
 * with a fallback to a timestamp + random string.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Create a React hook that connects to an IpcStore in the main process.
 * @param storeName - Unique name matching the store bound in main.
 * @param initialState - Fallback initial state before main process responds.
 * @param apiKey - The window property name where the IPC API is exposed.
 */
export function createReactIpcStore<T extends Record<string, any>>(storeName: string, initialState: T, apiKey = 'electronIpc') {
  return function useIpcStore(): [T, (updates: Partial<T> | ((prev: T) => Partial<T>)) => void, () => void] {
    const api = (window as any)[apiKey];
    const [state, setState] = useState<T>(initialState);

    useEffect(() => {
      if (!api) return;

      // Fetch actual state from main process
      api.invoke(`__ipc_store_${storeName}_get`).then((s: T) => {
        if (s) setState(s);
      }).catch(() => {
        // Main process store not available — keep initial state
      });

      const listener = (_event: any, newState: T) => {
        setState(newState);
      };

      if (api.on && api.off) {
        api.on(`__ipc_store_${storeName}_update`, listener);
        return () => {
          api.off(`__ipc_store_${storeName}_update`, listener);
        };
      }
    }, [apiKey]);

    const updateState = useCallback((updates: Partial<T> | ((prev: T) => Partial<T>)) => {
      if (!api) return;
      setState((prev) => {
        const nextUpdates = typeof updates === 'function' ? (updates as any)(prev) : updates;
        const nextState = { ...prev, ...nextUpdates };
        // Fire-and-forget with error rollback
        api.invoke(`__ipc_store_${storeName}_set`, nextUpdates).catch(() => {
          // Roll back to server state on failure
          api.invoke(`__ipc_store_${storeName}_get`).then((s: T) => {
            if (s) setState(s);
          });
        });
        return nextState;
      });
    }, [api]);

    const resetState = useCallback(() => {
      if (!api) return;
      api.invoke(`__ipc_store_${storeName}_reset`).then((s: T) => {
        if (s) setState(s);
      });
    }, [api]);

    return [state, updateState, resetState];
  };
}

type RendererAnyProcedure = { 
  _input: any; 
  _output: any; 
  _type: ProcedureType;
};

type RendererAnyRouter = { [key: string]: RendererAnyProcedure | RendererAnyRouter };

export type ReactIpcClient<TRouter extends RendererAnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends RendererAnyProcedure
    ? (TRouter[K]['_type'] extends 'query'
        ? (TRouter[K]['_input'] extends void | undefined
            ? {
                useQuery: (
                  input?: TRouter[K]['_input'],
                  options?: Omit<UseQueryOptions<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>, 'queryKey' | 'queryFn'>
                ) => ReturnType<typeof useQuery<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>>;
                useInfiniteQuery: (
                  input?: TRouter[K]['_input'],
                  options?: Omit<UseInfiniteQueryOptions<TRouter[K]['_output'], Error, InfiniteData<TRouter[K]['_output']>, any, any>, 'queryKey' | 'queryFn'>
                ) => ReturnType<typeof useInfiniteQuery<TRouter[K]['_output'], Error, InfiniteData<TRouter[K]['_output']>, any, any>>;
              }
            : {
                useQuery: (
                  input: TRouter[K]['_input'],
                  options?: Omit<UseQueryOptions<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>, 'queryKey' | 'queryFn'>
                ) => ReturnType<typeof useQuery<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>>;
                useInfiniteQuery: (
                  input: Omit<TRouter[K]['_input'], 'cursor'>,
                  options?: Omit<UseInfiniteQueryOptions<TRouter[K]['_output'], Error, InfiniteData<TRouter[K]['_output']>, any, any>, 'queryKey' | 'queryFn'>
                ) => ReturnType<typeof useInfiniteQuery<TRouter[K]['_output'], Error, InfiniteData<TRouter[K]['_output']>, any, any>>;
              })
        : TRouter[K]['_type'] extends 'mutation'
        ? {
            useMutation: (
              options?: Omit<UseMutationOptions<TRouter[K]['_output'], Error, TRouter[K]['_input'], any>, 'mutationFn'>
            ) => ReturnType<typeof useMutation<TRouter[K]['_output'], Error, TRouter[K]['_input'], any>>;
          }
        : TRouter[K]['_type'] extends 'subscription'
        ? (TRouter[K]['_input'] extends void | undefined
            ? {
                useSubscription: (
                  input?: TRouter[K]['_input'],
                  options?: { onData: (data: TRouter[K]['_output']) => void }
                ) => void;
              }
            : {
                useSubscription: (
                  input: TRouter[K]['_input'],
                  options: { onData: (data: TRouter[K]['_output']) => void }
                ) => void;
              })
        : TRouter[K]['_type'] extends 'channel'
        ? (TRouter[K]['_input'] extends void | undefined
            ? {
                useChannel: (
                  input?: TRouter[K]['_input'],
                  options?: { onData?: (data: TRouter[K]['_output']) => void }
                ) => { send: (data: any) => void };
              }
            : {
                useChannel: (
                  input: TRouter[K]['_input'],
                  options?: { onData?: (data: TRouter[K]['_output']) => void }
                ) => { send: (data: any) => void };
              })
        : never)
    : TRouter[K] extends RendererAnyRouter
    ? ReactIpcClient<TRouter[K]>
    : never;
};

/**
 * React hook to listen for query invalidation events broadcast from the main process.
 * Automatically invalidates the corresponding queries in the QueryClient cache.
 * @param queryClient - The TanStack Query client instance.
 * @param apiKey - The window property name where the IPC API is exposed.
 */
export function useIpcInvalidator(queryClient: QueryClient, apiKey = 'electronIpc') {
  const apiRef = useRef((window as any)[apiKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const listener = (_event: any, queryKey: string) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    };

    if (api.on && api.off) {
      api.on('__ipc_invalidate', listener);
      return () => {
        api.off('__ipc_invalidate', listener);
      };
    }
  }, [queryClient]);
}

/**
 * Create a type-safe React IPC client from a router type.
 * Uses Proxy to create a chainable API that maps to TanStack React Query hooks.
 *
 * @param apiKey - The window property name where the IPC API is exposed (default: 'electronIpc').
 * @param options - Configuration options for batching behavior.
 */
export function createReactIpc<TRouter extends RendererAnyRouter>(
  apiKey = 'electronIpc',
  options: { batching?: boolean; batchingTimeout?: number } = { batching: true, batchingTimeout: 10 }
): ReactIpcClient<TRouter> {
  let batchQueue: Array<{ channel: string, input: any, invokeId: string, resolve: (val: any) => void, reject: (err: any) => void }> = [];
  let batchTimer: any = null;

  const dispatchBatch = (api: any) => {
    if (batchQueue.length === 0) return;
    const queueToProcess = batchQueue;
    batchQueue = [];
    batchTimer = null;

    const batchPayload = queueToProcess.map(req => ({ channel: req.channel, input: req.input, invokeId: req.invokeId }));
    
    api.invoke('__ipc_batch', batchPayload).then((batchResults: any[]) => {
      if (!Array.isArray(batchResults)) {
        // Fallback in case main process is an older version or doesn't support batching
        queueToProcess.forEach(req => req.reject(new Error('Batch IPC failed: Main process did not return an array')));
        return;
      }
      queueToProcess.forEach((req, index) => {
        const res = batchResults[index];
        if (res && res.error) {
          req.reject(createIpcErrorFromResponse(res));
        } else {
          req.resolve(res ? res.data : undefined);
        }
      });
    }).catch((e: any) => {
      queueToProcess.forEach(req => req.reject(e));
    });
  };

  const invokeProcedure = (api: any, channel: string, input: any, invokeId: string, isQuery: boolean) => {
    if (!options.batching || !isQuery) {
      return api.invoke(channel, input, invokeId).then((res: any) => {
        if (res && res.error) {
          throw createIpcErrorFromResponse(res);
        }
        return res ? res.data : undefined;
      });
    }

    return new Promise((resolve, reject) => {
      batchQueue.push({ channel, input, invokeId, resolve, reject });
      if (!batchTimer) {
        batchTimer = setTimeout(() => dispatchBatch(api), options.batchingTimeout || 10);
      }
    });
  };

  const createProxy = (path: string[]): any => {
    return new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'useQuery') {
          return (input: any, queryOptions?: any) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            // Memoize the serialized input key for stable query keys
            const inputKey = useMemo(() => JSON.stringify(input), [input]);
            return useQuery({
              queryKey: [channel, inputKey],
              queryFn: async ({ signal }: { signal?: AbortSignal }) => {
                const invokeId = generateId();
                const onAbort = () => {
                  if (api.send) api.send(`${channel}.abort`, invokeId);
                };

                if (signal) {
                  signal.addEventListener('abort', onAbort);
                }

                try {
                  return await invokeProcedure(api, channel, input, invokeId, true);
                } finally {
                  if (signal) {
                    signal.removeEventListener('abort', onAbort);
                  }
                }
              },
              ...queryOptions,
            });
          };
        }

        if (prop === 'useInfiniteQuery') {
          return (input: any, queryOptions?: any) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            const inputKey = useMemo(() => JSON.stringify(input), [input]);
            return useInfiniteQuery({
              queryKey: [channel, inputKey],
              queryFn: async ({ pageParam, signal }: { pageParam?: any, signal?: AbortSignal }) => {
                const invokeId = generateId();
                const onAbort = () => {
                  if (api.send) api.send(`${channel}.abort`, invokeId);
                };

                if (signal) {
                  signal.addEventListener('abort', onAbort);
                }

                try {
                  const finalInput = typeof input === 'object' && input !== null 
                    ? { ...input, cursor: pageParam } 
                    : (pageParam !== undefined ? pageParam : input);
                  return await invokeProcedure(api, channel, finalInput, invokeId, true);
                } finally {
                  if (signal) {
                    signal.removeEventListener('abort', onAbort);
                  }
                }
              },
              ...queryOptions,
            });
          };
        }

        if (prop === 'useMutation') {
          return (mutationOptions?: any) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            return useMutation({
              mutationFn: async (input: any) => {
                const invokeId = generateId();
                return await invokeProcedure(api, channel, input, invokeId, false);
              },
              ...mutationOptions,
            });
          };
        }

        if (prop === 'useSubscription') {
          return (input: any, subOptions?: { onData: (data: any) => void }) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            // Stable serialization of input for effect dependencies
            const inputKey = useMemo(() => JSON.stringify(input), [input]);

            useEffect(() => {
              const subId = generateId();

              const listener = (_event: any, data: any) => {
                if (data && typeof data === 'object' && data.__subId === subId) {
                  subOptions?.onData?.(data.payload);
                } else if (data && data.__subId === undefined) {
                  // Legacy fallback if the main process didn't wrap the payload
                  subOptions?.onData?.(data);
                }
              };

              api.on(channel, listener);
              // Trigger the subscription on the main process
              if (api.send) {
                api.send(channel, { __action: 'subscribe', __subId: subId, input });
              }

              return () => {
                api.off(channel, listener);
                if (api.send) {
                  api.send(channel, { __action: 'unsubscribe', __subId: subId });
                }
              };
            }, [channel, inputKey]);
          };
        }

        if (prop === 'useChannel') {
          return (input: any, channelOptions?: { onData?: (data: any) => void }) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            
            const [subId] = useState(() => generateId());
            const inputKey = useMemo(() => JSON.stringify(input), [input]);

            useEffect(() => {
              const listener = (_event: any, data: any) => {
                if (data && typeof data === 'object' && data.__subId === subId) {
                  channelOptions?.onData?.(data.payload);
                } else if (data && data.__subId === undefined) {
                  channelOptions?.onData?.(data);
                }
              };

              api.on(channel, listener);
              if (api.send) {
                api.send(channel, { __action: 'subscribe', __subId: subId, input });
              }

              return () => {
                api.off(channel, listener);
                if (api.send) {
                  api.send(channel, { __action: 'unsubscribe', __subId: subId });
                }
              };
            }, [channel, inputKey, subId]);

            const send = useCallback((data: any) => {
               if (api.send) {
                 api.send(channel, { __action: 'send', __subId: subId, data });
               }
            }, [api, channel, subId]);

            return { send };
          };
        }

        return createProxy([...path, prop]);
      }
    });
  };

  return createProxy([]);
}