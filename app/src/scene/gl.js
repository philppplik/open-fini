// Scene Studio WebGL pixel pass: runs the "pixel" effects of scene/effects.js on the GPU. One fragment shader holds
// the same formulas as effects.js ▸ applyPixel (change both together); each effect is one pass between two
// framebuffers. Colors are straight (not premultiplied) alpha on both sides.
//
//   const pass = createPixelPass();          // null when WebGL 2 is not available (the compositor uses the CPU path)
//   const out = pass.apply(sourceCanvas, [{ type, p }], frame);   // → a canvas to draw (owned by the pass)
// Invariant: a lost context never throws into the render loop; apply() returns null and the caller falls back.
import { rgb, LOOKS } from "./effects.js";

const VS = `#version 300 es
in vec2 a;
out vec2 uv;
void main() { uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform int kind;
uniform float f[9];
uniform vec3 c1;
uniform vec3 c2;
uniform vec2 size;
uniform float flip;
in vec2 uv;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 grade(vec3 c, float exposure, float temperature, float tint, float contrast, float saturation, float vibrance, float lift, float gamma, float gain) {
  float ex = pow(2.0, exposure);
  c *= ex * vec3(1.0 + temperature * 0.25, 1.0 - tint * 0.2, 1.0 - temperature * 0.25);
  c = pow(clamp(c * gain + lift * (1.0 - c), 0.0, 1.0), vec3(1.0 / gamma));
  c = (c - 0.5) * contrast + 0.5;
  float l = luma(c);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float s = saturation * (1.0 + vibrance * (1.0 - (mx - mn)));
  return clamp(mix(vec3(l), c, s), 0.0, 1.0);
}
void main() {
  vec2 p = vec2(uv.x, mix(uv.y, 1.0 - uv.y, flip));
  vec4 c = texture(tex, p);
  if (c.a == 0.0) { o = c; return; }
  if (kind == 1) c.rgb = grade(c.rgb, f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]);
  else if (kind == 2) {
    vec3 g = grade(c.rgb, f[0], 0.0, 0.0, f[1], f[2], 0.0, 0.0, 1.0, 1.0);
    float l = luma(g);
    g = clamp(g + c1 * (1.0 - l) + c2 * l, 0.0, 1.0);
    c.rgb = mix(c.rgb, g, f[3]);
  } else if (kind == 3) {
    vec2 k = vec2(dot(c1, vec3(-0.169, -0.331, 0.5)), dot(c1, vec3(0.5, -0.419, -0.081)));
    vec2 q = vec2(dot(c.rgb, vec3(-0.169, -0.331, 0.5)), dot(c.rgb, vec3(0.5, -0.419, -0.081)));
    float a = smoothstep(f[0] * 0.5, f[0] * 0.5 + f[1] * 0.5 + 0.0001, distance(q, k));
    if (f[2] > 0.0) {
      if (c1.g >= c1.r && c1.g >= c1.b) { float other = (c.b + c.r) * 0.5; if (c.g > other) c.g = mix(c.g, other, f[2]); }
      else if (c1.b >= c1.r) { float other = (c.r + c.g) * 0.5; if (c.b > other) c.b = mix(c.b, other, f[2]); }
      else { float other = (c.g + c.b) * 0.5; if (c.r > other) c.r = mix(c.r, other, f[2]); }
    }
    c.a *= a;
  } else if (kind == 4) c.rgb = mix(c.rgb, mix(c1, c2, luma(c.rgb)), f[0]);
  else if (kind == 5) {
    float d = distance(vec2(uv.x, 1.0 - uv.y), vec2(0.5)) * 1.41421;
    c.rgb *= 1.0 - f[0] * smoothstep(f[1], f[1] + f[2], d);
  } else if (kind == 6) { float n = max(2.0, floor(f[0] + 0.5)) - 1.0; c.rgb = floor(c.rgb * n + 0.5) / n; }
  else if (kind == 7) {
    vec2 px = floor(vec2(uv.x, 1.0 - uv.y) * size);
    float s = sin(px.x * 12.9898 + px.y * 78.233 + f[1] * 37.719) * 43758.5453;
    c.rgb = clamp(c.rgb + (fract(s) - 0.5) * f[0], 0.0, 1.0);
  }
  o = c;
}`;

const KIND = { grade: 1, look: 2, "chroma-key": 3, duotone: 4, vignette: 5, posterize: 6, grain: 7 };

function uniforms(e, frame) {
  const p = e.p;
  switch (e.type) {
    case "grade":
      return { f: [p.exposure, p.temperature, p.tint, p.contrast, p.saturation, p.vibrance, p.lift, p.gamma, p.gain] };
    case "look": {
      const k = LOOKS[Math.round(p.look)] || LOOKS[0];
      return { f: [k.exposure, k.contrast, k.saturation, p.amount], c1: k.sh, c2: k.hi };
    }
    case "chroma-key":
      return { f: [p.tolerance, p.softness, p.spill], c1: rgb(p.color) };
    case "duotone":
      return { f: [p.amount], c1: rgb(p.shadows), c2: rgb(p.highlights) };
    case "vignette":
      return { f: [p.amount, p.size, p.softness] };
    case "posterize":
      return { f: [p.levels] };
    case "grain":
      return { f: [p.amount, frame] };
    default:
      return null;
  }
}

export function createPixelPass() {
  let canvas;
  let gl;
  try {
    canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(2, 2) : document.createElement("canvas");
    gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const U = Object.fromEntries(["tex", "kind", "f", "c1", "c2", "size", "flip"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  const tex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const src = tex();
  const ping = [tex(), tex()];
  const fbo = [gl.createFramebuffer(), gl.createFramebuffer()];
  let w = 0;
  let h = 0;
  let lost = false;
  canvas.addEventListener?.("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });

  function resize(nw, nh) {
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    canvas.width = w;
    canvas.height = h;
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, ping[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ping[i], 0);
    }
  }

  return {
    canvas,
    /** Runs the effects over `source` (a canvas). Returns the pass canvas with the result, or null on failure. */
    apply(source, list, frame = 0) {
      const passes = list.map((e) => ({ kind: KIND[e.type], u: uniforms(e, frame) })).filter((x) => x.kind && x.u);
      if (lost || gl.isContextLost() || !passes.length) return null;
      try {
        resize(source.width, source.height);
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.uniform1i(U.tex, 0);
        gl.uniform2f(U.size, w, h);
        let input = src;
        passes.forEach((ps, i) => {
          const last = i === passes.length - 1;
          gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : fbo[i % 2]);
          gl.bindTexture(gl.TEXTURE_2D, input);
          gl.uniform1i(U.kind, ps.kind);
          // the uploaded canvas is top-down; flip it exactly once (first pass), framebuffer textures are bottom-up
          gl.uniform1f(U.flip, i === 0 ? 1 : 0);
          const f = new Float32Array(9);
          f.set(ps.u.f);
          gl.uniform1fv(U.f, f);
          gl.uniform3fv(U.c1, ps.u.c1 || [0, 0, 0]);
          gl.uniform3fv(U.c2, ps.u.c2 || [0, 0, 0]);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          input = ping[i % 2];
        });
        return canvas;
      } catch {
        return null;
      }
    },
  };
}
