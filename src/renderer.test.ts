import { expect, test, vi, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, StrictMode } from 'react';
import { createReactIpc, createIpcErrorFromResponse, IpcTypedError, createReactIpcStore, useIpcInvalidator } from './renderer';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: any }) => createElement(QueryClientProvider, { client: queryClient }, children);
const strictWrapper = ({ children }: { children: any }) =>
  createElement(StrictMode, null, createElement(QueryClientProvider, { client: queryClient }, children));

// Mock the React IPC client
function createMockApi() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    invoke: vi.fn(),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      if (!listeners[channel]) listeners[channel] = [];
      listeners[channel].push(listener);
    }),
    off: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      if (listeners[channel]) {
        listeners[channel] = listeners[channel].filter(l => l !== listener);
      }
    }),
    send: vi.fn(),
    _listeners: listeners,
    _emit(channel: string, ...args: any[]) {
      (listeners[channel] || []).forEach((l) => l({}, ...args));
    },
  };
}


describe('createIpcErrorFromResponse', () => {
  test('creates IpcTypedError with code and data from error response', () => {
    const err = createIpcErrorFromResponse({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      data: { reason: 'bad token' },
    });

    expect(err).toBeInstanceOf(IpcTypedError);
    expect(err.message).toBe('Unauthorized');
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.data).toEqual({ reason: 'bad token' });
  });

  test('creates IpcTypedError with defaults for missing fields', () => {
    const err = createIpcErrorFromResponse({
      error: 'Something went wrong',
    });

    expect(err).toBeInstanceOf(IpcTypedError);
    expect(err.message).toBe('Something went wrong');
    expect(err.code).toBe('UNKNOWN');
    expect(err.data).toBeUndefined();
  });

  test('preserves ZodError issues in data', () => {
    const issues = [{ path: ['email'], message: 'Invalid email' }];
    const err = createIpcErrorFromResponse({
      error: 'Validation failed',
      code: 'BAD_REQUEST',
      data: issues,
    });

    expect(err.code).toBe('BAD_REQUEST');
    expect(err.data).toEqual(issues);
  });
});

describe('IpcTypedError', () => {
  test('is instanceof Error', () => {
    const err = new IpcTypedError('test', 'TEST_CODE', { foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IpcTypedError');
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.data).toEqual({ foo: 'bar' });
  });

  test('serializes to JSON with all fields', () => {
    const err = new IpcTypedError('Not found', 'NOT_FOUND', { id: 123 });
    const json = err.toJSON();
    expect(json).toEqual({
      name: 'IpcTypedError',
      message: 'Not found',
      code: 'NOT_FOUND',
      data: { id: 123 },
    });
  });

  test('is distinguishable from generic Error', () => {
    const ipcErr = new IpcTypedError('fail', 'FAIL');
    const genericErr = new Error('fail');

    expect(ipcErr instanceof IpcTypedError).toBe(true);
    expect(genericErr instanceof IpcTypedError).toBe(false);
    expect('code' in ipcErr).toBe(true);
    expect('code' in genericErr).toBe(false);
  });
});

describe('createReactIpc error handling', () => {
  test('useMutation surfaces IpcTypedError with code and data', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;

    mockApi.invoke.mockResolvedValue({
      error: 'Seat limit reached',
      code: 'PLAN_LIMIT',
      data: { current: 5, max: 5 },
    });

    const ipc = createReactIpc();

    // Extract the mutation function — we need to test it through the proxy
    const { result } = renderHook(() => (ipc as any).test.useMutation(), { wrapper });

    let caughtError: any;
    await act(async () => {
      try {
        await result.current.mutateAsync({ foo: 'bar' });
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(IpcTypedError);
    expect(caughtError.code).toBe('PLAN_LIMIT');
    expect(caughtError.data).toEqual({ current: 5, max: 5 });

    delete (window as any).electronIpc;
  });

  test('useQuery surfaces IpcTypedError on failure', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;

    mockApi.invoke.mockResolvedValue({
      error: 'Not authenticated',
      code: 'UNAUTHORIZED',
      data: undefined,
    });

    const ipc = createReactIpc('electronIpc', { batching: false });

    const { result } = renderHook(() => (ipc as any).failQuery.useQuery(undefined, { retry: false }), { wrapper });

    // Wait for error state
    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });

    const error = result.current.error;
    expect(error).toBeInstanceOf(IpcTypedError);
    expect((error as IpcTypedError).code).toBe('UNAUTHORIZED');

    delete (window as any).electronIpc;
  });
});

describe('createReactIpcStore', () => {
  test('syncs initial state and updates without double-invoke under StrictMode', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    mockApi.invoke.mockImplementation(async (channel: string, payload?: any) => {
      if (channel === '__ipc_store_settings_get') return { theme: 'system', notifications: true };
      if (channel === '__ipc_store_settings_set') return { theme: payload.theme, notifications: true };
      return null;
    });

    const useStore = createReactIpcStore('settings', { theme: 'system', notifications: true });
    const { result } = renderHook(() => useStore(), { wrapper: strictWrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current[0].theme).toBe('system');
      });
    });

    const setCallsBefore = mockApi.invoke.mock.calls.filter((c: any) => c[0] === '__ipc_store_settings_set').length;

    await act(async () => {
      result.current[1]({ theme: 'dark' });
    });

    const setCallsAfter = mockApi.invoke.mock.calls.filter((c: any) => c[0] === '__ipc_store_settings_set').length;
    expect(setCallsAfter - setCallsBefore).toBe(1);
    expect(result.current[0].theme).toBe('dark');

    delete (window as any).electronIpc;
  });
});

describe('useIpcInvalidator', () => {
  test('invalidates queries when __ipc_invalidate is received', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const localWrapper = ({ children }: { children: any }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    renderHook(() => useIpcInvalidator(qc), { wrapper: localWrapper });

    await act(async () => {
      mockApi._emit('__ipc_invalidate', 'system.getInfo');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['system.getInfo'] });

    delete (window as any).electronIpc;
  });
});

describe('useSubscription and useChannel', () => {
  test('useSubscription cleans up on unmount', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    const ipc = createReactIpc('electronIpc', { batching: false });

    const onData = vi.fn();
    const { unmount } = renderHook(
      () => (ipc as any).clock.useSubscription(undefined, { onData }),
      { wrapper }
    );

    expect(mockApi.send).toHaveBeenCalledWith(
      'clock',
      expect.objectContaining({ __action: 'subscribe' })
    );

    const subId = mockApi.send.mock.calls.find((c: any) => c[1]?.__action === 'subscribe')[1].__subId;

    await act(async () => {
      mockApi._emit('clock', { __subId: subId, payload: 'tick-1' });
    });
    expect(onData).toHaveBeenCalledWith('tick-1');

    unmount();
    expect(mockApi.send).toHaveBeenCalledWith(
      'clock',
      expect.objectContaining({ __action: 'unsubscribe', __subId: subId })
    );
    expect(mockApi.off).toHaveBeenCalled();

    delete (window as any).electronIpc;
  });

  test('useChannel send round-trip', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    const ipc = createReactIpc('electronIpc', { batching: false });
    const onData = vi.fn();

    const { result } = renderHook(
      () => (ipc as any).stream.useChannel({ filename: 'a.zip' }, { onData }),
      { wrapper }
    );

    const subId = mockApi.send.mock.calls.find((c: any) => c[1]?.__action === 'subscribe')[1].__subId;

    await act(async () => {
      result.current.send({ bytes: 1024 });
    });

    expect(mockApi.send).toHaveBeenCalledWith(
      'stream',
      expect.objectContaining({ __action: 'send', __subId: subId, data: { bytes: 1024 } })
    );

    await act(async () => {
      mockApi._emit('stream', { __subId: subId, payload: { status: 'progress', totalBytes: 1024 } });
    });
    expect(onData).toHaveBeenCalledWith({ status: 'progress', totalBytes: 1024 });

    delete (window as any).electronIpc;
  });

  test('useSubscription uses latest onData without resubscribing', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    const ipc = createReactIpc('electronIpc', { batching: false });

    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onData }: { onData: (d: any) => void }) =>
        (ipc as any).clock.useSubscription(undefined, { onData }),
      { wrapper, initialProps: { onData: first } }
    );

    const subscribeCalls = mockApi.send.mock.calls.filter((c: any) => c[1]?.__action === 'subscribe');
    expect(subscribeCalls).toHaveLength(1);
    const subId = subscribeCalls[0][1].__subId;

    await act(async () => {
      mockApi._emit('clock', { __subId: subId, payload: 'a' });
    });
    expect(first).toHaveBeenCalledWith('a');
    expect(second).not.toHaveBeenCalled();

    rerender({ onData: second });

    expect(mockApi.send.mock.calls.filter((c: any) => c[1]?.__action === 'subscribe')).toHaveLength(1);

    await act(async () => {
      mockApi._emit('clock', { __subId: subId, payload: 'b' });
    });
    expect(second).toHaveBeenCalledWith('b');
    expect(first).toHaveBeenCalledTimes(1);

    delete (window as any).electronIpc;
  });

  test('useSubscription surfaces onError from __error envelope', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    const ipc = createReactIpc('electronIpc', { batching: false });

    const onData = vi.fn();
    const onError = vi.fn();
    renderHook(
      () => (ipc as any).clock.useSubscription(undefined, { onData, onError }),
      { wrapper }
    );

    const subId = mockApi.send.mock.calls.find((c: any) => c[1]?.__action === 'subscribe')[1].__subId;

    await act(async () => {
      mockApi._emit('clock', {
        __subId: subId,
        __error: { error: 'Clock failed', code: 'CLOCK_DOWN', data: { retry: false } },
      });
    });

    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0];
    expect(err).toBeInstanceOf(IpcTypedError);
    expect(err.message).toBe('Clock failed');
    expect(err.code).toBe('CLOCK_DOWN');
    expect(err.data).toEqual({ retry: false });

    delete (window as any).electronIpc;
  });
});

describe('batch isolation', () => {
  test('falls back to individual invokes when __ipc_batch transport fails', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    queryClient.clear();

    mockApi.invoke.mockImplementation(async (channel: string, ...args: any[]) => {
      if (channel === '__ipc_batch') {
        throw new Error('batch transport down');
      }
      const input = args[0];
      return { data: input * input };
    });

    const ipc = createReactIpc('electronIpc', { batching: true, batchingTimeout: 5 });

    const { result: r1 } = renderHook(() => (ipc as any).mathSquare.useQuery(2), { wrapper });
    const { result: r2 } = renderHook(() => (ipc as any).mathSquare.useQuery(5), { wrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(r1.current.isSuccess).toBe(true);
        expect(r2.current.isSuccess).toBe(true);
      });
    });

    expect(r1.current.data).toBe(4);
    expect(r2.current.data).toBe(25);
    expect(mockApi.invoke).toHaveBeenCalledWith('__ipc_batch', expect.any(Array));
    expect(mockApi.invoke).toHaveBeenCalledWith('mathSquare', 2, expect.any(String));
    expect(mockApi.invoke).toHaveBeenCalledWith('mathSquare', 5, expect.any(String));

    delete (window as any).electronIpc;
  });

  test('isolates per-item errors inside a successful batch response', async () => {
    const mockApi = createMockApi();
    (window as any).electronIpc = mockApi;
    queryClient.clear();

    mockApi.invoke.mockImplementation(async (channel: string, payload: any) => {
      if (channel === '__ipc_batch') {
        return payload.map((req: any) =>
          req.input === 5
            ? { error: 'odd fail', code: 'ODD', data: { n: 5 } }
            : { data: req.input * req.input }
        );
      }
      return { data: payload * payload };
    });

    const ipc = createReactIpc('electronIpc', { batching: true, batchingTimeout: 5 });

    const { result: r1 } = renderHook(() => (ipc as any).mathSquare.useQuery(2), { wrapper });
    const { result: r2 } = renderHook(() => (ipc as any).mathSquare.useQuery(5), { wrapper });

    await act(async () => {
      await vi.waitFor(() => {
        expect(r1.current.isSuccess).toBe(true);
        expect(r2.current.isError).toBe(true);
      });
    });

    expect(r1.current.data).toBe(4);
    expect(r2.current.error).toBeInstanceOf(IpcTypedError);
    expect((r2.current.error as IpcTypedError).code).toBe('ODD');

    delete (window as any).electronIpc;
  });
});
