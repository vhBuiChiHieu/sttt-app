// Live smoke test: verify temp key + STT-RT WS accepts config (model + translation vi).
// Node 24 has global WebSocket + fetch. Run: node scripts/soniox-smoke.mjs
const WORKER = 'https://soniox.obert-john.workers.dev/';
const WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

const keyRes = await fetch(WORKER, { headers: { Accept: 'application/json' } });
const { api_key, expires_at } = await keyRes.json();
console.log('temp key:', api_key, '| expires:', expires_at);

const ws = new WebSocket(WS_URL);
ws.binaryType = 'arraybuffer';
const log = (...a) => console.log(...a);
let done = false;

ws.onopen = () => {
  log('WS open → send config');
  ws.send(JSON.stringify({
    api_key,
    model: 'stt-rt-v4',
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    enable_endpoint_detection: true,
    enable_language_identification: true,
    translation: { type: 'one_way', target_language: 'vi' }
  }));
  // send 0.5s silence PCM (Int16 zeros) then empty frame to finish
  ws.send(new Int16Array(8000).buffer);
  ws.send(new Uint8Array(0));
};
ws.onmessage = (e) => {
  const txt = typeof e.data === 'string' ? e.data : '[binary]';
  log('MSG:', txt);
  try { if (JSON.parse(txt).finished) { done = true; ws.close(); } } catch {}
};
ws.onerror = (e) => log('WS error:', e.message || e);
ws.onclose = (e) => { log('WS close:', e.code, e.reason); process.exit(0); };

// safety timeout
setTimeout(() => { if (!done) { log('timeout'); ws.close(); } }, 8000);
