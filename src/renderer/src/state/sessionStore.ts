// sessionStore — drives the status UI (§8). Mirrors SessionState from
// @shared/types with granular setters used by the Soniox client and timers.

import { create } from 'zustand';
import type { SessionState, SessionStatus } from '@shared/types';

interface SessionStore extends SessionState {
  setStatus(status: SessionStatus): void;
  setMode(mode: 1 | 2): void;
  setSessionMs(ms: number): void;
  // Stash the ephemeral temp key + its expiry together (§6.3 key refresh).
  setKey(key: string, expiresAt: number): void;
  setError(error?: string): void;
  reset(): void;
}

// Initial lifecycle state: idle, system-audio mode (mode 1), no key yet.
const initialState: SessionState = {
  status: 'idle',
  mode: 1,
  sessionMs: 0,
};

export const useSessionStore = create<SessionStore>((set) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),
  setSessionMs: (sessionMs) => set({ sessionMs }),
  setKey: (key, expiresAt) => set({ key, expiresAt }),
  // Setting an error also flips status to 'error' so the UI reacts in one step.
  setError: (error) =>
    set(error ? { error, status: 'error' } : { error: undefined }),

  reset: () => set({ ...initialState, key: undefined, expiresAt: undefined, error: undefined }),
}));
