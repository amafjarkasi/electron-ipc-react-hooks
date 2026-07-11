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
    on: vi.fn(),
    removeHandler: vi.fn()
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
    on: vi.fn(),
    removeHandler: vi.fn()
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
    on: vi.fn(),
    removeHandler: vi.fn()
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
    on: vi.fn(),
    removeHandler: vi.fn()
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

test('batch IPC resolves nested router procedures', async () => {
  const t = initIpc();
  const systemRouter = t.router({
    getInfo: t.procedure.query(() => ({ platform: 'test' })),
  });
  const appRouter = t.router({
    system: systemRouter,
    rootPing: t.procedure.query(() => 'pong'),
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  } as any;

  bindIpcRouter(mockIpcMain, appRouter);
  const batchHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === '__ipc_batch')[1];

  const res = await batchHandler({} as any, [
    { channel: 'system.getInfo', input: undefined, invokeId: 'n1' },
    { channel: 'rootPing', input: undefined, invokeId: 'n2' },
  ]);

  expect(res).toEqual([
    { data: { platform: 'test' } },
    { data: 'pong' },
  ]);
});

test('nested router dispose removes nested handlers', async () => {
  const t = initIpc();
  const appRouter = t.router({
    system: t.router({
      getInfo: t.procedure.query(() => 'ok'),
    }),
    ping: t.procedure.query(() => 'pong'),
  });

  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  } as any;

  const dispose = bindIpcRouter(mockIpcMain, appRouter);
  dispose();

  expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('__ipc_batch');
  expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('ping');
  expect(mockIpcMain.removeHandler).toHaveBeenCalledWith('system.getInfo');
});

test('bindIpcStore dispose unsubscribes broadcast', async () => {
  const store = createIpcStore({ theme: 'dark' });
  const mockIpcMain = {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  } as any;

  let sendCount = 0;
  const mockWebContents = {
    getAllWebContents: () => [
      { send: () => { sendCount++; } },
    ],
  };

  const dispose = bindIpcStore(mockIpcMain, 'settings', store, { webContents: mockWebContents as any });
  store.set({ theme: 'light' });
  expect(sendCount).toBe(1);

  dispose();
  store.set({ theme: 'dark' });
  expect(sendCount).toBe(1);
});

test('subscription cleanup on unsubscribe', async () => {
  const t = initIpc();
  let cleaned = false;
  const appRouter = t.router({
    clock: t.procedure.subscription(({ emit }) => {
      const id = setInterval(() => emit('tick'), 10);
      return () => {
        clearInterval(id);
        cleaned = true;
      };
    }),
  });

  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(handler);
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  } as any;

  const sender = {
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  bindIpcRouter(mockIpcMain, appRouter);
  const subHandler = listeners.get('clock')![0];

  await subHandler({ sender }, { __action: 'subscribe', __subId: 's1', input: undefined });
  await subHandler({ sender }, { __action: 'unsubscribe', __subId: 's1' });

  expect(cleaned).toBe(true);
});

test('channel send round-trip', async () => {
  const t = initIpc();
  const received: any[] = [];
  const appRouter = t.router({
    stream: t.procedure.channel(({ emit, onData }) => {
      onData((data) => {
        received.push(data);
        emit({ ack: data });
      });
      return () => {};
    }),
  });

  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(handler);
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  } as any;

  const sent: any[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_ch: string, payload: any) => sent.push(payload),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  bindIpcRouter(mockIpcMain, appRouter);
  const handler = listeners.get('stream')![0];

  await handler({ sender }, { __action: 'subscribe', __subId: 'c1', input: undefined });
  await handler({ sender }, { __action: 'send', __subId: 'c1', data: { bytes: 10 } });

  expect(received).toEqual([{ bytes: 10 }]);
  expect(sent).toEqual([{ __subId: 'c1', payload: { ack: { bytes: 10 } } }]);
});

test('subscription setup errors are sent to renderer as __error', async () => {
  const t = initIpc();
  const appRouter = t.router({
    clock: t.procedure.subscription(() => {
      throw new IpcError('No clock', 'NO_CLOCK', { reason: 'missing' });
    }),
  });

  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(handler);
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  } as any;

  const sent: any[] = [];
  const sender = {
    isDestroyed: () => false,
    send: (_ch: string, payload: any) => sent.push(payload),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  bindIpcRouter(mockIpcMain, appRouter);
  const subHandler = listeners.get('clock')![0];

  await subHandler({ sender }, { __action: 'subscribe', __subId: 's-err', input: undefined });

  expect(sent).toEqual([
    {
      __subId: 's-err',
      __error: { error: 'No clock', code: 'NO_CLOCK', data: { reason: 'missing' } },
    },
  ]);
  consoleSpy.mockRestore();
});

test('re-binding router without dispose does not duplicate subscription listeners', async () => {
  const t = initIpc();
  let subscribeCount = 0;
  const appRouter = t.router({
    clock: t.procedure.subscription(() => {
      subscribeCount++;
      return () => {};
    }),
  });

  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(handler);
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn((channel: string) => {
      listeners.set(channel, []);
    }),
  } as any;

  const sender = {
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  bindIpcRouter(mockIpcMain, appRouter);
  bindIpcRouter(mockIpcMain, appRouter);

  expect(mockIpcMain.removeAllListeners).toHaveBeenCalledWith('clock');
  expect(listeners.get('clock')).toHaveLength(1);

  await listeners.get('clock')![0]({ sender }, { __action: 'subscribe', __subId: 's1', input: undefined });
  expect(subscribeCount).toBe(1);
});

test('warns in development when subscription omits cleanup return', async () => {
  const t = initIpc();
  const appRouter = t.router({
    clock: t.procedure.subscription(() => {
      // intentionally no cleanup
    }),
  });

  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const mockIpcMain = {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel)!.push(handler);
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  } as any;

  const sender = {
    isDestroyed: () => false,
    send: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  bindIpcRouter(mockIpcMain, appRouter);
  await listeners.get('clock')![0]({ sender }, { __action: 'subscribe', __subId: 's1', input: undefined });

  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('subscription "clock" did not return a cleanup function')
  );
  warnSpy.mockRestore();
});

