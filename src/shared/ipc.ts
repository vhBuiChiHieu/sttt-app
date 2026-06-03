// Typed IPC contract (§4.4). Single source of truth for channel names and
// per-channel payload shapes, shared by main, preload and renderer.
// Keep dependency-free apart from the sibling `types` module.

import type { SessionStatus, Settings } from './types';

// ---------------------------------------------------------------------------
// Channel names — exact strings from the §4.4 table. Frozen so consumers get
// literal types and cannot be mutated at runtime.
// ---------------------------------------------------------------------------

export const CHANNELS = {
  sessionStart: 'session:start',
  sessionStop: 'session:stop',
  sessionConfig: 'session:config',
  sessionRefreshKey: 'session:refresh-key',
  sessionState: 'session:state',
  overlaySetMode: 'overlay:set-mode',
  overlaySetClickThrough: 'overlay:set-clickthrough',
  overlayAppearance: 'overlay:appearance',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

// Union of all channel string literals.
export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

// ---------------------------------------------------------------------------
// Per-channel payloads (§4.4 'Payload' column)
// ---------------------------------------------------------------------------

// session:start  (Control → Main): begin a session.
export interface SessionStartPayload {
  mode: 1 | 2;
  targetLang: string;
  // Optional language hints to bias detection.
  sourceHints?: string[];
}

// session:stop  (Control → Main): end the session. Empty body.
export type SessionStopPayload = Record<string, never>;

// session:config  (Main → Overlay): push minted key + Soniox config to overlay.
export interface SessionConfigPayload {
  tempKey: string;
  // Absolute epoch-ms expiry of tempKey — overlay seeds the Soniox client's
  // key-refresh timer from this without an extra refresh-key round-trip.
  expiresAt: number;
  model: string;
  sampleRate: number;
  translation: {
    type: 'one_way';
    target_language: string;
  };
}

// session:refresh-key  (Overlay ↔ Main): re-mint temp key on expiry/reconnect.
export interface RefreshKeyPayload {
  tempKey: string;
  expiresAt: number;
}

// session:state  (Overlay → Control,Main): status broadcast.
export interface SessionStatePayload {
  status: SessionStatus;
  sessionMs: number;
  tokenCount: number;
  error?: string;
}

// overlay:set-mode  (Control → Overlay): switch overlay style.
export interface OverlaySetModePayload {
  overlay: 'caption' | 'panel';
}

// overlay:set-clickthrough  (Control → Main): toggle click-through lock.
export interface OverlayClickthroughPayload {
  locked: boolean;
}

// overlay:appearance  (Control → Overlay): live appearance update.
export interface OverlayAppearancePayload {
  fontScale: number;
  opacity: number;
  theme: string;
  position: string;
}

// Maps every channel to its payload type for compile-time wiring checks.
export interface ChannelPayloads {
  [CHANNELS.sessionStart]: SessionStartPayload;
  [CHANNELS.sessionStop]: SessionStopPayload;
  [CHANNELS.sessionConfig]: SessionConfigPayload;
  [CHANNELS.sessionRefreshKey]: RefreshKeyPayload;
  [CHANNELS.sessionState]: SessionStatePayload;
  [CHANNELS.overlaySetMode]: OverlaySetModePayload;
  [CHANNELS.overlaySetClickThrough]: OverlayClickthroughPayload;
  [CHANNELS.overlayAppearance]: OverlayAppearancePayload;
}

// ---------------------------------------------------------------------------
// Preload-exposed API surface. Renderer and preload share this one contract so
// the bridge stays typed end-to-end. Event subscriptions return an unsubscribe
// function for clean teardown.
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

export interface IpcApi {
  // --- Session control (renderer → main) ---
  startSession(payload: SessionStartPayload): void;
  stopSession(): void;
  // Overlay broadcasts its live status up; main relays it to the control window.
  sendSessionState(payload: SessionStatePayload): void;

  // --- Overlay control (renderer → main/overlay) ---
  setOverlayMode(payload: OverlaySetModePayload): void;
  setClickThrough(payload: OverlayClickthroughPayload): void;
  setOverlayAppearance(payload: OverlayAppearancePayload): void;

  // --- Key refresh (overlay ↔ main): request a fresh temp key ---
  refreshKey(): Promise<RefreshKeyPayload>;

  // --- Settings (renderer ↔ main) ---
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;

  // --- Inbound events (main/overlay → renderer) ---
  onSessionConfig(handler: (payload: SessionConfigPayload) => void): Unsubscribe;
  // Main relays a user/tray-initiated stop to the overlay for graceful teardown.
  onSessionStop(handler: () => void): Unsubscribe;
  onSessionState(handler: (payload: SessionStatePayload) => void): Unsubscribe;
  onRefreshKey(handler: (payload: RefreshKeyPayload) => void): Unsubscribe;
  onOverlaySetMode(handler: (payload: OverlaySetModePayload) => void): Unsubscribe;
  onOverlayAppearance(handler: (payload: OverlayAppearancePayload) => void): Unsubscribe;
}
