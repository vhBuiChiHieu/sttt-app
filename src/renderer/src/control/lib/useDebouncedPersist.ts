// Debounced settings persistence (§10). Returns a stable `schedule(settings)`
// that coalesces rapid changes (slider drags, stepper mashing) into one
// window.api.setSettings call after `delayMs` of quiet.

import { useCallback, useEffect, useRef } from 'react'
import type { Settings } from '@shared/types'

export function useDebouncedPersist(delayMs = 350): (settings: Settings) => void {
  // Hold the timer + the latest pending payload across renders.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Settings | null>(null)

  // Flush any in-flight write on unmount so a final change isn't lost.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        if (pending.current) void window.api.setSettings(pending.current)
      }
    }
  }, [])

  return useCallback(
    (settings: Settings) => {
      pending.current = settings
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (pending.current) void window.api.setSettings(pending.current)
        pending.current = null
        timer.current = null
      }, delayMs)
    },
    [delayMs],
  )
}
