// Temp-key manager (§6, §11). Mints short-lived Soniox keys from the worker in
// the MAIN process; the permanent key never lives in the app. Caches the key,
// computes a refresh time before expiry, and exposes getKey()/refresh().

import type { RefreshKeyPayload } from '@shared/ipc';

// Worker endpoint that mints temp keys (§6). Returns { api_key, expires_at }.
const WORKER_URL = 'https://soniox.obert-john.workers.dev/';

// Refresh this many ms BEFORE the reported expiry, so a fresh key is always
// available before the old one lapses (§6.3 "refresh before expiry", test U5).
const REFRESH_MARGIN_MS = 60_000;

// Raw worker response shape. `expires_at` may arrive as epoch seconds, epoch ms
// or an ISO string depending on the worker; normalizeExpiry() handles all.
interface WorkerKeyResponse {
  api_key: string;
  expires_at: number | string;
}

// Cached key state. Kept in memory only, never persisted/logged (§11).
interface CachedKey {
  tempKey: string;
  expiresAt: number; // epoch ms
}

let cached: CachedKey | null = null;

// Convert the worker's `expires_at` into an absolute epoch-ms timestamp.
// Accepts ISO strings, epoch seconds (10-digit) and epoch ms (13-digit).
function normalizeExpiry(raw: number | string): number {
  if (typeof raw === 'string') {
    const asNum = Number(raw);
    // Pure-numeric string → fall through to numeric handling below.
    if (!Number.isFinite(asNum)) {
      const parsed = Date.parse(raw);
      // Fallback: assume ~1h validity if the value is unparseable.
      return Number.isNaN(parsed) ? Date.now() + 3_600_000 : parsed;
    }
    raw = asNum;
  }
  // Heuristic: values below ~10^12 are seconds, otherwise already ms.
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

// Fetch a brand-new key from the worker and update the cache.
async function mint(): Promise<CachedKey> {
  const res = await fetch(WORKER_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`temp-key worker responded ${res.status}`);
  }
  const body = (await res.json()) as WorkerKeyResponse;
  if (!body.api_key) {
    throw new Error('temp-key worker returned no api_key');
  }
  cached = {
    tempKey: body.api_key,
    expiresAt: normalizeExpiry(body.expires_at),
  };
  return cached;
}

// True when there is no cached key or it is within the refresh margin of expiry.
function needsRefresh(): boolean {
  if (!cached) return true;
  return Date.now() >= cached.expiresAt - REFRESH_MARGIN_MS;
}

// Return a valid key, minting/refreshing transparently if the cache is stale.
export async function getKey(): Promise<RefreshKeyPayload> {
  const key = needsRefresh() ? await mint() : cached!;
  return { tempKey: key.tempKey, expiresAt: key.expiresAt };
}

// Force a fresh mint regardless of cache state (used on reconnect, §6.3).
export async function refresh(): Promise<RefreshKeyPayload> {
  const key = await mint();
  return { tempKey: key.tempKey, expiresAt: key.expiresAt };
}

// Absolute epoch-ms time at which the current key should be refreshed.
// Returns null when no key is cached. Used by callers to schedule a refresh
// timer (test U5).
export function refreshAt(): number | null {
  return cached ? cached.expiresAt - REFRESH_MARGIN_MS : null;
}

// Drop the cached key (e.g. on session stop) so no stale key lingers in memory.
export function clearKey(): void {
  cached = null;
}
