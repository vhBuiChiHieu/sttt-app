// electron-store wrapper persisting the §10 settings fields.
// Single source of persisted config for the main process. No secrets stored
// (the temp key is ephemeral, §10/§11) — only the Settings shape from @shared.

import Store from 'electron-store';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

// One store instance per process, seeded with DEFAULT_SETTINGS so any missing
// field falls back to a sane default (§10, test U9). `clearInvalidConfig`
// guards against a corrupt JSON file wiping the user's data silently.
const store = new Store<Settings>({
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
  clearInvalidConfig: true,
});

// Read the full settings object. Spread over DEFAULT_SETTINGS so even a store
// that predates a newly-added field returns a complete, typed Settings value.
export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...store.store };
}

// Persist a full settings object. We replace wholesale (renderer always sends
// the complete object), but merge over defaults first to stay total.
export function setSettings(next: Settings): void {
  store.store = { ...DEFAULT_SETTINGS, ...next };
}

// Convenience single-field setter (used internally, e.g. when a hotkey/tray
// action mutates overlay mode and we want to persist it).
export function patchSettings(patch: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...patch };
  store.store = merged;
  return merged;
}
