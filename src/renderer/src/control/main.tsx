import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/index.css'
import './control.css'
import { App } from './App'

// Mount the Control React root (§7.6). Keeps the existing createRoot pattern.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
