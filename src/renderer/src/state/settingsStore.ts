// settingsStore — renderer mirror of the persisted Settings (§8/§10).
// Seeds from DEFAULT_SETTINGS; `hydrate` overlays the values loaded from
// electron-store at startup. Per-field setters keep the overlay UI reactive;
// persistence itself is the main-process / IPC slice's responsibility.

import { create } from 'zustand';
import type { Settings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

interface SettingsStore extends Settings {
  // Generic typed setter — set<K extends keyof Settings>(key, value).
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  // Replace the whole settings object from persisted state (startup load).
  hydrate(settings: Settings): void;
  reset(): void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...DEFAULT_SETTINGS,

  set: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),
  hydrate: (settings) => set({ ...settings }),
  reset: () => set({ ...DEFAULT_SETTINGS }),
}));
