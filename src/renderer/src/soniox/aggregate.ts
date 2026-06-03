// Thin adapter between the Soniox WS client and the token store.
//
// Responsibility is deliberately small (§6.2 lives in the State slice, NOT here):
//   - construct a SonioxClient from a pushed session config,
//   - on each inbound message, hand tokens[] to tokenStore.ingestTokens,
//   - on endpoint/finalization, call tokenStore.flushSegment,
//   - supply the key-mint function (wraps IPC session:refresh-key).
//
// No aggregation logic is reimplemented here.

import type { SonioxConfig } from '@shared/types';
import type { SessionConfigPayload, IpcApi } from '@shared/ipc';
import { SonioxClient } from './client';
import type { SonioxMessage, ClientStatus } from './client';

// tokenStore PUBLIC API (owner = State slice). Imported by the documented shape
// from '@renderer/state'; that module is built in parallel and may be absent
// during this slice's isolated run (Verify phase does the full typecheck).
import { useTokenStore } from '@renderer/state';

// `window.api` is the contextBridge surface (owner = preload slice). Declared
// against the authoritative IpcApi contract from '@shared/ipc'.
declare global {
  interface Window {
    api: IpcApi;
  }
}

// Hooks the renderer/UI cares about, passed through from the client.
export interface AggregateHandlers {
  onStatus?(status: ClientStatus): void;
  onFatal?(error: { error_type?: string; error_message?: string; request_id?: string }): void;
}

// Build the full §6.1 config from the IPC config payload. The payload carries
// the temp key + the variable bits; the rest are fixed for Mode 1 (16k mono PCM).
function buildConfig(payload: SessionConfigPayload): SonioxConfig {
  return {
    api_key: payload.tempKey,
    model: payload.model,
    audio_format: 'pcm_s16le',
    sample_rate: payload.sampleRate,
    num_channels: 1,
    enable_endpoint_detection: true,
    enable_language_identification: true,
    translation: payload.translation,
  };
}

// Soniox endpoint-detection marks the end of an utterance with a sentinel token
// (text '<end>' / '<fin>') in the stream when enable_endpoint_detection is on.
// We flush the current line into segment history (§6.2 rule 4) on that marker —
// NOT on every is_final token, which would fragment each word into its own
// segment. The stop `finished` message is also a flush point.
const ENDPOINT_MARKERS = new Set(['<end>', '<fin>']);

function isFinalizationBoundary(msg: SonioxMessage): boolean {
  if (msg.finished) return true;
  return msg.tokens.some((t) => ENDPOINT_MARKERS.has(t.text));
}

// Create a configured-but-not-started client for a pushed session config.
// Wires the client callbacks straight into the token store.
export function createSonioxSession(
  payload: SessionConfigPayload,
  // expires_at is pushed alongside the key via refresh-key; for the very first
  // config we don't have it on the payload, so the caller passes it explicitly.
  initialExpiresAt: number,
  handlers: AggregateHandlers = {},
): SonioxClient {
  const store = useTokenStore;

  const client = new SonioxClient({
    config: buildConfig(payload),
    initialExpiresAt,
    // Mint a fresh temp key through the preload bridge (IPC session:refresh-key).
    mintKey: () => window.api.refreshKey(),
    callbacks: {
      onMessage: (msg) => {
        // 1) Feed tokens into the store — it applies the §6.2 lane/final/provisional
        //    rules. Strip the endpoint sentinel tokens first so '<end>'/'<fin>'
        //    never leak into the rendered source line.
        const realTokens = msg.tokens.filter((t) => !ENDPOINT_MARKERS.has(t.text));
        if (realTokens.length > 0) {
          store.getState().ingestTokens(realTokens);
        }
        // 2) On a finalization boundary, push the current line into history.
        if (isFinalizationBoundary(msg)) {
          store.getState().flushSegment();
        }
      },
      onStatus: (status) => handlers.onStatus?.(status),
      onFatal: (error) => handlers.onFatal?.(error),
    },
  });

  return client;
}
