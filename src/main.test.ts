import { expect, test, vi } from 'vitest';
import { initIpc, bindIpcRouter } from './main';
import { z } from 'zod';

test('middleware and context injection', async () => {
  const t = initIpc<{ user: string }>();
  
  const middleware = t.procedure.use(async ({ next, ctx }) => {
    return next({ ctx: { user: (ctx as any).user + '_verified' } });
  });

  const appRouter = t.router({
    ping: middleware.query(({ ctx }) => `pong_${(ctx as any).user}`)
  });

  // Test internal execution
  const res = await appRouter.ping({ input: undefined, ctx: { user: 'john' } as any });
  expect(res).toBe('pong_john_verified');
});

test('nested router binding', async () => {
  const t = initIpc();
  const subRouter = t.router({
    hello: t.procedure.query(() => 'world')
  });
  
  const appRouter = t.router({
    api: subRouter
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);

  // Should have bound to 'api.hello'
  expect(mockIpcMain.handle).toHaveBeenCalledWith('api.hello', expect.any(Function));
});

test('zod validation in Version 1.1', async () => {
  const t = initIpc();
  const appRouter = t.router({
    sum: t.procedure
      .input(z.object({ a: z.number(), b: z.number() }))
      .query(({ input }) => input.a + input.b)
  });

  const res = await appRouter.sum({ input: { a: 10, b: 5 }, ctx: {} as any });
  expect(res).toBe(15);

  await expect(appRouter.sum({ input: { a: '10' } as any, ctx: {} as any })).rejects.toThrow();
});
