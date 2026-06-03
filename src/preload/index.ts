// Preload bridge (§11). Exposes ONLY the typed IpcApi surface on window.api via
// contextBridge — no raw ipcRenderer reaches the renderer. Every method maps to
// a single §4.4 channel; inbound subscriptions return an unsubscribe fn.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  type IpcApi,
  type OverlayAppearancePayload,
  type OverlayClickthroughPayload,
  type OverlaySetModePayload,
  type RefreshKeyPayload,
  type SessionConfigPayload,
  type SessionStartPayload,
  type SessionStatePayload,
  type Unsubscribe,
} from '@shared/ipc';
import type { Settings } from '@shared/types';

// Subscribe to a main→renderer channel and return an unsubscribe function. The
// renderer never sees the IpcRendererEvent — only the typed payload.
function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The single, fully-typed API object exposed to both renderer windows.
const api: IpcApi = {
  // --- Session control (renderer → main, fire-and-forget) ---
  startSession: (payload: SessionStartPayload) =>
    ipcRenderer.send(CHANNELS.sessionStart, payload),
  stopSession: () => ipcRenderer.send(CHANNELS.sessionStop, {}),
  sendSessionState: (payload: SessionStatePayload) =>
    ipcRenderer.send(CHANNELS.sessionState, payload),

  // --- Overlay control (renderer → main/overlay) ---
  setOverlayMode: (payload: OverlaySetModePayload) =>
    ipcRenderer.send(CHANNELS.overlaySetMode, payload),
  setClickThrough: (payload: OverlayClickthroughPayload) =>
    ipcRenderer.send(CHANNELS.overlaySetClickThrough, payload),
  setOverlayAppearance: (payload: OverlayAppearancePayload) =>
    ipcRenderer.send(CHANNELS.overlayAppearance, payload),

  // --- Key refresh (overlay ↔ main, request/response) ---
  refreshKey: (): Promise<RefreshKeyPayload> =>
    ipcRenderer.invoke(CHANNELS.sessionRefreshKey),

  // --- Settings (renderer ↔ main, request/response) ---
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settingsGet),
  setSettings: (settings: Settings): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.settingsSet, settings),

  // --- App lifecycle (renderer → main, fire-and-forget) ---
  quitApp: () => ipcRenderer.send(CHANNELS.appQuit),

  // --- Inbound events (main/overlay → renderer) ---
  onSessionConfig: (handler) =>
    subscribe<SessionConfigPayload>(CHANNELS.sessionConfig, handler),
  onSessionStop: (handler) =>
    subscribe<void>(CHANNELS.sessionStop, handler),
  onSessionState: (handler) =>
    subscribe<SessionStatePayload>(CHANNELS.sessionState, handler),
  onRefreshKey: (handler) =>
    subscribe<RefreshKeyPayload>(CHANNELS.sessionRefreshKey, handler),
  onOverlaySetMode: (handler) =>
    subscribe<OverlaySetModePayload>(CHANNELS.overlaySetMode, handler),
  onOverlayAppearance: (handler) =>
    subscribe<OverlayAppearancePayload>(CHANNELS.overlayAppearance, handler),
};

// Expose under context isolation (the default + §11). Fall back to a window
// assignment only if isolation is somehow disabled, so renderer code never
// crashes on a missing window.api.
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api);
} else {
  // @ts-expect-error — window.api typing is provided by index.d.ts
  window.api = api;
}
