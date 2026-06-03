// Control window root (§7.6). Single-column dark card stack that wires the SPEC
// §7 UI to the already-built foundation via `window.api` (typed IpcApi) and the
// zustand stores. This component owns all side-effects; cards are presentational.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Settings } from '@shared/types'
import { useSessionStore, useSettingsStore } from '@renderer/state'
import { useDebouncedPersist } from './lib/useDebouncedPersist'
import { isSessionActive } from './lib/status'
import { SourceCard } from './components/SourceCard'
import { LanguageCard } from './components/LanguageCard'
import { StartButton } from './components/StartButton'
import { OverlayCard } from './components/OverlayCard'
import { AppearanceCard } from './components/AppearanceCard'
import { ShortcutsCard } from './components/ShortcutsCard'
import { Footer } from './components/Footer'

// `-webkit-app-region` is non-standard so it's absent from React's CSSProperties;
// declare it once here rather than casting at the call site.
const dragStyle: CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' } = {
  WebkitAppRegion: 'drag',
}

export function App(): JSX.Element {
  // --- Session state (driven by the inbound session:state stream) ---
  const status = useSessionStore((s) => s.status)
  const mode = useSessionStore((s) => s.mode)
  const sessionMs = useSessionStore((s) => s.sessionMs)
  const expiresAt = useSessionStore((s) => s.expiresAt)
  const error = useSessionStore((s) => s.error)
  const setStatus = useSessionStore((s) => s.setStatus)
  const setSessionMs = useSessionStore((s) => s.setSessionMs)
  const setError = useSessionStore((s) => s.setError)

  // tokenCount isn't part of sessionStore (it's only on the wire payload), so we
  // keep it locally to derive tokens/min.
  const [tokenCount, setTokenCount] = useState(0)

  // --- Settings mirror (instant UI feedback; persisted via IPC) ---
  const settings = useSettingsStore() // full reactive Settings object
  const hydrate = useSettingsStore((s) => s.hydrate)
  const setField = useSettingsStore((s) => s.set)
  const schedulePersist = useDebouncedPersist()

  // Source-language detection hints (session-scoped, not persisted). Sent on
  // start as `sourceHints` to bias Soniox language ID (§16 open item).
  const [hints, setHints] = useState<string[]>([])

  // `now` drives the live temp-key TTL countdown; ticks only when relevant.
  const [now, setNow] = useState(() => Date.now())

  const active = isSessionActive(status)

  // -- Mount: load persisted settings into the store (§10). --
  useEffect(() => {
    let cancelled = false
    void window.api.getSettings().then((loaded) => {
      if (!cancelled) hydrate(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [hydrate])

  // -- Subscribe to status broadcasts; sync into the session store. --
  useEffect(() => {
    const unsub = window.api.onSessionState((p) => {
      setStatus(p.status)
      setSessionMs(p.sessionMs)
      setTokenCount(p.tokenCount)
      // setError(undefined) also clears the 'error' status back to neutral.
      setError(p.error)
    })
    return unsub
  }, [setStatus, setSessionMs, setError])

  // -- Tick `now` every second while a key TTL or session timer is showing. --
  useEffect(() => {
    if (!expiresAt && !active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt, active])

  // Tokens per minute, guarded against the divide-by-zero at t≈0.
  const tokensPerMin =
    sessionMs > 1000 ? Math.round(tokenCount / (sessionMs / 60000)) : 0

  // ---------------------------------------------------------------------------
  // Settings mutation helper: update store (instant) + schedule persist. The
  // overlay-side effect (push to overlay/main) is layered on top per field.
  // ---------------------------------------------------------------------------
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setField(key, value)
      // Build the next full object from the freshest snapshot for persistence.
      schedulePersist({ ...settingsRef.current, [key]: value })
    },
    [setField, schedulePersist],
  )

  // Push the current appearance bundle to the overlay (§4.4 overlay:appearance).
  const pushAppearance = useCallback((next: Settings) => {
    window.api.setOverlayAppearance({
      fontScale: next.fontScale,
      opacity: next.opacity,
      theme: next.theme,
      position: next.position,
    })
  }, [])

  // --- Overlay controls: mirror into store + live IPC push (§7.6 #4/#5). ---
  const onOverlayMode = useCallback(
    (overlayMode: 'caption' | 'panel') => {
      update('overlayMode', overlayMode)
      window.api.setOverlayMode({ overlay: overlayMode })
    },
    [update],
  )

  const onAppearanceField = useCallback(
    <K extends 'fontScale' | 'opacity' | 'theme' | 'position'>(
      key: K,
      value: Settings[K],
    ) => {
      update(key, value)
      pushAppearance({ ...settingsRef.current, [key]: value })
    },
    [update, pushAppearance],
  )

  // Click-through lock is not a persisted Settings field; route straight to main.
  const [clickThroughLocked, setClickThroughLocked] = useState(false)
  const onClickThrough = useCallback((locked: boolean) => {
    setClickThroughLocked(locked)
    window.api.setClickThrough({ locked })
  }, [])

  // --- Source mode (only mode 1 selectable in Phase 1). ---
  const setMode = useSessionStore((s) => s.setMode)
  const onSelectMode = useCallback(
    (next: 1) => {
      setMode(next)
    },
    [setMode],
  )

  const onToggleHint = useCallback((code: string) => {
    setHints((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }, [])

  // --- Start / Stop ---
  const onStart = useCallback(() => {
    window.api.startSession({
      mode: 1, // Phase 1: system audio only
      targetLang: 'vi', // locked target
      sourceHints: hints.length ? hints : undefined,
    })
  }, [hints])

  const onStop = useCallback(() => {
    window.api.stopSession()
  }, [])

  // Runtime reduced-motion override class (§7.1/§7.8) — kills decorative motion.
  const rootMotionClass = settings.reducedMotion ? 'ctrl-reduced-motion' : ''

  return (
    <div className={`flex h-full w-full flex-col bg-bg ${rootMotionClass}`}>
      {/* Draggable frameless header (§4.2). Buttons inside opt out via no-drag. */}
      <header
        className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4"
        style={dragStyle}
      >
        <div>
          <h1 className="text-[15px] font-semibold text-text">STT → Vietnamese</h1>
          <p className="text-[11px] text-muted">Realtime translator</p>
        </div>
      </header>

      {/* Scrollable card stack. */}
      <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-4">
        <SourceCard mode={mode} onSelect={onSelectMode} disabled={active} />

        <LanguageCard hints={hints} onToggleHint={onToggleHint} disabled={active} />

        <StartButton
          status={status}
          sessionMs={sessionMs}
          tokensPerMin={tokensPerMin}
          onStart={onStart}
          onStop={onStop}
        />

        {/* Surface session errors inline beneath the primary action (§7.5). */}
        {status === 'error' && error ? (
          <div
            className="rounded-10 border bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-err"
            style={{ borderColor: 'rgba(239,68,68,0.4)' }}
          >
            {error}
          </div>
        ) : null}

        <OverlayCard
          overlayMode={settings.overlayMode}
          position={settings.position}
          opacity={settings.opacity}
          fontScale={settings.fontScale}
          clickThroughLocked={clickThroughLocked}
          onOverlayMode={onOverlayMode}
          onPosition={(pos) => onAppearanceField('position', pos)}
          onOpacity={(v) => onAppearanceField('opacity', v)}
          onFontScale={(v) => onAppearanceField('fontScale', v)}
          onClickThrough={onClickThrough}
        />

        <AppearanceCard
          theme={settings.theme}
          showSource={settings.showSource}
          reducedMotion={settings.reducedMotion}
          onTheme={(t) => onAppearanceField('theme', t)}
          onShowSource={(v) => update('showSource', v)}
          onReducedMotion={(v) => update('reducedMotion', v)}
        />

        <ShortcutsCard hotkeys={settings.hotkeys} />
      </main>

      <div className="shrink-0 px-5 pb-4">
        <Footer status={status} sessionMs={sessionMs} expiresAt={expiresAt} now={now} />
      </div>
    </div>
  )
}
