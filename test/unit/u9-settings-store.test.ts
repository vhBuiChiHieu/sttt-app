// @vitest-environment jsdom
//
// U9 — Settings store: get/set round-trips; defaults applied when empty. (SPEC §13.1)
//
// The persisted store (`src/main/settings.ts`) depends on electron-store, which
// needs a real Electron `app` (userData path) and cannot run in plain Vitest. We
// test BOTH surfaces:
//   1. The renderer `useSettingsStore` (the §8 mirror) — the primary, fully
//      testable round-trip surface.
//   2. The main `settings.ts` defaults-merge logic with electron-store mocked at
//      the module boundary (vi.mock), so getSettings/setSettings/patchSettings
//      "defaults applied when empty" is still verified without real Electron.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@renderer/state/settingsStore';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';

describe('U9 renderer settingsStore — round-trip + defaults', () => {
  beforeEach(() => useSettingsStore.getState().reset());

  it('seeds from DEFAULT_SETTINGS', () => {
    const s = useSettingsStore.getState();
    expect(s.overlayMode).toBe(DEFAULT_SETTINGS.overlayMode);
    expect(s.fontScale).toBe(DEFAULT_SETTINGS.fontScale);
    expect(s.opacity).toBe(DEFAULT_SETTINGS.opacity);
    expect(s.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys);
  });

  it('set<K> round-trips a single typed field', () => {
    useSettingsStore.getState().set('overlayMode', 'panel');
    expect(useSettingsStore.getState().overlayMode).toBe('panel');
    useSettingsStore.getState().set('fontScale', 1.5);
    expect(useSettingsStore.getState().fontScale).toBe(1.5);
    // Untouched fields keep their defaults.
    expect(useSettingsStore.getState().opacity).toBe(DEFAULT_SETTINGS.opacity);
  });

  it('hydrate replaces the whole settings object from persisted state', () => {
    const persisted: Settings = {
      ...DEFAULT_SETTINGS,
      overlayMode: 'panel',
      opacity: 0.5,
      theme: 'auto',
      showSource: false,
    };
    useSettingsStore.getState().hydrate(persisted);
    const s = useSettingsStore.getState();
    expect(s.overlayMode).toBe('panel');
    expect(s.opacity).toBe(0.5);
    expect(s.theme).toBe('auto');
    expect(s.showSource).toBe(false);
  });

  it('reset restores defaults after mutation', () => {
    useSettingsStore.getState().set('opacity', 0.1);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().opacity).toBe(DEFAULT_SETTINGS.opacity);
  });
});

// --- Main-process settings.ts with electron-store mocked at the boundary ------
//
// A tiny in-memory fake stands in for electron-store: it implements the `store`
// getter/setter the module uses. This verifies the defaults-merge ("applied when
// empty") without booting Electron.
describe('U9 main settings.ts — defaults merge (electron-store mocked)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getSettings spreads defaults over an empty store', async () => {
    vi.doMock('electron-store', () => ({
      default: class {
        store: Partial<Settings> = {}; // simulate first-run empty persisted state
      },
    }));
    const { getSettings } = await import('@main/settings');
    expect(getSettings()).toEqual(DEFAULT_SETTINGS); // empty → full defaults
  });

  it('getSettings merges persisted values over defaults', async () => {
    vi.doMock('electron-store', () => ({
      default: class {
        store: Partial<Settings> = { overlayMode: 'panel', opacity: 0.42 };
      },
    }));
    const { getSettings } = await import('@main/settings');
    const out = getSettings();
    expect(out.overlayMode).toBe('panel');
    expect(out.opacity).toBe(0.42);
    expect(out.theme).toBe(DEFAULT_SETTINGS.theme); // missing field → default
  });

  it('setSettings + patchSettings round-trip through the store', async () => {
    vi.doMock('electron-store', () => ({
      default: class {
        store: Settings = { ...DEFAULT_SETTINGS };
      },
    }));
    const { getSettings, setSettings, patchSettings } = await import('@main/settings');
    setSettings({ ...DEFAULT_SETTINGS, fontScale: 2.0 });
    expect(getSettings().fontScale).toBe(2.0);

    const merged = patchSettings({ overlayMode: 'panel' });
    expect(merged.overlayMode).toBe('panel');
    expect(getSettings().overlayMode).toBe('panel');
    // patch must not clobber the previously-set fontScale.
    expect(getSettings().fontScale).toBe(2.0);
  });
});
