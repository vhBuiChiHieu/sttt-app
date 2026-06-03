// Maps SessionStatus → the visual treatments used by the StartButton and the
// footer connection chip (§7.5 / §7.6). Kept pure so it's trivially testable.

import type { SessionStatus } from '@shared/types'

// A session is "running" (Stop affordance, red button) for any non-terminal,
// non-idle status. 'error' still counts as running so the user can Stop/retry.
export function isSessionActive(status: SessionStatus): boolean {
  return (
    status === 'connecting' ||
    status === 'listening' ||
    status === 'reconnecting' ||
    status === 'error'
  )
}

export interface ChipVisual {
  label: string
  // Token color var for the dot/text.
  color: string
  // Animation helper class from control.css ('' = static).
  anim: '' | 'ctrl-dot-breathe' | 'ctrl-dot-pulse'
}

// Connection chip appearance per status (§7.5 status table).
export function chipVisual(status: SessionStatus): ChipVisual {
  switch (status) {
    case 'connecting':
      return { label: 'Connecting…', color: 'var(--accent)', anim: 'ctrl-dot-pulse' }
    case 'listening':
      return { label: 'Listening', color: 'var(--ok)', anim: '' }
    case 'reconnecting':
      return { label: 'Reconnecting…', color: 'var(--warn)', anim: 'ctrl-dot-pulse' }
    case 'error':
      return { label: 'Error', color: 'var(--err)', anim: '' }
    case 'stopped':
      return { label: 'Stopped', color: 'var(--muted)', anim: '' }
    case 'idle':
    default:
      return { label: 'Ready', color: 'var(--muted)', anim: 'ctrl-dot-breathe' }
  }
}

// mm:ss session timer from elapsed milliseconds.
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Remaining time until an epoch-ms expiry, as a short "Xm Ys" / "—" string.
export function formatTtl(expiresAt: number | undefined, now: number): string {
  if (!expiresAt) return '—'
  const remMs = expiresAt - now
  if (remMs <= 0) return 'expired'
  const totalSec = Math.floor(remMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
