import { expect, test, vi, describe, beforeEach, afterEach } from 'vitest';
import { IpcDevTools, createDevTools } from './devtools';

describe('IpcDevTools', () => {
  let devtools: IpcDevTools;

  beforeEach(() => {
    devtools = createDevTools({ maxHistory: 5 });
  });

  test('records IPC calls with full metadata', () => {
    devtools.recordCall({
      path: 'getUser',
      type: 'query',
      input: { id: '123' },
      timestamp: 1000,
    });

    devtools.recordResponse({
      path: 'getUser',
      duration: 50,
      success: true,
      data: { name: 'Alice' },
    });

    const history = devtools.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      path: 'getUser',
      type: 'query',
      input: { id: '123' },
      duration: 50,
      success: true,
      data: { name: 'Alice' },
    });
  });

  test('records failed IPC calls with error details', () => {
    devtools.recordCall({
      path: 'deleteUser',
      type: 'mutation',
      input: { id: '456' },
      timestamp: 2000,
    });

    devtools.recordResponse({
      path: 'deleteUser',
      duration: 10,
      success: false,
      error: { message: 'Not found', code: 'NOT_FOUND' },
    });

    const history = devtools.getHistory();
    expect(history[0].success).toBe(false);
    expect(history[0].error).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
  });

  test('respects maxHistory limit', () => {
    for (let i = 0; i < 8; i++) {
      devtools.recordCall({ path: `call${i}`, type: 'query', input: null, timestamp: i * 100 });
      devtools.recordResponse({ path: `call${i}`, duration: 10, success: true, data: i });
    }

    const history = devtools.getHistory();
    expect(history).toHaveLength(5);
    // Should keep the last 5 (calls 3-7)
    expect(history[0].path).toBe('call3');
    expect(history[4].path).toBe('call7');
  });

  test('clears history', () => {
    devtools.recordCall({ path: 'test', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'test', duration: 5, success: true, data: null });

    expect(devtools.getHistory()).toHaveLength(1);
    devtools.clear();
    expect(devtools.getHistory()).toHaveLength(0);
  });

  test('computes stats from history', () => {
    // Successful calls
    devtools.recordCall({ path: 'a', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'a', duration: 100, success: true, data: null });

    devtools.recordCall({ path: 'b', type: 'mutation', input: null, timestamp: 50 });
    devtools.recordResponse({ path: 'b', duration: 200, success: true, data: null });

    devtools.recordCall({ path: 'c', type: 'query', input: null, timestamp: 100 });
    devtools.recordResponse({ path: 'c', duration: 50, success: false, error: { message: 'fail' } });

    const stats = devtools.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(stats.errorCount).toBe(1);
    expect(stats.avgDuration).toBeCloseTo(116.67, 0);
    expect(stats.byType).toEqual({ query: 2, mutation: 1 });
  });

  test('filters history by path prefix', () => {
    devtools.recordCall({ path: 'admin.users.get', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'admin.users.get', duration: 10, success: true, data: null });

    devtools.recordCall({ path: 'admin.billing.get', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'admin.billing.get', duration: 10, success: true, data: null });

    devtools.recordCall({ path: 'public.ping', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'public.ping', duration: 10, success: true, data: null });

    const adminHistory = devtools.getHistory({ pathPrefix: 'admin.' });
    expect(adminHistory).toHaveLength(2);
    expect(adminHistory.every(h => h.path.startsWith('admin.'))).toBe(true);
  });

  test('subscriber is notified on recordResponse', () => {
    const listener = vi.fn();
    devtools.subscribe(listener);

    devtools.recordCall({ path: 'test', type: 'query', input: null, timestamp: 0 });
    expect(listener).not.toHaveBeenCalled();

    devtools.recordResponse({ path: 'test', duration: 5, success: true, data: null });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'test', success: true })
    );
  });

  test('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = devtools.subscribe(listener);
    unsub();

    devtools.recordCall({ path: 'test', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'test', duration: 5, success: true, data: null });

    expect(listener).not.toHaveBeenCalled();
  });

  test('enable/disable controls recording', () => {
    devtools.disable();

    devtools.recordCall({ path: 'a', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'a', duration: 5, success: true, data: null });

    expect(devtools.getHistory()).toHaveLength(0);

    devtools.enable();

    devtools.recordCall({ path: 'b', type: 'query', input: null, timestamp: 0 });
    devtools.recordResponse({ path: 'b', duration: 5, success: true, data: null });

    expect(devtools.getHistory()).toHaveLength(1);
    expect(devtools.getHistory()[0].path).toBe('b');
  });
});