// Loopback (system audio) capture — SPEC §5 / §15.
//
// On Electron+Windows, system-audio loopback is only unlocked when the page
// requests *video + audio* via getDisplayMedia, and the main process'
// setDisplayMediaRequestHandler answers with { video: <screenSource>,
// audio: 'loopback' }. We do not actually want the video, so we stop and drop
// the video track immediately and keep only the audio track.

export interface LoopbackCapture {
  // Stream containing exactly one (audio) track, ready to feed the graph.
  stream: MediaStream;
  // The retained system-audio track (kept for level/state checks and cleanup).
  audioTrack: MediaStreamTrack;
}

// Thrown when no usable loopback audio track is obtained, so the pipeline can
// surface a clear error state (§15 "Temp-key/clear error state" style).
export class NoAudioDeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoAudioDeviceError';
  }
}

// Acquire a loopback MediaStream and reduce it to its audio track.
export async function captureLoopback(): Promise<LoopbackCapture> {
  let stream: MediaStream;
  try {
    // video:true is REQUIRED to unlock loopback audio (§15), even though the
    // video track is discarded right after.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    // User cancelled the picker, or no capturable source / device available.
    const reason = err instanceof Error ? err.message : String(err);
    throw new NoAudioDeviceError(`Loopback capture failed: ${reason}`);
  }

  // Drop the video track immediately — we only ever needed it to enable audio.
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    // Stop whatever remains so we never leak a live capture session.
    stream.getTracks().forEach((t) => t.stop());
    throw new NoAudioDeviceError(
      'No system-audio (loopback) track returned; check the display-media handler.',
    );
  }

  return { stream, audioTrack };
}
