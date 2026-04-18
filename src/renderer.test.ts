import { expect, test, vi, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createReactIpc, createIpcErrorFromResponse, IpcTypedError } from './renderer';

const queryClient = new QueryClient();
const wrapper = ({ children }: { children: any }) => createElement(QueryClientProvider, { client: queryClient }, children);

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