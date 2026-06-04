// tokenStore — implements the §6.2 token-aggregation rules.
//
// Two render lanes, split by `translation_status`:
//   - source lane: tokens with status 'none' | 'original'
//   - vi lane:     tokens with status 'translation'
//
// Per Soniox's streaming model, each WS message carries *new* final tokens plus
// the full current set of provisional (is_final:false) tokens. Therefore:
//   - final tokens APPEND to the lane's final buffer (Soniox never re-sends a
//     final, so a plain append already satisfies "exactly once" — rule 2);
//   - provisional tokens REPLACE the lane's provisional buffer wholesale every
//     message (rule 3).
// The reducer is pure/deterministic so it can be unit-tested in isolation.

import { create } from 'zustand';
import type { Token, Segment } from '@shared/types';

// One render lane: committed (final) text plus the live (provisional) tail.
interface Lane {
  final: string;
  provisional: string;
}

export interface TokenState {
  source: Lane;
  vi: Lane;
  segments: Segment[];
  ingestTokens(tokens: Token[]): void;
  flushSegment(): void;
  reset(): void;
}

const emptyLane = (): Lane => ({ final: '', provisional: '' });

// Route a token to its lane key. 'none'/'original' → source, 'translation' → vi.
function laneOf(token: Token): 'source' | 'vi' {
  return token.translation_status === 'translation' ? 'vi' : 'source';
}

// Pure aggregation core (rules 1-3). Takes the two current lanes and one
// message's worth of tokens, returns the next lane state. No timestamps are
// used for the vi lane — translation is a flowing line, not word-aligned (rule 5).
export function aggregate(
  source: Lane,
  vi: Lane,
  tokens: Token[],
): { source: Lane; vi: Lane } {
  // Carry final buffers forward (finals are cumulative); rebuild provisionals
  // from scratch since this message replaces the whole provisional tail.
  const next = {
    source: { final: source.final, provisional: '' },
    vi: { final: vi.final, provisional: '' },
  };

  for (const token of tokens) {
    const key = laneOf(token); // rule 1: lane split
    if (token.is_final) {
      next[key].final += token.text; // rule 2: append finals once
    } else {
      next[key].provisional += token.text; // rule 3: provisional replaced wholesale
    }
  }

  return next;
}

export const useTokenStore = create<TokenState>((set) => ({
  source: emptyLane(),
  vi: emptyLane(),
  segments: [],

  ingestTokens: (tokens) =>
    set((state) => aggregate(state.source, state.vi, tokens)),

  // rule 4: push the current finalized line into segment history, then clear
  // the live line so the next utterance starts fresh.
  flushSegment: () =>
    set((state) => {
      // #8: fold any live provisional tail into final before committing, so a
      // half-spoken word at Stop ("I was trying to sa…") is preserved into
      // history instead of dropped. Harmless at normal endpoints, where the
      // provisional buffer is already empty.
      const segment: Segment = {
        source: state.source.final + state.source.provisional,
        vietnamese: state.vi.final + state.vi.provisional,
        time: Date.now(),
      };
      return {
        segments: [...state.segments, segment],
        source: emptyLane(),
        vi: emptyLane(),
      };
    }),

  reset: () => set({ source: emptyLane(), vi: emptyLane(), segments: [] }),
}));
