// U2 — Token aggregate: finals appended exactly once; provisional replaced wholesale.
// U3 — Lane split: translation_status routes to source vs VI lanes.
// U4 — Segment flush: endpoint/finalization pushes one segment with both lanes + time.
// (SPEC §13.1, rules §6.2)
//
// Exercises the REAL pure reducer `aggregate()` and the `useTokenStore` actions.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aggregate, useTokenStore } from '@renderer/state/tokenStore';
import type { Token } from '@shared/types';

// Minimal token factory — only the fields the reducer reads.
function tok(
  text: string,
  is_final: boolean,
  translation_status: Token['translation_status'],
): Token {
  return { text, is_final, translation_status, confidence: 1 };
}

const emptyLane = () => ({ final: '', provisional: '' });

describe('U2 aggregate — finals append once, provisionals replaced wholesale', () => {
  it('appends final tokens to the lane final buffer', () => {
    const r = aggregate(emptyLane(), emptyLane(), [
      tok('Hello', true, 'none'),
      tok(' world', true, 'none'),
    ]);
    expect(r.source.final).toBe('Hello world');
    expect(r.source.provisional).toBe('');
  });

  it('never re-appends a previously-committed final (Soniox sends each final once)', () => {
    // Message 1 commits "Hello"; message 2 carries only NEW finals.
    const r1 = aggregate(emptyLane(), emptyLane(), [tok('Hello', true, 'none')]);
    const r2 = aggregate(r1.source, r1.vi, [tok(' there', true, 'none')]);
    expect(r2.source.final).toBe('Hello there'); // exactly once, no duplication
  });

  it('replaces the provisional tail wholesale every message', () => {
    const r1 = aggregate(emptyLane(), emptyLane(), [tok('typ', false, 'none')]);
    expect(r1.source.provisional).toBe('typ');
    // Next message resends the corrected full provisional — old one is dropped.
    const r2 = aggregate(r1.source, r1.vi, [tok('typing', false, 'none')]);
    expect(r2.source.provisional).toBe('typing'); // not 'typtyping'
    expect(r2.source.final).toBe(''); // finals untouched
  });

  it('keeps committed finals while provisionals churn', () => {
    const r1 = aggregate(emptyLane(), emptyLane(), [tok('Done.', true, 'none')]);
    const r2 = aggregate(r1.source, r1.vi, [tok(' more', false, 'none')]);
    expect(r2.source.final).toBe('Done.');
    expect(r2.source.provisional).toBe(' more');
    // A provisional-only follow-up must not lose the final.
    const r3 = aggregate(r2.source, r2.vi, [tok(' moreee', false, 'none')]);
    expect(r3.source.final).toBe('Done.');
    expect(r3.source.provisional).toBe(' moreee');
  });
});

describe('U3 aggregate — lane split by translation_status', () => {
  it("routes 'none' and 'original' to the source lane", () => {
    const r = aggregate(emptyLane(), emptyLane(), [
      tok('Hi', true, 'none'),
      tok(' there', true, 'original'),
    ]);
    expect(r.source.final).toBe('Hi there');
    expect(r.vi.final).toBe('');
  });

  it("routes 'translation' to the VI lane", () => {
    const r = aggregate(emptyLane(), emptyLane(), [tok('Xin chào', true, 'translation')]);
    expect(r.vi.final).toBe('Xin chào');
    expect(r.source.final).toBe('');
  });

  it('splits a mixed message into the correct lanes simultaneously', () => {
    const r = aggregate(emptyLane(), emptyLane(), [
      tok('Hello', true, 'original'),
      tok('Xin', true, 'translation'),
      tok(' chào', false, 'translation'),
      tok(' world', false, 'original'),
    ]);
    expect(r.source.final).toBe('Hello');
    expect(r.source.provisional).toBe(' world');
    expect(r.vi.final).toBe('Xin');
    expect(r.vi.provisional).toBe(' chào');
  });
});

describe('U2/U3 via the store (ingestTokens delegates to aggregate)', () => {
  beforeEach(() => useTokenStore.getState().reset());

  it('accumulates finals and replaces provisionals across messages', () => {
    const s = useTokenStore.getState();
    s.ingestTokens([tok('A', true, 'none'), tok('prov', false, 'none')]);
    s.ingestTokens([tok('B', true, 'none'), tok('prov2', false, 'none')]);
    const st = useTokenStore.getState();
    expect(st.source.final).toBe('AB');
    expect(st.source.provisional).toBe('prov2');
  });
});

describe('U4 flushSegment — one segment with both lanes + time', () => {
  beforeEach(() => useTokenStore.getState().reset());

  it('pushes exactly one segment carrying both finalized lanes and a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T00:00:00Z'));
    const s = useTokenStore.getState();
    s.ingestTokens([tok('Hello', true, 'original'), tok('Xin chào', true, 'translation')]);
    s.flushSegment();

    const st = useTokenStore.getState();
    expect(st.segments).toHaveLength(1);
    expect(st.segments[0]).toMatchObject({
      source: 'Hello',
      vietnamese: 'Xin chào',
      time: Date.parse('2026-06-03T00:00:00Z'),
    });
    vi.useRealTimers();
  });

  it('clears the live lanes after a flush so the next utterance starts fresh', () => {
    const s = useTokenStore.getState();
    s.ingestTokens([tok('first', true, 'none')]);
    s.flushSegment();
    expect(useTokenStore.getState().source.final).toBe('');
    expect(useTokenStore.getState().vi.final).toBe('');

    // Second utterance produces a SECOND distinct segment.
    s.ingestTokens([tok('second', true, 'none')]);
    s.flushSegment();
    const st = useTokenStore.getState();
    expect(st.segments).toHaveLength(2);
    expect(st.segments[0].source).toBe('first');
    expect(st.segments[1].source).toBe('second');
  });
});
