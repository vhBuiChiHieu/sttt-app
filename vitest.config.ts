import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Test runner config for M7 (SPEC §13.1/§13.2/§13.6).
//
// Path aliases mirror electron.vite.config.ts / tsconfig so tests import the
// REAL modules under test (`@shared/*`, `@renderer/*`) unchanged.
//
// Environment: default is `node` (suits tempKey/settings/pure-reducer units).
// DOM-dependent files (zustand stores, the WS client which uses the global
// WebSocket/performance) opt into jsdom per-file via `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      // Test-only alias for the main-process modules under unit test (tempKey/settings).
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Deterministic timers everywhere we use them; each file opts in explicitly.
    clearMocks: true,
  },
});
