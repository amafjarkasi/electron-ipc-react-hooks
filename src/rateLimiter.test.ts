import { expect, test, vi, beforeEach, describe } from 'vitest';
import { createRateLimiter } from './rateLimiter';
import { initIpc, bindIpcRouter } from './main';

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test('allows requests within the limit', async () => {
    const rateLimit = createRateLimiter({ max: 3, windowMs: 1000 });

    const t = initIpc();
    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(() => 'pong'),
    });

    // Should allow 3 requests
    for (let i = 0; i < 3; i++) {
      const result = await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });
      expect(result).toBe('pong');
    }
  });

  test('blocks requests exceeding the limit', async () => {
    const rateLimit = createRateLimiter({ max: 2, windowMs: 1000 });

    const t = initIpc();
    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(() => 'pong'),
    });

    // First 2 should succeed
    await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });
    await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });

    // 3rd should be rate limited
    await expect(
      appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } })
    ).rejects.toThrow('Rate limit exceeded');
  });

  test('resets after the time window expires', async () => {
    const rateLimit = createRateLimiter({ max: 2, windowMs: 1000 });

    const t = initIpc();
    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(() => 'pong'),
    });

    await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });
    await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });

    // Advance past the window
    vi.advanceTimersByTime(1001);

    // Should work again
    const result = await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });
    expect(result).toBe('pong');
  });

  test('tracks different procedures independently by default', async () => {
    const rateLimit = createRateLimiter({ max: 2, windowMs: 1000 });

    const t = initIpc();
    const appRouter = t.router({
      a: t.procedure.use(rateLimit).query(() => 'a'),
      b: t.procedure.use(rateLimit).query(() => 'b'),
    });

    // 2 calls to 'a'
    await appRouter.a({ input: undefined, ctx: {}, path: 'a', broadcast: { invalidate: () => {} } });
    await appRouter.a({ input: undefined, ctx: {}, path: 'a', broadcast: { invalidate: () => {} } });

    // 'b' should still work — different path
    const result = await appRouter.b({ input: undefined, ctx: {}, path: 'b', broadcast: { invalidate: () => {} } });
    expect(result).toBe('b');
  });

  test('per-path rate limiting works via bindIpcRouter', async () => {
    const rateLimit = createRateLimiter({ max: 2, windowMs: 1000 });
    const t = initIpc();

    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(() => 'pong'),
    });

    const mockIpcMain = {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
    } as any;

    bindIpcRouter(mockIpcMain, appRouter);

    const pingHandler = mockIpcMain.handle.mock.calls.find((c: any) => c[0] === 'ping')[1];

    // First 2 succeed
    const res1 = await pingHandler({} as any, undefined);
    expect(res1).toEqual({ data: 'pong' });

    const res2 = await pingHandler({} as any, undefined);
    expect(res2).toEqual({ data: 'pong' });

    // 3rd is rate limited
    const res3 = await pingHandler({} as any, undefined);
    expect(res3).toEqual({ error: 'Rate limit exceeded', code: 'RATE_LIMITED', data: { limit: 2, windowMs: 1000 } });
  });

  test('uses custom error message and code when provided', async () => {
    const rateLimit = createRateLimiter({
      max: 1,
      windowMs: 1000,
      message: 'Too many requests, slow down!',
      code: 'SLOW_DOWN',
    });

    const t = initIpc();
    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(() => 'pong'),
    });

    await appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } });

    await expect(
      appRouter.ping({ input: undefined, ctx: {}, path: 'ping', broadcast: { invalidate: () => {} } })
    ).rejects.toThrow('Too many requests, slow down!');
  });

  test('respects custom keyGenerator for grouping', async () => {
    const rateLimit = createRateLimiter({
      max: 2,
      windowMs: 1000,
      keyGenerator: ({ ctx }) => ctx.userId || 'anonymous',
    });

    const t = initIpc<{ userId: string }>();
    const appRouter = t.router({
      ping: t.procedure.use(rateLimit).query(({ ctx }) => `pong:${ctx.userId}`),
    });

    const broadcast = { invalidate: () => {} };

    // User A: 2 requests
    await appRouter.ping({ input: undefined, ctx: { userId: 'A' }, path: 'ping', broadcast });
    await appRouter.ping({ input: undefined, ctx: { userId: 'A' }, path: 'ping', broadcast });

    // User B should still work — different key
    const result = await appRouter.ping({ input: undefined, ctx: { userId: 'B' }, path: 'ping', broadcast });
    expect(result).toBe('pong:B');

    // User A should be blocked
    await expect(
      appRouter.ping({ input: undefined, ctx: { userId: 'A' }, path: 'ping', broadcast })
    ).rejects.toThrow('Rate limit exceeded');
  });
});