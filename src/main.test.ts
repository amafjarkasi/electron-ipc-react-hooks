import { describe, it, expect } from 'vitest';
import { initIpc } from './main';
import { z } from 'zod';

describe('IpcRouter', () => {
  it('should create a router and allow querying', async () => {
    const t = initIpc();
    
    const router = t.router({
      getUser: t.procedure
        .input(z.string())
        .query(async ({ input }) => {
          return { id: input, name: 'Test' };
        }),
    });

    // We can directly call the procedure for testing!
    // At runtime, it's a function.
    const result = await router.getUser({ input: '123' });
    expect(result).toEqual({ id: '123', name: 'Test' });
  });

  it('should throw an error if input validation fails', async () => {
    const t = initIpc();
    
    const router = t.router({
      getUser: t.procedure
        .input(z.string())
        .query(async ({ input }) => {
          return { id: input, name: 'Test' };
        }),
    });

    await expect(router.getUser({ input: 123 as any })).rejects.toThrow();
  });
});
