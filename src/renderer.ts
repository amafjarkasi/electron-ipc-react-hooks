import { useQuery, useMutation, useInfiniteQuery, type UseQueryOptions, type UseMutationOptions, type UseInfiniteQueryOptions, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';

export class IpcError extends Error {
  constructor(
    public message: string,
    public code?: string,
    public data?: any
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

export function createReactIpcStore<T>(storeName: string, initialState: T, apiKey = 'electronIpc') {
  return function useIpcStore(): [T, (updates: Partial<T> | ((prev: T) => Partial<T>)) => void, () => void] {
    const api = (window as any)[apiKey];
    const [state, setState] = useState<T>(initialState);

    useEffect(() => {
      if (!api) return;

      // Fetch actual state from main process
      api.invoke(`__ipc_store_${storeName}_get`).then((s: T) => {
        if (s) setState(s);
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
    }, []);

    const updateState = useCallback((updates: Partial<T> | ((prev: T) => Partial<T>)) => {
      if (!api) return;
      setState((prev) => {
        const nextUpdates = typeof updates === 'function' ? (updates as any)(prev) : updates;
        const nextState = { ...prev, ...nextUpdates };
        api.invoke(`__ipc_store_${storeName}_set`, nextUpdates);
        return nextState;
      });
    }, []);

    const resetState = useCallback(() => {
      if (!api) return;
      api.invoke(`__ipc_store_${storeName}_reset`).then((s: T) => {
        if (s) setState(s);
      });
    }, []);

    return [state, updateState, resetState];
  };
}

type ProcedureType = 'query' | 'mutation' | 'subscription' | 'channel';

type AnyProcedure = { 
  _input: any; 
  _output: any; 
  _type: ProcedureType;
};

type AnyRouter = { [key: string]: AnyProcedure | AnyRouter };

export type ReactIpcClient<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
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
    : TRouter[K] extends AnyRouter
    ? ReactIpcClient<TRouter[K]>
    : never;
};

export function useIpcInvalidator(queryClient: QueryClient, apiKey = 'electronIpc') {
  useEffect(() => {
    const api = (window as any)[apiKey];
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
  }, [queryClient, apiKey]);
}

export function createReactIpc<TRouter extends AnyRouter>(
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
          req.reject(new IpcError(res.error, res.code, res.data));
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
          throw new IpcError(res.error, res.code, res.data);
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
            return useQuery({
              queryKey: [channel, input],
              queryFn: async ({ signal }: { signal?: AbortSignal }) => {
                const invokeId = Math.random().toString(36).substring(7);
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
            return useInfiniteQuery({
              queryKey: [channel, input],
              queryFn: async ({ pageParam, signal }: { pageParam?: any, signal?: AbortSignal }) => {
                const invokeId = Math.random().toString(36).substring(7);
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
                const invokeId = Math.random().toString(36).substring(7);
                return await invokeProcedure(api, channel, input, invokeId, false);
              },
              ...mutationOptions,
            });
          };
        }

        if (prop === 'useSubscription') {
          return (input: any, options?: { onData: (data: any) => void }) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');

            useEffect(() => {
              const subId = Math.random().toString(36).substring(7);

              const listener = (_event: any, data: any) => {
                if (data && typeof data === 'object' && data.__subId === subId) {
                  options?.onData?.(data.payload);
                } else if (data && data.__subId === undefined) {
                  // Legacy fallback if the main process didn't wrap the payload
                  options?.onData?.(data);
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
            }, [channel, JSON.stringify(input)]); // Basic deep comparison equivalent or reference dependency
          };
        }

        if (prop === 'useChannel') {
          return (input: any, options?: { onData?: (data: any) => void }) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            
            const [subId] = useState(() => Math.random().toString(36).substring(7));

            useEffect(() => {
              const listener = (_event: any, data: any) => {
                if (data && typeof data === 'object' && data.__subId === subId) {
                  options?.onData?.(data.payload);
                } else if (data && data.__subId === undefined) {
                  options?.onData?.(data);
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
            }, [channel, JSON.stringify(input)]);

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
