// Solv3R project page: dense gallery viewer (final solved states, millions of points, eye-dome lighting).
// v3 (11-01): the viewer can also play the solve of the same run, call by call (states saved during the run, static/play/<scene>), with the
// film's view-state chips below the stage, and cross-fades back to the dense final cloud at the end.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { errColor, EDL, Layer, SolveData, StreamData, Timeline, ACC_L, PALE, NEUTRAL, css } from './solve.js';

THREE.ColorManagement.enabled = false;
const ease = (u) => u * u * (3 - 2 * u);
const lim = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- loading
async function fetchGz(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  let buf;
  if (r.body && onBytes) {                                           // progress while downloading
    const rd = r.body.getReader(), parts = [];
    let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(value.length); }
    const u = new Uint8Array(n); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
    buf = u.buffer;
  } else buf = await r.arrayBuffer();
  const h = new Uint8Array(buf, 0, 2);
  if (h[0] === 0x1f && h[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}

function decodeChunk(buf, n) {
  const b = new Uint8Array(buf), m = n * 3;
  const pos = new Int16Array(m);
  let x = 0, y = 0, z = 0;                                           // Morton-ordered deltas, byte planes
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    x = (x + (b[j] | (b[m + j] << 8))) << 16 >> 16;
    y = (y + (b[j + 1] | (b[m + j + 1] << 8))) << 16 >> 16;
    z = (z + (b[j + 2] | (b[m + j + 2] << 8))) << 16 >> 16;
    pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
  }
  return { pos, col: new Uint8Array(buf.slice(2 * m, 3 * m)) };
}

const PVERT = /* glsl */`
attribute vec3 rgb; uniform vec3 lo; uniform vec3 hi; uniform float scale; uniform float maxSize; varying vec3 vC;
void main() {
  vec3 p = lo + (position * 0.5 + 0.5) * (hi - lo);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(scale / max(-mv.z, 1e-3), 1.0, maxSize);
  gl_Position = projectionMatrix * mv; vC = rgb;
}`;
// screen-door fade, on the pixels the played solve leaves out (solve.js keeps those with hash <= its alpha): the two cross-fade without holes
const PFRAG = /* glsl */`uniform float alpha; varying vec3 vC;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; if (alpha < 0.995 && hash(gl_FragCoord.xy) < 1.0 - alpha) discard; gl_FragColor = vec4(vC, 1.0); }`;
const GPLANE_VERT = `attribute float alpha; varying vec2 vUv; varying float vA; void main(){ vUv = uv; vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const GPLANE_FRAG = `uniform sampler2D map; varying vec2 vUv; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(texture2D(map, vUv).rgb, vA); }`;

// ---------------------------------------------------------------- the viewer
export class GalleryView {
  constructor(stage, opts = {}) {
    this.stage = stage; this.opts = opts;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'sv-canvas';
    stage.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.edl = new EDL(this.renderer, { strength: opts.edl ?? 0.2 });      // 11-02: lighter edge shading and smaller points, closer to plain renders
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.01, 60);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.55, zoomSpeed: 0.9, panSpeed: 0.7 });
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => {
      this.flying = null; this.moved = true;
      if (this.sel >= 0) { this.select(-1); if (this.frusta) this.frusta.visible = this.showCams; }   // leaving the photo
    });
    this.showCams = true; this.dirty = true; this.visible = false;
    this.play = null; this.densePts = []; this.pointK = opts.pointK ?? 1.25;   // dense point diameter in voxels
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(stage);
    // the wheel zooms only once the viewer was clicked (until the pointer leaves it), so scrolling the page over it scrolls the page
    this.controls.enableZoom = false;
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.controls.enableZoom = false; });
    this.canvas.addEventListener('pointerdown', (e) => { this.down = [e.clientX, e.clientY, performance.now()]; this.controls.enableZoom = true; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      const [x, y, t] = this.down; this.down = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) < 5 && performance.now() - t < 400) this.pick(e);
    });
    this.resize();
  }

  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr ?? 2);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.edl.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.dirty = true;
  }

  clear() {
    this.setPlay(null);
    for (const o of [...this.scene.children]) { this.scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
    this.meta = null; this.sel = -1; this.densePts = [];
  }

  // a played solve drawn in this viewer: { layer: PlayLayer, t: call or frame, dense: share of the dense cloud in the cross-fade }
  setPlay(p) {
    const old = this.play?.layer;
    if (old && old !== p?.layer) { this.scene.remove(old.group); old.dispose(); }
    this.play = p;
    if (p?.layer && p.layer.group.parent !== this.scene) this.scene.add(p.layer.group);
    this.dirty = true;
  }

  async open(base, onProgress) {
    const token = (this.token = {});
    this.clear();
    const meta = await (await fetch(`${base}/scene.json`)).json();
    if (token !== this.token) return;
    this.meta = meta; this.base = base;
    const thumbs = new Image(); thumbs.src = `${base}/thumbs.jpg`;
    this.thumbs = thumbs;
    this.uniforms = { lo: { value: new THREE.Vector3(...meta.quant.lo) }, hi: { value: new THREE.Vector3(...meta.quant.hi) }, scale: { value: 1 }, maxSize: { value: 8 }, alpha: { value: 1 } };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PVERT, fragmentShader: PFRAG });
    this.buildCams(thumbs);
    this.home();
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const chunks = small ? meta.chunks.slice(0, 2) : meta.chunks;
    const total = chunks.reduce((s, c) => s + c.n, 0);
    let got = 0, bytes = 0;
    for (const c of chunks) {                                         // each chunk is a uniform sample: the scene sharpens as chunks arrive
      const buf = await fetchGz(`${base}/${c.file}`, (b) => { bytes += b; onProgress?.(got / total, bytes); });
      if (token !== this.token) return;
      const { pos, col } = decodeChunk(buf, c.n);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3, true));
      g.setAttribute('rgb', new THREE.BufferAttribute(col, 3, true));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
      const pts = new THREE.Points(g, this.mat); pts.frustumCulled = false;
      this.scene.add(pts); this.densePts.push(pts);
      got += c.n; this.nShown = got; this.density = Math.sqrt(meta.nPts / got);
      onProgress?.(got / total, bytes);
      this.dirty = true;
    }
  }

  buildCams(img) {
    const m = this.meta, V = m.nViews, c = m.cams;
    const d = this.opts.frustum ?? 0.05;
    const fPos = new Float32Array(V * 48), fCol = new Float32Array(V * 48), pPos = new Float32Array(V * 12), pA = new Float32Array(V * 4);
    const uv = new Float32Array(V * 8), idx = new Uint32Array(V * 6), T = m.thumbs;
    this.centers = [];
    for (let r = 0; r < V; r++) {
      const v = m.views[r], R = c.slice(r * 12, r * 12 + 12);
      const xs = [(0 - v.cx) / v.fx, (1 - v.cx) / v.fx], ys = [(0 - v.cy) / v.fy, (1 - v.cy) / v.fy];
      const pt = (X, Y, Z) => [R[0] * X + R[1] * Y + R[2] * Z + R[9], R[3] * X + R[4] * Y + R[5] * Z + R[10], R[6] * X + R[7] * Y + R[8] * Z + R[11]];
      const C0 = [R[9], R[10], R[11]], q = [pt(xs[0] * d, ys[0] * d, d), pt(xs[1] * d, ys[0] * d, d), pt(xs[1] * d, ys[1] * d, d), pt(xs[0] * d, ys[1] * d, d)];
      this.centers.push(new THREE.Vector3(...C0));
      const P = [C0, ...q], seq = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];
      const col = m.err?.[r] !== null && m.err?.[r] !== undefined ? errColor(m.err[r]) : [0.78, 0.84, 0.92];
      seq.forEach((k, i) => { fPos.set(P[k], r * 48 + i * 3); fCol.set(col.map((x) => x * 0.85), r * 48 + i * 3); });
      q.forEach((p, i) => pPos.set(p, r * 12 + i * 3));
      const c0 = (r % T.cols) / T.cols, c1 = (r % T.cols + 1) / T.cols, r0 = 1 - Math.floor(r / T.cols) / T.rows, r1 = 1 - (Math.floor(r / T.cols) + 1) / T.rows;
      uv.set([c0, r0, c1, r0, c1, r1, c0, r1], r * 8);
      idx.set([r * 4, r * 4 + 1, r * 4 + 2, r * 4, r * 4 + 2, r * 4 + 3], r * 6);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); lg.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
    this.frusta = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    this.frusta.layers.set(1);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.pA = new THREE.BufferAttribute(pA, 1); pg.setAttribute('alpha', this.pA); pg.setIndex(new THREE.BufferAttribute(idx, 1));
    const tex = new THREE.Texture(img); tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    img.onload = () => { tex.needsUpdate = true; this.dirty = true; };
    if (img.complete) tex.needsUpdate = true;
    this.planes = new THREE.Mesh(pg, new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: GPLANE_VERT, fragmentShader: GPLANE_FRAG,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.planes.layers.set(1);
    this.pPos = pPos;
    // the clicked camera's photo at full resolution (views/NNN.jpg), over the atlas thumbnail once it has loaded
    const qg = new THREE.BufferGeometry();
    qg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    qg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    qg.setIndex([0, 1, 2, 0, 2, 3]);
    this.photo = new THREE.Mesh(qg, new THREE.ShaderMaterial({ uniforms: { map: { value: null }, alpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float alpha; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb, alpha); }',
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.photo.layers.set(1); this.photo.visible = false; this.photoReady = false;
    for (const o of [this.frusta, this.planes, this.photo]) { o.frustumCulled = false; this.scene.add(o); }
    this.frusta.visible = this.showCams;
  }

  loadPhoto(r) {
    this.photo.visible = false; this.photoReady = false;
    const im = new Image();
    im.onload = () => {
      if (this.sel !== r) return;
      const old = this.photo.material.uniforms.map.value;
      const t = new THREE.Texture(im); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
      this.photo.material.uniforms.map.value = t; old?.dispose();
      this.photo.geometry.attributes.position.array.set(this.pPos.subarray(r * 12, r * 12 + 12));
      this.photo.geometry.attributes.position.needsUpdate = true;
      this.photo.visible = true; this.photoReady = true; this.dirty = true;
    };
    im.src = `${this.photoBase ?? `${this.base}/views`}/${String(r).padStart(3, '0')}.jpg`;   // photoBase: the photos of a scene kept elsewhere
  }

  setCams(on) { this.showCams = on; if (this.frusta) this.frusta.visible = on; this.dirty = true; }

  home(animate = false) {
    const c = this.opts.camera ?? this.meta?.camera;
    if (!c) return;
    const yaw = c.yaw * Math.PI / 180, el = c.elev * Math.PI / 180, tgt = new THREE.Vector3(...(c.target ?? [0, 0, 0]));
    const wide = Math.max(1, Math.pow((16 / 9) / (this.camera.aspect || 16 / 9), 0.6));   // views are framed for 16:9; narrower stages step back
    const eye = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(c.dist * wide).add(tgt);
    this.select(-1);
    if (animate) this.flyTo(eye, tgt, c.fov ?? 45);
    else { this.camera.position.copy(eye); this.controls.target.copy(tgt); this.camera.fov = c.fov ?? 45; this.camera.updateProjectionMatrix(); this.controls.update(); }
    this.dirty = true;
  }

  flyTo(eye, tgt, fov, dur = 1.0) {
    this.flying = { t: 0, dur, e0: this.camera.position.clone(), t0: this.controls.target.clone(), f0: this.camera.fov, e1: eye, t1: tgt, f1: fov };
  }

  // click near a camera centre: look through it and show its photo (while a solve plays: its cameras as they are at that call)
  pick(e) {
    if (!this.meta || !this.showCams) return;
    const rc = this.canvas.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    const P = this.play, played = P?.layer && P.dense < 0.5;
    const cen = played ? P.layer.centers() : this.centers;
    let best = -1, bd = 16;
    cen.forEach((p, r) => {
      if (!p) return;
      const v = p.clone().project(this.camera);
      if (v.z > 1) return;
      const sx = (v.x * 0.5 + 0.5) * rc.width, sy = (1 - (v.y * 0.5 + 0.5)) * rc.height, dd = Math.hypot(sx - mx, sy - my);
      if (dd < bd) { bd = dd; best = r; }
    });
    if (best < 0) return;
    if (played) this.onPlayPick?.(best);
    else if (!P || P.dense > 0.99) this.lookThrough(best);
  }

  lookThrough(r) {
    const m = this.meta, R = m.cams.slice(r * 12, r * 12 + 12), v = m.views[r];
    const eye = new THREE.Vector3(R[9], R[10], R[11]), fwd = new THREE.Vector3(R[2], R[5], R[8]).normalize();
    this.select(r);
    if (this.frusta) this.frusta.visible = false;                      // the other cameras would cover the photo
    this.flyTo(eye.clone(), eye.clone().addScaledVector(fwd, 0.5), lim(2 * Math.atan(0.5 / v.fy) * 180 / Math.PI, 20, 100));
    this.onSelect?.(r);
  }

  select(r) {
    this.sel = r;
    if (!this.pA) return;
    this.pA.array.fill(0);
    this.pA.needsUpdate = true; this.photoFade = 0; this.dirty = true;
    if (r >= 0) this.loadPhoto(r); else { this.photo.visible = false; this.photoReady = false; }
  }

  frame(dt) {
    this.beforeFrame?.(dt);
    if (this.flying) {
      const f = this.flying; f.t += dt;
      const u = ease(lim(f.t / f.dur, 0, 1));
      this.camera.position.lerpVectors(f.e0, f.e1, u); this.controls.target.lerpVectors(f.t0, f.t1, u);
      this.camera.fov = f.f0 + (f.f1 - f.f0) * u; this.camera.updateProjectionMatrix();
      if (u >= 1) this.flying = null;
      this.dirty = true;
    }
    if (this.sel >= 0 && (this.photoFade < 1 || this.photoReady !== this.shownReady)) {   // the photo fades in once the camera has arrived
      this.photoFade = this.flying ? 0 : Math.min(1, this.photoFade + dt * 1.6);
      const a = ease(this.photoFade);
      this.pA.array.fill(this.photoReady ? 0 : a, this.sel * 4, this.sel * 4 + 4); this.pA.needsUpdate = true;
      this.photo.material.uniforms.alpha.value = a; this.shownReady = this.photoReady;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty || !this.meta) return;
    this.dirty = false;
    const h = this.renderer.domElement.height, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const focal = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.uniforms.scale.value = focal * this.meta.voxel * this.pointK * (this.density ?? 1);
    this.uniforms.maxSize.value = 6 * dpr;
    // cross-fade between the dense final cloud and a played solve
    const P = this.play, ad = P ? P.dense : 1;
    this.uniforms.alpha.value = ad;
    for (const o of this.densePts) o.visible = ad > 0.003;
    if (this.frusta) { this.frusta.material.opacity = 0.8 * ad; if (P) this.frusta.visible = this.showCams && this.sel < 0 && ad > 0.01; }
    let states = null;
    if (P?.layer) {
      const L = P.layer, la = 1 - ad;
      L.uniforms.layerAlpha.value = la; L.group.visible = la > 0.004;
      L.uniforms.scale.value = focal * (L.data.meta.dens ?? 1) * (P.pointScale ?? 0.85);
      L.uniforms.maxSize.value = 6 * dpr;
      states = L.update(P.t, { cams: this.showCams, photos: false });
    }
    this.edl.render(this.scene, this.camera);
    if (states) this.afterFrame?.(states);
  }
}

// ---------------------------------------------------------------- a played solve in the gallery viewer
// solve.js's Layer, drawn like the dense cloud (no fog), with the views that join marked: their points glow, their cameras are larger and white,
// and their photos show on the image planes for a moment.  A stream frame is marked while it is the newest one.
const FSEQ = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];
export class PlayLayer extends Layer {
  constructor(data, opts = {}) {
    super(data, opts);
    this.uniforms.fogNear.value = 1e4; this.uniforms.fogFar.value = 2e4;
    if (opts.yMax !== undefined) this.uniforms.yMax.value = opts.yMax;    // the dense cloud's ceiling cut (interiors)
    this.frusta.material.opacity = 0.8;
    this.cA = new Float32Array(15); this.cB = new Float32Array(15);
    this.cen = new Float32Array(data.V * 3); this.shown = new Uint8Array(data.V);
  }

  // 1 while a view joins (a stream frame: while it arrives), then fading over the next calls (frames)
  fresh(r, t) {
    const D = this.data, str = D instanceof StreamData, dt = t - (str ? r : D.joinCall[r]);
    if (dt <= 0) return 0;
    return 1 - ease(lim((dt - 1) / (str ? 1.2 : 2.5), 0, 1));
  }

  centers() { return Array.from({ length: this.data.V }, (_, r) => (this.shown[r] ? new THREE.Vector3(this.cen[r * 3], this.cen[r * 3 + 1], this.cen[r * 3 + 2]) : null)); }

  update(t, show) {
    const D = this.data, V = D.V, str = D instanceof StreamData, seg = D.segment(t);
    if (!this.seg || this.seg.k !== seg.k || this.seg.k2 !== seg.k2) {
      this.posA.array.set(D.abs[seg.k]); this.posA.needsUpdate = true;
      this.posB.array.set(D.abs[seg.k2]); this.posB.needsUpdate = true;
    }
    this.seg = seg;
    const A = this.cA, B = this.cB, fs = this.frustumScale, la = this.uniforms.layerAlpha.value, states = [];
    const kA = str ? 0 : seg.k, kB = str ? 1 : seg.k2;
    for (let r = 0; r < V; r++) {
      const s = D.viewState(r, t, seg);
      s.fresh = this.fresh(r, t); states.push(s);
      const hi = r === this.highlight ? 1 : 0, live = s.live ?? true, w = Math.max(hi, s.fresh);
      this.viewBuf[r * 4] = Math.round(s.appear * 255);
      this.viewBuf[r * 4 + 1] = Math.round(255 * Math.max(hi, 0.5 * s.fresh));
      this.viewBuf[r * 4 + 2] = Math.round(s.mix * 255);
      const dd = fs * (1 + 0.5 * w) * (str && !live ? 0.55 : 1);
      this.corners(kA, r, dd, A, 0); this.corners(kB, r, dd, B, 0);
      for (let i = 0; i < 15; i++) A[i] += (B[i] - A[i]) * s.mix;
      this.cen.set(A.subarray(0, 3), r * 3); this.shown[r] = s.appear > 0.5 ? 1 : 0;
      const vis = show.cams && s.appear > 0.01;
      const c0 = D.hasErr ? errColor(s.err) : NEUTRAL;
      const dim = (str && !live ? 0.38 : 1) * s.appear * la * (0.85 + 0.15 * w);
      const c1 = [(c0[0] + (1 - c0[0]) * w) * dim, (c0[1] + (1 - c0[1]) * w) * dim, (c0[2] + (1 - c0[2]) * w) * dim];
      const base = r * 48;
      for (let q = 0; q < 16; q++) {
        const p = FSEQ[q] * 3, o = base + q * 3;
        this.fPos[o] = vis ? A[p] : 0; this.fPos[o + 1] = vis ? A[p + 1] : 0; this.fPos[o + 2] = vis ? A[p + 2] : 0;
        this.fCol[o] = c1[0]; this.fCol[o + 1] = c1[1]; this.fCol[o + 2] = c1[2];
      }
      const pa = (show.cams ? Math.max(hi, 0.92 * s.fresh) : hi) * s.appear * la;
      for (let q = 0; q < 4; q++) {
        this.pPos[r * 12 + q * 3] = A[3 + q * 3]; this.pPos[r * 12 + q * 3 + 1] = A[4 + q * 3]; this.pPos[r * 12 + q * 3 + 2] = A[5 + q * 3];
        this.pA[r * 4 + q] = pa;
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

// ---------------------------------------------------------------- view-state chips, as in the film: one per view, filled from the bottom as the
// view receives calls, from pale (just joined) to the solved blue.  Offline and streaming keep the arrival order (a stream as a moving window,
// the frames that left it dimmed), incremental groups the arrival waves, and any-order keeps the capture order with an empty slot per photo
// still to come, so the waves land anywhere in the row.
function tokRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
class Tokens {
  constructor(el, host, { onHover, onPick } = {}) {
    this.el = el; this.host = host; this.onHover = onHover; this.onPick = onPick;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'chips-canvas';
    this.tip = document.createElement('div'); this.tip.className = 'chips-tip gal-tip';
    el.append(this.canvas); host.append(this.tip);
    this.hover = -1; this.boxes = []; this.D = null;
    this.canvas.addEventListener('pointermove', (e) => this.setHover(this.at(e)));
    this.canvas.addEventListener('pointerleave', () => this.setHover(-1));
    this.canvas.addEventListener('click', (e) => { const q = this.at(e); if (q >= 0) this.onPick?.(this.order[q]); });
    new ResizeObserver(() => { if (this.D) { this.layout(); this.draw(this.states, this.t); } }).observe(el);
  }
  setData(D, mode) {
    this.D = D; this.mode = mode; this.states = null; this.hover = -1; this.tip.style.opacity = 0;
    const idx = [...Array(D.V).keys()];
    if (mode === 'ooo') idx.sort((a, b) => D.meta.views[a].cap - D.meta.views[b].cap);
    this.order = idx;
    this.group = idx.map((r) => (mode === 'incremental' ? D.first[r] : 0));
    this.layout();
  }
  clear() {
    this.D = null; this.states = null; this.hover = -1; this.tip.style.opacity = 0;
    this.canvas.width = 0; this.canvas.style.height = '0px';
  }
  layout() {
    const W = this.el.clientWidth, n = this.order?.length ?? 0;
    if (!this.D || !W) return;
    const maxRows = (n <= 30 ? 1 : n <= 100 ? 2 : 3) + (W < 600 ? 2 : 0);
    let w = n > 60 ? 18 : 22, boxes, rows, h, gap;
    for (; ; w--) {
      h = Math.round(w * 0.75); gap = Math.max(2, Math.round(w * 0.25));
      const gg = Math.round(w * 0.9);
      let x = 0, y = 0; rows = 1; boxes = [];
      for (let q = 0; q < n; q++) {
        if (q > 0 && x > 0 && this.group[q] !== this.group[q - 1]) x += gg;
        if (x + w > W) { x = 0; y += h + gap + 2; rows++; }
        boxes.push([x, y]); x += w + gap;
      }
      if (rows <= maxRows || w <= 6) break;
    }
    this.w = w; this.h = h; this.boxes = boxes; this.pad = 5;
    const H = (rows - 1) * (h + gap + 2) + h + 2 * this.pad, dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`;
    this.dpr = dpr;
  }
  at(e) {
    const rc = this.canvas.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top - this.pad;
    return this.boxes.findIndex(([bx, by]) => x >= bx - 1 && x <= bx + this.w + 1 && y >= by - 1 && y <= by + this.h + 1);
  }
  setHover(q) {
    const r = q >= 0 ? this.order[q] : -1;
    if (r === this.hover) return;
    this.hover = r; this.onHover?.(r);
    if (r < 0 || !this.states) { this.tip.style.opacity = 0; this.draw(this.states, this.t); return; }
    const D = this.D, st = this.states[r], v = D.meta.views[r], T = D.meta.thumbs, sc = 108 / T.w, str = D instanceof StreamData;
    const what = st.appear < 0.5 ? 'not here yet' : str ? (st.live ? 'in the window' : 'left the window') : `${Math.max(1, Math.round(st.recv))} calls`;
    this.tip.innerHTML = `<div class="tip-img" style="width:${T.w * sc}px;height:${T.h * sc}px;background-image:url(${D.thumbs.src});
      background-size:${T.cols * T.w * sc}px ${T.rows * T.h * sc}px;background-position:-${(r % T.cols) * T.w * sc}px -${Math.floor(r / T.cols) * T.h * sc}px"></div>
      <div class="tip-txt"><b>${v.label ?? `photo ${v.cap + 1}`}</b><span>${what}</span></div>`;
    const hr = this.host.getBoundingClientRect(), cr = this.canvas.getBoundingClientRect(), [bx, by] = this.boxes[q];
    const left = lim(cr.left - hr.left + bx + this.w / 2 - 62, 0, hr.width - 124);
    this.tip.style.left = `${left}px`; this.tip.style.top = `${cr.top - hr.top + this.pad + by + this.h + 8}px`; this.tip.style.opacity = 1;
    this.draw(this.states, this.t);
  }
  draw(states, t) {
    this.states = states; this.t = t;
    const D = this.D;
    if (!D || !states || !this.boxes.length) return;
    const g = this.canvas.getContext('2d'), str = D instanceof StreamData, { w, h, pad } = this, rr = Math.min(3, w / 5);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let q = 0; q < this.order.length; q++) {
      const r = this.order[q], st = states[r], [x, by] = this.boxes[q], a = st.appear;
      if (a <= 0.01) {                                                   // a photo still to come: its empty slot (out of order only)
        if (this.mode === 'ooo') { g.setLineDash([2, 2]); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1; tokRect(g, x + 0.5, by + pad + 0.5, w - 1, h - 1, rr); g.stroke(); g.setLineDash([]); }
        continue;
      }
      const y = by + pad - (1 - a) * h * 0.8;                            // drops into its slot as it arrives
      const fill = str ? 0.14 + 0.86 * st.mix : 1 - Math.pow(0.86, Math.max(1, st.recv));
      const fr = st.fresh ?? 0, out = str && !st.live;
      g.globalAlpha = a * (out ? 0.68 : 1);
      g.fillStyle = 'rgba(255,255,255,0.07)'; tokRect(g, x, y, w, h, rr); g.fill();
      g.save(); tokRect(g, x, y, w, h, rr); g.clip();
      g.fillStyle = css([PALE[0] + (ACC_L[0] - PALE[0]) * fill, PALE[1] + (ACC_L[1] - PALE[1]) * fill, PALE[2] + (ACC_L[2] - PALE[2]) * fill], 0.95);
      g.fillRect(x, y + h * (1 - fill), w, h * fill); g.restore();
      let ea = str && st.live ? 0.7 : 0.4, lw = 1;
      if (fr > 0.01) { ea = Math.max(ea, 0.4 + 0.6 * fr); lw = 1 + 0.5 * fr; g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 7 * fr; }
      if (r === this.hover) { ea = 1; lw = 1.5; }
      g.strokeStyle = `rgba(255,255,255,${ea})`; g.lineWidth = lw; tokRect(g, x + 0.5, y + 0.5, w - 1, h - 1, rr); g.stroke();
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- playing the solve: loads the run's saved states on demand
const playCache = new Map();
async function loadPlay(base, onProgress) {
  const meta = await (await fetch(`${base}/scene.json`)).json();
  const thumbs = new Image();
  const thumbsReady = new Promise((res, rej) => { thumbs.onload = res; thumbs.onerror = () => rej(new Error(`${base}/thumbs.jpg`)); });
  thumbs.src = `${base}/thumbs.jpg`;
  let got = 0;
  const onBytes = (b) => { got += b; onProgress?.(Math.min(1, got / (meta.bytes || 8e6))); };
  const buf = await fetchGz(`${base}/points.bin`, onBytes);
  await thumbsReady;
  return meta.kind === 'stream' ? new StreamData(meta, buf, thumbs) : new SolveData(meta, buf, thumbs);
}

export class GalleryPlay {
  constructor(root, view) {
    this.root = root; this.view = view;
    this.btn = root.querySelector('.gal-playbtn'); this.btnTxt = this.btn.querySelector('span');
    this.bar = root.querySelector('.gal-play'); this.tlEl = this.bar.querySelector('.timeline');
    this.callEl = root.querySelector('.gal-call'); this.callK = this.callEl.querySelector('em'); this.callV = this.callEl.querySelector('strong');
    this.toastEl = root.querySelector('.gal-stage .toast'); this.hint = root.querySelector('.gal-stage .hint');
    this.tokens = new Tokens(this.bar.querySelector('.gal-tokens'), root, {
      onHover: (r) => { if (this.L) { this.L.highlight = r; this.view.dirty = true; } },
      onPick: (r) => this.look(r),
    });
    this.btn.addEventListener('click', () => this.start());
    view.beforeFrame = (dt) => this.tick(dt);
    view.afterFrame = (states) => this.draw(states);
    view.onPlayPick = (r) => this.look(r);
    window.addEventListener('pointerup', () => { this.drag = false; });
    window.addEventListener('pointercancel', () => { this.drag = false; });
    this.P = null; this.g = null; this.tok = {};
  }

  // a scene opens in the viewer: its dense final state, with the play button once that has loaded
  setScene(g, base) { this.stop(); this.g = g; this.base = base; this.btn.hidden = true; }
  ready(id) { if (this.g?.id === id && this.g.play && !this.P) this.btn.hidden = false; }

  async start() {
    const g = this.g;
    if (!g?.play || this.loading) return;
    const tok = (this.tok = {});
    let D;
    if (!playCache.has(g.id)) {
      playCache.set(g.id, loadPlay(this.base, (f) => { if (this.g === g) this.btn.style.setProperty('--p', f.toFixed(3)); }));
      while (playCache.size > 2) playCache.delete(playCache.keys().next().value);   // decoded states of two scenes at most (phones)
    }
    this.loading = true; this.btn.classList.add('busy'); this.btnTxt.textContent = 'Loading the solve…';
    try { D = await playCache.get(g.id); } catch (e) {
      playCache.delete(g.id);
      if (tok === this.tok) { this.btnTxt.textContent = 'Not available'; setTimeout(() => { if (tok === this.tok) this.resetBtn(); }, 2200); }
      return;
    } finally { this.loading = false; }
    if (tok !== this.tok) return;                                      // another scene was opened meanwhile
    this.resetBtn();
    this.open(D);
  }

  resetBtn() { this.btn.classList.remove('busy'); this.btn.style.setProperty('--p', '0'); this.btnTxt.textContent = 'Play the solve'; }

  open(D) {
    const g = this.g, str = D instanceof StreamData, v = this.view;
    const L = new PlayLayer(D, { frustum: v.opts.frustum ?? 0.05, yMax: v.meta.quant.hi[1] + 0.01 });
    this.L = L; this.D = D;
    v.select(-1);
    v.setPlay({ layer: L, t: D.t0, dense: 1, pointScale: g.play.pointScale });
    this.marks = [];
    if (!str) for (const f of D.waves) if (f > 0) { const n = D.first.filter((x) => x === f).length; this.marks.push({ t: D.calls[f - 1] + 0.5, text: `+${n}`, n }); }
    this.tlEl.innerHTML = '';
    const t1 = str ? D.V + D.win + 1 : D.t1;                           // a stream ends once its last frames have left the window
    this.tl = new Timeline(this.tlEl, { t0: D.t0, t1, duration: g.play.duration ?? 12, marks: this.marks,
      label: (t) => (str ? `frame ${this.count(t)} / ${D.V}` : `call ${this.count(t)} / ${D.t1}`), tickEvery: str ? 0 : D.t1 - D.t0 > 40 ? 4 : 1 });
    this.tl.on(() => { v.dirty = true; });
    this.tl.track.addEventListener('pointerdown', () => { this.drag = true; if (this.P) this.P.hold = 0; });
    this.tokens.setData(D, g.play.mode);
    this.P = { hold: 0.7, endT: 0, dense: 1 };
    this.lastT = D.t0;
    this.callK.textContent = str ? 'frame' : 'call';
    this.bar.classList.add('on'); this.bar.setAttribute('aria-hidden', 'false');
    this.btn.hidden = true; this.callEl.classList.add('on'); this.hint?.classList.add('off');
    v.dirty = true;
  }

  // calls made so far (a stream: frames arrived); a state between two calls belongs to the call that makes it
  count(t) { const n = Math.max(0, Math.ceil(t - 1e-6)); return this.D instanceof StreamData ? Math.min(this.D.V, n) : n; }

  stop() {
    this.tok = {};
    this.tl?.pause();
    this.P = null; this.L = null; this.D = null; this.tl = null;
    this.view.setPlay(null);
    this.bar.classList.remove('on'); this.bar.setAttribute('aria-hidden', 'true');
    this.callEl.classList.remove('on');
    this.toastEl?.classList.remove('on');
    this.tokens.clear();
    this.loading = false; this.resetBtn();
  }

  toast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text; this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toastEl.classList.remove('on'), 1700);
  }

  tick(dt) {
    const P = this.P, v = this.view;
    if (!P || !v.play) return;
    const tl = this.tl, t0 = tl.t, d0 = P.dense;
    if (P.hold > 0) { P.hold -= dt; if (P.hold <= 0) tl.play(); }
    if (tl.playing && v.sel >= 0) v.select(-1);                        // leaving a dense camera's photo when the solve plays again
    tl.tick(dt);
    const t = tl.t;
    if (tl.playing && t > this.lastT) for (const m of this.marks) if (this.lastT < m.t && t >= m.t) this.toast(`+${m.n} photos join`);
    this.lastT = t;
    P.endT = tl.pos >= 1 && !tl.playing && !this.drag && P.hold <= 0 ? P.endT + dt : 0;
    if (P.endT > 0.6) P.dense = Math.min(1, P.dense + dt / 1.3);      // the solve has finished: back to the dense final cloud
    else P.dense = Math.max(0, P.dense - dt / 0.5);
    v.play.t = t; v.play.dense = ease(P.dense);
    if (tl.playing || P.hold > 0 || t !== t0 || P.dense !== d0) v.dirty = true;
  }

  draw(states) {
    if (!this.P) return;
    const t = this.view.play.t;
    this.tokens.draw(states, t);
    this.callV.textContent = String(this.count(t)).padStart(this.D instanceof StreamData ? 3 : 2, '0');
  }

  // a chip or a camera: look through that view (the dense cloud's camera and photo once the solve has finished)
  look(r) {
    const v = this.view, D = this.D;
    if (!D) return;
    if (v.play && v.play.dense > 0.5) {
      const j = v.meta.views.findIndex((x) => x.cap === D.meta.views[r].cap);
      if (j >= 0) v.lookThrough(j);
      return;
    }
    this.tl.pause(); if (this.P) this.P.hold = 0;
    const t = this.tl.t, seg = D.segment(t), s = D.viewState(r, t, seg), str = D instanceof StreamData;
    if (s.appear < 0.5) return;
    const a = D.cam(str ? 0 : seg.k, r), b = D.cam(str ? 1 : seg.k2, r), c = (i) => a[i] + (b[i] - a[i]) * s.mix;
    const eye = new THREE.Vector3(c(9), c(10), c(11)), fwd = new THREE.Vector3(c(2), c(5), c(8)).normalize();
    v.flyTo(eye.clone().addScaledVector(fwd, -0.02), eye.clone().addScaledVector(fwd, 0.5), lim(2 * Math.atan(0.5 / D.meta.views[r].fy) * 180 / Math.PI, 20, 100));
  }
}
