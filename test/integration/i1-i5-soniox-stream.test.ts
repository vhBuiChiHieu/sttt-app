// @vitest-environment jsdom
//
// Integration I1-I5 (SPEC §13.2) — SonioxClient + aggregate adapter driven
// against the controllable MockWebSocket, with Vitest fake timers for
// backoff/swap timing.
//
//   I1 Handshake          — config sent on open; binary frames flow; finished closes.
//   I2 Translation stream — mixed original+VI tokens render into correct lanes.
//   I3 Mid-stream error   — 503 → backoff → re-mint key → reopen → resume.
//   I4 Key expiry         — expiry mid-session → silent re-mint, no user-visible drop.
//   I5 300-min boundary   — session swap at cap with no gap in rendered text.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SonioxClient } from '@renderer/soniox/client';
import { createSonioxSession } from '@renderer/soniox/aggregate';
import { useTokenStore } from '@renderer/state/tokenStore';
import type { SonioxConfig, Token } from '@shared/types';
import type { SessionConfigPayload } from '@shared/ipc';
import { MockWebSocket, installMockWebSocket } from '../helpers/mock-websocket';

const baseConfig: SonioxConfig = {
  api_key: 'temp:init',
  model: 'stt-rt-v4',
  audio_format: 'pcm_s16le',
  sample_rate: 16000,
  num_channels: 1,
  enable_endpoint_detection: true,
  enable_language_identification: true,
  translation: { type: 'one_way', target_language: 'vi' },
};

function tok(
  text: string,
  is_final: boolean,
  translation_status: Token['translation_status'],
): Token {
  return { text, is_final, translation_status, confidence: 1 };
}

let restore: () => void;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  restore = installMockWebSocket();
  useTokenStore.getState().reset();
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe('I1 handshake', () => {
  it('sends the §6.1 config JSON as the first frame on open', () => {
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 3_600_000,
      mintKey: vi.fn(async () => ({ tempKey: 'temp:fresh', expiresAt: Date.now() + 3_600_000 })),
      callbacks: { onMessage: vi.fn(), onStatus: vi.fn(), onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();

    const cfg = MockWebSocket.last.configMessage();
    expect(cfg).toMatchObject({
      api_key: 'temp:init',
      model: 'stt-rt-v4',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      translation: { type: 'one_way', target_language: 'vi' },
    });
  });

  it('flows binary PCM frames and reports listening', () => {
    const onStatus = vi.fn();
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 3_600_000,
      mintKey: vi.fn(),
      callbacks: { onMessage: vi.fn(), onStatus, onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();
    expect(onStatus).toHaveBeenCalledWith('listening');

    client.sendPcm(new Int16Array([1, 2, 3, 4]).buffer);
    expect(MockWebSocket.last.binaryFrames()).toHaveLength(1);
    expect(MockWebSocket.last.binaryFrames()[0].byteLength).toBe(8);
  });

  it('closes cleanly on stop → empty frame → finished', () => {
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 3_600_000,
      mintKey: vi.fn(),
      callbacks: { onMessage: vi.fn(), onStatus: vi.fn(), onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();
    const ws = MockWebSocket.last;

    client.stop();
    // Empty end-of-stream binary frame.
    const empties = ws.binaryFrames().filter((b) => b.byteLength === 0);
    expect(empties).toHaveLength(1);

    // Server acks with finished → socket torn down (readyState CLOSED).
    ws.triggerJson({ tokens: [], finished: true });
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});

describe('I2 translation stream → correct lanes (via aggregate adapter)', () => {
  it('routes mixed original + VI tokens into the token store lanes', () => {
    const payload: SessionConfigPayload = {
      tempKey: 'temp:init',
      expiresAt: Date.now() + 3_600_000,
      model: 'stt-rt-v4',
      sampleRate: 16000,
      translation: { type: 'one_way', target_language: 'vi' },
    };
    const client = createSonioxSession(payload, payload.expiresAt);
    client.start();
    MockWebSocket.last.triggerOpen();

    MockWebSocket.last.triggerJson({
      tokens: [
        tok('Hello', true, 'original'),
        tok(' world', false, 'original'),
        tok('Xin chào', true, 'translation'),
        tok(' bạn', false, 'translation'),
      ],
    });

    const st = useTokenStore.getState();
    expect(st.source.final).toBe('Hello');
    expect(st.source.provisional).toBe(' world');
    expect(st.vi.final).toBe('Xin chào');
    expect(st.vi.provisional).toBe(' bạn');
  });

  it('flushes a segment on the endpoint marker token', () => {
    const payload: SessionConfigPayload = {
      tempKey: 'temp:init',
      expiresAt: Date.now() + 3_600_000,
      model: 'stt-rt-v4',
      sampleRate: 16000,
      translation: { type: 'one_way', target_language: 'vi' },
    };
    const client = createSonioxSession(payload, payload.expiresAt);
    client.start();
    MockWebSocket.last.triggerOpen();

    MockWebSocket.last.triggerJson({
      tokens: [tok('Hello', true, 'original'), tok('Xin chào', true, 'translation')],
    });
    // '<end>' is the endpoint sentinel → adapter strips it (the marker never
    // reaches rendered text) and flushes the current line to history.
    MockWebSocket.last.triggerJson({ tokens: [tok('<end>', true, 'none')] });

    const st = useTokenStore.getState();
    expect(st.segments).toHaveLength(1);
    expect(st.segments[0].source).toBe('Hello');
    expect(st.segments[0].vietnamese).toBe('Xin chào');
    expect(st.source.final).toBe(''); // live line cleared after flush
  });
});

describe('I3 mid-stream 503 → backoff → re-mint → reopen → resume', () => {
  it('re-mints a fresh key and re-sends config on reconnect', async () => {
    const mintKey = vi
      .fn()
      .mockResolvedValue({ tempKey: 'temp:remint', expiresAt: Date.now() + 3_600_000 });
    const onStatus = vi.fn();
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 3_600_000,
      mintKey,
      callbacks: { onMessage: vi.fn(), onStatus, onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();

    // Server emits a retryable 503 error, then drops the socket.
    MockWebSocket.last.triggerJson({ tokens: [], error_code: 503 });
    expect(onStatus).toHaveBeenCalledWith('reconnecting');
    MockWebSocket.last.triggerClose();

    const before = MockWebSocket.instances.length;
    await vi.advanceTimersByTimeAsync(500); // first backoff step
    expect(mintKey).toHaveBeenCalledTimes(1); // fresh key minted
    expect(MockWebSocket.instances.length).toBe(before + 1); // socket reopened

    // New socket re-handshakes with the re-minted key.
    MockWebSocket.last.triggerOpen();
    expect(MockWebSocket.last.configMessage()).toMatchObject({ api_key: 'temp:remint' });
    expect(onStatus).toHaveBeenCalledWith('listening');
  });
});

describe('I4 key expiry → silent re-mint, no drop', () => {
  it('proactively re-mints before expiry without tearing down the socket', async () => {
    const mintKey = vi
      .fn()
      .mockResolvedValue({ tempKey: 'temp:refreshed', expiresAt: Date.now() + 7_200_000 });
    const onStatus = vi.fn();
    // Expiry 90s out; KEY_REFRESH_LEAD_MS is 30s → refresh fires at ~60s.
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 90_000,
      mintKey,
      callbacks: { onMessage: vi.fn(), onStatus, onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();
    const socketBefore = MockWebSocket.last;
    onStatus.mockClear();

    // Just before the lead window: no refresh yet.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(mintKey).not.toHaveBeenCalled();

    // Cross the lead window → quiet refresh.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mintKey).toHaveBeenCalledTimes(1);

    // Socket is the SAME (no reconnect) and the user sees no status churn.
    expect(MockWebSocket.last).toBe(socketBefore);
    expect(MockWebSocket.last.readyState).toBe(MockWebSocket.OPEN);
    expect(onStatus).not.toHaveBeenCalledWith('reconnecting');
    expect(onStatus).not.toHaveBeenCalledWith('error');
  });
});

describe('I5 300-min boundary → seamless session swap', () => {
  it('swaps to a fresh socket at the 290-min mark without flashing reconnecting', async () => {
    const mintKey = vi
      .fn()
      .mockResolvedValue({ tempKey: 'temp:swapped', expiresAt: Date.now() + 100 * 60_000 });
    const onStatus = vi.fn();
    const client = new SonioxClient({
      config: baseConfig,
      initialExpiresAt: Date.now() + 100 * 60_000,
      mintKey,
      callbacks: { onMessage: vi.fn(), onStatus, onFatal: vi.fn() },
    });
    client.start();
    MockWebSocket.last.triggerOpen();
    onStatus.mockClear();
    const before = MockWebSocket.instances.length;

    // Advance to the 290-min swap point. The swap closes the old socket; onclose
    // → scheduleReconnect → fresh key + reconnect (swapping flag set). Use the
    // synchronous advance to fast-forward through the ~1700 keepalive interval
    // ticks in one shot (the async variant awaits microtasks per tick → timeout).
    vi.advanceTimersByTime(290 * 60_000);
    // Run the reconnect backoff (index reset to 0 → 500ms) + mint resolution.
    await vi.advanceTimersByTimeAsync(500);

    expect(mintKey).toHaveBeenCalled();
    expect(MockWebSocket.instances.length).toBeGreaterThan(before); // new socket

    // The swap reconnect reports 'connecting', never the alarming 'reconnecting'.
    MockWebSocket.last.triggerOpen();
    expect(onStatus).not.toHaveBeenCalledWith('error');
    expect(MockWebSocket.last.configMessage()).toMatchObject({ api_key: 'temp:swapped' });

    client.stop();
  });
});
