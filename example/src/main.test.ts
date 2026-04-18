import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import * as fs from 'fs/promises';

const {
  mockMinimize,
  mockMaximize,
  mockRestore,
  mockClose,
  mockFocus,
  mockShowNotification
} = vi.hoisted(() => ({
  mockMinimize: vi.fn(),
  mockMaximize: vi.fn(),
  mockRestore: vi.fn(),
  mockClose: vi.fn(),
  mockFocus: vi.fn(),
  mockShowNotification: vi.fn()
}));

vi.mock('electron', () => {
  class MockBrowserWindow {
    loadFile = vi.fn();
    loadURL = vi.fn();
    webContents = {};
    static fromWebContents = vi.fn(() => ({
      minimize: mockMinimize,
      maximize: mockMaximize,
      restore: mockRestore,
      close: mockClose,
      focus: mockFocus,
      isMaximized: vi.fn().mockReturnValue(false)
    }));
  }

  function MockNotification(this: any) {
    this.show = mockShowNotification;
  }

  const electronMock = {
    __esModule: true,
    app: {
      setPath: vi.fn(),
      whenReady: vi.fn().mockResolvedValue(true),
      on: vi.fn(),
      quit: vi.fn()
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn()
    },
    dialog: {
      showOpenDialog: vi.fn()
    },
    Notification: MockNotification
  };

  return { ...electronMock, default: electronMock };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('fs/promises');
  return {
    ...actual,
    stat: vi.fn().mockResolvedValue({
      size: 1024,
      birthtime: new Date('2023-01-01')
    }),
    readFile: vi.fn().mockResolvedValue('line1\nline2\nline3\nline4\nline5\nline6\nline7')
  };
});

import { appRouter } from './main';
console.log('TEST ELECTRON MOCK:', require('electron'));

test('processDroppedFile mutation', async () => {
  const res = await appRouter.system.processDroppedFile({
    input: { filePath: 'test.txt' },
    ctx: { event: {} } as any,
    path: 'system.processDroppedFile',
    broadcast: { invalidate: vi.fn() }
  });

  expect(res.name).toBe('test.txt');
  expect(res.size).toBe(1024);
  expect(res.preview).toBe('line1\nline2\nline3\nline4\nline5');
});

test('controlWindow mutation', async () => {
  await appRouter.system.controlWindow({
    input: { action: 'minimize' },
    ctx: { event: { sender: {} } } as any,
    path: 'system.controlWindow',
    broadcast: { invalidate: vi.fn() }
  });
  expect(mockMinimize).toHaveBeenCalled();

  await appRouter.system.controlWindow({
    input: { action: 'maximize' },
    ctx: { event: { sender: {} } } as any,
    path: 'system.controlWindow',
    broadcast: { invalidate: vi.fn() }
  });
  expect(mockMaximize).toHaveBeenCalled();
});

test('showNotification mutation', async () => {
  (global as any).__mockShowNotification = mockShowNotification;
  await appRouter.system.showNotification({
    input: { title: 'Test', body: 'Test body' },
    ctx: { event: {} } as any,
    path: 'system.showNotification',
    broadcast: { invalidate: vi.fn() }
  });
  expect(mockShowNotification).toHaveBeenCalled();
});