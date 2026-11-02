// Solv3R project page: the solve viewer.
// A scene is a sequence of solver states (snapshots at given calls). Points keep one pixel subset per view, so the viewer
// interpolates every point between the two saved states around the current call. Views appear at the call they join.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

THREE.ColorManagement.enabled = false;
const BG = new THREE.Color(0x05070b);

// ---------------------------------------------------------------- colours (the film's palette)
export const ACC_L = [150 / 255, 196 / 255, 242 / 255];
const AMBER = [250 / 255, 199 / 255, 115 / 255];
const WARN = [240 / 255, 140 / 255, 133 / 255];
export const PALE = [0.42, 0.47, 0.54];
export const NEUTRAL = [0.80, 0.84, 0.90];

// rotation error (deg) -> colour: <= 1 deg light blue, 3 deg amber, >= 9 deg red (log scale, as in the film)
export function errColor(e) {
  if (e === null || e === undefined || !isFinite(e)) return PALE;
  const x = Math.min(1, Math.max(0, Math.log10(Math.max(e, 1e-3)) / Math.log10(9)));
  const [a, b, u] = x < 0.5 ? [ACC_L, AMBER, 2 * x] : [AMBER, WARN, 2 * x - 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
export const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const smooth = (u) => u * u * (3 - 2 * u);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- eye-dome lighting: shade each pixel by how much its neighbours are in front of it
const EDL_FRAG = /* glsl */`
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 texel; uniform float near; uniform float far; uniform float strength; uniform float radius; uniform vec3 bg;
varying vec2 vUv;
float lin(float d) { float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 1.0) { gl_FragColor = vec4(bg, 1.0); return; }
  float ld = log2(lin(d));
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 o = vec2(cos(a), sin(a)) * texel * radius;
    float dn = texture2D(tDepth, vUv + o).r;
    if (dn < 1.0) s += max(0.0, ld - log2(lin(dn)));
  }
  float shade = exp(-s / 8.0 * 300.0 * strength);
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb * shade, 1.0);
}`;

export class EDL {
  constructor(renderer, opts = {}) {
    this.r = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, texel: { value: new THREE.Vector2(0.25, 0.25) },
        near: { value: 0.01 }, far: { value: 100 }, strength: { value: opts.strength ?? 0.35 }, radius: { value: opts.radius ?? 1.4 }, bg: { value: BG } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: EDL_FRAG, depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); q.frustumCulled = false;
    this.scene.add(q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h) { this.rt.setSize(w, h); this.mat.uniforms.texel.value.set(1 / w, 1 / h); }
  // points (layer 0) through EDL, then overlays (layer 1) on top with their own depth test against nothing
  render(scene, camera) {
    const r = this.r;
    camera.layers.set(0);
    r.setRenderTarget(this.rt); r.setClearColor(BG, 1); r.clear(); r.render(scene, camera);
    r.setRenderTarget(null);
    this.mat.uniforms.near.value = camera.near; this.mat.uniforms.far.value = camera.far;
    r.render(this.scene, this.cam);
    camera.layers.set(1);
    r.autoClear = false; r.clearDepth(); r.render(scene, camera); r.autoClear = true;
    camera.layers.set(0);
  }
}

// ---------------------------------------------------------------- loading
async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  let buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf, 0, 2);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {                     // gzip (servers that already decompress send raw bytes)
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    buf = await new Response(s).arrayBuffer();
  }
  return buf;
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(url));
    im.src = url;
  });
}

const cache = new Map();
export function loadScene(base) {
  if (!cache.has(base)) cache.set(base, loadSceneNow(base));
  return cache.get(base);
}

async function loadSceneNow(base) {
  const meta = await (await fetch(`${base}/scene.json`)).json();
  const [buf, thumbs] = await Promise.all([fetchBin(`${base}/points.bin`), loadImage(`${base}/thumbs.jpg`)]);
  return meta.kind === 'stream' ? new StreamData(meta, buf, thumbs) : new SolveData(meta, buf, thumbs);
}

// ---------------------------------------------------------------- a solve: snapshots of all views
export class SolveData {
  constructor(meta, buf, thumbs) {
    this.meta = meta; this.thumbs = thumbs;
    const S = meta.calls.length, N = meta.nPts, V = meta.nViews;
    this.S = S; this.N = N; this.V = V;
    let off = 0;
    this.abs = [];
    let prev = null;
    const bytes = new Uint8Array(buf);
    for (let k = 0; k < S; k++) {                            // delta-coded prefixes (byte planes) -> absolute int16 per snapshot
      const n = meta.prefix[k] * 3;
      const d = new Int16Array(n);
      for (let i = 0; i < n; i++) d[i] = bytes[off + i] | (bytes[off + n + i] << 8);
      off += n * 2;
      const a = new Int16Array(N * 3);
      if (prev) {
        const n0 = meta.prefix[k - 1] * 3;
        for (let i = 0; i < n0; i++) a[i] = prev[i] + d[i];
        for (let i = n0; i < n; i++) a[i] = d[i];
      } else a.set(d);
      this.abs.push(a); prev = a;
    }
    for (let k = S - 2; k >= 0; k--) {                       // points not yet present: hold their first state
      const a = this.abs[k], b = this.abs[k + 1];
      for (let i = meta.prefix[k] * 3; i < N * 3; i++) a[i] = b[i];
    }
    this.rgb = new Uint8Array(buf.slice(off, off + N * 3)); off += N * 3;
    this.vid = new Uint16Array(buf.slice(off, off + N * 2)); off += N * 2;
    this.size = new Uint8Array(buf.slice(off, off + N)); off += N;
    this.cams = new Float32Array(buf.slice(off, off + S * V * 12 * 4));
    this.calls = meta.calls;
    this.first = meta.views.map((v) => v.first);
    this.joinCall = this.first.map((f) => (f > 0 ? this.calls[f - 1] : (meta.start ?? 0)));
    this.t0 = meta.start ?? this.calls[0] - 1;
    this.t1 = this.calls[S - 1];
    this.hasErr = meta.err.some((row) => row.some((e) => e !== null));
    this.waves = [...new Set(this.first)].sort((a, b) => a - b);
  }

  // snapshot interval around call t: states k and k+1, mix u
  segment(t) {
    const c = this.calls;
    if (t <= c[0]) return { k: 0, k2: 0, u: 0 };
    if (t >= c[c.length - 1]) return { k: c.length - 1, k2: c.length - 1, u: 0 };
    let k = 0;
    while (c[k + 1] <= t) k++;
    return { k, k2: k + 1, u: smooth((t - c[k]) / (c[k + 1] - c[k])) };
  }

  // per view: appearance (0..1), mix, error, calls received
  viewState(r, t, seg) {
    const f = this.first[r], cf = this.calls[f], cp = f > 0 ? this.calls[f - 1] : this.t0;
    const appear = t >= cf ? 1 : t <= cp ? 0 : smooth((t - cp) / Math.max(cf - cp, 1e-6));
    const e0 = this.meta.err[seg.k][r], e1 = this.meta.err[seg.k2][r];
    let e = null;
    if (e0 !== null && e1 !== null) e = Math.exp(Math.log(Math.max(e0, 1e-3)) * (1 - seg.u) + Math.log(Math.max(e1, 1e-3)) * seg.u);
    else if (e1 !== null && t > cp) e = e1;
    else if (e0 !== null) e = e0;
    return { appear, mix: seg.u, err: e, recv: Math.max(0, t - this.joinCall[r]) };
  }

  cam(k, r) { return this.cams.subarray((k * this.V + r) * 12, (k * this.V + r) * 12 + 12); }

  presentViews(t) { let n = 0; for (let r = 0; r < this.V; r++) if (t > (this.first[r] > 0 ? this.calls[this.first[r] - 1] : this.t0) + 1e-6) n++; return n; }
}

// ---------------------------------------------------------------- a stream: every frame has an on-arrival and an exit state
export class StreamData {
  constructor(meta, buf, thumbs) {
    this.meta = meta; this.thumbs = thumbs;
    const N = meta.nPts, V = meta.nViews;
    this.N = N; this.V = V; this.S = 2;
    let off = 0;
    const bytes = new Uint8Array(buf), n = N * 3;
    const planes = () => { const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = bytes[off + i] | (bytes[off + n + i] << 8); off += n * 2; return a; };
    const a = planes(), b = planes();
    this.abs = [a, b];
    this.rgb = new Uint8Array(buf.slice(off, off + N * 3)); off += N * 3;
    this.vid = new Uint16Array(buf.slice(off, off + N * 2)); off += N * 2;
    this.size = new Uint8Array(buf.slice(off, off + N)); off += N;
    this.cams = new Float32Array(buf.slice(off, off + 2 * V * 12 * 4));
    this.t0 = 0; this.t1 = V;                                     // time = frames arrived
    this.win = meta.window ?? 6;
    this.hasErr = meta.err.some((row) => row.some((e) => e !== null));
    this.first = meta.views.map((_, r) => r);
    this.calls = [0, V];
  }
  segment() { return { k: 0, k2: 1, u: 0 }; }
  viewState(r, t) {
    const appear = clamp(t - r, 0, 1);                           // frame r arrives between t = r and r + 1
    const mix = smooth(clamp((t - r - 1) / this.win, 0, 1));      // on-arrival -> exit estimate while in the window
    const e0 = this.meta.err[0][r], e1 = this.meta.err[1][r];
    let e = null;
    if (e0 !== null && e1 !== null) e = Math.exp(Math.log(Math.max(e0, 1e-3)) * (1 - mix) + Math.log(Math.max(e1, 1e-3)) * mix);
    return { appear, mix, err: e, recv: Math.max(0, t - r), live: t - r < this.win + 1 };
  }
  cam(k, r) { return this.cams.subarray((k * this.V + r) * 12, (k * this.V + r) * 12 + 12); }
  presentViews(t) { return clamp(Math.ceil(t), 0, this.V); }
}

// ---------------------------------------------------------------- shaders
const VERT = /* glsl */`
attribute vec3 posB; attribute vec3 rgb; attribute float vsize; attribute float vid;
uniform vec3 lo; uniform vec3 hi; uniform sampler2D viewTex; uniform float nViews;
uniform float f0; uniform float f1; uniform float scale; uniform float maxSize; uniform float layerAlpha;
uniform float fogNear; uniform float fogFar; uniform float yMax;
varying vec3 vRgb; varying float vA; varying float vH; varying float vFog;
void main() {
  vec4 vt = texture2D(viewTex, vec2((vid + 0.5) / nViews, 0.5));
  vec3 a = lo + (position * 0.5 + 0.5) * (hi - lo);
  vec3 b = lo + (posB * 0.5 + 0.5) * (hi - lo);
  vec3 p = mix(a, b, vt.b);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float foot = exp(mix(f0, f1, vsize));
  vA = p.y > yMax ? 0.0 : vt.r * layerAlpha; vH = vt.g; vRgb = rgb;   // yMax: a display cut of the gallery's dense cloud (off: 1e9)
  vFog = smoothstep(fogNear, fogFar, -mv.z);
  gl_PointSize = vA > 0.003 ? clamp(foot * scale / max(-mv.z, 1e-3), 1.0, maxSize) : 0.0;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform vec3 bg; uniform vec3 hiCol;
varying vec3 vRgb; varying float vA; varying float vH; varying float vFog;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  if (vA < 0.995 && hash(gl_FragCoord.xy) > vA) discard;      // screen-door fade keeps depth writes exact
  vec3 col = mix(vRgb, hiCol, 0.45 * vH) * (1.0 - 0.10 * r2);
  gl_FragColor = vec4(mix(col, bg, 0.55 * vFog), 1.0);
}`;
const PLANE_VERT = `attribute float alpha; varying vec2 vUv; varying float vA; void main(){ vUv = uv; vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const PLANE_FRAG = `uniform sampler2D map; uniform float opacity; varying vec2 vUv; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(texture2D(map, vUv).rgb, vA * opacity); }`;

// ---------------------------------------------------------------- one layer = one solve drawn in a view (also the gallery's played solve, gallery.js)
export class Layer {
  constructor(data, opts = {}) {
    this.data = data; this.opts = opts;
    const { N, V, meta } = data;
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Int16Array(N * 3), 3, true);
    this.posB = new THREE.BufferAttribute(new Int16Array(N * 3), 3, true);
    this.posA.setUsage(THREE.DynamicDrawUsage); this.posB.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('posB', this.posB);
    g.setAttribute('rgb', new THREE.BufferAttribute(data.rgb, 3, true));
    g.setAttribute('vsize', new THREE.BufferAttribute(data.size, 1, true));
    g.setAttribute('vid', new THREE.BufferAttribute(data.vid, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.viewBuf = new Uint8Array(V * 4);
    this.viewTex = new THREE.DataTexture(this.viewBuf, V, 1, THREE.RGBAFormat);
    this.viewTex.magFilter = this.viewTex.minFilter = THREE.NearestFilter;
    this.uniforms = {
      lo: { value: new THREE.Vector3(...meta.quant.lo) }, hi: { value: new THREE.Vector3(...meta.quant.hi) },
      viewTex: { value: this.viewTex }, nViews: { value: V }, f0: { value: meta.size.f0 }, f1: { value: meta.size.f1 },
      scale: { value: 1 }, maxSize: { value: 10 }, layerAlpha: { value: 1 }, fogNear: { value: 2 }, fogFar: { value: 6 }, yMax: { value: 1e9 },
      bg: { value: new THREE.Color(0x05070b) }, hiCol: { value: new THREE.Color(0.55, 0.78, 1.0) },
    };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG }));
    this.points.frustumCulled = false;
    // camera frustums: 8 segments per view
    const lg = new THREE.BufferGeometry();
    this.fPos = new Float32Array(V * 16 * 3); this.fCol = new Float32Array(V * 16 * 3);
    lg.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.fCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.frusta = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.frusta.frustumCulled = false;
    // photos on the frustum image planes
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(V * 4 * 3); this.pA = new Float32Array(V * 4);
    const uv = new Float32Array(V * 4 * 2), idx = new Uint32Array(V * 6);
    const T = meta.thumbs;
    for (let r = 0; r < V; r++) {
      const c0 = (r % T.cols) / T.cols, c1 = (r % T.cols + 1) / T.cols;
      const r0 = 1 - Math.floor(r / T.cols) / T.rows, r1 = 1 - (Math.floor(r / T.cols) + 1) / T.rows;
      uv.set([c0, r0, c1, r0, c1, r1, c0, r1], r * 8);         // corners: TL, TR, BR, BL (image space)
      idx.set([r * 4, r * 4 + 1, r * 4 + 2, r * 4, r * 4 + 2, r * 4 + 3], r * 6);
    }
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    pg.setAttribute('alpha', new THREE.BufferAttribute(this.pA, 1).setUsage(THREE.DynamicDrawUsage));
    pg.setIndex(new THREE.BufferAttribute(idx, 1));
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    const tex = new THREE.Texture(data.thumbs); tex.needsUpdate = true; tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.planeMat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, opacity: { value: 0.92 } }, vertexShader: PLANE_VERT, fragmentShader: PLANE_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.planes = new THREE.Mesh(pg, this.planeMat);
    this.planes.frustumCulled = false;
    this.frusta.layers.set(1); this.planes.layers.set(1);
    this.group = new THREE.Group();
    this.group.add(this.points, this.frusta, this.planes);
    this.seg = null; this.highlight = -1;
    this.frustumScale = opts.frustum ?? meta.frustum ?? 0.07;
    this.corner = new Float32Array(15);
  }

  dispose() {
    this.points.geometry.dispose(); this.points.material.dispose(); this.viewTex.dispose();
    this.frusta.geometry.dispose(); this.frusta.material.dispose();
    this.planes.geometry.dispose(); this.planeMat.uniforms.map.value.dispose(); this.planeMat.dispose();
  }

  // camera centre and image-plane corners of view r at snapshot k (world), plane depth d
  corners(k, r, d, out, o) {
    const c = this.data.cam(k, r), v = this.data.meta.views[r];
    const xs = [(0 - v.cx) / v.fx, (1 - v.cx) / v.fx], ys = [(0 - v.cy) / v.fy, (1 - v.cy) / v.fy];
    out[o] = c[9]; out[o + 1] = c[10]; out[o + 2] = c[11];
    const pts = [[xs[0], ys[0]], [xs[1], ys[0]], [xs[1], ys[1]], [xs[0], ys[1]]];
    for (let q = 0; q < 4; q++) {
      const X = pts[q][0] * d, Y = pts[q][1] * d, Z = d;
      out[o + 3 + q * 3] = c[0] * X + c[1] * Y + c[2] * Z + c[9];
      out[o + 4 + q * 3] = c[3] * X + c[4] * Y + c[5] * Z + c[10];
      out[o + 5 + q * 3] = c[6] * X + c[7] * Y + c[8] * Z + c[11];
    }
  }

  update(t, show) {
    const D = this.data, V = D.V;
    const seg = D.segment(t);
    if (!this.seg || this.seg.k !== seg.k || this.seg.k2 !== seg.k2) {
      this.posA.array.set(D.abs[seg.k]); this.posA.needsUpdate = true;
      this.posB.array.set(D.abs[seg.k2]); this.posB.needsUpdate = true;
    }
    this.seg = seg;
    const A = new Float32Array(15), B = new Float32Array(15);
    const fs = this.frustumScale, la = this.uniforms.layerAlpha.value;
    const states = [];
    for (let r = 0; r < V; r++) {
      const s = D.viewState(r, t, seg);
      states.push(s);
      const hi = r === this.highlight ? 1 : 0;
      this.viewBuf[r * 4] = Math.round(s.appear * 255);
      this.viewBuf[r * 4 + 1] = hi * 255;
      this.viewBuf[r * 4 + 2] = Math.round(s.mix * 255);
      // frustum + plane, interpolated between the two states
      const kA = D instanceof StreamData ? 0 : seg.k, kB = D instanceof StreamData ? 1 : seg.k2;
      const live = s.live ?? true;
      const dd = fs * (hi ? 1.5 : 1) * (D instanceof StreamData && !live ? 0.55 : 1);
      this.corners(kA, r, dd, A, 0); this.corners(kB, r, dd, B, 0);
      const m = s.mix;
      for (let i = 0; i < 15; i++) A[i] = A[i] + (B[i] - A[i]) * m;
      const vis = show.cams && s.appear > 0.01 ? 1 : 0;
      const base = r * 48;
      const seq = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];
      let col = this.data.hasErr ? errColor(s.err) : NEUTRAL;
      if (r === (D.meta.anchor ?? -1) && this.data.hasErr) col = [0.93, 0.95, 0.98];
      const dim = (D instanceof StreamData && !live ? 0.38 : 1) * s.appear * la;
      for (let q = 0; q < 16; q++) {
        const p = seq[q] * 3;
        this.fPos[base + q * 3] = vis ? A[p] : 0; this.fPos[base + q * 3 + 1] = vis ? A[p + 1] : 0; this.fPos[base + q * 3 + 2] = vis ? A[p + 2] : 0;
        this.fCol[base + q * 3] = col[0] * dim; this.fCol[base + q * 3 + 1] = col[1] * dim; this.fCol[base + q * 3 + 2] = col[2] * dim;
      }
      for (let q = 0; q < 4; q++) {
        this.pPos[r * 12 + q * 3] = A[3 + q * 3]; this.pPos[r * 12 + q * 3 + 1] = A[4 + q * 3]; this.pPos[r * 12 + q * 3 + 2] = A[5 + q * 3];
        this.pA[r * 4 + q] = show.photos ? s.appear * la * (D instanceof StreamData && !live ? 0.0 : 1) * (hi ? 1 : 0.9) : (hi ? s.appear * la : 0);
      }
    }
    this.viewTex.needsUpdate = true;
    this.frusta.geometry.attributes.position.needsUpdate = true;
    this.frusta.geometry.attributes.color.needsUpdate = true;
    this.planes.geometry.attributes.position.needsUpdate = true;
    this.planes.geometry.attributes.alpha.needsUpdate = true;
    return states;
  }
}

// ---------------------------------------------------------------- a view: one canvas, one or more layers
export class SolveView {
  constructor(container, opts = {}) {
    this.container = container; this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sv-canvas';
    container.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x05070b, 1);
    this.edl = new EDL(this.renderer);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 200);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6; this.controls.zoomSpeed = 0.8; this.controls.panSpeed = 0.6;
    this.controls.addEventListener('change', () => { this.dirty = true; if (!this.syncing) this.onCamera?.(this); });
    this.controls.addEventListener('start', () => { this.userMoved = true; this.flying = null; });
    this.layers = [];
    this.show = { cams: true, photos: false };
    this.dirty = true; this.t = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.edl.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  setLayers(list) {
    for (const L of this.layers) { this.scene.remove(L.group); L.dispose(); }
    this.layers = list.map(({ data, window: win, ...o }) => { const L = new Layer(data, o); L.window = win; this.scene.add(L.group); return L; });
    this.dirty = true;
  }

  home(animate = false) {
    const m = this.layers[0]?.data.meta;
    if (!m) return;
    const c = this.opts.camera ?? m.camera, yaw = c.yaw * Math.PI / 180, el = c.elev * Math.PI / 180;
    const tgt = new THREE.Vector3(...(c.target ?? [0, 0, 0]));
    const eye = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(c.dist).add(tgt);
    if (animate) this.flyTo(eye, tgt, c.fov ?? 40);
    else {
      this.camera.position.copy(eye); this.controls.target.copy(tgt); this.camera.fov = c.fov ?? 40;
      this.camera.updateProjectionMatrix(); this.controls.update();
    }
    this.userMoved = false; this.dirty = true;
  }

  flyTo(eye, tgt, fov, dur = 0.9) {
    this.flying = { t: 0, dur, e0: this.camera.position.clone(), t0: this.controls.target.clone(), f0: this.camera.fov, e1: eye, t1: tgt, f1: fov };
  }

  // look through camera r of the first layer
  lookThrough(r) {
    const L = this.layers[0];
    if (!L) return;
    const seg = L.data.segment(this.t), s = L.data.viewState(r, this.t, seg);
    const a = L.data.cam(L.data instanceof StreamData ? 0 : seg.k, r), b = L.data.cam(L.data instanceof StreamData ? 1 : seg.k2, r);
    const m = s.mix, c = (i) => a[i] + (b[i] - a[i]) * m;
    const eye = new THREE.Vector3(c(9), c(10), c(11));
    const fwd = new THREE.Vector3(c(2), c(5), c(8)).normalize();
    const v = L.data.meta.views[r];
    const fov = 2 * Math.atan(0.5 / v.fy) * 180 / Math.PI;
    this.flyTo(eye.clone().addScaledVector(fwd, -0.02), eye.clone().addScaledVector(fwd, 0.6), clamp(fov, 20, 90));
  }

  setTime(t) { this.t = t; this.dirty = true; }

  // where the cameras of the visible layer are on screen (NDC); off-screen when |x| or |y| > 1
  centroidNDC() {
    const L = this.layers.find((l) => l.uniforms.layerAlpha.value > 0.5) ?? this.layers[0];
    if (!L || L.data instanceof StreamData) return null;
    const D = L.data, seg = D.segment(this.t), acc = new THREE.Vector3();
    let n = 0;
    for (let r = 0; r < D.V; r++) {
      const st = D.viewState(r, this.t, seg);
      if (st.appear < 0.5) continue;
      const a = D.cam(seg.k, r), b = D.cam(seg.k2, r);
      acc.x += a[9] + (b[9] - a[9]) * st.mix; acc.y += a[10] + (b[10] - a[10]) * st.mix; acc.z += a[11] + (b[11] - a[11]) * st.mix; n++;
    }
    return n ? acc.divideScalar(n).project(this.camera) : null;
  }

  frame(dt) {
    if (this.flying) {
      const f = this.flying; f.t += dt;
      const u = smooth(clamp(f.t / f.dur, 0, 1));
      this.camera.position.lerpVectors(f.e0, f.e1, u); this.controls.target.lerpVectors(f.t0, f.t1, u);
      this.camera.fov = f.f0 + (f.f1 - f.f0) * u; this.camera.updateProjectionMatrix();
      if (u >= 1) this.flying = null;
      this.dirty = true;
      this.onCamera?.(this);
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return null;
    this.dirty = false;
    const h = this.renderer.domElement.height;
    const focal = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    const dist = this.camera.position.distanceTo(this.controls.target);
    let states = null;
    for (const L of this.layers) {
      let la = 1;
      if (L.window) {                                         // [from, to, fade]: fades in after `from`, out after `to`
        const [a, b = Infinity, fd = 0.4] = L.window, t = this.t;
        la = t < a ? 0 : t < a + fd ? smooth((t - a) / fd) : t < b ? 1 : t < b + fd ? 1 - smooth((t - b) / fd) : 0;
      }
      L.uniforms.layerAlpha.value = la;
      L.group.visible = la > 0.004;
      L.uniforms.scale.value = focal * (L.data.meta.dens ?? 1) * (this.opts.pointScale ?? 0.8);
      L.uniforms.maxSize.value = 6 * Math.min(window.devicePixelRatio || 1, 2);
      L.uniforms.fogNear.value = dist * 0.9; L.uniforms.fogFar.value = dist * 2.6;
      const s = L.update(this.t, this.show);
      if (!states) states = s;
    }
    this.edl.render(this.scene, this.camera);
    return states;
  }

  copyCamera(o) {
    this.syncing = true;
    this.camera.position.copy(o.camera.position); this.controls.target.copy(o.controls.target);
    this.camera.fov = o.camera.fov; this.camera.updateProjectionMatrix(); this.controls.update();
    this.syncing = false; this.dirty = true;
  }
}

// ---------------------------------------------------------------- timeline (shared clock + scrubber)
export class Timeline {
  constructor(el, { t0, t1, scale = 'lin', duration = 8, marks = [], label = (t) => `call ${Math.round(t)}`, tickEvery = 0 }) {
    this.el = el; this.t0 = t0; this.t1 = t1; this.scale = scale; this.duration = duration; this.label = label;
    this.pos = 0; this.playing = false; this.listeners = [];
    el.classList.add('tl');
    el.innerHTML = `<button class="tl-play" aria-label="Play">${ICON.play}</button>
      <div class="tl-track"><div class="tl-rail"></div><div class="tl-fill"></div><div class="tl-ticks"></div><div class="tl-marks"></div><div class="tl-head"></div></div>
      <div class="tl-time"></div>`;
    this.btn = el.querySelector('.tl-play'); this.track = el.querySelector('.tl-track');
    this.head = el.querySelector('.tl-head'); this.fill = el.querySelector('.tl-fill'); this.timeEl = el.querySelector('.tl-time');
    const ticks = el.querySelector('.tl-ticks');
    if (tickEvery) for (let c = Math.ceil(t0 / tickEvery) * tickEvery; c <= t1; c += tickEvery) {
      const d = document.createElement('i'); d.style.left = `${this.x(c) * 100}%`; ticks.appendChild(d);
    }
    const mk = el.querySelector('.tl-marks');
    for (const m of marks) {
      const d = document.createElement('span'); d.className = 'tl-mark'; d.style.left = `${this.x(m.t) * 100}%`;
      d.innerHTML = `<b></b><em>${m.text}</em>`; mk.appendChild(d);
    }
    this.btn.addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    const scrub = (e) => {
      const r = this.track.getBoundingClientRect();
      this.set(clamp((e.clientX - r.left) / r.width, 0, 1));
    };
    this.track.addEventListener('pointerdown', (e) => {
      this.pause(); this.track.setPointerCapture(e.pointerId); scrub(e);
      const mv = (ev) => scrub(ev), up = () => { this.track.removeEventListener('pointermove', mv); this.track.removeEventListener('pointerup', up); };
      this.track.addEventListener('pointermove', mv); this.track.addEventListener('pointerup', up);
    });
    this.track.tabIndex = 0;
    this.track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { this.pause(); this.set(clamp(this.pos + (e.key === 'ArrowRight' ? 0.02 : -0.02), 0, 1)); e.preventDefault(); }
      if (e.key === ' ') { this.playing ? this.pause() : this.play(); e.preventDefault(); }
    });
    this.render();
  }
  x(t) { return this.scale === 'log' ? Math.log(t / this.t0) / Math.log(this.t1 / this.t0) : (t - this.t0) / (this.t1 - this.t0); }
  tAt(x) { return this.scale === 'log' ? this.t0 * Math.pow(this.t1 / this.t0, x) : this.t0 + x * (this.t1 - this.t0); }
  get t() { return this.tAt(this.pos); }
  setT(t) { this.set(clamp(this.x(t), 0, 1)); }
  set(p) { this.pos = p; this.render(); for (const f of this.listeners) f(this.t); }
  play() { if (this.pos >= 1) this.set(0); this.playing = true; this.btn.innerHTML = ICON.pause; this.btn.setAttribute('aria-label', 'Pause'); }
  pause() { this.playing = false; this.btn.innerHTML = ICON.play; this.btn.setAttribute('aria-label', 'Play'); }
  tick(dt) {
    if (!this.playing) return;
    const p = Math.min(1, this.pos + dt / this.duration);
    this.set(p);
    if (p >= 1) this.pause();
  }
  render() {
    this.head.style.left = `${this.pos * 100}%`; this.fill.style.width = `${this.pos * 100}%`;
    this.timeEl.textContent = this.label(this.t);
  }
  on(f) { this.listeners.push(f); }
}

const ICON = {
  play: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------- view chips: one per view, filled with the calls it received, coloured by its error
export class Chips {
  constructor(el, view, { onHover, onPick } = {}) {
    this.el = el; this.view = view; this.onHover = onHover; this.onPick = onPick;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'chips-canvas';
    this.tip = document.createElement('div'); this.tip.className = 'chips-tip';
    el.append(this.canvas, this.tip);
    this.hover = -1; this.boxes = [];
    this.canvas.addEventListener('pointermove', (e) => this.pick(e));
    this.canvas.addEventListener('pointerleave', () => { this.setHover(-1); });
    this.canvas.addEventListener('click', (e) => { const r = this.at(e); if (r >= 0) this.onPick?.(r); });
    new ResizeObserver(() => { this.layout(); this.draw(this.states); }).observe(el);
  }
  setData(data) { this.data = data; this.layout(); }
  layout() {
    const D = this.data;
    if (!D) return;
    const W = this.el.clientWidth;
    const V = D.V, gapW = 6;
    const waves = D.waves ?? [0];
    let s = 15;
    const fit = (s) => { let x = 0, rows = 1; let prevW = null;
      for (let r = 0; r < V; r++) { const w = D.first[r]; const extra = prevW !== null && w !== prevW ? gapW : 0; if (x + extra + s > W) { rows++; x = 0; } else x += extra; x += s + 2; prevW = w; }
      return rows; };
    while (s > 5 && fit(s) > (V > 60 ? 3 : 2)) s -= 1;
    this.s = s;
    let x = 0, y = 0, prevW = null;
    this.boxes = [];
    for (let r = 0; r < V; r++) {
      const w = D.first[r]; const extra = prevW !== null && w !== prevW ? gapW : 0;
      if (x + extra + s > W) { x = 0; y += s + 3; } else x += extra;
      this.boxes.push([x, y, s]); x += s + 2; prevW = w;
    }
    const H = y + s + 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`;
    this.dpr = dpr;
    void waves;
  }
  at(e) {
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return this.boxes.findIndex(([bx, by, s]) => x >= bx && x <= bx + s && y >= by && y <= by + s);
  }
  pick(e) { this.setHover(this.at(e), e); }
  setHover(r, e) {
    if (r === this.hover && !e) return;
    this.hover = r; this.onHover?.(r);
    if (r < 0 || !this.states) { this.tip.style.opacity = 0; this.draw(this.states); return; }
    const D = this.data, st = this.states[r], [bx, by, s] = this.boxes[r];
    const T = D.meta.thumbs, scale = 92 / T.w;
    const cap = D.meta.views[r].label ?? `view ${D.meta.views[r].cap + 1}`;
    const err = st.appear < 0.5 ? 'not arrived yet' : st.err === null ? `${st.recv.toFixed(0)} calls` : `rotation error ${st.err < 10 ? st.err.toFixed(2) : st.err.toFixed(0)}°`;
    this.tip.innerHTML = `<div class="tip-img" style="width:${T.w * scale}px;height:${T.h * scale}px;background-image:url(${D.thumbs.src});
      background-size:${T.cols * T.w * scale}px ${T.rows * T.h * scale}px;background-position:-${(r % T.cols) * T.w * scale}px -${Math.floor(r / T.cols) * T.h * scale}px"></div>
      <div class="tip-txt"><b>${cap}</b><span>${err}</span></div>`;
    const left = clamp(bx + s / 2 - 60, 0, this.el.clientWidth - 124);
    this.tip.style.left = `${left}px`; this.tip.style.top = `${by + s + 8}px`; this.tip.style.opacity = 1;
    this.draw(this.states);
  }
  draw(states) {
    this.states = states;
    const D = this.data;
    if (!D || !states) return;
    const g = this.canvas.getContext('2d'), dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let r = 0; r < D.V; r++) {
      const [x, y, s] = this.boxes[r], st = states[r];
      const rr = Math.min(3, s / 4);
      g.globalAlpha = 0.35 + 0.65 * st.appear;
      g.fillStyle = 'rgba(255,255,255,0.06)';
      rrect(g, x, y, s, s, rr); g.fill();
      if (st.appear > 0.02) {
        const fill = D instanceof StreamData ? 1 : Math.max(0.06, 1 - Math.pow(0.62, st.recv));
        const col = D.hasErr ? errColor(st.err) : ACC_L;
        g.save(); rrect(g, x, y, s, s, rr); g.clip();
        g.fillStyle = css(col, D instanceof StreamData && !st.live ? 0.45 : 0.95);
        g.fillRect(x, y + s * (1 - fill), s, s * fill);
        g.restore();
      }
      if (r === this.hover) { g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.5; rrect(g, x - 1, y - 1, s + 2, s + 2, rr + 1); g.stroke(); }
    }
    g.globalAlpha = 1;
  }
}
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------------------------------------------------------------- render loop shared by every view on the page (draws only what is on screen)
const loop = { items: new Set(), last: 0, running: false };
export function animate(item) { loop.items.add(item); if (!loop.running) { loop.running = true; loop.last = performance.now(); requestAnimationFrame(step); } }
function step(now) {
  const dt = Math.min(0.1, (now - loop.last) / 1000); loop.last = now;
  for (const it of loop.items) if (it.visible !== false) it.frame(dt);
  requestAnimationFrame(step);
}
