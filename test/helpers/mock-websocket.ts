// Controllable fake WebSocket for SonioxClient tests (U6-U8, I1-I5).
//
// SonioxClient uses the GLOBAL `WebSocket` constructor (SPEC §3 "Native
// WebSocket (renderer)"). Rather than stand up a real ws server (which fights
// Vitest fake timers used for backoff/keepalive/swap timing), we install this
// fake as `global.WebSocket`. Each instance is registered so a test can grab the
// latest socket and drive open/message/close/error by hand.
//
// It implements only the surface SonioxClient touches: readyState, binaryType,
// the four on* handlers, send(), close(), and the OPEN/CONNECTING/... constants.

export type SentFrame = string | ArrayBuffer;

export class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  // Every constructed socket lands here so tests can address them in order.
  static instances: MockWebSocket[] = [];
  static get last(): MockWebSocket {
    const s = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!s) throw new Error('no MockWebSocket constructed yet');
    return s;
  }
  static reset(): void {
    MockWebSocket.instances = [];
  }

  readonly url: string;
  binaryType = 'blob';
  readyState: number = MockWebSocket.CONNECTING;

  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: SentFrame }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;

  // Everything the client sent, in order. Binary frames are ArrayBuffers.
  readonly sent: SentFrame[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: SentFrame): void {
    this.sent.push(data);
  }

  close(): void {
    // Mirror the browser: closing an open/connecting socket fires onclose async-ish.
    // We fire synchronously here and let the test's fake timers/awaits sequence it.
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }

  // --- Test drivers ---------------------------------------------------------

  // Simulate the server accepting the connection.
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  // Deliver a JSON text frame from the "server".
  triggerJson(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  // Deliver a raw frame (binary or pre-stringified) as-is.
  triggerRaw(data: SentFrame): void {
    this.onmessage?.({ data });
  }

  // Simulate the server/transport dropping the socket.
  triggerClose(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: '', wasClean: false });
  }

  triggerError(): void {
    this.onerror?.({});
  }

  // --- Inspection helpers ---------------------------------------------------

  // The text frames sent (e.g. config JSON, keepalive, finalize).
  textFrames(): string[] {
    return this.sent.filter((f): f is string => typeof f === 'string');
  }

  // The binary frames sent (PCM + the empty stop frame).
  binaryFrames(): ArrayBuffer[] {
    return this.sent.filter((f): f is ArrayBuffer => f instanceof ArrayBuffer);
  }

  // Parsed first config message (the handshake), if present.
  configMessage(): Record<string, unknown> | null {
    const first = this.textFrames()[0];
    return first ? (JSON.parse(first) as Record<string, unknown>) : null;
  }
}

// Install MockWebSocket as the global constructor and return a cleanup fn.
export function installMockWebSocket(): () => void {
  const prev = (globalThis as { WebSocket?: unknown }).WebSocket;
  MockWebSocket.reset();
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
  return () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = prev;
    MockWebSocket.reset();
  };
}
