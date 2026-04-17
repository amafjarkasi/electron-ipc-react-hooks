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

type ProcedureType = 'query' | 'mutation' | 'subscription';

export interface Procedure<TInput, TOutput, TType extends ProcedureType, TContext> {
  _type: TType;
  _input: TInput;
  _output: TOutput;
  _ctx: TContext;
  (opts: { input: TInput; ctx: TContext }): Promise<TOutput>;
}

export type AnyProcedure = Procedure<any, any, any, any>;
export type AnyRouter = { [key: string]: AnyProcedure | AnyRouter };

export type Middleware<TInput, TContext, TNewContext> = (opts: {
  input: TInput;
  ctx: TContext;
  next: (opts: { ctx: TNewContext }) => Promise<any>;
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

  query<TOutput>(resolver: (opts: { input: TInput; ctx: TContext }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'query', TContext> {
    return this.createProcedure('query', resolver);
  }

  mutation<TOutput>(resolver: (opts: { input: TInput; ctx: TContext }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'mutation', TContext> {
    return this.createProcedure('mutation', resolver);
  }

  subscription<TOutput>(resolver: (opts: { input: TInput; ctx: TContext }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'subscription', TContext> {
    return this.createProcedure('subscription', resolver);
  }

  private createProcedure<TOutput, TType extends ProcedureType>(
    type: TType,
    resolver: (opts: { input: TInput; ctx: TContext }) => Promise<TOutput> | TOutput
  ): Procedure<TInput, TOutput, TType, TContext> {
    const procedure = async (opts: { input: TInput; ctx: TContext }) => {
      let validInput = opts.input;
      if (this.schema) {
        validInput = await this.schema.parseAsync(opts.input);
      }

      // Chain middlewares
      const callRecursive = async (index: number, currentCtx: any): Promise<any> => {
        if (index >= this.middlewares.length) {
          return resolver({ input: validInput, ctx: currentCtx });
        }

        const middleware = this.middlewares[index];
        return middleware({
          input: validInput,
          ctx: currentCtx,
          next: ({ ctx }) => callRecursive(index + 1, ctx),
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
    }
  };
}

export function bindIpcRouter(
  ipcMain: IpcMain,
  router: AnyRouter,
  createContext?: (event: IpcMainInvokeEvent) => any | Promise<any>,
  path = ''
) {
  for (const [key, value] of Object.entries(router)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Check if it's a procedure or a sub-router
    if (typeof value === 'function' && '_type' in value) {
      const procedure = value as AnyProcedure;
      
      if (procedure._type === 'query' || procedure._type === 'mutation') {
        ipcMain.handle(currentPath, async (event, input) => {
          try {
            const ctx = createContext ? await createContext(event) : { event };
            const result = await procedure({ input, ctx });
            return { data: result };
          } catch (e: any) {
            if (e instanceof IpcError) {
              return { 
                error: e.message, 
                code: e.code, 
                data: e.data 
              };
            }
            return { error: e.message || 'Unknown error' };
          }
        });
      } else if (procedure._type === 'subscription') {
        ipcMain.on(currentPath, async (event, input) => {
          try {
            const ctx = createContext ? await createContext(event) : { event };
            await procedure({ input, ctx });
          } catch (error) {
            console.error(`Error in subscription ${currentPath}:`, error);
          }
        });
      }
    } else {
      // Nested router
      bindIpcRouter(ipcMain, value as AnyRouter, createContext, currentPath);
    }
  }
}
