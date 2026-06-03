// Shared domain types — single source of truth for every slice.
// Keep this file dependency-free (no electron/react/node imports) so it can be
// imported from main, preload and renderer alike.

// ---------------------------------------------------------------------------
// Soniox STT-RT token (§6.2 + SONIOX_API_DOCS §5.8)
// ---------------------------------------------------------------------------

// `translation_status` distinguishes the two render lanes (§6.2):
//   'none'        → token is not translated
//   'original'    → spoken/original token that may be translated
//   'translation' → the translated (Vietnamese) token
export type TranslationStatus = 'none' | 'original' | 'translation';

// A single token from a Soniox real-time message. Spoken/original tokens carry
// timestamps; translation tokens do not (hence the optional ms fields).
export interface Token {
  text: string;
  start_ms?: number;
  end_ms?: number;
  confidence: number;
  is_final: boolean;
  // Language of `text` (e.g. 'en', 'vi'). Optional: not always present.
  language?: string;
  translation_status: TranslationStatus;
  // Source language for a translated token (only on translation tokens).
  source_language?: string;
}

// ---------------------------------------------------------------------------
// Soniox connection config — first WS message (§6.1)
// ---------------------------------------------------------------------------

export interface SonioxConfig {
  api_key: string;
  model: string;
  audio_format: string;
  sample_rate: number;
  num_channels: number;
  enable_endpoint_detection: boolean;
  enable_language_identification: boolean;
  // One-way translation into a single target language (we use 'vi').
  translation: {
    type: 'one_way';
    target_language: string;
  };
}

// ---------------------------------------------------------------------------
// Finalized transcript segment (panel scrollback, §6.2 rule 4)
// ---------------------------------------------------------------------------

export interface Segment {
  source: string;
  vietnamese: string;
  // Wall-clock epoch ms when the segment was flushed.
  time: number;
  speaker?: string;
}

// ---------------------------------------------------------------------------
// Persisted user settings (§8 settingsStore, §10)
// ---------------------------------------------------------------------------

export interface Settings {
  overlayMode: 'caption' | 'panel';
  // Font scale factor, 0.8–2.0 (80–200%, §7.8).
  fontScale: number;
  // Overlay opacity, 0..1.
  opacity: number;
  theme: 'dark' | 'auto';
  // Overlay anchor, e.g. 'bottom-center'.
  position: string;
  showSource: boolean;
  reducedMotion: boolean;
  // Action → accelerator string (§7.7), e.g. { startStop: 'Ctrl+Alt+S' }.
  hotkeys: Record<string, string>;
}

// Defaults applied on first run and when a persisted field is missing.
export const DEFAULT_SETTINGS: Settings = {
  overlayMode: 'caption',
  fontScale: 1.0,
  opacity: 0.85,
  theme: 'dark',
  position: 'bottom-center',
  showSource: true,
  reducedMotion: false,
  hotkeys: {
    startStop: 'Ctrl+Alt+S',
    toggleOverlay: 'Ctrl+Alt+O',
    toggleClickThrough: 'Ctrl+Alt+L',
    switchMode: 'Ctrl+Alt+M',
  },
};

// ---------------------------------------------------------------------------
// Session lifecycle state (§8 sessionStore, §4.4 status enum)
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'reconnecting'
  | 'error'
  | 'stopped';

export interface SessionState {
  status: SessionStatus;
  // Capture mode: 1 = system/loopback audio, 2 = microphone.
  mode: 1 | 2;
  // Elapsed session time in ms (used for the 300-min cap, §6.3).
  sessionMs: number;
  // Ephemeral Soniox temp key (never persisted, §10/§11).
  key?: string;
  // Epoch ms when the temp key expires.
  expiresAt?: number;
  error?: string;
}
