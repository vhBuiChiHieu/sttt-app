// Overlay session controller (SPEC §4.3 data flow, M5 wiring).
//
// Owns the live capture+STT lifecycle inside the overlay renderer:
//   - subscribe window.api.onSessionConfig → build a SonioxClient (aggregate.ts)
//     + start the audio pipeline (pipeline.ts), feed onPcm → client.sendPcm and
//     onLevel → audioStore.
//   - map Soniox client status callbacks → sessionStore AND broadcast up via
//     window.api.sendSessionState (§4.4 session:state).
//   - subscribe onSessionStop (relayed session:stop) → graceful stop + flush.
//   - subscribe onOverlaySetMode → settingsStore.overlayMode.
//   - subscribe onOverlayAppearance → settingsStore (+ live theme/position handled
//     by App from the store).
//   - full teardown (unsubscribe + stop pipeline + client) on unmount.
//
// Renders nothing; UI reads purely from the zustand stores.

import { useEffect } from 'react';
import type {
  SessionConfigPayload,
  SessionStatePayload,
  OverlaySetModePayload,
  OverlayAppearancePayload,
} from '@shared/ipc';
import type { SessionStatus } from '@shared/types';
import { createSonioxSession } from '@renderer/soniox/aggregate';
import type { SonioxClient, ClientStatus } from '@renderer/soniox/client';
import { start as startPipeline, stop as stopPipeline } from '@renderer/audio/pipeline';
import {
  useSessionStore,
  useSettingsStore,
  useAudioStore,
  useTokenStore,
} from '@renderer/state';

// Map the client's lifecycle status (connecting/listening/reconnecting/error)
// onto the broader session status enum. 'idle'/'stopped' are owned elsewhere.
function toSessionStatus(status: ClientStatus): SessionStatus {
  return status; // ClientStatus is a strict subset of SessionStatus
}

export function useOverlaySession(): void {
  useEffect(() => {
    // Per-session handles; reset on each (re)start so a stop/start cycle is clean.
    let client: SonioxClient | null = null;
    let pipelineRunning = false;
    // Session timer: sessionMs feeds the §4.4 state broadcast.
    let startedAt = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const session = useSessionStore.getState();
    const tokens = useTokenStore.getState();
    const audio = useAudioStore.getState();

    // Broadcast current status up to the control window (§4.4 session:state).
    const broadcast = (status: SessionStatus, error?: string): void => {
      const payload: SessionStatePayload = {
        status,
        sessionMs: startedAt ? Date.now() - startedAt : 0,
        tokenCount: useTokenStore.getState().segments.length,
        error,
      };
      window.api.sendSessionState(payload);
    };

    // Tear down audio + WS, keep store state for the UI to fade out (§7.5 stopped).
    const teardownSession = async (): Promise<void> => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (client) {
        client.stop(); // graceful: empty frame → finished → socket close
        client = null;
      }
      if (pipelineRunning) {
        await stopPipeline();
        pipelineRunning = false;
      }
      startedAt = 0;
      audio.setLevel(0);
    };

    // --- session:config (Main → Overlay): start a fresh session --------------
    const offConfig = window.api.onSessionConfig(async (cfg: SessionConfigPayload) => {
      // A new config replaces any running session (e.g. restart).
      await teardownSession();
      tokens.reset();

      // Seed the session store with the real pushed key/expiry (§6 session:config).
      const expiresAt = cfg.expiresAt;
      session.setKey(cfg.tempKey, expiresAt);
      session.setStatus('connecting');
      startedAt = Date.now();
      broadcast('connecting');

      // Build (not yet started) the Soniox client; its status callbacks drive UI.
      client = createSonioxSession(cfg, expiresAt, {
        onStatus: (s: ClientStatus) => {
          const mapped = toSessionStatus(s);
          session.setStatus(mapped);
          // Clear any prior error once we're healthy again.
          if (mapped !== 'error') session.setError(undefined);
          broadcast(mapped);
        },
        onFatal: (err) => {
          const message = err.error_message ?? err.error_type ?? 'Session error';
          session.setError(message);
          broadcast('error', message);
        },
      });

      // Open the socket, then start audio capture feeding it.
      client.start();
      try {
        await startPipeline(
          (pcm: ArrayBuffer) => client?.sendPcm(pcm),
          (level: number) => audio.setLevel(level),
        );
        pipelineRunning = true;
        audio.setDeviceOk(true);
      } catch (err) {
        // Capture failure (no loopback device / user-cancelled picker, §15).
        console.error('[overlay] loopback capture failed:', err);
        const message = err instanceof Error ? err.message : 'Audio capture failed';
        audio.setDeviceOk(false);
        session.setError(message);
        broadcast('error', message);
        client?.stop();
        client = null;
        return;
      }

      // Tick sessionMs ~1/s for the broadcast/timer (no busy loop, §13.6).
      timer = setInterval(() => {
        session.setSessionMs(startedAt ? Date.now() - startedAt : 0);
      }, 1000);
    });

    // --- session:stop (Main → Overlay): graceful teardown --------------------
    // User/tray-initiated stop is relayed by main on 'session:stop'. Finalize the
    // current line, broadcast the stopped status up to control, then tear down
    // audio + WS (§6.2 rule 4 / §7.5 stopped). Guarded to a live session.
    const offStop = window.api.onSessionStop(() => {
      // Always finalize + broadcast 'stopped', even when there is no live client
      // (a failed start nulls `client` in the capture-error path above). Skipping
      // this leaves control stuck on the red "Stop" button — session:state never
      // returns to a terminal status — so the user can't stop/retry (§7.5).
      // teardownSession is null-safe: it guards on client/pipeline/timer.
      useTokenStore.getState().flushSegment();
      useSessionStore.getState().setStatus('stopped');
      broadcast('stopped');
      void teardownSession();
    });

    // --- overlay:set-mode (Control → Overlay) --------------------------------
    const offMode = window.api.onOverlaySetMode((payload: OverlaySetModePayload) => {
      useSettingsStore.getState().set('overlayMode', payload.overlay);
    });

    // --- overlay:appearance (Control → Overlay): live-apply -------------------
    const offAppearance = window.api.onOverlayAppearance((payload: OverlayAppearancePayload) => {
      const s = useSettingsStore.getState();
      s.set('fontScale', payload.fontScale);
      s.set('opacity', payload.opacity);
      // theme/position are free-form strings on the wire; the Settings type
      // narrows them, so cast at the boundary (validated upstream in control).
      s.set('theme', payload.theme as 'dark' | 'auto');
      s.set('position', payload.position);
    });

    // --- teardown on unmount -------------------------------------------------
    return () => {
      offConfig();
      offStop();
      offMode();
      offAppearance();
      void teardownSession();
    };
  }, []);
}
