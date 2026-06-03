// CaptionBar — default overlay surface (§7.2 + §7.5).
//
// Bottom-center glass bar, max-width 70vw, safe-area margin from the screen
// bottom. Two stacked lanes: source (top, small/muted, optional via showSource)
// and Vietnamese (bottom, large/semibold). Idle collapses to a breathing "Ready"
// pill. The §7.5 status table drives connecting / listening / reconnecting /
// error treatments.
//
// Reads purely from the zustand stores; per-token motion lives in TokenLine.

import { useTokenStore, useSessionStore, useSettingsStore } from '@renderer/state';
import { TokenLine } from './TokenLine';
import { LevelMeter } from './LevelMeter';

// Shared glass surface styling (§7.1: --glass + backdrop blur + shadow + border).
const GLASS_STYLE: React.CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: 'var(--shadow-overlay)',
};

// §7.5 idle: a small Ready pill with a soft breathing glow.
function ReadyPill({ reducedMotion }: { reducedMotion: boolean }): JSX.Element {
  return (
    <div
      className={`rounded-24 border border-border px-5 py-2 text-sm text-muted ${
        reducedMotion ? '' : 'ready-breathe'
      }`}
      style={GLASS_STYLE}
    >
      Ready
    </div>
  );
}

// §7.5 connecting: shimmer skeleton line + 3-dot pulse.
function ConnectingSkeleton(): JSX.Element {
  return (
    <div className="flex w-full items-center gap-3">
      <div className="h-4 flex-1 rounded-10 shimmer-line" />
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-accent dot-pulse"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function CaptionBar(): JSX.Element {
  const source = useTokenStore((s) => s.source);
  const vi = useTokenStore((s) => s.vi);
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  const showSource = useSettingsStore((s) => s.showSource);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);

  const hasText =
    source.final || source.provisional || vi.final || vi.provisional;
  const listening = status === 'listening';

  // §7.5 idle/stopped with no text → collapse to the Ready pill.
  if ((status === 'idle' || status === 'stopped') && !hasText) {
    return (
      <div className="flex h-full w-full items-end justify-center pb-16">
        <ReadyPill reducedMotion={reducedMotion} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-end justify-center pb-16">
      <div
        className="relative max-w-[70vw] rounded-24 border border-border px-6 py-4"
        style={GLASS_STYLE}
      >
        {/* §7.5 error: red hairline at the top edge. */}
        {status === 'error' ? (
          <div
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-24"
            style={{ background: 'var(--err)' }}
          />
        ) : null}

        {/* §7.5 reconnecting: amber pulse strip. */}
        {status === 'reconnecting' ? (
          <div
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-24 amber-pulse"
            style={{ background: 'var(--warn)' }}
          />
        ) : null}

        {/* §7.5 listening: live EQ + accent dot on the bar edge. */}
        {listening ? (
          <div className="absolute right-4 top-3 flex items-center gap-2">
            <LevelMeter />
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent accent-blink"
              aria-hidden
            />
          </div>
        ) : null}

        {status === 'connecting' && !hasText ? (
          <ConnectingSkeleton />
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* Source lane (top, muted, optional). */}
            {showSource && (source.final || source.provisional) ? (
              <div className="text-muted">
                <TokenLine
                  final={source.final}
                  provisional={source.provisional}
                  variant="source"
                  reducedMotion={reducedMotion}
                  showCaret={listening}
                />
              </div>
            ) : null}

            {/* Vietnamese lane (bottom, primary). Dimmed while reconnecting
                so the last text reads as held, not live (§7.5). */}
            <div
              className="line-settle"
              style={{ opacity: status === 'reconnecting' ? 0.55 : 1 }}
            >
              <TokenLine
                final={vi.final}
                provisional={vi.provisional}
                variant="vi"
                reducedMotion={reducedMotion}
                showCaret={listening}
              />
            </div>
          </div>
        )}

        {/* §7.5 reconnecting/error inline message + retry affordance. */}
        {status === 'reconnecting' ? (
          <div className="mt-2 text-xs text-warn">Reconnecting…</div>
        ) : null}
        {status === 'error' ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-err">
            <span>{error ?? 'Connection error'}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
