// StartButton (§7.6 #3): the primary action. Large pill — accent when idle,
// red when a session is active. Shows the live session timer and tokens/min
// derived from the sessionStore + the inbound session:state stream.

import type { SessionStatus } from '@shared/types'
import { formatDuration, isSessionActive } from '../lib/status'

export function StartButton({
  status,
  sessionMs,
  tokensPerMin,
  onStart,
  onStop,
}: {
  status: SessionStatus
  sessionMs: number
  tokensPerMin: number
  onStart: () => void
  onStop: () => void
}): JSX.Element {
  const active = isSessionActive(status)
  // 'connecting'/'reconnecting' are transitional — show progress wording.
  const label =
    status === 'connecting'
      ? 'Connecting…'
      : status === 'reconnecting'
        ? 'Reconnecting…'
        : active
          ? 'Stop'
          : 'Start'

  // §7.6 #13: 'connecting' is a short, non-cancelable handshake — disable the
  // button so a click can't silently fire stopSession() (a hidden cancel behind
  // the "Connecting…" label). 'reconnecting' stays clickable as a red Stop so a
  // long reconnect can still be aborted. aria-busy covers both transitional states.
  const connecting = status === 'connecting'
  const reconnecting = status === 'reconnecting'

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={active ? onStop : onStart}
        disabled={connecting}
        aria-busy={connecting || reconnecting}
        className={[
          'relative h-14 overflow-hidden rounded-16 text-[16px] font-semibold text-white transition-colors duration-180 ease-easeOutExpo',
          active ? 'bg-err' : 'bg-accent',
          connecting ? 'cursor-not-allowed opacity-70' : '',
        ].join(' ')}
        style={active ? undefined : { backgroundImage: 'var(--accent-grad)' }}
      >
        {/* Sheen sweep while running — decorative, killed by reduced-motion. */}
        {active ? (
          <span
            aria-hidden
            className="ctrl-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)]"
          />
        ) : null}
        <span className="relative z-10">{label}</span>
      </button>

      {/* Live readout: timer + tokens/min. Reserves height so layout is stable. */}
      <div className="flex h-4 items-center justify-center gap-3 text-[11px] text-muted">
        {active ? (
          <>
            <span className="tabular-nums">{formatDuration(sessionMs)}</span>
            <span className="text-border">•</span>
            <span className="tabular-nums">{tokensPerMin} tok/min</span>
          </>
        ) : (
          <span>Ready to start</span>
        )}
      </div>
    </div>
  )
}
