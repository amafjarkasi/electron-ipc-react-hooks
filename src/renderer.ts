import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';

type AnyProcedure = { _input: any; _output: any; _type: string };
type AnyRouter = Record<string, AnyProcedure>;

export type ReactIpcClient<TRouter extends AnyRouter> = {
  [K in keyof TRouter]: TRouter[K] extends { _type: 'query', _input: infer I, _output: infer O }
    ? {
        useQuery: (
          input: I,
          options?: Omit<UseQueryOptions<O, Error, O, any>, 'queryKey' | 'queryFn'>
        ) => ReturnType<typeof useQuery<O, Error, O, any>>;
      }
    : TRouter[K] extends { _type: 'mutation', _input: infer I, _output: infer O }
    ? {
        useMutation: (
          options?: Omit<UseMutationOptions<O, Error, I, any>, 'mutationFn'>
        ) => ReturnType<typeof useMutation<O, Error, I, any>>;
      }
    : never;
};

export function createReactIpc<TRouter extends AnyRouter>(apiKey = 'electronIpc'): ReactIpcClient<TRouter> {
  return new Proxy({} as ReactIpcClient<TRouter>, {
    get(_, channel: string) {
      return {
        useQuery: (input: any, options?: any) => {
          const api = (window as any)[apiKey];
          if (!api) throw new Error(`Could not find window.${apiKey}`);
          return useQuery({
            queryKey: [channel, input],
            queryFn: async () => {
              const res = await api.invoke(channel, input);
              if (res && res.error) throw new Error(res.error);
              return res ? res.data : undefined;
            },
            ...options,
          });
        },
        useMutation: (options?: any) => {
          const api = (window as any)[apiKey];
          if (!api) throw new Error(`Could not find window.${apiKey}`);
          return useMutation({
            mutationFn: async (input: any) => {
              const res = await api.invoke(channel, input);
              if (res && res.error) throw new Error(res.error);
              return res ? res.data : undefined;
            },
            ...options,
          });
        }
      };
    }
  });
}
