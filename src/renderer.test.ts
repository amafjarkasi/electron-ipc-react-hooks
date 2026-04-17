import { describe, it, expect, vi } from 'vitest';
import { createReactIpc } from './renderer';

type MockRouter = {
  getUser: { _input: string, _output: { id: string }, _type: 'query' },
  updateUser: { _input: { id: string, name: string }, _output: boolean, _type: 'mutation' }
};

describe('createReactIpc', () => {
  it('should generate useQuery for a procedure', () => {
    (global as any).window = {
      electronIpc: { invoke: vi.fn() }
    };
    
    const ipc = createReactIpc<MockRouter>();
    expect(typeof ipc.getUser.useQuery).toBe('function');
    expect(typeof ipc.updateUser.useMutation).toBe('function');
  });
});
