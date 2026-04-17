import type { ZodType } from "zod";
import type { IpcMain } from "electron";

export type AnyProcedure = Procedure<any, any, any>;
export type AnyRouter = Record<string, AnyProcedure>;

export interface Procedure<TInput, TOutput, TType extends 'query' | 'mutation' | 'subscription'> {
  _type: TType;
  _input: TInput;
  _output: TOutput;
  (opts: { input: TInput, event?: any }): Promise<TOutput>;
}

export class ProcedureBuilder<TInput = void> {
  private schema?: ZodType<any>;

  input<TNewInput>(schema: ZodType<TNewInput>): ProcedureBuilder<TNewInput> {
    const builder = new ProcedureBuilder<TNewInput>();
    builder.schema = schema;
    return builder;
  }

  query<TOutput>(resolver: (opts: { input: TInput, event?: any }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'query'> {
    return this.createProcedure('query', resolver);
  }

  mutation<TOutput>(resolver: (opts: { input: TInput, event?: any }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'mutation'> {
    return this.createProcedure('mutation', resolver);
  }

  subscription<TOutput>(resolver: (opts: { input: TInput, event?: any }) => Promise<TOutput> | TOutput): Procedure<TInput, TOutput, 'subscription'> {
    return this.createProcedure('subscription', resolver);
  }

  private createProcedure<TOutput, TType extends 'query' | 'mutation' | 'subscription'>(
    type: TType,
    resolver: (opts: { input: TInput, event?: any }) => Promise<TOutput> | TOutput
  ): Procedure<TInput, TOutput, TType> {
    const procedure = async (opts: { input: TInput, event?: any }) => {
      let validInput = opts.input;
      if (this.schema) {
        validInput = await this.schema.parseAsync(opts.input);
      }
      return resolver({ ...opts, input: validInput });
    };

    procedure._type = type;
    procedure._input = null as unknown as TInput;
    procedure._output = null as unknown as TOutput;

    return procedure as any;
  }
}

export function initIpc() {
  return {
    procedure: new ProcedureBuilder(),
    router<TRouter extends AnyRouter>(routerObj: TRouter): TRouter {
      return routerObj;
    }
  };
}

export function bindIpcRouter(ipcMain: IpcMain, router: AnyRouter) {
  for (const [channel, procedure] of Object.entries(router)) {
    if (procedure._type === 'query' || procedure._type === 'mutation') {
      ipcMain.handle(channel, async (event, input) => {
        try {
          const result = await procedure({ input, event });
          return { data: result };
        } catch (error: any) {
          return { error: error.message || 'Unknown error' };
        }
      });
    } else if (procedure._type === 'subscription') {
      ipcMain.on(channel, async (event, input) => {
         try {
           await procedure({ input, event });
         } catch (error) {
           console.error(`Error in subscription ${channel}:`, error);
         }
      });
    }
  }
}
