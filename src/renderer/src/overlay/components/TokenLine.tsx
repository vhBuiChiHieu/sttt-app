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
}

export function TokenLine({
  final,
  provisional,
  variant,
  reducedMotion,
  showCaret = true,
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

  // Persist the signature set for the next diff.
  const nextSig = new Set(words.map((w) => w.key));
  prevSigRef.current = nextSig;

  // Per-variant typography (§7.2 / §7.8). VI lane carries the readability shadow
  // and generous line-height; source lane is small + muted.
  const laneClass =
    variant === 'vi'
      ? 'font-vi font-semibold legible vi-lane text-[1.5rem]'
      : 'font-sans legible text-[0.95rem]';

  return (
    <div
      className={`flex flex-wrap items-baseline ${laneClass}`}
      // will-change hint kept on the line container (§7.4.3).
      style={{ willChange: 'transform, opacity' }}
    >
      {words.map((w) => {
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
