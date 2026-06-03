import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/index.css'

// Placeholder control window — real card stack UI lands in a later wave.
function ControlApp(): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="rounded-16 border border-border bg-surface px-6 py-4 text-text">
        Scaffold OK
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ControlApp />
    </StrictMode>
  )
}
