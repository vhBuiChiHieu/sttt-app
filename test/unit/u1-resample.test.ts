// Unit U1 (resampler) — regression for the fallback linear resampler in
// pcm-processor.js, exercised via its pure mirror resampleLinearTo16k().
//
// The bug this guards: the previous resampler carried a NEGATIVE read position
// across blocks (pos_end < block length), so the next block read channel[-1] →
// undefined → NaN samples. The fix keeps nextReadPos in [0, ratio).

import { describe, it, expect } from 'vitest';
import { resampleLinearTo16k } from '@renderer/audio/pcm-convert';

// A 128-sample render quantum of a smooth ramp in [-1, 1].
function ramp(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = (i / (n - 1)) * 2 - 1;
  return a;
}

describe('U1 resampleLinearTo16k (48k→16k fallback)', () => {
  const ratio = 48000 / 16000; // = 3

  it('carries a non-negative read position across consecutive blocks', () => {
    let readPos = 0;
    // Chain many blocks; nextReadPos must never go negative (the regression).
    for (let block = 0; block < 50; block++) {
      const r = resampleLinearTo16k(ramp(128), ratio, readPos);
      expect(r.nextReadPos).toBeGreaterThanOrEqual(0);
      expect(r.nextReadPos).toBeLessThan(ratio);
      readPos = r.nextReadPos;
    }
  });

  it('emits ~length/ratio samples per block with no NaN/garbage', () => {
    const r = resampleLinearTo16k(ramp(128), ratio, 0);
    // 128 / 3 ≈ 42-43 output samples.
    expect(r.samples.length).toBeGreaterThanOrEqual(42);
    expect(r.samples.length).toBeLessThanOrEqual(44);
    for (const s of r.samples) {
      expect(Number.isNaN(s)).toBe(false);
      expect(s).toBeGreaterThanOrEqual(-32768);
      expect(s).toBeLessThanOrEqual(32767);
    }
  });

  it('starts the second block in-bounds (no channel[-1] read)', () => {
    const first = resampleLinearTo16k(ramp(128), ratio, 0);
    // Feed the carried position into a fresh block; first output must be finite
    // (a negative readPos would have produced NaN here).
    const second = resampleLinearTo16k(ramp(128), ratio, first.nextReadPos);
    expect(Number.isNaN(second.samples[0])).toBe(false);
  });
});
