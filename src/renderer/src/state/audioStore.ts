// audioStore — live input meter (§8). `level` is a normalized 0..1 amplitude
// from the capture analyser; `deviceOk` reflects whether a usable input device
// was acquired.

import { create } from 'zustand';

export interface AudioState {
  level: number;
  deviceOk: boolean;
  setLevel(level: number): void;
  setDeviceOk(deviceOk: boolean): void;
  reset(): void;
}

export const useAudioStore = create<AudioState>((set) => ({
  level: 0,
  deviceOk: false,

  setLevel: (level) => set({ level }),
  setDeviceOk: (deviceOk) => set({ deviceOk }),
  reset: () => set({ level: 0, deviceOk: false }),
}));
