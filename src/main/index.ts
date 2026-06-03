// Main entry (§4.1). Owns app lifecycle, the single-instance lock, window
// creation (overlay + control), the system tray, global shortcuts (§7.7), IPC
// wiring (§4.4) and process-wide security hardening (§11).

import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  Tray,
} from 'electron';
import { createControl, createOverlay, setClickThrough } from './windows.js';
import { registerIpc, startSession, stopSession, type WindowRefs } from './ipc.js';
import { CHANNELS } from '@shared/ipc';
import { getSettings, patchSettings } from './settings.js';

// Live window handles. Kept module-scoped so the tray, shortcuts and IPC refs
// can reach them; reset to undefined on close so accessors stay honest.
let overlayWin: BrowserWindow | undefined;
let controlWin: BrowserWindow | undefined;
let tray: Tray | undefined;

// Tracks whether a session is active (drives the tray Start/Stop label). The
// overlay owns real session state; this is just a UI mirror toggled by actions.
let sessionActive = false;
// Tracks click-through lock so the tray/hotkey can toggle it (default: locked).
let clickThroughLocked = true;

// Window accessors handed to the IPC layer (§4.4 routing).
const refs: WindowRefs = {
  overlay: () => overlayWin,
  control: () => controlWin,
};

// ---------------------------------------------------------------------------
// Single-instance lock (§4.1): a second launch quits immediately and focuses
// the existing control window instead of opening a duplicate.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showControl();
  });
  void bootstrap();
}

// Create windows + wire everything once the app is ready.
async function bootstrap(): Promise<void> {
  await app.whenReady();

  hardenWebContentsGlobally();
  createWindows();
  registerIpc(refs);
  createTray();
  registerShortcuts();

  // macOS: re-create windows when the dock icon is clicked with none open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
}

// Open both windows on ready (§4.1 "on ready open control + overlay").
function createWindows(): void {
  spawnControl();

  const overlay = createOverlay();
  overlay.on('closed', () => {
    overlayWin = undefined;
  });
  overlayWin = overlay;
}

// Create the control window, wiring its close handler, and store the handle.
// Use a local first so the 'closed' closure doesn't make TS treat the module
// variable as possibly-undefined immediately after assignment.
function spawnControl(): BrowserWindow {
  const win = createControl();
  win.on('closed', () => {
    controlWin = undefined;
  });
  controlWin = win;
  return win;
}

// Bring the control window to the foreground, recreating it if needed.
function showControl(): void {
  const win = !controlWin || controlWin.isDestroyed() ? spawnControl() : controlWin;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------------------
// Tray (§4.2): Show/Hide control, Start/Stop, Overlay mode, Quit.
// ---------------------------------------------------------------------------
function createTray(): void {
  // Empty image keeps the tray valid even before a real icon asset exists; the
  // packaging slice supplies the branded icon later.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('STT → VI');
  refreshTrayMenu();

  // Double-click toggles the control window's visibility.
  tray.on('double-click', () => toggleControl());
}

// Rebuild the tray context menu so labels reflect current state.
function refreshTrayMenu(): void {
  if (!tray) return;
  const overlayMode = getSettings().overlayMode;
  const menu = Menu.buildFromTemplate([
    {
      label: controlWin?.isVisible() ? 'Hide control' : 'Show control',
      click: () => toggleControl(),
    },
    {
      label: sessionActive ? 'Stop' : 'Start',
      click: () => toggleSession(),
    },
    {
      label: 'Overlay mode',
      submenu: [
        {
          label: 'Caption',
          type: 'radio',
          checked: overlayMode === 'caption',
          click: () => setOverlayMode('caption'),
        },
        {
          label: 'Panel',
          type: 'radio',
          checked: overlayMode === 'panel',
          click: () => setOverlayMode('panel'),
        },
      ],
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// Global shortcuts (§7.7): Start/Stop, Show/Hide overlay, click-through lock,
// switch overlay mode. Registered on ready, released on quit.
// ---------------------------------------------------------------------------
function registerShortcuts(): void {
  const hk = getSettings().hotkeys;
  globalShortcut.register(hk.startStop ?? 'Ctrl+Alt+S', () => toggleSession());
  globalShortcut.register(hk.toggleOverlay ?? 'Ctrl+Alt+O', () => toggleOverlay());
  globalShortcut.register(hk.toggleClickThrough ?? 'Ctrl+Alt+L', () => toggleClickThrough());
  globalShortcut.register(hk.switchMode ?? 'Ctrl+Alt+M', () => cycleOverlayMode());
}

// --- Action handlers (shared by tray + hotkeys) ---------------------------

// Toggle a session from the tray/hotkey by calling the same start/stop routine
// the control IPC handler uses (§4.4). session:start mints a key in main and
// pushes config to the overlay; session:stop tells the overlay to close its WS.
function toggleSession(): void {
  sessionActive = !sessionActive;
  if (sessionActive) {
    // Default to mode 1 (loopback) with Vietnamese target when triggered here.
    void startSession(refs, { mode: 1, targetLang: 'vi' });
  } else {
    stopSession(refs);
  }
  refreshTrayMenu();
}

// Show/Hide the overlay window (§7.7 Ctrl+Alt+O).
function toggleOverlay(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (overlayWin.isVisible()) overlayWin.hide();
  else overlayWin.showInactive();
}

// Show/Hide the control window.
function toggleControl(): void {
  if (controlWin?.isVisible()) controlWin.hide();
  else showControl();
  refreshTrayMenu();
}

// Toggle overlay click-through lock (§7.7 Ctrl+Alt+L).
function toggleClickThrough(): void {
  clickThroughLocked = !clickThroughLocked;
  if (overlayWin) setClickThrough(overlayWin, clickThroughLocked);
}

// Set a specific overlay mode, persist it, and notify the overlay (§4.4).
function setOverlayMode(mode: 'caption' | 'panel'): void {
  patchSettings({ overlayMode: mode });
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send(CHANNELS.overlaySetMode, { overlay: mode });
  }
  refreshTrayMenu();
}

// Cycle caption ↔ panel (§7.7 Ctrl+Alt+M).
function cycleOverlayMode(): void {
  const next = getSettings().overlayMode === 'caption' ? 'panel' : 'caption';
  setOverlayMode(next);
}

// ---------------------------------------------------------------------------
// Security hardening applied to every webContents the app creates (§11):
// deny window.open and block navigation away from the app bundle/dev server.
// windows.ts hardens per-window too; this is the belt-and-braces global guard.
// ---------------------------------------------------------------------------
function hardenWebContentsGlobally(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file:');
      if (!allowed) event.preventDefault();
    });
    // Refuse all renderer permission requests (mic etc. are requested in the
    // renderer via getDisplayMedia, which is gated separately).
    contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  });
}

// ---------------------------------------------------------------------------
// Lifecycle teardown.
// ---------------------------------------------------------------------------

// Keep the app alive in the tray when all windows close (overlay HUD pattern).
app.on('window-all-closed', () => {
  // Do not auto-quit on win32/linux — the tray keeps the app running. macOS
  // also stays alive per platform convention.
});

// Release global shortcuts so they don't linger after exit.
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
