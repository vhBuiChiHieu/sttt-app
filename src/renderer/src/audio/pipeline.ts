// Audio pipeline wiring — SPEC §5 / §13.6.
//
// captureLoopback() → AudioContext(16k) → MediaStreamAudioSourceNode
//   ├→ AudioWorkletNode('pcm-downsampler') → batch ~100ms Int16 → onPcm(buffer)
//   └→ AnalyserNode (parallel, throttled ~30fps) → onLevel(0..1) for the meter
//
// The worklet is shipped as plain JS and loaded by URL so Vite does not try to
// bundle it as an ES module (§15 "AudioWorklet bundling in Vite").

import { captureLoopback, type LoopbackCapture } from './capture';
// `?url` makes Vite emit the worklet as a standalone asset and hand us its URL.
import pcmProcessorUrl from './pcm-processor.js?url';

const TARGET_RATE = 16000;
// ~100ms of mono 16 kHz Int16 = 1600 samples (within the 100–120ms target).
const BATCH_SAMPLES = 1600;
// Throttle the level meter to ~30fps so the analyser does not burn idle CPU
// (§13.6 "analyser throttled to ~30 fps for meter").
const LEVEL_INTERVAL_MS = 1000 / 30;

export type OnPcm = (buffer: ArrayBuffer) => void;
export type OnLevel = (level: number) => void;

export class AudioPipeline {
  private capture: LoopbackCapture | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Int16 batch accumulator (filled across worklet messages, flushed at ~100ms).
  private batch = new Int16Array(BATCH_SAMPLES);
  private batchFill = 0;

  // Level-meter throttling.
  private levelRaf = 0;
  private lastLevelAt = 0;
  // ArrayBuffer-backed (not ArrayBufferLike) to satisfy getFloatTimeDomainData's
  // typed-array generic in TS 5.7+ lib.dom.
  private analyserBuf: Float32Array<ArrayBuffer> | null = null;

  // True when the context could not run at 16 kHz and the worklet is doing the
  // resample (§15 fallback). Exposed via `resamplingInWorklet` for diagnostics.
  private _resampleFallback = false;

  get resamplingInWorklet(): boolean {
    return this._resampleFallback;
  }

  async start(onPcm: OnPcm, onLevel: OnLevel): Promise<void> {
    // 1. Acquire loopback audio (throws NoAudioDeviceError on failure).
    this.capture = await captureLoopback();

    // 2. Create the context at 16 kHz. If the platform refuses that rate, fall
    //    back to the default rate — the worklet then resamples to 16 kHz.
    try {
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      // Some platforms throw rather than honour the requested rate.
      this.ctx = new AudioContext();
    }
    // graph runs at native rate when 16k was refused; pcm-downsampler resamples.
    this._resampleFallback = this.ctx.sampleRate !== TARGET_RATE;

    // 3. Load the worklet module from its emitted URL.
    await this.ctx.audioWorklet.addModule(pcmProcessorUrl);

    // 4. Build the graph.
    this.source = this.ctx.createMediaStreamSource(this.capture.stream);
    this.worklet = new AudioWorkletNode(this.ctx, 'pcm-downsampler');

    // Worklet → batch → onPcm. Each message is a transferred Int16 ArrayBuffer.
    this.worklet.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      this.accumulate(new Int16Array(ev.data), onPcm);
    };

    // Parallel analyser for the level meter (not connected to destination).
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserBuf = new Float32Array(this.analyser.fftSize);

    // source feeds both the worklet and the analyser.
    this.source.connect(this.worklet);
    this.source.connect(this.analyser);
    // The worklet must be pulled by the graph; route it to a muted destination
    // so process() keeps getting called without making the capture audible.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.worklet.connect(sink).connect(this.ctx.destination);

    // 5. Start the throttled level loop.
    this.lastLevelAt = 0;
    this.tickLevel(onLevel);

    // Resume in case the context started suspended (autoplay policy).
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  // Append worklet output to the batch buffer, flushing whole ~100ms chunks.
  private accumulate(chunk: Int16Array, onPcm: OnPcm): void {
    let offset = 0;
    while (offset < chunk.length) {
      const space = BATCH_SAMPLES - this.batchFill;
      const take = Math.min(space, chunk.length - offset);
      this.batch.set(chunk.subarray(offset, offset + take), this.batchFill);
      this.batchFill += take;
      offset += take;

      if (this.batchFill === BATCH_SAMPLES) {
        // Hand off a copy's buffer; reset the accumulator for the next batch.
        const out = this.batch.slice(0, BATCH_SAMPLES);
        onPcm(out.buffer);
        this.batchFill = 0;
      }
    }
  }

  // rAF-driven meter, gated to ~30fps. Computes RMS → 0..1 level.
  private tickLevel(onLevel: OnLevel): void {
    const loop = (now: number): void => {
      this.levelRaf = requestAnimationFrame(loop);
      if (now - this.lastLevelAt < LEVEL_INTERVAL_MS) return;
      this.lastLevelAt = now;

      if (!this.analyser || !this.analyserBuf) return;
      this.analyser.getFloatTimeDomainData(this.analyserBuf);
      let sum = 0;
      for (let i = 0; i < this.analyserBuf.length; i++) {
        const v = this.analyserBuf[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.analyserBuf.length);
      // Clamp; RMS of normalised audio is already within [0,1] in practice.
      onLevel(rms > 1 ? 1 : rms);
    };
    this.levelRaf = requestAnimationFrame(loop);
  }

  async stop(): Promise<void> {
    // Stop the meter loop.
    if (this.levelRaf) {
      cancelAnimationFrame(this.levelRaf);
      this.levelRaf = 0;
    }

    // Detach the worklet port handler and tear down nodes.
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.analyserBuf = null;

    // Stop capture tracks so Windows releases the loopback session.
    this.capture?.stream.getTracks().forEach((t) => t.stop());
    this.capture = null;

    // Close the context last.
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }

    // Drop any partial batch.
    this.batchFill = 0;
  }
}

// Module-level convenience instance + functional API matching the slice spec:
//   start(onPcm, onLevel) / stop()
const pipeline = new AudioPipeline();

export function start(onPcm: OnPcm, onLevel: OnLevel): Promise<void> {
  return pipeline.start(onPcm, onLevel);
}

export function stop(): Promise<void> {
  return pipeline.stop();
}
