// AudioWorklet processor: 'pcm-downsampler'
//
// PLAIN JS on purpose — this file is loaded as a worklet module via a `?url`
// import (SPEC §5 / §15 "AudioWorklet bundling in Vite"). It must contain NO
// ES `import` statements so Vite ships it verbatim; bundling it would break the
// worklet global scope (AudioWorkletProcessor, registerProcessor, sampleRate).
//
// Job: take Float32 mono samples [-1, 1] from the render graph and emit
// little-endian Int16 PCM as a transferable ArrayBuffer. If the AudioContext
// could not be created at 16 kHz (fallback path, §15 "AudioContext 16k
// unsupported"), we linearly resample to 16 kHz here so Soniox always gets the
// rate it was configured with.

const TARGET_RATE = 16000;

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a worklet global = the AudioContext's actual rate.
    // When the context already runs at 16 kHz this ratio is 1 → no resample.
    this._ratio = sampleRate / TARGET_RATE;
    // Fractional read position carried across process() blocks so the linear
    // resampler stays phase-continuous between 128-sample quanta.
    this._readPos = 0;
  }

  // Clamp + convert a single Float32 sample to a 16-bit signed integer.
  static _floatToInt16(sample) {
    // Clamp to [-1, 1] first; out-of-range floats would wrap on cast.
    const s = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    // Asymmetric scaling: negative range maps to -32768, positive to 32767.
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  process(inputs) {
    const input = inputs[0];
    // No connected input (e.g. graph torn down) → keep processor alive.
    if (!input || input.length === 0) return true;

    // Mono pipeline: loopback is downmixed upstream, take channel 0.
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    let int16;

    if (this._ratio === 1) {
      // Fast path: context is already at 16 kHz, just convert.
      int16 = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        int16[i] = PcmDownsampler._floatToInt16(channel[i]);
      }
    } else {
      // Fallback path: linear-interpolate down to 16 kHz.
      // outCount = how many 16 kHz samples this input block yields.
      const outCount = Math.floor((channel.length - this._readPos) / this._ratio);
      int16 = new Int16Array(outCount > 0 ? outCount : 0);
      let pos = this._readPos;
      for (let i = 0; i < int16.length; i++) {
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const a = channel[idx];
        // Guard the upper neighbour at the block boundary.
        const b = idx + 1 < channel.length ? channel[idx + 1] : a;
        int16[i] = PcmDownsampler._floatToInt16(a + (b - a) * frac);
        pos += this._ratio;
      }
      // Carry leftover fractional position into the next block.
      this._readPos = pos - channel.length;
    }

    if (int16.length > 0) {
      // Transfer the underlying ArrayBuffer (zero-copy) to the main thread.
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true; // keep the processor running
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
