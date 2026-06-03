// @vitest-environment jsdom
//
// U6 — Backoff: reconnect delays follow 0.5→1→2→5→10 cap; resets on success.
// U7 — Keepalive timer: fires after >15s without audio; cancels on audio resume.
// U8 — Error routing: branches by error_type; retryable vs fatal classification.
// (SPEC §13.1, policies §6.3)
//
// Drives the REAL `SonioxClient` against the MockWebSocket harness with Vitest
// fake timers so backoff/keepalive timing is deterministic. jsdom env supplies
// `performance` (which the keepalive idle clock reads).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SonioxClient } from '@renderer/soniox/client';
import type { SonioxConfig } from '@shared/types';
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

// Spy callbacks + a mintKey that hands back a fresh key each call.
function makeClient(mint?: ReturnType<typeof vi.fn>) {
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const onFatal = vi.fn();
  const mintKey =
    mint ?? vi.fn(async () => ({ tempKey: 'temp:fresh', expiresAt: Date.now() + 3_600_000 }));
  const client = new SonioxClient({
    config: baseConfig,
    initialExpiresAt: Date.now() + 3_600_000,
    mintKey,
    callbacks: { onMessage, onStatus, onFatal },
  });
  return { client, onMessage, onStatus, onFatal, mintKey };
}

let restore: () => void;
beforeEach(() => {
  // Fake `performance` too: the client's keepalive idle clock reads
  // performance.now(); without faking it, advancing timers wouldn't move that
  // clock and the >15s idle check would never trip.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  restore = installMockWebSocket();
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe('U6 reconnect backoff schedule', () => {
  it('follows 0.5s → 1s → 2s → 5s → 10s and caps at 10s', async () => {
    const { client } = makeClient();
    client.start();
    MockWebSocket.last.triggerOpen();

    const schedule = [500, 1000, 2000, 5000, 10_000, 10_000];
    for (const delay of schedule) {
      const before = MockWebSocket.instances.length;
      // Drop the socket → schedules a reconnect at `delay`.
      MockWebSocket.last.triggerClose();

      // Just before the delay: no new socket yet.
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(MockWebSocket.instances.length).toBe(before);

      // At the delay: reconnectWithFreshKey runs (mintKey resolves), new socket opens.
      await vi.advanceTimersByTimeAsync(1);
      expect(MockWebSocket.instances.length).toBe(before + 1);
    }
  });

  it('resets backoff to 0.5s after a successful (re)open', async () => {
    const { client } = makeClient();
    client.start();
    MockWebSocket.last.triggerOpen();

    // Two failures climb the schedule to 2s.
    MockWebSocket.last.triggerClose();
    await vi.advanceTimersByTimeAsync(500);
    MockWebSocket.last.triggerClose();
    await vi.advanceTimersByTimeAsync(1000);

    // This reconnect succeeds (open) → backoff index resets.
    MockWebSocket.last.triggerOpen();

    // Next drop must again wait only 500ms.
    const before = MockWebSocket.instances.length;
    MockWebSocket.last.triggerClose();
    await vi.advanceTimersByTimeAsync(499);
    expect(MockWebSocket.instances.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(MockWebSocket.instances.length).toBe(before + 1);
  });
});

describe('U7 keepalive timer', () => {
  it('sends a keepalive once >15s elapse with no audio', async () => {
    const { client } = makeClient();
    client.start();
    MockWebSocket.last.triggerOpen();
    const ws = MockWebSocket.last;

    // Keepalive checks every 10s; at 10s idle is <15s → nothing sent yet.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.textFrames().some((f) => f.includes('keepalive'))).toBe(false);

    // At 20s total, idle (20s) > 15s → keepalive fires.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.textFrames().some((f) => f.includes('keepalive'))).toBe(true);
  });

  it('does not send keepalive while audio keeps flowing (idle clock resets)', async () => {
    const { client } = makeClient();
    client.start();
    MockWebSocket.last.triggerOpen();
    const ws = MockWebSocket.last;

    // Feed a PCM frame every 9s so idle never crosses 15s at a 10s check.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(9_000);
      client.sendPcm(new ArrayBuffer(8));
    }
    expect(ws.textFrames().some((f) => f.includes('keepalive'))).toBe(false);
  });
});

describe('U8 error routing — retryable vs fatal', () => {
  it('treats retryable error_types as reconnecting (not fatal)', () => {
    for (const type of [
      'request_timeout',
      'limit_exceeded',
      'internal_error',
      'service_unavailable',
    ]) {
      const { client, onStatus, onFatal } = makeClient();
      client.start();
      MockWebSocket.last.triggerOpen();
      onStatus.mockClear();
      MockWebSocket.last.triggerJson({ tokens: [], error_type: type, error_message: type });
      expect(onStatus).toHaveBeenCalledWith('reconnecting');
      expect(onFatal).not.toHaveBeenCalled();
    }
  });

  it('treats retryable error_codes (408/429/500/503) as reconnecting', () => {
    for (const code of [408, 429, 500, 503]) {
      const { client, onStatus, onFatal } = makeClient();
      client.start();
      MockWebSocket.last.triggerOpen();
      onStatus.mockClear();
      MockWebSocket.last.triggerJson({ tokens: [], error_code: code });
      expect(onStatus).toHaveBeenCalledWith('reconnecting');
      expect(onFatal).not.toHaveBeenCalled();
    }
  });

  it('treats auth error_types/codes as recoverable reconnect (re-mint path)', () => {
    const cases: Array<Record<string, unknown>> = [
      { error_type: 'unauthenticated' },
      { error_type: 'temp_api_key_session_expired' },
      { error_code: 401 },
      { error_code: 403 },
    ];
    for (const env of cases) {
      const { client, onStatus, onFatal } = makeClient();
      client.start();
      MockWebSocket.last.triggerOpen();
      onStatus.mockClear();
      MockWebSocket.last.triggerJson({ tokens: [], ...env });
      expect(onStatus).toHaveBeenCalledWith('reconnecting');
      expect(onFatal).not.toHaveBeenCalled();
    }
  });

  it('classifies 400 / unknown types as fatal (fix-and-stop)', () => {
    const { client, onStatus, onFatal } = makeClient();
    client.start();
    MockWebSocket.last.triggerOpen();
    MockWebSocket.last.triggerJson({
      tokens: [],
      error_code: 400,
      error_type: 'invalid_request',
      error_message: 'bad target_language',
      request_id: 'req-1',
    });
    expect(onStatus).toHaveBeenCalledWith('error');
    expect(onFatal).toHaveBeenCalledWith(
      expect.objectContaining({ error_type: 'invalid_request', request_id: 'req-1' }),
    );
  });
});
