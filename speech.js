// Speech → text with Whisper, running locally in the browser (transformers.js).
//
// Hold SPACE to talk. While you talk, the audio so far is re-transcribed again and again,
// and the running guess is published as Speech.partial (Speech.partialVersion bumps on change).
// When you let go, a final pass runs and the result is pushed to Speech.queue (an empty
// string means "nothing was said", so the sketch can drop the live words).
import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

env.allowLocalModels = false;

const S = window.Speech;
const MODEL = 'onnx-community/whisper-base'; // multilingual. 'onnx-community/whisper-tiny' is faster, less accurate
const RATE = 16000;            // Whisper wants 16 kHz mono
const PARTIAL_EVERY = 0.5;     // seconds of new audio before re-transcribing
const MAX_SEGMENT = 25;        // Whisper sees 30 s at most; commit and start fresh before that

S.partial = '';
S.partialVersion = 0;
S.debug = { model: 'loading', runs: 0, lastMs: 0, error: '', heard: 0, keyDown: false };

// ------------------------------------------------------------------ model

let asrPromise = null;
let forceWasm = false;

async function createPipeline() {
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file && p.file.endsWith('.onnx')) {
      S.status = `loading whisper ${Math.round(p.progress)}%`;
      S.debug.model = `downloading ${p.file.split('/').pop()} ${Math.round(p.progress)}%`;
    }
  };
  // WebGPU is several times faster, which matters for live text. Fall back to WASM.
  if (!forceWasm && navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null)) {
    try {
      const asr = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      S.backend = 'webgpu';
      return asr;
    } catch (e) {
      console.warn('[whisper] webgpu failed, using wasm', e);
    }
  }
  S.backend = 'wasm';
  return pipeline('automatic-speech-recognition', MODEL, { progress_callback });
}

function loadModel() {
  if (!asrPromise) {
    S.status = 'loading whisper (first time downloads ~80 MB)…';
    asrPromise = createPipeline().then(async (asr) => {
      await asr(new Float32Array(RATE), { language: 'english' }); // warm-up
      S.status = `whisper ready (${S.backend}) · hold SPACE and speak`;
      S.debug.model = `ready (${S.backend})`;
      return asr;
    });
    asrPromise.catch((e) => {
      console.error('[whisper] load failed', e);
      S.debug.error = 'load: ' + e.message;
      asrPromise = null;
      if (!forceWasm) { forceWasm = true; S.debug.model = 'webgpu failed, retrying on cpu'; loadModel(); }
      else { S.status = 'whisper failed to load: ' + e.message; S.debug.model = 'failed'; }
    });
  }
  return asrPromise;
}

// One model call at a time; callers await the queue.
let busy = Promise.resolve();
function exclusive(fn) {
  const job = busy.then(fn);
  busy = job.catch(() => {});
  return job;
}

// Which of our languages is this? Asks Whisper for its first token after <|startoftranscript|>
// and compares only the language tokens we care about. ~0.2 s on WebGPU.
function detectLanguage(samples) {
  return exclusive(async () => {
    const asr = await loadModel();
    const id = (s) => asr.tokenizer.model.tokens_to_ids.get(s);
    const inputs = await asr.processor(samples);
    const out = await asr.model({
      ...inputs,
      decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(id('<|startoftranscript|>'))]), [1, 1]),
    });
    const logits = out.logits.data;
    let best = 'english', bestScore = -Infinity;
    for (const [name, code] of Object.entries(LANG_CODES)) {
      const s = logits[id(`<|${code}|>`)];
      if (s > bestScore) { best = name; bestScore = s; }
    }
    return best;
  });
}

function transcribe(samples, language) {
  return exclusive(async () => {
    let asr = await loadModel();
    const t0 = performance.now();
    let out;
    try {
      out = await asr(samples, { language, task: 'transcribe' });
    } catch (e) {
      if (S.backend !== 'webgpu') throw e;
      // Some GPUs load the model fine but fail when running it: switch to CPU and retry.
      console.warn('[whisper] webgpu run failed, switching to cpu', e);
      S.debug.error = 'webgpu run: ' + e.message + ' → using cpu';
      forceWasm = true; asrPromise = null;
      asr = await loadModel();
      out = await asr(samples, { language, task: 'transcribe' });
    }
    S.debug.runs++;
    S.debug.lastMs = Math.round(performance.now() - t0);
    // Drop Whisper's non-speech tags like [BLANK_AUDIO] or (music)
    return (out.text || '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  });
}

// ------------------------------------------------------------------ language
// 'auto' detects among LANG_CODES each time you talk. Add more, e.g. italian: 'it', german: 'de'.

const LANG_CODES = { english: 'en', spanish: 'es', french: 'fr' };
S.languages = ['auto', ...Object.keys(LANG_CODES)];
S.detected = '';
try { S.language = localStorage.getItem('cecilia-lang') || 'auto'; } catch { S.language = 'auto'; }
if (!S.languages.includes(S.language)) S.language = 'auto';
S.cycleLanguage = () => {
  S.language = S.languages[(S.languages.indexOf(S.language) + 1) % S.languages.length];
  try { localStorage.setItem('cecilia-lang', S.language); } catch {}
};

// ------------------------------------------------------------------ microphone capture

let stream = null, ctx = null, chunks = [], chunkLen = 0;
S.level = 0;
S.peak = 0;

async function setupMic() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but simple and works everywhere; gives raw samples + a level meter.
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    e.outputBuffer.getChannelData(0).fill(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    S.level = Math.min(1, Math.sqrt(sum / input.length) * 8);
    if (S.recording) {
      S.peak = Math.max(S.peak, S.level);
      chunks.push(new Float32Array(input));
      chunkLen += input.length;
    }
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  const track = stream.getAudioTracks()[0];
  S.mic = track ? track.label : '';
}

// Everything recorded so far, resampled to 16 kHz.
function audio16k() {
  const all = new Float32Array(chunkLen);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = ctx.sampleRate / RATE;
  const out = new Float32Array(Math.floor(all.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(all.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function resetAudio() { chunks = []; chunkLen = 0; S.peak = 0; }

// ------------------------------------------------------------------ talk loop

let session = 0;

S.start = async () => {
  if (S.recording) return;
  S.recording = true;
  try {
    await setupMic();
  } catch (e) {
    S.recording = false;
    S.status = 'microphone blocked: ' + e.message;
    S.debug.error = 'mic: ' + e.message;
    return;
  }
  if (!S.recording) return; // key released while the permission prompt was up
  await ctx.resume();
  resetAudio();
  S.status = 'listening…';
  liveLoop(++session);
};

S.stop = () => { S.recording = false; };

function publishPartial(text) {
  if (text !== S.partial) { S.partial = text; S.partialVersion++; }
}

async function liveLoop(id) {
  let lastLen = 0;
  // In auto mode: detect once there's ~1 s of speech, keep it while you talk, re-check at the end.
  let lang = S.language === 'auto' ? null : S.language;
  S.detected = '';
  const langFor = async (audio, recheck) => {
    if (S.language !== 'auto') return S.language;
    if (!lang || recheck) {
      lang = await detectLanguage(audio);
      S.detected = lang;
    }
    return lang;
  };

  while (S.recording && id === session) {
    await new Promise((r) => setTimeout(r, 100));
    const secs = chunkLen / ctx.sampleRate;
    S.debug.heard = secs;
    S.debug.ctx = ctx.state;
    if (secs - lastLen < PARTIAL_EVERY || S.peak < 0.03) continue;
    if (!lang && S.language === 'auto' && secs < 1) continue;
    lastLen = secs;

    if (secs > MAX_SEGMENT) {
      // Long monologue: commit what we have and keep listening on a fresh segment.
      const audio = audio16k();
      resetAudio(); lastLen = 0;
      const text = await langFor(audio, true).then((l) => transcribe(audio, l)).catch(() => '');
      S.queue.push(text);
      publishPartial('');
      continue;
    }
    try {
      const audio = audio16k();
      const text = await transcribe(audio, await langFor(audio, false));
      if (S.recording && id === session) publishPartial(text);
    } catch (e) {
      console.error('[whisper]', e);
      S.debug.error = 'live: ' + e.message;
    }
  }
  if (id !== session) return;

  // Released: final pass over the whole segment.
  const secs = chunkLen / ctx.sampleRate;
  if (secs < 0.3) { S.queue.push(S.partial); publishPartial(''); S.status = 'hold SPACE while you talk'; return; }
  if (S.peak < 0.03) {
    S.queue.push('');
    publishPartial('');
    S.status = `mic is silent (${S.mic || 'unknown mic'}) · pick another mic: click the icon left of the address bar`;
    return;
  }
  S.status = 'finishing…';
  try {
    const audio = audio16k();
    const l = await langFor(audio, true);
    const text = await transcribe(audio, l);
    console.log('[whisper]', l, text);
    S.queue.push(text);
    S.status = text ? 'hold SPACE to say more' : 'didn’t catch that · try again';
  } catch (e) {
    console.error('[whisper]', e);
    S.queue.push(S.partial);
    S.status = 'transcription error: ' + e.message;
  }
  publishPartial('');
}

// For testing without a mic: feed a Float32Array at any sample rate as if spoken live.
S.simulate = async (samples, sampleRate, speed = 1) => {
  ctx = ctx || new AudioContext({ sampleRate });
  if (ctx.sampleRate !== sampleRate) throw new Error('simulate needs rate ' + ctx.sampleRate);
  S.recording = true; resetAudio(); S.peak = 1;
  liveLoop(++session);
  const step = Math.floor(sampleRate * 0.1);
  for (let i = 0; i < samples.length; i += step) {
    chunks.push(samples.slice(i, i + step)); chunkLen += Math.min(step, samples.length - i);
    await new Promise((r) => setTimeout(r, 100 / speed));
  }
  S.recording = false;
};

loadModel();
