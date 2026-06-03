// Pure Float32 → Int16 PCM conversion helpers (SPEC §5, unit test U1).
//
// WHY THIS FILE EXISTS: the real conversion lives in `pcm-processor.js`, which
// runs inside the AudioWorklet global scope. That file `extends
// AudioWorkletProcessor` and calls `registerProcessor(...)` at module load, so
// importing it in Node/Vitest throws (those worklet globals don't exist). To
// unit-test the clamp/byte-order behaviour without a real refactor of the
// worklet, this module mirrors the worklet's inline conversion EXACTLY:
//
//   const s = sample < -1 ? -1 : sample > 1 ? 1 : sample;
//   return s < 0 ? s * 0x8000 : s * 0x7fff;
//
// Keep these two in sync if the worklet's math ever changes. This is an additive
// pure export only — it does not alter any production code path.

// Clamp a single Float32 sample to [-1, 1] and convert to a 16-bit signed int.
// Asymmetric scaling: negatives map toward -32768, positives toward 32767.
export function floatToInt16(sample: number): number {
  const s = sample < -1 ? -1 : sample > 1 ? 1 : sample;
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}

// Convert a Float32 mono buffer to a little-endian Int16 PCM ArrayBuffer,
// matching what the worklet posts to the main thread (length preserved 1:1 in
// the fast/no-resample path). Int16Array is little-endian on all supported
// platforms (x64 Windows), so the returned buffer is LE PCM.
export function floatArrayToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = floatToInt16(samples[i]);
  }
  return out;
}

// Result of one resample block: the Int16 samples plus the fractional read
// position to carry into the next block (always in [0, ratio), so chaining never
// produces a negative index).
export interface ResampleResult {
  samples: Int16Array;
  nextReadPos: number;
}

// Linear-interpolate a Float32 block (sampled at nativeRate, ratio = nativeRate/
// 16000) down to 16 kHz Int16, continuing from `readPos`. EXACT mirror of the
// fallback branch in pcm-processor.js (the worklet can't import this — keep them
// in sync). `readPos` must be >= 0; the loop exits with pos >= length so
// `nextReadPos` is in [0, ratio) and the next block never reads a negative index.
export function resampleLinearTo16k(
  channel: Float32Array,
  ratio: number,
  readPos: number,
): ResampleResult {
  const tmp = new Int16Array(Math.ceil(channel.length / ratio) + 2);
  let n = 0;
  let pos = readPos;
  while (pos < channel.length) {
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = channel[idx];
    const b = idx + 1 < channel.length ? channel[idx + 1] : a;
    tmp[n++] = floatToInt16(a + (b - a) * frac);
    pos += ratio;
  }
  return { samples: tmp.slice(0, n), nextReadPos: pos - channel.length };
}
