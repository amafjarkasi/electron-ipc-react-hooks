import { expect, test, vi } from 'vitest';
import { initIpc, bindIpcRouter, IpcError, createIpcStore, bindIpcStore } from './main';
import { z } from 'zod';

test('createIpcStore synchronizes state', async () => {
  const store = createIpcStore({ theme: 'dark', volume: 50 });
  expect(store.get().theme).toBe('dark');
  
  store.set({ theme: 'light' });
  expect(store.get().theme).toBe('light');

  store.reset();
  expect(store.get().theme).toBe('dark');
  expect(store.get().volume).toBe(50);

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  let broadcastedState = null;
  const mockWebContents = {
    getAllWebContents: () => [
      { send: (channel: string, payload: any) => { if (channel === '__ipc_store_settings_update') broadcastedState = payload; } }
    ]
  };

  bindIpcStore(mockIpcMain, 'settings', store, { webContents: mockWebContents as any });
  
  const getHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === '__ipc_store_settings_get')[1];
  const setHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === '__ipc_store_settings_set')[1];
  const resetHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === '__ipc_store_settings_reset')[1];
  
  const resGet = await getHandler({} as any);
  expect(resGet).toEqual({ theme: 'dark', volume: 50 });

  const resSet = await setHandler({} as any, { volume: 100 });
  expect(resSet).toEqual({ theme: 'dark', volume: 100 });
  expect(store.get().volume).toBe(100);
  expect(broadcastedState).toEqual({ theme: 'dark', volume: 100 });

  const resReset = await resetHandler({} as any);
  expect(resReset).toEqual({ theme: 'dark', volume: 50 });
  expect(store.get().volume).toBe(50);
});

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
  const res = await appRouter.ping({ input: undefined, ctx: { user: 'john' }, path: 'ping', broadcast: { invalidate: () => {} } });
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

  const res = await appRouter.sum({ input: { a: 10, b: 5 }, ctx: {} as any, path: 'sum', broadcast: { invalidate: () => {} } });
  expect(res).toBe(15);

  await expect(appRouter.sum({ input: { a: '10' } as any, ctx: {} as any, path: 'sum', broadcast: { invalidate: () => {} } })).rejects.toThrow();
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

test('AbortSignal cancellation', async () => {
  const t = initIpc();
  
  let wasAborted = false;
  
  const appRouter = t.router({
    slowThing: t.procedure.query(async ({ signal }) => {
      // Simulate waiting for something, checking signal
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) {
        wasAborted = true;
        throw new Error('Aborted');
      }
      return 'done';
    })
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);
  
  const slowHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'slowThing')[1];
  const abortHandler = mockIpcMain.on.mock.calls.find((c: any) => c[0] === 'slowThing.abort')[1];
  
  const invokeId = 'test-invoke-123';
  
  // Start the handler
  const promise = slowHandler({} as any, undefined, invokeId);
  
  // Trigger abort before the promise resolves
  abortHandler({} as any, invokeId);
  
  const res = await promise;
  
  expect(wasAborted).toBe(true);
  expect(res).toEqual({
    error: 'Aborted'
  });
});

test('Pub/Sub Cross-Window Broadcast Invalidation', async () => {
  const t = initIpc();
  
  const appRouter = t.router({
    updateSettings: t.procedure.mutation(({ broadcast }) => {
      broadcast.invalidate('getSettings');
      return true;
    })
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn()
  } as any;

  let broadcastedPayload = null;
  const mockWebContents = {
    getAllWebContents: () => [
      { send: (channel: string, payload: any) => { if (channel === '__ipc_invalidate') broadcastedPayload = payload; } }
    ]
  };

  // We pass mockWebContents as an option so we don't need a real Electron environment in Vitest
  bindIpcRouter(mockIpcMain, appRouter, undefined, { webContents: mockWebContents as any });
  
  const updateHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'updateSettings')[1];
  
  const res = await updateHandler({} as any, undefined, 'invoke-2');
  
  expect(res).toEqual({ data: true });
  expect(broadcastedPayload).toBe('getSettings');
});

test('batch IPC requests', async () => {
  const t = initIpc();
  
  const appRouter = t.router({
    getA: t.procedure.query(() => 'A'),
    getB: t.procedure.input(z.string()).query(({ input }) => `B-${input}`)
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn()
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);
  
  const batchHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === '__ipc_batch')[1];
  
  const requests = [
    { channel: 'getA', input: undefined, invokeId: '1' },
    { channel: 'getB', input: 'test', invokeId: '2' },
    { channel: 'missing', input: null, invokeId: '3' }
  ];
  
  const res = await batchHandler({} as any, requests);
  
  expect(res).toEqual([
    { data: 'A' },
    { data: 'B-test' },
    { error: 'Procedure missing not found' }
  ]);
});

