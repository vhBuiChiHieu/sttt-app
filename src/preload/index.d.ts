// Global typing for the preload-exposed bridge. Makes window.api strongly typed
// as the shared IpcApi in every renderer, with zero runtime cost.

import type { IpcApi } from '@shared/ipc';

declare global {
  interface Window {
    api: IpcApi;
  }
}

export {};
