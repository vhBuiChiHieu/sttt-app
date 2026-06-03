// U5 — Temp-key mgr: computes refresh time from `expires_at`; triggers refresh
// before expiry. (SPEC §13.1)
//
// Tests the REAL main-process module `tempKey.ts`. `fetch` is the only external
// boundary; it is mocked. Time is controlled with fake timers so the 60s
// REFRESH_MARGIN_MS window is deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getKey, refresh, refreshAt, clearKey } from '@main/tempKey';

const NOW = Date.parse('2026-06-03T00:00:00Z');
const REFRESH_MARGIN_MS = 60_000; // mirrors tempKey.ts constant

// Build a fake worker response. `expires_at` shape is configurable to exercise
// normalizeExpiry (epoch ms / epoch seconds / ISO).
function mockWorker(api_key: string, expires_at: number | string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ api_key, expires_at }),
    })),
  );
}

describe('U5 temp-key manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    clearKey();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mints on first getKey and returns the key + epoch-ms expiry', async () => {
    const expMs = NOW + 3_600_000;
    mockWorker('temp:abc', expMs);
    const { tempKey, expiresAt } = await getKey();
    expect(tempKey).toBe('temp:abc');
    expect(expiresAt).toBe(expMs);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('computes refreshAt = expiry − 60s margin', async () => {
    const expMs = NOW + 3_600_000;
    mockWorker('temp:abc', expMs);
    await getKey();
    expect(refreshAt()).toBe(expMs - REFRESH_MARGIN_MS);
  });

  it('returns null refreshAt when no key is cached', () => {
    expect(refreshAt()).toBeNull();
  });

  it('serves the cached key (no re-mint) while outside the refresh margin', async () => {
    mockWorker('temp:abc', NOW + 3_600_000);
    await getKey();
    await getKey(); // still fresh → no second fetch
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-mints once the clock is within the refresh margin of expiry', async () => {
    mockWorker('temp:abc', NOW + 3_600_000);
    await getKey();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance to 30s before expiry — inside the 60s margin → must re-mint.
    vi.setSystemTime(NOW + 3_600_000 - 30_000);
    mockWorker('temp:def', NOW + 3_600_000 + 3_600_000);
    const { tempKey } = await getKey();
    expect(fetch).toHaveBeenCalledTimes(1); // new stub reset the counter
    expect(tempKey).toBe('temp:def');
  });

  it('refresh() forces a fresh mint regardless of cache freshness', async () => {
    mockWorker('temp:abc', NOW + 3_600_000);
    await getKey();
    mockWorker('temp:def', NOW + 7_200_000);
    const { tempKey } = await refresh();
    expect(tempKey).toBe('temp:def');
  });

  it('normalizes epoch-seconds expiry to epoch-ms', async () => {
    const expSec = Math.floor((NOW + 3_600_000) / 1000); // 10-digit seconds
    mockWorker('temp:abc', expSec);
    const { expiresAt } = await getKey();
    expect(expiresAt).toBe(expSec * 1000);
  });

  it('normalizes ISO-string expiry to epoch-ms', async () => {
    const iso = new Date(NOW + 3_600_000).toISOString();
    mockWorker('temp:abc', iso);
    const { expiresAt } = await getKey();
    expect(expiresAt).toBe(Date.parse(iso));
  });

  it('throws a clear error when the worker is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    await expect(refresh()).rejects.toThrow(/503/);
  });

  it('throws when the worker returns no api_key (malformed key, §13.5)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ expires_at: NOW }) })),
    );
    await expect(refresh()).rejects.toThrow(/no api_key/);
  });
});
