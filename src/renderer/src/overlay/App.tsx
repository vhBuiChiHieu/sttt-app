// Overlay App root (§7.2/§7.3 surface selection + session wiring).
//
// - Hosts the session controller hook (useOverlaySession) which owns the
//   capture+Soniox lifecycle and the inbound IPC subscriptions.
// - Renders CaptionBar OR FloatingPanel from settingsStore.overlayMode.
// - Live-applies appearance from the store: overlay opacity + the reducedMotion
//   class hook (the per-token CSS reads .reduced-motion on this root, §7.8).

import { useSettingsStore } from '@renderer/state';
import { useOverlaySession } from './useOverlaySession';
import { CaptionBar } from './components/CaptionBar';
import { FloatingPanel } from './components/FloatingPanel';

export function App(): JSX.Element {
  const overlayMode = useSettingsStore((s) => s.overlayMode);
  const opacity = useSettingsStore((s) => s.opacity);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);

  // Mount the capture/STT session controller (renders nothing).
  useOverlaySession();

  return (
    // The .reduced-motion class is the in-app override hook (§7.1/§7.8) consulted
    // by overlay.css alongside the prefers-reduced-motion media query.
    // Overlay opacity (§7.6 appearance) applies to the whole surface.
    <div
      className={`h-full w-full ${reducedMotion ? 'reduced-motion' : ''}`}
      style={{ opacity }}
    >
      {overlayMode === 'panel' ? <FloatingPanel /> : <CaptionBar />}
    </div>
  );
}
