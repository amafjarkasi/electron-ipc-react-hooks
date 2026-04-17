import { expect, test, vi } from 'vitest';
import { initIpc, bindIpcRouter, IpcError } from './main';
import { z } from 'zod';

test('middleware flow and context injection', async () => {
  const t = initIpc<{ user: string; role?: string }>();
  
  const middleware1 = t.middleware(async ({ next, ctx, path, type }) => {
    expect(path).toBe('ping');
    expect(type).toBe('query');
    return next({ ctx: { ...ctx, user: ctx.user + '_verified' } });
  });

  const middleware2 = t.middleware(async ({ next, ctx }) => {
    return next({ ctx: { ...ctx, role: 'admin' } });
  });

  const appRouter = t.router({
    ping: t.procedure.use(middleware1).use(middleware2).query(({ ctx }) => `pong_${ctx.user}_${ctx.role}`)
  });

  // Test internal execution
  const res = await appRouter.ping({ input: undefined, ctx: { user: 'john' }, path: 'ping' });
  expect(res).toBe('pong_john_verified_admin');
});

test('nested router binding and deep execution', async () => {
  const t = initIpc();
  
  const deepRouter = t.router({
    greet: t.procedure.input(z.string()).query(({ input }) => `Hello ${input}`)
  });

  const subRouter = t.router({
    hello: t.procedure.query(() => 'world'),
    deep: deepRouter
  });
  
  const appRouter = t.router({
    api: subRouter
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);

  // Should have bound to 'api.hello' and 'api.deep.greet'
  expect(mockIpcMain.handle).toHaveBeenCalledWith('api.hello', expect.any(Function));
  expect(mockIpcMain.handle).toHaveBeenCalledWith('api.deep.greet', expect.any(Function));

  // Extract the handler for api.deep.greet and test it
  const greetHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'api.deep.greet')[1];
  
  const res = await greetHandler({} as any, 'Alice');
  expect(res).toEqual({ data: 'Hello Alice' });
});

test('zod validation in Version 1.1', async () => {
  const t = initIpc();
  const appRouter = t.router({
    sum: t.procedure
      .input(z.object({ a: z.number(), b: z.number() }))
      .query(({ input }) => input.a + input.b)
  });

  const res = await appRouter.sum({ input: { a: 10, b: 5 }, ctx: {} as any, path: 'sum' });
  expect(res).toBe(15);

  await expect(appRouter.sum({ input: { a: '10' } as any, ctx: {} as any, path: 'sum' })).rejects.toThrow();
});

test('IpcError serialization', async () => {
  const t = initIpc();
  const appRouter = t.router({
    fail: t.procedure.query(() => {
      throw new IpcError('Unauthorized', 'UNAUTHORIZED', { reason: 'bad token' });
    })
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);
  
  const failHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'fail')[1];
  const res = await failHandler({} as any, undefined);
  
  expect(res).toEqual({
    error: 'Unauthorized',
    code: 'UNAUTHORIZED',
    data: { reason: 'bad token' }
  });
});
