export type ProcedureType = 'query' | 'mutation' | 'subscription' | 'channel';

export interface Procedure<TInput, TOutput, TType extends ProcedureType, TContext> {
  _type: TType;
  _input: TInput;
  _output: TOutput;
  _ctx: TContext;
  (opts: {
    input: TInput;
    ctx: TContext;
    path: string;
    emit?: (data: TOutput) => void;
    onData?: (listener: (data: any) => void) => void;
    signal?: AbortSignal;
    broadcast: { invalidate: (path: string) => void };
  }): Promise<any>;
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