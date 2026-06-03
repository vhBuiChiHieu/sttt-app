// LevelMeter — thin live EQ shown while listening (§7.5).
//
// Reads the single 0..1 RMS level from audioStore and paints a small bar EQ.
// We synthesise a handful of bars from that one scalar (the analyser already
// throttles to ~30fps, §13.6) by giving each bar a fixed weight + a little phase
// jitter, so the meter reads as "alive" without a per-bin FFT feed. Heights use
// transform: scaleY only (§7.4.3 — no layout writes), so it stays cheap.

import { useAudioStore } from '@renderer/state';

// Per-bar weights: a gentle centre-biased EQ profile. 7 bars reads as an EQ
// without crowding the caption bar edge.
const WEIGHTS = [0.55, 0.78, 1.0, 0.86, 1.0, 0.72, 0.5];

export function LevelMeter(): JSX.Element {
  const level = useAudioStore((s) => s.level);

  return (
    <div className="flex h-3 items-end gap-[2px]" aria-hidden>
      {WEIGHTS.map((w, i) => {
        // Floor so bars never fully collapse; scale by level*weight.
        const scale = Math.max(0.18, Math.min(1, level * w * 2.4));
        return (
          <span
            key={i}
            className="w-[2px] rounded-full bg-accent"
            style={{
              height: '100%',
              transformOrigin: 'bottom',
              transform: `scaleY(${scale})`,
              // Smooth the scalar between meter ticks; transform-only (§7.4.3).
              transition: 'transform 90ms cubic-bezier(0.16,1,0.3,1)',
              opacity: 0.85,
            }}
          />
        );
      })}
    </div>
  );
}
