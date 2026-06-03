// I7 — IPC: start/stop/config/appearance channels deliver typed payloads both
// ways. (SPEC §13.2 / §4.4)
//
// Both IPC ends need Electron (`ipcMain` in main, `contextBridge`/`ipcRenderer`
// in preload). We mock the `electron` module so the REAL `registerIpc` /
// `startSession` / `stopSession` handlers (main) and the REAL preload `api`
// object run unchanged, then assert the exact channel + typed payload that
// crosses each boundary. tempKey/settings/windows are mocked at the module
// boundary so no real worker/electron-store is touched.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CHANNELS } from '@shared/ipc';
import type {
  SessionStartPayload,
  SessionStatePayload,
  OverlayAppearancePayload,
  OverlaySetModePayload,
} from '@shared/ipc';

// --- electron mock: a recording ipcMain + a passthrough BrowserWindow type ----
type Listener = (e: unknown, payload: unknown) => void;
type Handler = (e: unknown, payload?: unknown) => unknown;

const ipcListeners = new Map<string, Listener>();
const ipcHandlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    on: (ch: string, fn: Listener) => ipcListeners.set(ch, fn),
    handle: (ch: string, fn: Handler) => ipcHandlers.set(ch, fn),
    removeAllListeners: (ch: string) => ipcListeners.delete(ch),
    removeHandler: (ch: string) => ipcHandlers.delete(ch),
  },
  // BrowserWindow only used as a type in ipc.ts; provide a stub class.
  BrowserWindow: class {},
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    send: vi.fn(),
    invoke: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

// --- dependency boundary mocks (resolved to the same files ipc.ts imports) ----
vi.mock('@main/tempKey', () => ({
  getKey: vi.fn(async () => ({ tempKey: 'temp:i7', expiresAt: 1_900_000_000_000 })),
  refresh: vi.fn(async () => ({ tempKey: 'temp:i7-refresh', expiresAt: 1_900_000_111_000 })),
  clearKey: vi.fn(),
}));
vi.mock('@main/settings', () => ({
  getSettings: vi.fn(() => ({ overlayMode: 'caption' })),
  setSettings: vi.fn(),
}));
vi.mock('@main/windows', () => ({ setClickThrough: vi.fn() }));

// A fake renderer-side window that records what main sends to it.
function fakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  return {
    sent,
    isDestroyed: () => false,
    showInactive: vi.fn(),
    webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
  };
}

describe('I7 main IPC handlers — typed payloads both ways', () => {
  beforeEach(() => {
    ipcListeners.clear();
    ipcHandlers.clear();
    vi.clearAllMocks();
  });

  it('session:start mints a key and pushes a typed session:config to the overlay', async () => {
    const { registerIpc } = await import('@main/ipc');
    const overlay = fakeWindow();
    const control = fakeWindow();
    registerIpc({ overlay: () => overlay as never, control: () => control as never });

    const start: SessionStartPayload = { mode: 1, targetLang: 'vi' };
    // Drive the registered session:start listener and await the async work.
    ipcListeners.get(CHANNELS.sessionStart)!({}, start);
    await vi.waitFor(() => expect(overlay.sent.length).toBeGreaterThan(0));

    const cfg = overlay.sent.find((m) => m.channel === CHANNELS.sessionConfig);
    expect(cfg).toBeDefined();
    expect(cfg!.payload).toMatchObject({
      tempKey: 'temp:i7',
      expiresAt: 1_900_000_000_000,
      model: 'stt-rt-v4',
      sampleRate: 16000,
      translation: { type: 'one_way', target_language: 'vi' },
    });
    expect(overlay.showInactive).toHaveBeenCalled();
  });

  it('session:state from the overlay is relayed to the control window', async () => {
    const { registerIpc } = await import('@main/ipc');
    const overlay = fakeWindow();
    const control = fakeWindow();
    registerIpc({ overlay: () => overlay as never, control: () => control as never });

    const state: SessionStatePayload = {
      status: 'listening',
      sessionMs: 1234,
      tokenCount: 7,
    };
    ipcListeners.get(CHANNELS.sessionState)!({}, state);

    const relayed = control.sent.find((m) => m.channel === CHANNELS.sessionState);
    expect(relayed?.payload).toEqual(state);
  });

  it('overlay:appearance and overlay:set-mode forward to the overlay', async () => {
    const { registerIpc } = await import('@main/ipc');
    const overlay = fakeWindow();
    const control = fakeWindow();
    registerIpc({ overlay: () => overlay as never, control: () => control as never });

    const appearance: OverlayAppearancePayload = {
      fontScale: 1.5,
      opacity: 0.7,
      theme: 'dark',
      position: 'bottom-center',
    };
    ipcListeners.get(CHANNELS.overlayAppearance)!({}, appearance);
    expect(overlay.sent.find((m) => m.channel === CHANNELS.overlayAppearance)?.payload).toEqual(
      appearance,
    );

    const mode: OverlaySetModePayload = { overlay: 'panel' };
    ipcListeners.get(CHANNELS.overlaySetMode)!({}, mode);
    expect(overlay.sent.find((m) => m.channel === CHANNELS.overlaySetMode)?.payload).toEqual(mode);
  });

  it('session:refresh-key invoke returns a fresh typed RefreshKeyPayload', async () => {
    const { registerIpc } = await import('@main/ipc');
    registerIpc({ overlay: () => undefined, control: () => undefined });
    const result = await ipcHandlers.get(CHANNELS.sessionRefreshKey)!({});
    expect(result).toEqual({ tempKey: 'temp:i7-refresh', expiresAt: 1_900_000_111_000 });
  });

  it('session:stop relays a stop to the overlay and clears the key', async () => {
    const tempKey = await import('@main/tempKey');
    const { registerIpc } = await import('@main/ipc');
    const overlay = fakeWindow();
    registerIpc({ overlay: () => overlay as never, control: () => undefined });

    ipcListeners.get(CHANNELS.sessionStop)!({}, {});
    expect(overlay.sent.find((m) => m.channel === CHANNELS.sessionStop)).toBeDefined();
    expect(tempKey.clearKey).toHaveBeenCalled();
  });
});

describe('I7 preload bridge — renderer→main send on the right channels', () => {
  it('the exposed api maps each method to its §4.4 channel', async () => {
    const electron = await import('electron');
    // Force the contextIsolated branch so preload uses contextBridge (no `window`
    // dependency in this node-env test).
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
    // Importing the preload runs its top-level exposeInMainWorld with the api.
    await import('../../src/preload/index');
    const expose = (electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(expose?.[0]).toBe('api');
    const api = expose?.[1] as Record<string, (p?: unknown) => unknown>;

    const sendMock = electron.ipcRenderer.send as ReturnType<typeof vi.fn>;
    sendMock.mockClear();

    api.startSession({ mode: 1, targetLang: 'vi' });
    expect(sendMock).toHaveBeenCalledWith(CHANNELS.sessionStart, { mode: 1, targetLang: 'vi' });

    sendMock.mockClear();
    api.setOverlayMode({ overlay: 'panel' });
    expect(sendMock).toHaveBeenCalledWith(CHANNELS.overlaySetMode, { overlay: 'panel' });

    sendMock.mockClear();
    api.setOverlayAppearance({ fontScale: 1, opacity: 1, theme: 'dark', position: 'bottom-center' });
    expect(sendMock).toHaveBeenCalledWith(
      CHANNELS.overlayAppearance,
      expect.objectContaining({ fontScale: 1 }),
    );

    // refreshKey is an invoke (request/response), not a fire-and-forget send.
    const invokeMock = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockClear();
    api.refreshKey();
    expect(invokeMock).toHaveBeenCalledWith(CHANNELS.sessionRefreshKey);
  });
});
