// TokenLine — the §7.4 smooth token-reveal primitive.
//
// Renders one lane (final buffer + provisional tail) as a flex-wrap line of
// per-word <span>s. Core behaviours (§7.4):
//   1. Token enter: each NEW word animates opacity/translateY/blur with a ≤25ms
//      per-word stagger so words stream in (animate transform/opacity/filter only).
//   2. Provisional vs final: provisional words use --text-provisional + a trailing
//      caret glow; when a word finalizes it transitions to --text + semibold and
//      fires a one-time accent-grad sweep.
//   3. No layout jank: provisional region is diffed against the previous render so
//      unchanged leading words do NOT re-animate; only genuinely new words enter.
//
// Reduced motion (prop) disables the enter transform/blur + sweep, keeping instant
// opacity (the .reduced-motion class on the overlay root also covers this in CSS).

import { useRef } from 'react';

// Max per-word entry stagger (§7.4.1 "≤25ms"). Capped so long lines don't crawl.
const STAGGER_MS = 25;
const STAGGER_CAP = 12; // after N words, stop adding delay (keeps tail snappy)

// Split a buffer into words while preserving the trailing space so wrapped lines
// keep natural spacing. Empty string → no words.
function toWords(buf: string): string[] {
  if (!buf) return [];
  // Keep delimiters with the word (match runs of non-space + following spaces).
  const matches = buf.match(/\S+\s*/g);
  return matches ?? [];
}

// Stable identity for a word at a given lane position: text + index. Used to
// detect which words are new since the last render (so we don't re-animate the
// unchanged leading region).
type WordKind = 'final' | 'provisional';

interface RenderedWord {
  key: string;
  text: string;
  kind: WordKind;
  // True only on the first render where this exact word appeared → triggers enter.
  isNew: boolean;
  // Index within the line, for the entry stagger.
  index: number;
}

export interface TokenLineProps {
  final: string;
  provisional: string;
  // 'vi' = Be Vietnam Pro semibold large; 'source' = Inter small muted.
  variant: 'vi' | 'source';
  reducedMotion: boolean;
  // Show the trailing provisional caret glow (only while actively listening).
  showCaret?: boolean;
  // #3: optional rolling-window cap. When the combined word count exceeds this,
  // only the trailing `maxWords` words are rendered (the leading overflow is
  // dropped from the DOM but stays preserved in segment history on flush).
  maxWords?: number;
}

export function TokenLine({
  final,
  provisional,
  variant,
  reducedMotion,
  showCaret = true,
  maxWords,
}: TokenLineProps): JSX.Element {
  // Remember the previous word list so we can diff and only animate genuine
  // additions. We compare by (kind,index,text) signature.
  const prevSigRef = useRef<Set<string>>(new Set());
  // Track which final words have already fired their one-time sweep so re-renders
  // (e.g. provisional churn) don't replay it.
  const sweptRef = useRef<Set<string>>(new Set());

  const finalWords = toWords(final);
  const provWords = toWords(provisional);

  // Build the render list. Final words first (committed), then provisional tail.
  const words: RenderedWord[] = [];
  let idx = 0;
  for (const text of finalWords) {
    const sig = `f:${idx}:${text}`;
    words.push({
      key: sig,
      text,
      kind: 'final',
      isNew: !prevSigRef.current.has(sig),
      index: idx,
    });
    idx += 1;
  }
  for (let p = 0; p < provWords.length; p++) {
    const text = provWords[p];
    // Provisional words key on their own index so replacing the tail wholesale
    // only re-animates words whose (index,text) actually changed (§7.4.3 diff).
    const sig = `p:${p}:${text}`;
    words.push({
      key: sig,
      text,
      kind: 'provisional',
      isNew: !prevSigRef.current.has(sig),
      index: idx,
    });
    idx += 1;
  }

  // #3: rolling window — when over the cap, drop the leading overflow and keep
  // only the trailing `maxWords` words. Each survivor retains its original
  // index-based key/signature so the reveal-diff below does NOT re-animate words
  // that merely shifted position when older words scrolled off.
  const rendered =
    maxWords != null && words.length > maxWords ? words.slice(-maxWords) : words;

  // Persist the signature set for the next diff. We diff against everything we
  // actually render (the windowed tail) so dropped words don't pollute the set.
  const nextSig = new Set(rendered.map((w) => w.key));
  prevSigRef.current = nextSig;

  // Per-variant typography (§7.2 / §7.8). VI lane carries the readability shadow
  // and generous line-height; source lane is small + muted.
  // #4: sizes are in `em` so they scale with the `fontSize: ${fontScale}rem`
  // set on the enclosing lanes container / card root. At fontScale=1 the parent
  // is 1rem, so 1.5em / 0.95em reproduce today's 1.5rem / 0.95rem exactly.
  const laneClass =
    variant === 'vi'
      ? 'font-vi font-semibold legible vi-lane text-[1.5em]'
      : 'font-sans legible text-[0.95em]';

  return (
    <div
      className={`flex flex-wrap items-baseline ${laneClass}`}
      // will-change hint kept on the line container (§7.4.3).
      style={{ willChange: 'transform, opacity' }}
    >
      {rendered.map((w) => {
        const isFinal = w.kind === 'final';
        // One-time finalize sweep: a final word that is new this render and has
        // not been swept yet. (Disabled under reduced motion.)
        const firstFinalize = isFinal && w.isNew && !sweptRef.current.has(w.key);
        if (firstFinalize) sweptRef.current.add(w.key);
        const doSweep = firstFinalize && !reducedMotion;

        // Entry animation only for newly-arrived words (and not reduced-motion).
        const doEnter = w.isNew && !reducedMotion;
        const delayMs = Math.min(w.index, STAGGER_CAP) * STAGGER_MS;

        const classes = [
          'whitespace-pre', // preserve the trailing space captured in the word
          isFinal ? 'tok-final text-text' : 'text-text-provisional',
          doSweep ? 'tok-sweep' : '',
          doEnter ? 'tok-enter' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <span
            key={w.key}
            className={classes}
            // Stagger only the enter animation; harmless when not entering.
            style={doEnter ? { animationDelay: `${delayMs}ms` } : undefined}
          >
            {w.text}
          </span>
        );
      })}

      {/* Trailing caret glow after the provisional tail (§7.4.2). */}
      {showCaret && provWords.length > 0 ? <span className="caret-glow" aria-hidden /> : null}
    </div>
  );
}
