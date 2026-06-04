// Window manager (§4.1, §4.2). Builds the two BrowserWindows — a transparent,
// click-through overlay and a frameless rounded control window — with the exact
// properties from SPEC §4.2 and the hardened webPreferences from §11.

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

// Shared, security-hardened webPreferences for every window (§11):
// no node integration, context isolation on, sandboxed, typed preload bridge.
function securePreferences(): Electron.WebPreferences {
  return {
    // Preload emits as .cjs (see electron.vite.config.ts) so it loads under sandbox.
    preload: join(__dirname, '../preload/index.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    // Block <webview>; we never embed untrusted content.
    webviewTag: false,
  };
}

// Load a renderer entry by HTML filename, using electron-vite's dev server URL
// when present and the bundled file otherwise.
function loadEntry(win: BrowserWindow, htmlFile: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(`${devUrl}/${htmlFile}`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${htmlFile}`));
  }
}

// Harden a window against external navigation and new-window popups (§11).
// Returning { action: 'deny' } blocks window.open; the will-navigate guard
// blocks in-app navigation away from the bundle (dev URL is allowlisted).
function hardenNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // External http(s) links open in the user's browser, never in-app.
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file:');
    if (!allowed) event.preventDefault();
  });
}

// Dev-only: forward each renderer's console + crash/load failures to the MAIN
// process terminal. Renderer logs normally live only in that window's DevTools;
// piping them here means `npm run dev` (and an in-session `!` run) captures all
// of it — WS/audio/CSP errors included — without opening DevTools. The dev URL
// env is set by electron-vite only in dev, so this is a no-op in production.
function attachDevLogging(win: BrowserWindow, label: string): void {
  if (!process.env['ELECTRON_RENDERER_URL']) return;
  const wc = win.webContents;
  const levels = ['log', 'info', 'warn', 'error'];
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[${label}:${levels[level] ?? 'log'}] ${message}  (${sourceId}:${line})`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[${label}:preload-error] ${preloadPath}\n`, error);
  });
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[${label}:render-gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[${label}:did-fail-load] ${code} ${desc} ${url}`);
  });
}

// ---------------------------------------------------------------------------
// Overlay window (§4.2): transparent, frameless, always-on-top at screen-saver
// level, visible on all workspaces, off the taskbar, resizable, no shadow, and
// click-through by default (toggleable via setClickThrough()).
// ---------------------------------------------------------------------------
export function createOverlay(): BrowserWindow {
  // Cover the FULL work area of the primary display (#12/#15). A transparent
  // click-through canvas spanning the whole screen lets the renderer anchor the
  // caption to true screen edges and render the panel without clipping (the old
  // 200px bottom strip clipped the panel and trapped position presets in a band).
  // workArea excludes the taskbar; the renderer fine-tunes layout from settings.
  const { workArea } = screen.getPrimaryDisplay();
  const { x, y, width, height } = workArea;

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    // Don't steal focus when the overlay shows over other apps.
    focusable: false,
    show: false,
    webPreferences: securePreferences(),
  });

  // Always-on-top at the highest practical level so the overlay survives over
  // fullscreen apps (§4.2, §7.8). 1 = always above the screen-saver level.
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  // Float across every virtual desktop / fullscreen space (§7.8).
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Click-through by default — pointer events pass to the app beneath, while
  // `forward:true` still lets the renderer receive move events for hover UI.
  win.setIgnoreMouseEvents(true, { forward: true });

  hardenNavigation(win);
  attachDevLogging(win, 'overlay');
  loadEntry(win, 'overlay.html');
  return win;
}

// ---------------------------------------------------------------------------
// Control window (§4.2): normal frameless rounded window, 420×640, draggable
// header (handled CSS-side via -webkit-app-region), single instance enforced by
// the caller. Hidden until ready-to-show to avoid a white flash.
// ---------------------------------------------------------------------------
export function createControl(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    frame: false,
    resizable: false,
    show: false,
    // Rounded corners + translucency hint on supported platforms.
    roundedCorners: true,
    backgroundColor: '#00000000',
    webPreferences: securePreferences(),
  });

  win.on('ready-to-show', () => win.show());

  hardenNavigation(win);
  attachDevLogging(win, 'control');
  loadEntry(win, 'control.html');
  return win;
}

// Toggle the overlay's click-through lock (§7.7 Ctrl+Alt+L, §4.4
// overlay:set-clickthrough). `locked:true` → click-through (events pass below);
// `locked:false` → interactive overlay.
export function setClickThrough(overlay: BrowserWindow, locked: boolean): void {
  overlay.setIgnoreMouseEvents(locked, { forward: true });
}
