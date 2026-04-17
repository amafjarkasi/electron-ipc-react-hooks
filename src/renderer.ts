import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';

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

type ProcedureType = 'query' | 'mutation' | 'subscription';

type AnyProcedure = { 
  _input: any; 
  _output: any; 
  _type: ProcedureType;
};

type AnyRouter = { [key: string]: AnyProcedure | AnyRouter };

export type ReactIpcClient<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends AnyProcedure
    ? (TRouter[K]['_type'] extends 'query'
        ? {
            useQuery: (
              input: TRouter[K]['_input'],
              options?: Omit<UseQueryOptions<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>, 'queryKey' | 'queryFn'>
            ) => ReturnType<typeof useQuery<TRouter[K]['_output'], Error, TRouter[K]['_output'], any>>;
          }
        : TRouter[K]['_type'] extends 'mutation'
        ? {
            useMutation: (
              options?: Omit<UseMutationOptions<TRouter[K]['_output'], Error, TRouter[K]['_input'], any>, 'mutationFn'>
            ) => ReturnType<typeof useMutation<TRouter[K]['_output'], Error, TRouter[K]['_input'], any>>;
          }
        : never)
    : TRouter[K] extends AnyRouter
    ? ReactIpcClient<TRouter[K]>
    : never;
};

export function createReactIpc<TRouter extends AnyRouter>(apiKey = 'electronIpc'): ReactIpcClient<TRouter> {
  const createProxy = (path: string[]): any => {
    return new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'useQuery') {
          return (input: any, options?: any) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            return useQuery({
              queryKey: [channel, input],
              queryFn: async () => {
                const res = await api.invoke(channel, input);
                if (res && res.error) {
                  throw new IpcError(res.error, res.code, res.data);
                }
                return res ? res.data : undefined;
              },
              ...options,
            });
          };
        }

        if (prop === 'useMutation') {
          return (options?: any) => {
            const api = (window as any)[apiKey];
            if (!api) throw new Error(`Could not find window.${apiKey}`);
            const channel = path.join('.');
            return useMutation({
              mutationFn: async (input: any) => {
                const res = await api.invoke(channel, input);
                if (res && res.error) {
                  throw new IpcError(res.error, res.code, res.data);
                }
                return res ? res.data : undefined;
              },
              ...options,
            });
          };
        }

        return createProxy([...path, prop]);
      }
    });
  };

  return createProxy([]);
}
