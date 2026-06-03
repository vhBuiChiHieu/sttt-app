// U1 — PCM convert: Float32→Int16 clamps [-1,1]→[-32768,32767]; LE byte order;
// length preserved. (SPEC §13.1)
//
// Tests the pure mirror `pcm-convert.ts` (see that file for why it exists). The
// math is byte-for-byte identical to the worklet's inline conversion.

import { describe, it, expect } from 'vitest';
import { floatToInt16, floatArrayToInt16 } from '@renderer/audio/pcm-convert';

describe('U1 floatToInt16 — clamp + scale', () => {
  it('maps the extremes to the full Int16 range', () => {
    // +1.0 → 32767 (0x7fff), -1.0 → -32768 (0x8000 * -1).
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(0)).toBe(0);
  });

  it('clamps out-of-range floats instead of wrapping', () => {
    // Values beyond [-1,1] would wrap on a raw cast; conversion must clamp first.
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(-2)).toBe(-32768);
    expect(floatToInt16(1.0001)).toBe(32767);
    expect(floatToInt16(-5)).toBe(-32768);
  });

  it('scales mid-range values with asymmetric pos/neg factors', () => {
    expect(floatToInt16(0.5)).toBeCloseTo(0.5 * 0x7fff, 5);
    expect(floatToInt16(-0.5)).toBeCloseTo(-0.5 * 0x8000, 5);
  });
});

describe('U1 floatArrayToInt16 — length + byte order', () => {
  it('preserves length 1:1 (no-resample fast path)', () => {
    const input = new Float32Array([0, 0.25, -0.25, 1, -1]);
    const out = floatArrayToInt16(input);
    expect(out.length).toBe(input.length);
  });

  it('produces correct per-sample values', () => {
    const input = new Float32Array([0, 1, -1, 0.5]);
    const out = floatArrayToInt16(input);
    // 0.5*0x7fff = 16383.5; Int16Array truncates toward zero → 16383 (matches the
    // worklet, which also stores into an Int16Array).
    expect(Array.from(out)).toEqual([0, 32767, -32768, Math.trunc(0.5 * 0x7fff)]);
  });

  it('emits little-endian bytes', () => {
    // 32767 = 0x7FFF → LE bytes [0xFF, 0x7F]; -32768 = 0x8000 → LE [0x00, 0x80].
    const out = floatArrayToInt16(new Float32Array([1, -1]));
    const bytes = new Uint8Array(out.buffer);
    expect(Array.from(bytes)).toEqual([0xff, 0x7f, 0x00, 0x80]);
  });
});
