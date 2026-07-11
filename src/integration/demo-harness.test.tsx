import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, useState, StrictMode } from 'react';
import { z } from 'zod';
import { initIpc, bindIpcRouter, bindIpcStore, createIpcStore, IpcError } from '../main';
import { createReactIpc, createReactIpcStore, useIpcInvalidator } from '../renderer';

/**
 * In-memory Electron IPC bridge for jsdom: wires fake ipcMain to window.electronIpc.
 */
function createIpcBridge() {
  const invokeHandlers = new Map<string, (...args: any[]) => any>();
  const mainListeners = new Map<string, Array<(...args: any[]) => void>>();
  const rendererListeners = new Map<string, Array<(...args: any[]) => void>>();

  const sender = {
    isDestroyed: () => false,
    send: (channel: string, ...args: any[]) => {
      (rendererListeners.get(channel) || []).forEach((l) => l({}, ...args));
    },
    once: vi.fn(),
    removeListener: vi.fn(),
  };

  const webContents = {
    getAllWebContents: () => [sender],
  };

  const ipcMain = {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      invokeHandlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      invokeHandlers.delete(channel);
    },
    on: (channel: string, fn: (...args: any[]) => void) => {
      if (!mainListeners.has(channel)) mainListeners.set(channel, []);
      mainListeners.get(channel)!.push(fn);
    },
    removeListener: (channel: string, fn: (...args: any[]) => void) => {
      mainListeners.set(
        channel,
        (mainListeners.get(channel) || []).filter((f) => f !== fn)
      );
    },
  };

  const api = {
    invoke: async (channel: string, ...args: any[]) => {
      const handler = invokeHandlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler({ sender }, ...args);
    },
    send: (channel: string, payload?: any) => {
      (mainListeners.get(channel) || []).forEach((fn) => fn({ sender }, payload));
    },
    on: (channel: string, listener: (...args: any[]) => void) => {
      if (!rendererListeners.has(channel)) rendererListeners.set(channel, []);
      rendererListeners.get(channel)!.push(listener);
    },
    off: (channel: string, listener: (...args: any[]) => void) => {
      rendererListeners.set(
        channel,
        (rendererListeners.get(channel) || []).filter((l) => l !== listener)
      );
    },
  };

  return { ipcMain, api, webContents, sender };
}

function buildDemoRouter() {
  const t = initIpc<{ event: any; timestamp: number }>();
  const settingsStore = createIpcStore({ theme: 'system', notifications: true });

  const systemRouter = t.router({
    getInfo: t.procedure.query(() => ({
      platform: 'test',
      arch: 'x64',
      nodeVersion: '20.0.0',
      electronVersion: '41.0.0',
      chromeVersion: '120.0.0',
    })),
  });

  const appRouter = t.router({
    system: systemRouter,
    helloContext: t.procedure.query(({ ctx }) => `Hello @ ${ctx.timestamp}`),
    echoReverse: t.procedure
      .input(z.object({ text: z.string() }))
      .mutation(async ({ input }) => input.text.split('').reverse().join('')),
    throwError: t.procedure
      .input(z.object({ shouldThrow: z.boolean() }))
      .mutation(({ input }) => {
        if (input.shouldThrow) throw new IpcError('Boom', 'DEMO_ERROR');
        return 'ok';
      }),
    saveProfile: t.procedure
      .input(z.object({ name: z.string().min(3) }))
      .mutation(({ input }) => ({ saved: input.name })),
    mathSquare: t.procedure.input(z.number()).query(({ input }) => input * input),
    slowQuery: t.procedure.input(z.string()).query(async ({ input, signal }) => {
      await new Promise((r) => setTimeout(r, 80));
      if (signal?.aborted) throw new Error('Aborted');
      return `Done: ${input}`;
    }),
    getLogs: t.procedure
      .input(z.object({ limit: z.number(), cursor: z.number().optional() }))
      .query(({ input }) => {
        const cursor = input.cursor ?? 0;
        const items = Array.from({ length: input.limit }, (_, i) => ({
          id: cursor + i,
          message: `Log ${cursor + i}`,
        }));
        return { items, nextCursor: cursor + input.limit < 15 ? cursor + input.limit : undefined };
      }),
    clock: t.procedure.subscription(({ emit }) => {
      let n = 0;
      const id = setInterval(() => emit(`tick-${++n}`), 30);
      return () => clearInterval(id);
    }),
    fileUploadStream: t.procedure
      .input(z.object({ filename: z.string() }))
      .channel(({ emit, onData }) => {
        let total = 0;
        onData((data) => {
          if (data?.done) {
            emit({ status: 'complete', totalBytes: total });
          } else if (data?.bytes) {
            total += data.bytes;
            emit({ status: 'progress', totalBytes: total });
          }
        });
        return () => {};
      }),
    invalidateDemo: t.procedure.mutation(({ broadcast }) => {
      broadcast.invalidate('system.getInfo');
      return true;
    }),
  });

  return { appRouter, settingsStore };
}

function DemoApp({ ipc, useSettings }: { ipc: any; useSettings: () => any }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    StrictMode,
    null,
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DemoFeatures, { ipc, useSettings, queryClient })
    )
  );
}

function DemoFeatures({
  ipc,
  useSettings,
  queryClient,
}: {
  ipc: any;
  useSettings: () => any;
  queryClient: QueryClient;
}) {
  useIpcInvalidator(queryClient);
  const [settings, setSettings] = useSettings();
  const { data: sysInfo } = ipc.system.getInfo.useQuery(undefined);
  const { data: hello } = ipc.helloContext.useQuery(undefined);
  const echo = ipc.echoReverse.useMutation();
  const errMut = ipc.throwError.useMutation();
  const save = ipc.saveProfile.useMutation();
  const [clock, setClock] = useState('waiting');
  const [channelLog, setChannelLog] = useState('');
  const [batchOn, setBatchOn] = useState(false);

  ipc.clock.useSubscription(undefined, { onData: (d: string) => setClock(d) });
  const { send } = ipc.fileUploadStream.useChannel(
    { filename: 'test.zip' },
    { onData: (d: any) => setChannelLog(JSON.stringify(d)) }
  );

  const q1 = ipc.mathSquare.useQuery(2, { enabled: batchOn });
  const q2 = ipc.mathSquare.useQuery(5, { enabled: batchOn });
  const q3 = ipc.mathSquare.useQuery(10, { enabled: batchOn });

  const logs = ipc.getLogs.useInfiniteQuery(
    { limit: 5 },
    { getNextPageParam: (last: any) => last.nextCursor, initialPageParam: 0 }
  );

  return createElement(
    'div',
    null,
    createElement('div', { 'data-testid': 'sys-platform' }, sysInfo?.platform ?? 'loading'),
    createElement('div', { 'data-testid': 'hello' }, hello ?? 'loading'),
    createElement('div', { 'data-testid': 'clock' }, clock),
    createElement('div', { 'data-testid': 'theme' }, settings.theme),
    createElement(
      'button',
      {
        'data-testid': 'toggle-theme',
        onClick: () => setSettings((s: any) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      },
      'Toggle Theme'
    ),
    createElement(
      'button',
      {
        'data-testid': 'echo-btn',
        onClick: () => echo.mutate({ text: 'abc' }),
      },
      'Echo'
    ),
    createElement('div', { 'data-testid': 'echo-result' }, echo.data ?? ''),
    createElement(
      'button',
      {
        'data-testid': 'error-btn',
        onClick: () => errMut.mutate({ shouldThrow: true }),
      },
      'Error'
    ),
    createElement('div', { 'data-testid': 'error-msg' }, errMut.error?.message ?? ''),
    createElement(
      'button',
      {
        'data-testid': 'save-short',
        onClick: () => save.mutate({ name: 'ab' }),
      },
      'Save Short'
    ),
    createElement('div', { 'data-testid': 'save-error' }, (save.error as any)?.code ?? ''),
    createElement(
      'button',
      { 'data-testid': 'batch-btn', onClick: () => setBatchOn(true) },
      'Batch'
    ),
    createElement(
      'div',
      { 'data-testid': 'batch-results' },
      batchOn && !q1.isFetching && !q2.isFetching && !q3.isFetching
        ? `${q1.data},${q2.data},${q3.data}`
        : ''
    ),
    createElement(
      'button',
      {
        'data-testid': 'channel-btn',
        onClick: () => {
          send({ bytes: 1024 });
          send({ done: true });
        },
      },
      'Channel'
    ),
    createElement('div', { 'data-testid': 'channel-log' }, channelLog),
    createElement(
      'div',
      { 'data-testid': 'logs-count' },
      logs.data ? String(logs.data.pages.reduce((n: number, p: any) => n + p.items.length, 0)) : '0'
    ),
    createElement(
      'button',
      {
        'data-testid': 'load-more',
        onClick: () => logs.fetchNextPage(),
        disabled: !logs.hasNextPage,
      },
      'Load More'
    )
  );
}

describe('demo feature harness (browser mock)', () => {
  let disposeRouter: () => void;
  let disposeStore: () => void;
  let ipc: any;
  let useSettings: () => any;
  let unmountApp: (() => void) | undefined;

  beforeEach(() => {
    const { ipcMain, api, webContents } = createIpcBridge();
    (window as any).electronIpc = api;

    const { appRouter, settingsStore } = buildDemoRouter();
    disposeRouter = bindIpcRouter(
      ipcMain as any,
      appRouter,
      (event) => ({ event, timestamp: 12345 }),
      { webContents }
    );
    disposeStore = bindIpcStore(ipcMain as any, 'settings', settingsStore, { webContents });

    ipc = createReactIpc('electronIpc', { batching: true, batchingTimeout: 5 });
    useSettings = createReactIpcStore('settings', { theme: 'system', notifications: true });
  });

  afterEach(() => {
    unmountApp?.();
    unmountApp = undefined;
    disposeRouter?.();
    disposeStore?.();
    delete (window as any).electronIpc;
  });

  test('queries, mutations, store, subscription, channel, batch, infinite', async () => {
    const rendered = render(createElement(DemoApp, { ipc, useSettings }));
    unmountApp = rendered.unmount;

    await waitFor(() => {
      expect(screen.getByTestId('sys-platform').textContent).toBe('test');
    });
    await waitFor(() => {
      expect(screen.getByTestId('hello').textContent).toContain('12345');
    });

    await waitFor(() => {
      expect(screen.getByTestId('clock').textContent).toMatch(/tick-/);
    });

    await waitFor(() => {
      expect(screen.getByTestId('theme').textContent).toBe('system');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-theme'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('theme').textContent).toBe('dark');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('echo-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('echo-result').textContent).toBe('cba');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('error-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('error-msg').textContent).toBe('Boom');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-short'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('save-error').textContent).toBe('BAD_REQUEST');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('batch-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('batch-results').textContent).toBe('4,25,100');
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('channel-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('channel-log').textContent).toContain('complete');
    });

    await waitFor(() => {
      expect(screen.getByTestId('logs-count').textContent).toBe('5');
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('load-more'));
    });
    await waitFor(() => {
      expect(Number(screen.getByTestId('logs-count').textContent)).toBeGreaterThan(5);
    });
  });
});
