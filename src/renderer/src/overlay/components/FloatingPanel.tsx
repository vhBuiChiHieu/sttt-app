// FloatingPanel — toggleable overlay surface (§7.3).
//
// Draggable + resizable glass card. Header (drag handle) with controls:
// opacity/pin, font-size −/+, mode switch (→ caption), lock click-through, close.
// Body = segment scrollback (newest at bottom), auto-stick-to-bottom; when the
// user scrolls up a "↓ Latest" chip appears. The list is VIRTUALIZED — only the
// segments in (and just around) the viewport are rendered, capping DOM nodes for
// long sessions (§7.3 / §13.6).
//
// Drag/resize use transform/left/top on the card root only; the spec's
// transform-only rule (§7.4.3) targets the high-frequency token reveal path, so
// using left/top for occasional user-driven drag is acceptable and avoids a
// transform that would fight the resize box model.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Segment } from '@shared/types';
import {
  useTokenStore,
  useSessionStore,
  useSettingsStore,
} from '@renderer/state';
import { TokenLine } from './TokenLine';

// Fixed row height estimate for virtualization. Segments wrap, but a generous
// fixed height keeps the math simple and the spacer accurate enough; rows clamp
// their content height so the estimate holds (§7.3 "render only visible").
const ROW_HEIGHT = 92;
// Render this many extra rows above/below the viewport to avoid pop-in on scroll.
const OVERSCAN = 3;
// Distance from the bottom (px) under which we treat the view as "stuck".
const STICK_THRESHOLD = 24;

const GLASS_STYLE: React.CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: 'var(--shadow-overlay)',
};

// One scrollback row: source (muted) over Vietnamese (primary), with a timestamp.
function SegmentRow({
  segment,
  reducedMotion,
  fresh,
}: {
  segment: Segment;
  reducedMotion: boolean;
  fresh: boolean;
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
      style={{ minHeight: ROW_HEIGHT }}
    >
      <div className="flex items-center justify-between text-[0.7rem] text-muted">
        <span>{segment.speaker ?? 'Speaker'}</span>
        <span>{time}</span>
      </div>
      {segment.source ? (
        <div className="font-sans text-[0.85rem] text-muted legible">
          {segment.source}
        </div>
      ) : null}
      <div className="font-vi text-[1.05rem] font-semibold text-text legible vi-lane">
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

  // --- card geometry (drag + resize), local UI state only ------------------
  const [box, setBox] = useState({ x: 80, y: 80, w: 420, h: 360 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ ox: number; oy: number; ow: number; oh: number } | null>(null);

  // --- scrollback virtualization + stick-to-bottom -------------------------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [stuck, setStuck] = useState(true);
  // Remember the last segment count so a freshly-committed row can slide in.
  const prevCountRef = useRef(segments.length);

  // Measure the scroll viewport height (resize-aware).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
  }, [box.h]);

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
    setScrollTop(el.scrollTop);
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

  // The live (un-flushed) line is rendered after the scrollback as a "tail".
  const liveTailHeight = vi.final || vi.provisional ? ROW_HEIGHT : 0;
  const totalHeight = segments.length * ROW_HEIGHT + liveTailHeight;

  // Window calculation: first/last visible index given scrollTop + viewport.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    segments.length,
    Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + OVERSCAN,
  );
  const visible = segments.slice(first, last);

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
      setBox((b) => ({
        ...b,
        x: e.clientX - dragRef.current!.dx,
        y: e.clientY - dragRef.current!.dy,
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

  // Header control handlers (local/store updates only; no IPC ownership here).
  const bumpFont = (delta: number): void =>
    setSetting('fontScale', Math.min(2, Math.max(0.8, Number((fontScale + delta).toFixed(2)))));
  const switchToCaption = (): void => setSetting('overlayMode', 'caption');
  const toggleClickThrough = (): void => window.api.setClickThrough({ locked: true });
  const cycleOpacity = (): void =>
    setSetting('opacity', opacity >= 0.95 ? 0.6 : Number((opacity + 0.15).toFixed(2)));

  const listening = status === 'listening';

  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-16 border border-border"
      style={{
        ...GLASS_STYLE,
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
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
        <div className="flex items-center gap-1 text-muted" onPointerDown={(e) => e.stopPropagation()}>
          <HeaderBtn label="Opacity" onClick={cycleOpacity}>◐</HeaderBtn>
          <HeaderBtn label="Smaller" onClick={() => bumpFont(-0.1)}>A−</HeaderBtn>
          <HeaderBtn label="Larger" onClick={() => bumpFont(0.1)}>A+</HeaderBtn>
          <HeaderBtn label="Caption mode" onClick={switchToCaption}>▭</HeaderBtn>
          <HeaderBtn label="Lock click-through" onClick={toggleClickThrough}>🔒</HeaderBtn>
        </div>
      </div>

      {/* Scrollback body (virtualized). */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
        onScroll={onScroll}
        style={{ opacity: status === 'reconnecting' ? 0.6 : 1 }}
      >
        {segments.length === 0 && !liveTailHeight ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {status === 'connecting' ? 'Connecting…' : 'Waiting for audio…'}
          </div>
        ) : (
          // Spacer sized to the full virtual height; visible rows absolutely
          // positioned at their offset so only ~viewport rows are in the DOM.
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visible.map((seg, i) => {
              const index = first + i;
              return (
                <div
                  key={seg.time + ':' + index}
                  style={{ position: 'absolute', top: index * ROW_HEIGHT, left: 0, right: 0 }}
                >
                  <SegmentRow
                    segment={seg}
                    reducedMotion={reducedMotion}
                    fresh={index === segments.length - 1 && index >= prevCountRef.current}
                  />
                </div>
              );
            })}

            {/* Live (un-flushed) tail line below the committed segments. */}
            {liveTailHeight ? (
              <div
                style={{
                  position: 'absolute',
                  top: segments.length * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                }}
                className="flex flex-col gap-1 px-4 py-3"
              >
                {source.final || source.provisional ? (
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
