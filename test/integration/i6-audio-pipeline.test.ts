// @vitest-environment jsdom
//
// I6 — Audio pipeline: mocked MediaStream → worklet posts Int16 buffers of the
// expected size. (SPEC §13.2 / §5 / §13.6)
//
// The real Web Audio stack (AudioContext, AudioWorkletNode, getDisplayMedia) does
// not exist in jsdom. We mock that boundary just enough to instantiate the REAL
// `AudioPipeline`, then capture the worklet `port.onmessage` handler the pipeline
// installs and feed it Int16 chunks. This exercises the production `accumulate()`
// batching path, asserting it emits ~100ms frames of 1600 samples / 3200 bytes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioPipeline } from '@renderer/audio/pipeline';

const BATCH_SAMPLES = 1600; // ~100ms of mono 16k Int16 (mirrors pipeline.ts)

// A fake worklet node whose port.onmessage the pipeline will assign. We keep a
// reference so the test can push messages as if the worklet posted them.
class FakeAudioWorkletNode {
  port = { onmessage: null as ((ev: MessageEvent<ArrayBuffer>) => void) | null };
  connect(node: unknown): unknown {
    return node;
  }
  disconnect(): void {}
}

let lastWorklet: FakeAudioWorkletNode | null = null;

// Minimal AudioContext stand-in covering only what AudioPipeline.start touches.
class FakeAudioContext {
  sampleRate: number;
  state = 'running';
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  constructor(opts?: { sampleRate?: number }) {
    // Honour the requested 16k so _resampleFallback stays false in the happy path.
    this.sampleRate = opts?.sampleRate ?? 48000;
  }
  createMediaStreamSource(): { connect: (n: unknown) => unknown; disconnect: () => void } {
    return { connect: (n: unknown) => n, disconnect: () => {} };
  }
  createAnalyser(): unknown {
    return {
      fftSize: 0,
      getFloatTimeDomainData: (_buf: Float32Array) => {},
      disconnect: () => {},
    };
  }
  createGain(): { gain: { value: number }; connect: (n: unknown) => unknown } {
    return { gain: { value: 0 }, connect: (n: unknown) => n };
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [{ stop() {} }],
    getVideoTracks: () => [],
    getAudioTracks: () => [{ stop() {} }],
    removeTrack: () => {},
  } as unknown as MediaStream;
}

let restore: Array<() => void> = [];
beforeEach(() => {
  lastWorklet = null;
  restore = [];

  // getDisplayMedia → a stream with one audio track.
  Object.defineProperty(global.navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn(async () => fakeStream()) },
  });
  restore.push(() => {
    // @ts-expect-error cleanup
    delete (global.navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'AudioWorkletNode',
    vi.fn(() => {
      lastWorklet = new FakeAudioWorkletNode();
      return lastWorklet;
    }),
  );
  // rAF is used by the level meter loop; make it a no-op (return a handle).
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  restore.forEach((fn) => fn());
  vi.unstubAllGlobals();
});

describe('I6 audio pipeline batching', () => {
  it('emits one 1600-sample (3200-byte) Int16 frame per ~100ms of audio', async () => {
    const pipeline = new AudioPipeline();
    const frames: ArrayBuffer[] = [];

    await pipeline.start(
      (buf) => frames.push(buf),
      () => {},
    );

    expect(lastWorklet).not.toBeNull();
    const post = lastWorklet!.port.onmessage!;
    expect(typeof post).toBe('function');

    // Feed exactly one batch worth of samples in two worklet messages (128-quantum
    // sized chunks in reality; here any split exercising accumulate is fine).
    post({ data: new Int16Array(1000).fill(7).buffer } as MessageEvent<ArrayBuffer>);
    expect(frames).toHaveLength(0); // not yet a full batch
    post({ data: new Int16Array(600).fill(9).buffer } as MessageEvent<ArrayBuffer>);

    expect(frames).toHaveLength(1);
    expect(frames[0].byteLength).toBe(BATCH_SAMPLES * 2); // 3200 bytes
    expect(new Int16Array(frames[0]).length).toBe(BATCH_SAMPLES);

    await pipeline.stop();
  });

  it('splits a large input across multiple full batches with a partial remainder held back', async () => {
    const pipeline = new AudioPipeline();
    const frames: ArrayBuffer[] = [];
    await pipeline.start(
      (buf) => frames.push(buf),
      () => {},
    );
    const post = lastWorklet!.port.onmessage!;

    // 3700 samples → two full 1600-sample batches + 500 held in the accumulator.
    post({ data: new Int16Array(3700).buffer } as MessageEvent<ArrayBuffer>);
    expect(frames).toHaveLength(2);
    expect(frames.every((f) => f.byteLength === BATCH_SAMPLES * 2)).toBe(true);

    // Top up the remaining 1100 → completes the third batch.
    post({ data: new Int16Array(1100).buffer } as MessageEvent<ArrayBuffer>);
    expect(frames).toHaveLength(3);

    await pipeline.stop();
  });

  it('reports no resample fallback when the context honours 16 kHz', async () => {
    const pipeline = new AudioPipeline();
    await pipeline.start(
      () => {},
      () => {},
    );
    // FakeAudioContext honours the requested 16k → fast path, no worklet resample.
    expect(pipeline.resamplingInWorklet).toBe(false);
    await pipeline.stop();
  });
});
