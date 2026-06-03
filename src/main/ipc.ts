// Typed IPC handlers (§4.4). Registers an ipcMain handler/listener for every
// channel in the §4.4 table, all typed via @shared/ipc. Routes payloads between
// the control window, the overlay window, the temp-key manager and settings.

import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  CHANNELS,
  type OverlayAppearancePayload,
  type OverlayClickthroughPayload,
  type OverlaySetModePayload,
  type RefreshKeyPayload,
  type SessionConfigPayload,
  type SessionStartPayload,
  type SessionStatePayload,
} from '@shared/ipc';
import type { Settings } from '@shared/types';
import { getSettings, setSettings } from './settings.js';
import { getKey, refresh, clearKey } from './tempKey.js';
import { setClickThrough } from './windows.js';

// Soniox config constants pushed to the overlay (§6.1). The temp key is filled
// in per-session by session:start; everything else is fixed.
const SONIOX_MODEL = 'stt-rt-v4';
const SONIOX_SAMPLE_RATE = 16000;

// Window accessors supplied by index.ts. Returning possibly-undefined lets the
// handlers stay safe if a window was closed/not-yet-created.
export interface WindowRefs {
  overlay(): BrowserWindow | undefined;
  control(): BrowserWindow | undefined;
}

// Send a typed message to a window's renderer if it exists and is alive.
function sendTo(win: BrowserWindow | undefined, channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

// Start a session from main: mint a temp key, reveal the overlay, then push
// session:config so the overlay can open the Soniox WS (§4.3). Exported so the
// tray/hotkey can drive the exact same flow as the control IPC handler.
export async function startSession(
  refs: WindowRefs,
  payload: SessionStartPayload,
): Promise<void> {
  const overlay = refs.overlay();
  try {
    const { tempKey, expiresAt } = await getKey();
    const config: SessionConfigPayload = {
      tempKey,
      expiresAt,
      model: SONIOX_MODEL,
      sampleRate: SONIOX_SAMPLE_RATE,
      translation: { type: 'one_way', target_language: payload.targetLang },
    };
    if (overlay && !overlay.isDestroyed()) {
      overlay.showInactive(); // reveal without stealing focus
      sendTo(overlay, CHANNELS.sessionConfig, config);
    }
  } catch (err) {
    // Surface key-mint failures as an error state to control + overlay.
    const state: SessionStatePayload = {
      status: 'error',
      sessionMs: 0,
      tokenCount: 0,
      error: err instanceof Error ? err.message : 'temp-key fetch failed',
    };
    sendTo(refs.control(), CHANNELS.sessionState, state);
    sendTo(overlay, CHANNELS.sessionState, state);
  }
}

// Stop a session from main: relay stop to the overlay (which closes the WS) and
// drop the cached key. Exported for tray/hotkey use.
export function stopSession(refs: WindowRefs): void {
  sendTo(refs.overlay(), CHANNELS.sessionStop, {});
  clearKey();
}

// Register every §4.4 handler. Idempotent-ish: callers register once at startup.
export function registerIpc(refs: WindowRefs): void {
  // --- session:start (Control → Main) -------------------------------------
  ipcMain.on(
    CHANNELS.sessionStart,
    (_e: IpcMainEvent, payload: SessionStartPayload) => {
      void startSession(refs, payload);
    },
  );

  // --- session:stop (Control → Main) --------------------------------------
  ipcMain.on(CHANNELS.sessionStop, () => stopSession(refs));

  // --- session:state (Overlay → Control,Main) -----------------------------
  // The overlay owns the session; relay its status broadcasts to control.
  ipcMain.on(
    CHANNELS.sessionState,
    (_e: IpcMainEvent, payload: SessionStatePayload) => {
      sendTo(refs.control(), CHANNELS.sessionState, payload);
    },
  );

  // --- session:refresh-key (Overlay → Main, invoke) -----------------------
  // Overlay asks for a fresh key on expiry/reconnect (§6.3). Force a re-mint.
  ipcMain.handle(
    CHANNELS.sessionRefreshKey,
    async (_e: IpcMainInvokeEvent): Promise<RefreshKeyPayload> => refresh(),
  );

  // --- overlay:set-mode (Control → Overlay) -------------------------------
  ipcMain.on(
    CHANNELS.overlaySetMode,
    (_e: IpcMainEvent, payload: OverlaySetModePayload) => {
      sendTo(refs.overlay(), CHANNELS.overlaySetMode, payload);
    },
  );

  // --- overlay:set-clickthrough (Control → Main) --------------------------
  // Toggle the overlay's click-through lock directly on the window (§7.7).
  ipcMain.on(
    CHANNELS.overlaySetClickThrough,
    (_e: IpcMainEvent, payload: OverlayClickthroughPayload) => {
      const overlay = refs.overlay();
      if (overlay) setClickThrough(overlay, payload.locked);
    },
  );

  // --- overlay:appearance (Control → Overlay) -----------------------------
  ipcMain.on(
    CHANNELS.overlayAppearance,
    (_e: IpcMainEvent, payload: OverlayAppearancePayload) => {
      sendTo(refs.overlay(), CHANNELS.overlayAppearance, payload);
    },
  );

  // --- settings:get / settings:set (Control ↔ Main, invoke) ---------------
  ipcMain.handle(CHANNELS.settingsGet, (): Settings => getSettings());
  ipcMain.handle(
    CHANNELS.settingsSet,
    (_e: IpcMainInvokeEvent, settings: Settings): void => setSettings(settings),
  );
}

// Tear down all handlers (e.g. before quit) so nothing leaks across reloads.
export function unregisterIpc(): void {
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.removeAllListeners(channel);
    ipcMain.removeHandler(channel);
  }
}
