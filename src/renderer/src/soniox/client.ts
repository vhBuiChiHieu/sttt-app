// Soniox STT-RT WebSocket client (renderer).
//
// Owns the connection lifecycle to wss://stt-rt.soniox.com/transcribe-websocket:
//   - opens the socket, sends the §6.1 config JSON (with a temp api_key minted in main),
//   - streams PCM via binary frames (sendPcm),
//   - keepalive / optional finalize control messages (§6.3),
//   - reconnect with exponential backoff + key re-mint,
//   - key-expiry refresh and ~290 min session swap,
//   - error routing by error_type/error_code (§6.3 / SONIOX_API_DOCS §7.3),
//   - graceful stop (empty frame → await `finished` → close).
//
// This class does NOT aggregate tokens. It parses each inbound message just
// enough to drive lifecycle, and forwards the full parsed payload to `onMessage`
// so the State slice (via aggregate.ts) can apply the §6.2 rules.

import type { Token, SonioxConfig } from '@shared/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Inbound Soniox real-time message (success / finished / error are all variants
// of the same envelope — distinguished by `finished` and `error_*` fields).
export interface SonioxMessage {
  tokens: Token[];
  final_audio_proc_ms?: number;
  total_audio_proc_ms?: number;
  finished?: boolean;
  // Error envelope (§7.2): present only on the terminal error message.
  error_code?: number;
  error_type?: string;
  error_message?: string;
  request_id?: string;
}

// Connection/lifecycle status surfaced to the UI (mirrors §4.4 status enum,
// minus 'idle'/'stopped' which the session store owns).
export type ClientStatus = 'connecting' | 'listening' | 'reconnecting' | 'error';

// A function that mints a fresh temp key from main (wraps IPC
// `session:refresh-key`). Injected so the client stays decoupled from `window`.
export type MintKey = () => Promise<{ tempKey: string; expiresAt: number }>;

export interface SonioxClientCallbacks {
  // Each fully-parsed inbound message (success or finished). Error messages are
  // handled internally and NOT forwarded here.
  onMessage(msg: SonioxMessage): void;
  // Status transitions for UI/status broadcast.
  onStatus(status: ClientStatus): void;
  // Fatal, non-retryable error (e.g. 400 fix-and-stop, or auth that cannot be
  // recovered). The caller should surface this and stop the session.
  onFatal(error: { error_type?: string; error_message?: string; request_id?: string }): void;
}

export interface SonioxClientOptions {
  // Base config (§6.1). `api_key` is overwritten on every (re)connect with the
  // freshest minted key, so the value passed here is only the initial key.
  config: SonioxConfig;
  initialExpiresAt: number;
  mintKey: MintKey;
  callbacks: SonioxClientCallbacks;
}

// ---------------------------------------------------------------------------
// Tunables (§6.3 policies). Centralised for clarity / testability.
// ---------------------------------------------------------------------------

const WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

// Keepalive: send after >15s of no audio; hard server limit is 20s (§6.3).
const KEEPALIVE_IDLE_MS = 15_000;
const KEEPALIVE_PERIOD_MS = 10_000; // re-arm cadence while paused

// Optional manual finalize ~200ms after speech stops, for snappier finals.
const FINALIZE_SILENCE_MS = 200;

// Reconnect backoff schedule (seconds → ms), capped at 10s.
const BACKOFF_MS = [500, 1000, 2000, 5000, 10_000];

// Session cap is 300 min; swap proactively at 290 min to avoid a hard close.
const SESSION_SWAP_MS = 290 * 60 * 1000;

// Refresh the temp key this far before its stated expiry.
const KEY_REFRESH_LEAD_MS = 30_000;

// error_type → recovery strategy (§7.3 / §6.3). We branch on type, not message.
// Codes are kept as a fallback when error_type is absent.
const RETRY_CODES = new Set([408, 429, 500, 503]);
const REAUTH_CODES = new Set([401, 403]);
const RETRY_TYPES = new Set(['request_timeout', 'limit_exceeded', 'internal_error', 'service_unavailable']);
const REAUTH_TYPES = new Set(['unauthenticated', 'temp_api_key_session_expired']);

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SonioxClient {
  private readonly opts: SonioxClientOptions;
  private ws: WebSocket | null = null;

  // Freshest key + expiry; mutated on refresh/reconnect/swap.
  private apiKey: string;
  private expiresAt: number;

  // Lifecycle flags.
  private stopping = false; // graceful stop in progress (don't reconnect)
  private swapping = false; // session-swap reconnect (suppress 'reconnecting' UI churn)
  private backoffIndex = 0;

  // Timers (kept as handles so we can clear them on teardown).
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keyRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionSwapTimer: ReturnType<typeof setTimeout> | null = null;

  private lastAudioAt = 0; // perf ms of the last PCM frame (drives keepalive)

  constructor(opts: SonioxClientOptions) {
    this.opts = opts;
    this.apiKey = opts.config.api_key;
    this.expiresAt = opts.initialExpiresAt;
  }

  // --- Public API -----------------------------------------------------------

  // Open the socket and begin a session. Idempotent: a second call while a
  // socket exists is ignored.
  start(): void {
    if (this.ws) return;
    this.stopping = false;
    this.backoffIndex = 0;
    this.armSessionSwap();
    this.connect();
  }

  // Send one PCM frame (Int16 LE) as a binary WS frame. No-ops unless the socket
  // is open. Resets the keepalive idle clock and arms the optional finalize.
  sendPcm(buf: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(buf);
    this.lastAudioAt = performance.now();
    this.armFinalize();
  }

  // Graceful stop (§6.3): send empty frame, let Soniox emit remaining finals +
  // `finished`, then the close handler tears everything down.
  stop(): void {
    this.stopping = true;
    this.clearTimer('reconnect');
    this.clearTimer('keepalive');
    this.clearTimer('finalize');
    this.clearTimer('keyRefresh');
    this.clearTimer('sessionSwap');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Empty binary frame signals end-of-stream; we await `finished` server-side.
      this.ws.send(new ArrayBuffer(0));
    } else {
      this.teardownSocket();
    }
  }

  // --- Connection -----------------------------------------------------------

  private connect(): void {
    this.opts.callbacks.onStatus(this.swapping ? 'connecting' : this.backoffIndex > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      // First message MUST be the config JSON, with the freshest api_key (§6.1).
      const config: SonioxConfig = { ...this.opts.config, api_key: this.apiKey };
      ws.send(JSON.stringify(config));
      this.backoffIndex = 0; // a clean open resets backoff
      this.swapping = false;
      this.lastAudioAt = performance.now();
      this.armKeepalive();
      this.armKeyRefresh();
      this.opts.callbacks.onStatus('listening');
    };

    ws.onmessage = (ev) => this.handleMessage(ev.data);

    ws.onerror = () => {
      // Transport-level error: the close handler runs next and drives recovery.
      // Nothing to do here beyond letting onclose decide reconnect vs stop.
    };

    ws.onclose = () => {
      this.clearTimer('keepalive');
      this.clearTimer('finalize');
      this.clearTimer('keyRefresh');
      this.ws = null;
      if (this.stopping) {
        this.teardownSocket();
        return;
      }
      // Unexpected close → reconnect with backoff (re-mint key + re-send config).
      this.scheduleReconnect();
    };
  }

  // Parse + route an inbound message. Strings are JSON; binary is unexpected.
  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return; // Soniox sends JSON text frames only
    let msg: SonioxMessage;
    try {
      msg = JSON.parse(data) as SonioxMessage;
    } catch {
      return; // ignore unparseable frames rather than crash the session
    }

    // Error envelope (§7.2): branch by error_type, fall back to error_code.
    if (msg.error_type !== undefined || msg.error_code !== undefined) {
      this.handleError(msg);
      return;
    }

    // Normal token message (success or finished). Forward to the aggregator.
    this.opts.callbacks.onMessage(msg);

    // `finished` arrives only after we sent the empty frame during stop().
    if (msg.finished) {
      this.teardownSocket();
    }
  }

  // Route a server error by type/code (§6.3 / §7.3). The socket is closed by
  // Soniox right after an error, so onclose handles the actual reconnect; here
  // we only decide retry vs fatal and re-mint on auth failures.
  private handleError(msg: SonioxMessage): void {
    const type = msg.error_type;
    const code = msg.error_code;
    const retryable = (type !== undefined && RETRY_TYPES.has(type)) || (code !== undefined && RETRY_CODES.has(code));
    const reauth = (type !== undefined && REAUTH_TYPES.has(type)) || (code !== undefined && REAUTH_CODES.has(code));

    if (retryable || reauth) {
      // Both paths reconnect; reauth additionally forces a fresh key mint, which
      // scheduleReconnect already does on every attempt. Let onclose drive it.
      this.opts.callbacks.onStatus('reconnecting');
      return;
    }

    // 400 / unknown → fix-and-stop. Do not retry blindly (§7.4).
    this.stopping = true;
    this.opts.callbacks.onStatus('error');
    this.opts.callbacks.onFatal({
      error_type: msg.error_type,
      error_message: msg.error_message,
      request_id: msg.request_id,
    });
  }

  // --- Reconnect ------------------------------------------------------------

  private scheduleReconnect(): void {
    this.opts.callbacks.onStatus('reconnecting');
    const delay = BACKOFF_MS[Math.min(this.backoffIndex, BACKOFF_MS.length - 1)];
    this.backoffIndex += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.reconnectWithFreshKey();
    }, delay);
  }

  // Re-mint the temp key (always fresh on reconnect, §6.3), then reopen + re-send
  // config in connect(). If minting fails, back off and try again.
  private async reconnectWithFreshKey(): Promise<void> {
    if (this.stopping) return;
    try {
      const { tempKey, expiresAt } = await this.opts.mintKey();
      this.apiKey = tempKey;
      this.expiresAt = expiresAt;
      this.connect();
    } catch {
      // Mint failed (e.g. offline) — keep retrying with continued backoff.
      this.scheduleReconnect();
    }
  }

  // --- Session swap (300 min cap, §6.3) -------------------------------------

  // At ~290 min, open a fresh session with a new key and swap seamlessly. We
  // re-use the reconnect path but flag it so the UI doesn't flash 'reconnecting'.
  private armSessionSwap(): void {
    this.clearTimer('sessionSwap');
    this.sessionSwapTimer = setTimeout(() => {
      if (this.stopping) return;
      this.swapping = true;
      this.backoffIndex = 0;
      // Close current socket; onclose → scheduleReconnect → fresh key + config.
      if (this.ws) this.ws.close();
      this.armSessionSwap(); // arm the next 290-min window
    }, SESSION_SWAP_MS);
  }

  // --- Key expiry refresh ---------------------------------------------------

  // Proactively re-mint the key shortly before `expires_at`. The new key takes
  // effect on the next (re)connect; mid-stream the existing session keeps its
  // already-authenticated socket, so we just keep the value warm for reconnects.
  private armKeyRefresh(): void {
    this.clearTimer('keyRefresh');
    const lead = this.expiresAt - Date.now() - KEY_REFRESH_LEAD_MS;
    const delay = Math.max(0, lead);
    this.keyRefreshTimer = setTimeout(() => {
      void this.refreshKeyQuietly();
    }, delay);
  }

  private async refreshKeyQuietly(): Promise<void> {
    if (this.stopping) return;
    try {
      const { tempKey, expiresAt } = await this.opts.mintKey();
      this.apiKey = tempKey;
      this.expiresAt = expiresAt;
      this.armKeyRefresh(); // re-arm against the new expiry
    } catch {
      // Retry the refresh on a short fixed delay; failure isn't fatal until a
      // reconnect actually needs the key.
      this.keyRefreshTimer = setTimeout(() => void this.refreshKeyQuietly(), 5_000);
    }
  }

  // --- Keepalive / finalize -------------------------------------------------

  // Periodically check for audio idleness; if >15s since last frame, send a
  // keepalive control message to stay under the 20s server idle limit (§6.3).
  private armKeepalive(): void {
    this.clearTimer('keepalive');
    this.keepaliveTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const idle = performance.now() - this.lastAudioAt;
      if (idle > KEEPALIVE_IDLE_MS) {
        this.ws.send(JSON.stringify({ type: 'keepalive' }));
      }
    }, KEEPALIVE_PERIOD_MS);
  }

  // After each PCM frame, (re)arm a one-shot finalize that fires only if audio
  // then goes silent for ~200ms — snappier finals without over-calling (§5.3).
  private armFinalize(): void {
    this.clearTimer('finalize');
    this.finalizeTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'finalize' }));
      }
    }, FINALIZE_SILENCE_MS);
  }

  // --- Teardown -------------------------------------------------------------

  // Final cleanup: clear all timers and drop the socket reference.
  private teardownSocket(): void {
    this.clearTimer('keepalive');
    this.clearTimer('finalize');
    this.clearTimer('reconnect');
    this.clearTimer('keyRefresh');
    this.clearTimer('sessionSwap');
    if (this.ws) {
      // Detach handlers so a late close/error can't re-trigger reconnect.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  // Small helper to clear+null a named timer without repeating boilerplate.
  private clearTimer(name: 'keepalive' | 'finalize' | 'reconnect' | 'keyRefresh' | 'sessionSwap'): void {
    const map = {
      keepalive: () => {
        if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = null;
      },
      finalize: () => {
        if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
        this.finalizeTimer = null;
      },
      reconnect: () => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      },
      keyRefresh: () => {
        if (this.keyRefreshTimer) clearTimeout(this.keyRefreshTimer);
        this.keyRefreshTimer = null;
      },
      sessionSwap: () => {
        if (this.sessionSwapTimer) clearTimeout(this.sessionSwapTimer);
        this.sessionSwapTimer = null;
      },
    };
    map[name]();
  }
}
