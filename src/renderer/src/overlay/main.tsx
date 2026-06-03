import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/index.css'
// Overlay-scoped keyframes (§7.4 token reveal, §7.5 status states).
import './overlay.css'
import { App } from './App'

// Mounts the real Overlay app (CaptionBar / FloatingPanel + session controller).
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
