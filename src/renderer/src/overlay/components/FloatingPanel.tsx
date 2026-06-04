// FloatingPanel — toggleable overlay surface (§7.3).
//
// Draggable + resizable glass card. Header (drag handle) with controls:
// font-size −/+, mode switch (→ caption), lock click-through.
// Body = segment scrollback (newest at bottom), auto-stick-to-bottom; when the
// user scrolls up a "↓ Latest" chip appears. Segments render in a normal
// in-flow scrolling column — the session is bounded by the 300-min cap so the
// DOM node count stays acceptable; re-introduce windowing only if profiling
// shows a real problem (§7.3 / §13.6).
//
// Drag/resize use transform/left/top on the card root only; the spec's
// transform-only rule (§7.4.3) targets the high-frequency token reveal path, so
// using left/top for occasional user-driven drag is acceptable and avoids a
// transform that would fight the resize box model.

import { useEffect, useRef, useState } from 'react';
import type { Segment } from '@shared/types';
import {
  useTokenStore,
  useSessionStore,
  useSettingsStore,
} from '@renderer/state';
import { TokenLine } from './TokenLine';

// Distance from the bottom (px) under which we treat the view as "stuck".
const STICK_THRESHOLD = 24;
// #14: keep at least this many px of the panel on-screen when dragging so the
// frameless card can't be lost off an edge (mirrors the resize min-size clamp).
const MIN_VISIBLE = 40;

const GLASS_STYLE: React.CSSProperties = {
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: 'var(--shadow-overlay)',
};

// #10: drive the glass backdrop alpha from settings.opacity (RGB matches the
// --glass base) so the backdrop is translucent but the text stays opaque.
function glassBg(opacity: number): string {
  return `rgba(18, 20, 25, ${opacity})`;
}

// One scrollback row: source (muted) over Vietnamese (primary), with a timestamp.
// #4: em sizes so the card-root fontSize (= fontScale rem) scales the text; at
// fontScale=1 these reproduce today's 0.7rem / 0.85rem / 1.05rem exactly.
function SegmentRow({
  segment,
  reducedMotion,
  fresh,
  showSource,
}: {
  segment: Segment;
  reducedMotion: boolean;
  fresh: boolean;
  showSource: boolean;
}): JSX.Element {
  const time = new Date(segment.time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <div
      className={`flex flex-col gap-1 border-b border-border px-4 py-3 ${
        fresh && !reducedMotion ? 'segment-commit' : ''
      }`}
    >
      <div className="flex items-center justify-between text-[0.7em] text-muted">
        {/* #9: only show a speaker label once real diarization data exists. */}
        {segment.speaker ? <span>{segment.speaker}</span> : null}
        <span className="ml-auto">{time}</span>
      </div>
      {/* #11: source lane gated on the showSource setting. */}
      {showSource && segment.source ? (
        <div className="font-sans text-[0.85em] text-muted legible">
          {segment.source}
        </div>
      ) : null}
      <div className="font-vi text-[1.05em] font-semibold text-text legible vi-lane">
        {segment.vietnamese}
      </div>
    </div>
  );
}

export function FloatingPanel(): JSX.Element {
  const segments = useTokenStore((s) => s.segments);
  const vi = useTokenStore((s) => s.vi);
  const source = useTokenStore((s) => s.source);
  const status = useSessionStore((s) => s.status);
  const fontScale = useSettingsStore((s) => s.fontScale);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setSetting = useSettingsStore((s) => s.set);
  const opacity = useSettingsStore((s) => s.opacity);
  // #11: panel honours the live "show source text" toggle.
  const showSource = useSettingsStore((s) => s.showSource);

  // --- card geometry (drag + resize), local UI state only ------------------
  const [box, setBox] = useState({ x: 80, y: 80, w: 420, h: 360 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ ox: number; oy: number; ow: number; oh: number } | null>(null);

  // --- scrollback + stick-to-bottom ----------------------------------------
  // #1/#2: segments render as a normal in-flow column (no fixed-height
  // virtualization), so rows take their true wrapped height and never overlap.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(true);
  // Remember the last segment count so a freshly-committed row can slide in.
  const prevCountRef = useRef(segments.length);

  // The live (un-flushed) line is rendered after the scrollback as a "tail".
  const hasLiveTail = Boolean(vi.final || vi.provisional);

  // Keep the view pinned to the latest segment while "stuck" (§7.3 auto-stick).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stuck) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = segments.length;
  }, [segments.length, stuck, vi.final, vi.provisional]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStuck(distToBottom <= STICK_THRESHOLD);
  };

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    // Smooth scroll honoured unless reduced motion (§7.4.5 / §7.8).
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    setStuck(true);
  };

  // --- drag (header) -------------------------------------------------------
  const onHeaderPointerDown = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
  };
  // --- resize (bottom-right handle) ---------------------------------------
  const onResizePointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { ox: e.clientX, oy: e.clientY, ow: box.w, oh: box.h };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current) {
      const nx = e.clientX - dragRef.current.dx;
      const ny = e.clientY - dragRef.current.dy;
      setBox((b) => ({
        ...b,
        // #14: clamp so at least MIN_VISIBLE px of the card stays on-screen on
        // every edge — the frameless panel can no longer be dragged off and lost.
        x: Math.min(
          window.innerWidth - MIN_VISIBLE,
          Math.max(MIN_VISIBLE - b.w, nx),
        ),
        y: Math.min(
          window.innerHeight - MIN_VISIBLE,
          Math.max(0, ny),
        ),
      }));
    } else if (resizeRef.current) {
      const r = resizeRef.current;
      setBox((b) => ({
        ...b,
        w: Math.max(280, r.ow + (e.clientX - r.ox)),
        h: Math.max(200, r.oh + (e.clientY - r.oy)),
      }));
    }
  };
  const onPointerUp = (): void => {
    dragRef.current = null;
    resizeRef.current = null;
  };

  // Local mirror of the overlay click-through lock (main owns the real window
  // state via setIgnoreMouseEvents; this drives the header button's toggle).
  const [clickThroughLocked, setClickThroughLocked] = useState(false);

  // Header control handlers (local/store updates only; no IPC ownership here).
  const bumpFont = (delta: number): void =>
    setSetting('fontScale', Math.min(2, Math.max(0.8, Number((fontScale + delta).toFixed(2)))));
  const switchToCaption = (): void => setSetting('overlayMode', 'caption');
  // Toggle (not just lock) click-through so the button can also unlock.
  const toggleClickThrough = (): void => {
    const next = !clickThroughLocked;
    setClickThroughLocked(next);
    window.api.setClickThrough({ locked: next });
  };

  const listening = status === 'listening';

  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-16 border border-border"
      style={{
        ...GLASS_STYLE,
        // #10: backdrop alpha from settings.opacity (text stays opaque).
        background: glassBg(opacity),
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        // #4: card-root fontSize scales every em-sized child (rows + live tail).
        fontSize: `${fontScale}rem`,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Header / drag handle (§7.3). */}
      <div
        className="flex cursor-grab items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        onPointerDown={onHeaderPointerDown}
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${listening ? 'bg-accent accent-blink' : 'bg-muted'}`}
            aria-hidden
          />
          <span className="text-xs font-medium text-text">Transcript</span>
        </div>
        {/* Controls — stopPropagation so clicks don't start a drag. */}
        {/* #10: opacity ◐ cycle removed — the control window slider is the single
            source of truth for backdrop opacity (was desynced from it). */}
        <div className="flex items-center gap-1 text-muted" onPointerDown={(e) => e.stopPropagation()}>
          <HeaderBtn label="Smaller" onClick={() => bumpFont(-0.1)}>A−</HeaderBtn>
          <HeaderBtn label="Larger" onClick={() => bumpFont(0.1)}>A+</HeaderBtn>
          <HeaderBtn label="Caption mode" onClick={switchToCaption}>▭</HeaderBtn>
          <HeaderBtn label="Lock click-through" onClick={toggleClickThrough}>🔒</HeaderBtn>
        </div>
      </div>

      {/* Scrollback body — natural in-flow column (#1/#2). */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        onScroll={onScroll}
        style={{ opacity: status === 'reconnecting' ? 0.6 : 1 }}
      >
        {segments.length === 0 && !hasLiveTail ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {status === 'connecting' ? 'Connecting…' : 'Waiting for audio…'}
          </div>
        ) : (
          <div className="flex flex-col">
            {segments.map((seg, index) => (
              <SegmentRow
                key={seg.time + ':' + index}
                segment={seg}
                reducedMotion={reducedMotion}
                showSource={showSource}
                fresh={index === segments.length - 1 && index >= prevCountRef.current}
              />
            ))}

            {/* Live (un-flushed) tail line as the last in-flow child. */}
            {hasLiveTail ? (
              <div className="flex flex-col gap-1 px-4 py-3">
                {/* #11: source lane gated on the showSource setting. */}
                {showSource && (source.final || source.provisional) ? (
                  <TokenLine
                    final={source.final}
                    provisional={source.provisional}
                    variant="source"
                    reducedMotion={reducedMotion}
                    showCaret={listening}
                  />
                ) : null}
                <TokenLine
                  final={vi.final}
                  provisional={vi.provisional}
                  variant="vi"
                  reducedMotion={reducedMotion}
                  showCaret={listening}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* "↓ Latest" chip when the user has scrolled away from the bottom. */}
      {!stuck ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-24 border border-border px-3 py-1 text-xs text-text"
          style={{ background: 'var(--surface)' }}
        >
          ↓ Latest
        </button>
      ) : null}

      {/* Resize handle (bottom-right). */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onPointerDown={onResizePointerDown}
        style={{
          background:
            'linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%)',
        }}
        aria-label="Resize"
      />
    </div>
  );
}

// Small icon button used in the panel header.
function HeaderBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-10 px-1.5 py-0.5 text-xs hover:bg-[rgba(255,255,255,0.06)] hover:text-text"
    >
      {children}
    </button>
  );
}
