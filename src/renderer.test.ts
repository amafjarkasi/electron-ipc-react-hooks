import { describe, it, expect, vi } from 'vitest';
import { createReactIpc, createReactIpcStore } from './renderer';
import { renderHook, act } from '@testing-library/react';

type MockRouter = {
  getUser: { _input: string, _output: { id: string }, _type: 'query' },
  getUsersInfinite: { _input: { cursor?: number, limit: number }, _output: { items: any[], nextCursor?: number }, _type: 'query' },
  updateUser: { _input: { id: string, name: string }, _output: boolean, _type: 'mutation' }
};

describe('createReactIpc', () => {
  it('should generate useQuery for a procedure', () => {
    (global as any).window = {
      electronIpc: { invoke: vi.fn() }
    };
    
    const ipc = createReactIpc<MockRouter>();
    expect(typeof ipc.getUser.useQuery).toBe('function');
    expect(typeof ipc.getUsersInfinite.useInfiniteQuery).toBe('function');
    expect(typeof ipc.updateUser.useMutation).toBe('function');
  });
});

describe('createReactIpcStore', () => {
  it('should initialize and provide update function', async () => {
    let mockListener: any;
    const mockApi = {
      invoke: vi.fn().mockResolvedValue({ theme: 'dark' }),
      on: vi.fn((_channel, listener) => { mockListener = listener; }),
      off: vi.fn()
    };
    (global as any).window = { electronIpc: mockApi };

    const useSettingsStore = createReactIpcStore('settings', { theme: 'light' });
    
    // Test initial state is what we passed in
    const { result } = renderHook(() => useSettingsStore());
    expect(result.current[0]).toEqual({ theme: 'light' });

    // Wait for the invoke to resolve and state to update
    await vi.waitFor(() => {
      expect(result.current[0]).toEqual({ theme: 'dark' });
    });

    // Test optimistic update
    act(() => {
      result.current[1]({ theme: 'blue' });
    });
    expect(result.current[0]).toEqual({ theme: 'blue' });
    expect(mockApi.invoke).toHaveBeenCalledWith('__ipc_store_settings_set', { theme: 'blue' });

    // Test remote update
    act(() => {
      mockListener(null, { theme: 'red' });
    });
    expect(result.current[0]).toEqual({ theme: 'red' });
  });
});
