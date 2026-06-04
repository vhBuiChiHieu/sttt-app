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

// #3: generous rolling-window cap so normal sentences are untouched but a long
// monologue can't grow the bar without bound (full text stays in segments[]).
const CAPTION_MAX_WORDS = 60;

// Shared glass surface styling (§7.1: blur + shadow + border). The background is
// applied per-render so its alpha can be driven by settings.opacity (#10).
const GLASS_STYLE: React.CSSProperties = {
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: 'var(--shadow-overlay)',
};

// #10: drive the glass backdrop's alpha from settings.opacity so the panel is
// translucent but the text stays fully opaque (root CSS opacity used to fade
// the text too). RGB matches the --glass base (rgba(18,20,25,0.72)).
function glassBg(opacity: number): string {
  return `rgba(18, 20, 25, ${opacity})`;
}

// #5: map the saved position string to flex anchor classes for the outer
// full-surface container. Vertical = top vs bottom; horizontal = left/center/
// right. Bottom keeps the safe-area margin (pb-16); top mirrors it (pt-16).
function anchorClasses(position: string): string {
  const vertical = position.startsWith('top') ? 'items-start pt-16' : 'items-end pb-16';
  let horizontal = 'justify-center';
  if (position.endsWith('-left')) horizontal = 'justify-start pl-16';
  else if (position.endsWith('-right')) horizontal = 'justify-end pr-16';
  return `${vertical} ${horizontal}`;
}

// §7.5 idle: a small Ready pill with a soft breathing glow.
function ReadyPill({
  reducedMotion,
  opacity,
}: {
  reducedMotion: boolean;
  opacity: number;
}): JSX.Element {
  return (
    <div
      className={`rounded-24 border border-border px-5 py-2 text-sm text-muted ${
        reducedMotion ? '' : 'ready-breathe'
      }`}
      style={{ ...GLASS_STYLE, background: glassBg(opacity) }}
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
  // #4/#5/#10: typography scale, edge anchor, and backdrop opacity from settings.
  const fontScale = useSettingsStore((s) => s.fontScale);
  const position = useSettingsStore((s) => s.position);
  const opacity = useSettingsStore((s) => s.opacity);

  const hasText =
    source.final || source.provisional || vi.final || vi.provisional;
  const listening = status === 'listening';
  // #5: flex anchor for the full-surface wrapper, shared by both branches.
  const anchor = anchorClasses(position);
  // #8: hold + dim the last line on reconnecting AND stopped (so a Stop leaves
  // the final words visible-but-held instead of snapping away).
  const dimmed = status === 'reconnecting' || status === 'stopped';

  // §7.5 idle/stopped with no text → collapse to the Ready pill.
  if ((status === 'idle' || status === 'stopped') && !hasText) {
    return (
      <div className={`flex h-full w-full ${anchor}`}>
        <ReadyPill reducedMotion={reducedMotion} opacity={opacity} />
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full ${anchor}`}>
      <div
        className="relative max-w-[70vw] rounded-24 border border-border px-6 py-4"
        style={{ ...GLASS_STYLE, background: glassBg(opacity) }}
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
          // #4: fontScale drives both lanes via em-sized text inside.
          // #3: hard safety — cap the lanes height and clip overflow. Content is
          // bottom-anchored (justify-end) so the VI lane is never clipped; if an
          // over-long line exceeds the cap the OLDEST top content is what scrolls
          // out of view, faded by the top mask-gradient instead of hard-cutting.
          // The maxWords window is the primary bound; this is a belt-and-braces
          // guard, and on a normal short caption nothing is clipped or faded.
          <div
            className="flex flex-col justify-end gap-1.5 overflow-hidden"
            style={{
              fontSize: `${fontScale}rem`,
              maxHeight: '40vh',
              maskImage:
                'linear-gradient(to bottom, transparent 0, #000 1.5em)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0, #000 1.5em)',
            }}
          >
            {/* Source lane (top, muted, optional). */}
            {showSource && (source.final || source.provisional) ? (
              <div className="text-muted">
                <TokenLine
                  final={source.final}
                  provisional={source.provisional}
                  variant="source"
                  reducedMotion={reducedMotion}
                  showCaret={listening}
                  maxWords={CAPTION_MAX_WORDS}
                />
              </div>
            ) : null}

            {/* Vietnamese lane (bottom, primary). Dimmed while reconnecting or
                stopped so the last text reads as held, not live (§7.5 / #8). */}
            <div className="line-settle" style={{ opacity: dimmed ? 0.55 : 1 }}>
              <TokenLine
                final={vi.final}
                provisional={vi.provisional}
                variant="vi"
                reducedMotion={reducedMotion}
                showCaret={listening}
                maxWords={CAPTION_MAX_WORDS}
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
