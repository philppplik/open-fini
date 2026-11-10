// Records one utterance from the microphone as 16 kHz mono PCM for batch speech-to-text engines (the `transcribe`
// shape of an `stt` engine, platform/engines.js), for example a whisper.cpp WebAssembly build from an extension.
// Lazy: loaded only when a local engine is used. The audio stays in memory and goes only to the chosen engine.
//
//   resampleMono(chunks, inRate, outRate = 16000) -> Float32Array      (pure, tested)
//   rms(samples) -> number                                              (pure, tested)
//   createEndpointer({ ... }) -> { push(level, ms) -> "listening" | "speaking" | "done" }   silence end (pure, tested)
//   recordUtterance({ signal, maxMs, onLevel }) -> Promise<Float32Array>  microphone (browser)

export const CAPTURE = Object.freeze({ rate: 16000, maxMs: 30_000, silenceMs: 1200, startTimeoutMs: 8000, threshold: 0.012 });

/** Concatenates Float32 chunks and resamples them linearly to `outRate`. */
export function resampleMono(chunks, inRate, outRate = CAPTURE.rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const src = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    src.set(c, o);
    o += c.length;
  }
  if (inRate === outRate || !n) return src;
  const len = Math.max(1, Math.floor((n * outRate) / inRate));
  const out = new Float32Array(len);
  const step = inRate / outRate;
  for (let i = 0; i < len; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const i1 = Math.min(n - 1, i0 + 1);
    const f = x - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

export function rms(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return samples.length ? Math.sqrt(s / samples.length) : 0;
}

/**
 * Decides when an utterance is over: "listening" until the level first exceeds the threshold, "speaking" after that,
 * "done" after `silenceMs` below the threshold, after `maxMs` in total, or when nobody spoke within `startTimeoutMs`.
 */
export function createEndpointer({ threshold = CAPTURE.threshold, silenceMs = CAPTURE.silenceMs, maxMs = CAPTURE.maxMs, startTimeoutMs = CAPTURE.startTimeoutMs } = {}) {
  let t = 0;
  let quiet = 0;
  let spoke = false;
  return {
    get spoke() {
      return spoke;
    },
    push(level, ms) {
      t += ms;
      if (level >= threshold) {
        spoke = true;
        quiet = 0;
      } else quiet += ms;
      if (t >= maxMs || (spoke && quiet >= silenceMs) || (!spoke && t >= startTimeoutMs)) return "done";
      return spoke ? "speaking" : "listening";
    },
  };
}

/** Records until the speaker pauses (or the time cap); resolves with 16 kHz mono PCM (empty when nobody spoke). */
export async function recordUtterance({ signal, maxMs = CAPTURE.maxMs, onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot record from the microphone.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).catch((e) => {
    throw new Error(e?.name === "NotAllowedError" ? "Microphone access was denied." : `The microphone could not be opened (${e?.message || e}).`);
  });
  const ctx = new AudioContext();
  const chunks = [];
  try {
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessorNode is deprecated but universally available and needs no extra worklet file
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const end = createEndpointer({ maxMs });
    await new Promise((resolve, reject) => {
      const stop = () => resolve();
      signal?.addEventListener("abort", stop, { once: true });
      node.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        chunks.push(data);
        const level = rms(data);
        onLevel?.(level);
        if (end.push(level, (data.length / ctx.sampleRate) * 1000) === "done") {
          if (!end.spoke) chunks.length = 0;
          stop();
        }
      };
      source.connect(node);
      node.connect(ctx.destination);
      ctx.resume().catch(reject);
    });
    node.disconnect();
    source.disconnect();
    return resampleMono(chunks, ctx.sampleRate);
  } finally {
    for (const tr of stream.getTracks()) tr.stop();
    ctx.close().catch(() => {});
  }
}
