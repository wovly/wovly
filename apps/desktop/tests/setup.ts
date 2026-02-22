/**
 * Vitest global setup file
 * Runs once before all tests
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Mock Electron APIs globally
beforeAll(() => {
  // Mock electron module
  vi.mock('electron', () => ({
    app: {
      getPath: vi.fn((name: string) => `/mock/path/${name}`),
      getName: vi.fn(() => 'Wovly'),
      getVersion: vi.fn(() => '0.1.0'),
      on: vi.fn(),
      quit: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
    },
    BrowserWindow: vi.fn(() => ({
      loadURL: vi.fn(),
      on: vi.fn(),
      webContents: {
        send: vi.fn(),
      },
    })),
  }));

  // Mock Node.js modules that require special handling
  vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
      ...actual,
      promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        access: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
      },
    };
  });
});

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  vi.restoreAllMocks();
});

// Global test timeout
beforeAll(() => {
  // Set default timeout to 10 seconds
  vi.setConfig({ testTimeout: 10000 });
});
