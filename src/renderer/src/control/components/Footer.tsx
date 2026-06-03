// Footer (§7.6 #7): connection chip + session time + temp-key TTL. The chip
// colour/label/animation come from chipVisual(status); TTL is derived from the
// sessionStore's `expiresAt` (set by the foundation on key mint/refresh).

import type { SessionStatus } from '@shared/types'
import { chipVisual, formatDuration, formatTtl } from '../lib/status'

export function Footer({
  status,
  sessionMs,
  expiresAt,
  now,
}: {
  status: SessionStatus
  sessionMs: number
  expiresAt: number | undefined
  now: number
}): JSX.Element {
  const chip = chipVisual(status)
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border px-1 pt-3 text-[11px] text-muted">
      {/* Connection chip: animated dot + label. */}
      <span className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${chip.anim}`}
          style={{ backgroundColor: chip.color }}
        />
        <span style={{ color: chip.color }}>{chip.label}</span>
      </span>

      {/* Session time + key TTL. */}
      <span className="flex items-center gap-3 tabular-nums">
        <span title="Session time">{formatDuration(sessionMs)}</span>
        <span className="text-border">•</span>
        <span title="Temp-key time-to-live">key {formatTtl(expiresAt, now)}</span>
      </span>
    </footer>
  )
}
