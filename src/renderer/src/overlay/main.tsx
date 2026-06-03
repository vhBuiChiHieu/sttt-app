import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/index.css'

// Placeholder overlay — real CaptionBar/FloatingPanel UI lands in a later wave.
// Renders a small glass "Ready" pill using the §7.1 design tokens.
function OverlayApp(): JSX.Element {
  return (
    <div className="flex h-full w-full items-end justify-center pb-16">
      <div
        className="rounded-24 border border-border px-5 py-2 text-sm text-muted shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
        style={{ background: 'var(--glass)', backdropFilter: 'blur(20px)' }}
      >
        Ready
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OverlayApp />
    </StrictMode>
  )
}
