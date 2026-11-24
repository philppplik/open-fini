// Scene Studio sequential decoding (docs/scene-studio.md ▸ Render pipeline): reads a video file's samples
// (scene/demux.js) and decodes them with WebCodecs' VideoDecoder from the key frame before the wanted frame
// onward. The export asks for frames in increasing time, so the decoder runs front to back through each file
// instead of seeking a <video> element for every frame; the playback cache of time-remapped clips (reverse, ramps)
// keeps every frame a decode run passes, so a reversed clip decodes each group of pictures once.
//
//   createFrameReader(bytes, mime) → Promise<reader | null>   null: no WebCodecs, a container or codec it cannot
//                                                             read; the caller seeks the element instead
//   reader.frameAt(seconds, { keep }) → Promise<VideoFrame | null>   the frame shown at that time; valid until the
//       next call or close(). `keep(frame)` receives a clone of EVERY frame decoded on the way (the caller closes it).
//   reader.timeOf(seconds) → microseconds of that frame        reader.times: sorted presentation times (µs)
//   reader.close()
//   planPrefetch(times, seconds, direction, span) → frame indices from the frame at `seconds` over `span` seconds
//       in the direction the source runs (−1, 0, 1), nearest first (pure; the playback cache)
// Invariants: calls are serialized; a request behind the decoder's position, or more than one group of pictures
// ahead, restarts at the key frame before it; frames are matched by their timestamps (the sample times of the
// container), so B-frame reordering is handled by the decoder. A decoder error closes the reader (null afterwards).
import { demuxVideo, frameIndexAt } from "./demux.js";

export function planPrefetch(times, seconds, direction, span) {
  const i0 = frameIndexAt(times, Math.round(seconds * 1e6));
  if (i0 < 0) return [];
  const out = [i0];
  if (!direction) return out;
  const step = direction < 0 ? -1 : 1;
  const limit = span * 1e6 + 1;
  for (let i = i0 + step; i >= 0 && i < times.length && Math.abs(times[i] - times[i0]) <= limit; i += step) out.push(i);
  return out;
}

export async function createFrameReader(bytes, mime = "") {
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") return null;
  const track = demuxVideo(bytes, mime);
  if (!track) return null;
  const config = { codec: track.codec, codedWidth: track.width || undefined, codedHeight: track.height || undefined, ...(track.description ? { description: track.description } : {}) };
  try {
    if (!(await VideoDecoder.isConfigSupported(config)).supported) return null;
  } catch {
    return null;
  }
  const { samples, times } = track;
  // presentation time → decode index; key frames in decode order
  const indexOfTs = new Map(samples.map((s, i) => [s.ts, i]));
  const keyBefore = new Int32Array(samples.length);
  for (let i = 0, k = 0; i < samples.length; i++) keyBefore[i] = samples[i].key ? (k = i) : k;

  let decoder = null;
  let next = 0; // next sample to feed (decode order)
  let fedKey = -1; // key frame the current run started at (-1: none)
  let error = null;
  let closed = false;
  let current = null; // the frame handed out last
  let keep = null;
  let target = -Infinity; // timestamp of the frame being asked for
  let lastOut = -Infinity; // latest timestamp the current run has output (frames come out in presentation order)
  const ready = new Map(); // timestamp → VideoFrame decoded but not handed out yet
  let wake = null;

  const dropReady = (below = Infinity) => {
    for (const [ts, f] of ready) if (ts < below) {
      f.close();
      ready.delete(ts);
    }
  };
  function start(from) {
    try {
      decoder?.close();
    } catch {
      /* already closed */
    }
    dropReady();
    decoder = new VideoDecoder({
      output(frame) {
        try {
          keep?.(frame.clone());
        } catch {
          /* the cache is best effort */
        }
        if (frame.timestamp > lastOut) lastOut = frame.timestamp;
        // decoders have a small pool of output frames and stall while all are held: keep only the wanted frame and
        // a few after it (the next requests of a sequential read), close the rest right away
        if (frame.timestamp < target || (frame.timestamp !== target && ready.size >= 4)) {
          frame.close();
          wake?.();
          return;
        }
        const old = ready.get(frame.timestamp);
        if (old) old.close();
        ready.set(frame.timestamp, frame);
        wake?.();
      },
      error(e) {
        error = e;
        wake?.();
      },
    });
    decoder.configure(config);
    lastOut = -Infinity;
    next = from;
    fedKey = from;
  }
  const feed = () => {
    const s = samples[next++];
    decoder.decode(new EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: s.ts, duration: s.dur, data: bytes.subarray(s.offset, s.offset + s.size) }));
  };
  const nap = (ms) => new Promise((r) => {
    wake = r;
    setTimeout(r, ms);
  });

  async function decodeTo(ts) {
    const di = indexOfTs.get(ts);
    target = ts;
    dropReady(ts);
    const key = keyBefore[di];
    // behind the decoder (already output and dropped), after a flush, or a jump past the next key frame: restart at
    // the key frame (a frame that was fed but is still inside the decoder is simply waited for)
    const gone = di < next && !ready.has(ts) && (ts <= lastOut || fedKey < 0 || di < fedKey);
    if (!decoder || decoder.state !== "configured" || gone || key > Math.max(next - 1, fedKey)) start(key);
    let flushed = false;
    let idle = 0;
    while (!ready.has(ts)) {
      if (error) throw error;
      if (next < samples.length && next <= di + 4 && decoder.decodeQueueSize < 8) feed();
      else if (decoder.decodeQueueSize > 0) await nap(20);
      else if (next < samples.length && idle < 3) {
        // the decoder holds frames back (reordering, pipelining): give it more input
        feed();
        idle++;
      } else if (next < samples.length) {
        await nap(10);
        idle = 0;
        if (decoder.decodeQueueSize === 0) feed();
      } else if (!flushed) {
        await decoder.flush();
        flushed = true;
        fedKey = -1; // after a flush the decoder needs a key frame again
      } else return null;
    }
    const f = ready.get(ts);
    ready.delete(ts);
    dropReady(ts); // earlier frames are not needed any more (requests move forward)
    return f;
  }

  let chain = Promise.resolve();
  const reader = {
    times,
    track,
    timeOf: (seconds) => times[Math.max(0, frameIndexAt(times, Math.round(seconds * 1e6)))],
    frameAt(seconds, opts = {}) {
      const run = async () => {
        if (closed) return null;
        current?.close();
        current = null;
        keep = opts.keep || null;
        try {
          current = await decodeTo(reader.timeOf(seconds));
          return current;
        } catch (err) {
          reader.close();
          throw err;
        } finally {
          keep = null;
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    },
    close() {
      closed = true;
      current?.close();
      current = null;
      dropReady();
      try {
        if (decoder && decoder.state !== "closed") decoder.close();
      } catch {
        /* already closed */
      }
    },
    get closed() {
      return closed || !!error;
    },
  };
  return reader;
}
