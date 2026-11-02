// Solv3R project page: wiring of the interactive sections.
import { loadScene, SolveView, Timeline, Chips, animate, errColor, css, StreamData } from './solve.js';
import { GalleryView, GalleryPlay } from './gallery.js';

const SCN = 'static/scenes';
const $ = (s, r = document) => r.querySelector(s);
const med = (a) => { const b = a.filter((x) => x !== null && isFinite(x)).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : 0.5 * (b[m - 1] + b[m]); };
const fmtE = (e) => (e === null ? '–' : e < 10 ? `${e.toFixed(2)}°` : `${e.toFixed(0)}°`);

// ---------------------------------------------------------------- shared helpers
function GALLERY_HASH() { return GALLERY.some((g) => `#${g.id}` === location.hash); }
function lazy(el, f) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); f(); } }, { rootMargin: '400px' });
  io.observe(el);
}
function watchVisible(el, obj) {
  // the latest entry: one callback can carry several crossings (fast scrolls), oldest first
  new IntersectionObserver((es) => { obj.visible = es[es.length - 1].isIntersecting; if (obj.visible) obj.onShow?.(); }, { threshold: 0.12 }).observe(el);
}
function legend(el, on) {
  el.innerHTML = on ? '<div>camera rotation error</div><div class="lg-bar"></div><div class="lg-ticks"><span>≤1°</span><span>3°</span><span>≥9°</span></div>' : '';
}
function waveMarks(D, unit) {
  if (D instanceof StreamData) return [];
  const marks = [];
  for (const f of D.waves) {
    if (f === 0) continue;
    const n = D.first.filter((x) => x === f).length;
    marks.push({ t: D.calls[f - 1] + 0.5, text: `+${n}`, n });
  }
  return marks;
}
function errStats(D, states, filt = () => true) {
  const out = [];
  for (let r = 0; r < D.V; r++) if (r !== D.meta.anchor && states[r].appear > 0.5 && filt(r)) out.push(states[r].err);
  return med(out);
}

// ---------------------------------------------------------------- one viewer with timeline, HUD and chips
class Player {
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.stage = $('.stage', root);
    this.view = new SolveView(this.stage, opts.view ?? {});
    this.hudV = $('.hud-v', root); this.hudSub = $('.hud-sub', root); this.toastEl = $('.toast', root);
    this.loadingEl = $('.loading', root); this.legendEl = $('.legend', root); this.hintEl = $('.hint', root);
    const ce = $('.chips', root);
    if (ce) this.chips = new Chips(ce, this.view, {
      onHover: (r) => { for (const L of this.view.layers) L.highlight = r; this.view.dirty = true; },
      onPick: (r) => this.view.lookThrough(r),
    });
    for (const b of root.querySelectorAll('.tool')) b.addEventListener('click', () => this.tool(b));
    this.lastT = null; this.visible = false; this.started = false;
    watchVisible(this.stage, this);
    animate(this);
  }
  tool(b) {
    const k = b.dataset.tool;
    if (k === 'home') { this.view.home(true); return; }
    if (k === 'full') {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else this.stage.requestFullscreen?.().catch(() => {});
      return;
    }
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on)); this.view.show[k] = on; this.view.dirty = true;
  }
  onShow() { if (!this.started && this.data) { this.started = true; this.tl.play(); } }
  async open(cfg) {
    this.cfg = cfg; this.loadingEl.classList.remove('done'); this.loadingEl.textContent = 'Loading 3D…';
    const token = (this.token = {});
    let D;
    try { D = await loadScene(`${SCN}/${cfg.scene}`); } catch (e) {
      try { if (!cfg.alt) throw e; D = await loadScene(`${SCN}/${cfg.alt}`); } catch (e2) { if (token === this.token) this.loadingEl.textContent = 'Scene not available yet'; return; }
    }
    if (token !== this.token) return;
    this.data = D;
    this.view.setLayers([{ data: D, frustum: cfg.frustum }]);
    this.view.show.photos = cfg.photos ?? false;
    this.view.opts.camera = cfg.camera;
    for (const b of this.root.querySelectorAll('.tool[data-tool="photos"]')) b.setAttribute('aria-pressed', String(this.view.show.photos));
    this.view.home();
    this.chips?.setData(D);
    if (this.legendEl) legend(this.legendEl, D.hasErr);
    const unit = cfg.unit ?? 'call';
    this.marks = cfg.marks ?? waveMarks(D, unit);
    const tlEl = $('.timeline', this.root);
    this.tl = new Timeline(tlEl, { t0: D.t0, t1: D.t1, duration: cfg.duration ?? 10, marks: this.marks.length > 14 ? [] : this.marks,
      label: (t) => (unit === 'frame' ? `frame ${Math.min(D.V, Math.max(1, Math.ceil(t)))} / ${D.V}` : `call ${Math.max(0, Math.floor(t + 1e-6))} / ${D.t1}`),
      tickEvery: D.t1 - D.t0 > 80 ? 0 : unit === 'frame' ? 0 : D.t1 - D.t0 > 40 ? 4 : 1 });
    this.tl.on(() => { this.view.setTime(this.tl.t); });
    this.view.setTime(this.tl.t);
    this.lastT = null;
    this.loadingEl.classList.add('done');
    if (this.visible) { this.started = true; this.tl.play(); } else this.started = false;
  }
  toast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text; this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.toastEl.classList.remove('on'), 1800);
  }
  frame(dt) {
    if (!this.tl) { this.view.frame(dt); return; }
    this.tl.tick(dt);
    const t = this.tl.t;
    if (this.lastT !== null && t > this.lastT) for (const m of this.marks) if (this.lastT < m.t && t >= m.t) this.toast(m.n ? `+${m.n} ${this.cfg.unit === 'frame' ? 'frames' : 'views join'}` : m.text);
    this.lastT = t;
    const states = this.view.frame(dt);
    if (this.view.userMoved && this.hintEl && !this.hintEl.classList.contains('off')) this.hintEl.classList.add('off');
    if (!states) return;
    const D = this.data;
    this.chips?.draw(states);
    const unit = this.cfg.unit ?? 'call';
    if (this.hudV) {
      this.hudV.textContent = unit === 'frame' ? String(Math.min(D.V, Math.max(1, Math.ceil(t)))).padStart(3, '0') : String(Math.max(0, Math.floor(t + 1e-6))).padStart(2, '0');
      this.hudV.previousElementSibling.textContent = unit;
      const n = D.presentViews(t);
      const e = D.hasErr ? errStats(D, states) : null;
      this.hudSub.textContent = `${n} ${unit === 'frame' ? 'frames' : 'views'}` + (e !== null ? `\nmedian error ${fmtE(e)}` : '');
    }
    this.opts.onFrame?.(t, states);
  }
}

// ---------------------------------------------------------------- 1. gallery: final solved states, dense; "Play the solve" plays the same run
// call by call (static/play/<id>: the saved states, in the dense cloud's frame, scripts/web/play_align.py).  mode: how the chips show the views.
const GALLERY = [
  // v3 (11-02): four scenes the user picked, offline solves of 48 photos (the gallery pool, runs/web_1031/pool); dense and photos in static/dense/<id>
  // 11-02 (user: more any-order and streaming scenes): scenes3 any-order runs, 8 photos then waves of 4 in a random order (runs/web_1101/galvid/any_prep.sbatch)
  // 11-02 order (user): settings mixed, not all offline first; the DL3DV sofa dropped
  { id: 'colosseum', name: 'Colosseum', setting: 'Offline', sub: '91 photos at once', play: { mode: 'offline', duration: 9 },
    note: 'VGGT example images. All 91 photos are solved together for 24 calls.' },
  { id: 'canyon', name: 'Basalt canyon', poster: 'static/dense/canyon_stream/views/024.jpg', setting: 'Streaming', sub: 'a video, frame by frame', play: { mode: 'stream', duration: 14 }, dense: 'static/dense/canyon_stream', camera: { yaw: 0, elev: 30, dist: 2.75 },
    note: 'VGGT example video (Studlagil canyon), 85 frames. Each frame is solved when it arrives, in a small window of recent and anchor frames.' },
  { id: 'rubble', name: 'Rubble', setting: 'Any order', sub: 'photos arriving in any order', play: { mode: 'ooo', duration: 18, pointScale: 0.7 },
    // the oblique view of the paper teaser's incremental panel (yaw -120, elevation 38 there), in this scene's frame: scripts/web/teaser_cam.py
    camera: { yaw: -80, elev: 36, dist: 2.5, target: [0.089, 0.016, 0.008], fov: 42 },
    note: 'Mill19, 96 aerial photos. Eight photos spread over the site are solved first, and the other 88 arrive in a random order, eight at a time. Cameras are colored by their rotation error against the dataset poses.' },
  { id: 'palace', name: 'Palace of Fine Arts', poster: 'static/dense/palace/views/024.jpg', setting: 'Offline', sub: '48 photos at once', play: { mode: 'offline', duration: 9 }, dense: 'static/dense/palace', camera: { yaw: 0, elev: 35, dist: 2.4 },
    note: 'DL3DV-10K validation scene. All 48 photos are solved together.' },
  { id: 'restaurant', name: 'Restaurant', setting: 'Streaming', sub: 'a video, frame by frame', play: { mode: 'stream', duration: 16 },
    note: 'DL3DV-10K validation video, 161 frames. Each frame is solved when it arrives, in a small window of recent and anchor frames, and the map shows each frame as it left the window. The ceiling is hidden so that the room can be seen from above.' },
  { id: 'courtyard', name: 'Courtyard', poster: 'static/dense/courtyard/views/012.jpg', setting: 'Any order', sub: 'photos arriving in any order', play: { mode: 'ooo', duration: 14 }, dense: 'static/dense/courtyard', camera: { yaw: 0, elev: 35, dist: 2.7 },
    note: 'ETH3D courtyard, 38 photos. Eight photos are solved first, and the other 30 arrive in a random order, four at a time.' },
  { id: 'library', name: 'Library aisle', poster: 'static/dense/library/views/024.jpg', setting: 'Offline', sub: '48 photos at once', play: { mode: 'offline', duration: 9 }, dense: 'static/dense/library', camera: { yaw: -35, elev: 30, dist: 2.3 },
    note: 'DL3DV-10K validation scene. All 48 photos are solved together. The ceiling is hidden so that the aisle can be seen from above.' },
  { id: 'courtroom', name: 'Courtroom', poster: 'static/dense/courtroom/views/024.jpg', setting: 'Any order', sub: 'photos arriving in any order', play: { mode: 'ooo', duration: 14 }, dense: 'static/dense/courtroom', camera: { yaw: 0, elev: 35, dist: 2.4 },
    note: 'Tanks and Temples Courtroom, 48 photos. Eight photos are solved first, and the other 40 arrive in a random order, four at a time. The ceiling is hidden so that the room can be seen from above.' },
  { id: 'london', name: 'Living room', poster: 'static/dense/london/views/024.jpg', setting: 'Any order', sub: 'photos arriving in any order', play: { mode: 'ooo', duration: 14 }, dense: 'static/dense/london', camera: { yaw: 60, elev: 35, dist: 1.2, target: [-0.1, -0.15, 0] }   /* inside the room (user) */,
    note: 'Zip-NeRF London living room, 48 photos. Eight photos are solved first, and the other 40 arrive in a random order, four at a time.' },
  // sofas (user's own lounge capture) dropped 11-02 (user: no time)
  // shop (Cambridge streaming) dropped 11-02 (user: the last streaming scene is not needed)
];
const GAL = 'static/gallery', PLAY = 'static/play';

function initGallery() {
  const sec = $('#gallery'), picker = $('.gal-picker', sec), root = $('#gallery-player');
  const stage = $('.stage', root), view = new GalleryView(stage, {});
  const loading = $('.loading', root), bar = $('.gal-progress i', root), note = $('.gal-note', root);
  const hint = $('.hint', root), play = new GalleryPlay(root, view);
  view.controls.addEventListener('start', () => hint.classList.add('off'));
  for (const b of root.querySelectorAll('.tool')) b.addEventListener('click', () => {
    const k = b.dataset.tool;
    if (k === 'home') view.home(true);
    else if (k === 'full') { if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.().catch(() => {}); }
    else { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); view.setCams(on); }
  });
  GALLERY.forEach((g, i) => {
    const b = document.createElement('button');
    b.className = 'gal-card'; b.setAttribute('role', 'tab'); b.dataset.id = g.id;
    b.innerHTML = `<span class="gal-thumb" style="background-image:url(${g.poster ?? `${GAL}/${g.id}/poster.jpg`})"></span>
      <span class="gal-txt"><em>${g.setting}</em><span>${g.sub}</span></span>`;   // 11-02: no scene names (user)
    b.addEventListener('click', () => open(i, true));
    picker.appendChild(b);
  });
  // 11-02: the strip scrolls with arrow buttons, a vertical wheel over it, and drag (it did not scroll with a mouse wheel)
  {
    const strip = picker, wrapS = document.createElement('div'); wrapS.className = 'gal-strip';
    strip.parentNode.insertBefore(wrapS, strip); wrapS.appendChild(strip);
    for (const [cls, dir, lab] of [['gal-arrow l', -1, 'Previous scenes'], ['gal-arrow r', 1, 'Next scenes']]) {
      const a = document.createElement('button'); a.className = cls; a.setAttribute('aria-label', lab); a.innerHTML = dir < 0 ? '&#8249;' : '&#8250;';
      a.addEventListener('click', () => strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: 'smooth' }));
      wrapS.appendChild(a);
    }
    const upd = () => { wrapS.classList.toggle('at-start', strip.scrollLeft < 4); wrapS.classList.toggle('at-end', strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 4); };
    strip.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
    strip.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) { const before = strip.scrollLeft; strip.scrollLeft += e.deltaY; if (strip.scrollLeft !== before) e.preventDefault(); } }, { passive: false });
    let down = null, moved = false;
    strip.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { down = [e.clientX, strip.scrollLeft]; moved = false; } });
    window.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - down[0]; if (Math.abs(dx) > 4) moved = true; strip.scrollLeft = down[1] - dx; });
    window.addEventListener('pointerup', () => { down = null; });
    strip.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }
  async function open(i, user = false) {
    const g = GALLERY[i];
    for (const b of picker.children) b.setAttribute('aria-selected', String(b.dataset.id === g.id));
    $('.gal-name', root).textContent = g.name; $('.gal-setting', root).textContent = `${g.setting} · ${g.sub}`;
    note.textContent = g.note;
    if (user) try { history.replaceState(null, '', `#${g.id}`); } catch (e) { /* sandboxed viewers */ }
    play.setScene(g, `${PLAY}/${g.id}`);
    loading.textContent = 'Loading 3D…'; loading.classList.remove('done'); bar.style.width = '0%'; bar.parentElement.classList.remove('done');
    view.opts.camera = g.camera;                                      // undefined: the scene's own default view
    view.photoBase = `${g.dense ?? `${GAL}/${g.id}`}/views`;
    try {
      await view.open(g.dense ?? `${GAL}/${g.id}`, (f, bytes) => {
        bar.style.width = `${Math.round(100 * f)}%`;
        loading.textContent = `Loading 3D… ${(bytes / 1e6).toFixed(1)} MB`;
        if (f > 0) loading.classList.add('done');
      });
      bar.parentElement.classList.add('done');
      const e = (view.meta?.err ?? []).filter((x) => x !== null && x > 0);
      note.textContent = g.note;                     // 11-01: no numbers under the scenes (user)
      if (view.meta) play.ready(g.id);
    } catch (err) { loading.textContent = 'Scene not available yet'; }
  }
  // 11-02: "Play the solve" plays a rendered video of the solve (static/play_video/<id>.mp4, scripts/web/gallery_video.py) that ends on the
  // viewer's home view, then fades into the live dense cloud (the point playback drew points that did not end where the dense cloud is)
  {
    let vid = null;
    const btn = $('.gal-playbtn', root), txt = btn.querySelector('span');
    const end = (fade = 0.7) => {
      const v = vid; vid = null;
      if (!v) return;
      v.style.transition = `opacity ${fade}s`; v.style.opacity = '0';
      setTimeout(() => v.remove(), fade * 1000 + 50);
      btn.hidden = false; txt.textContent = 'Replay the solve';
    };
    play.start = () => {
      const g = play.g;
      if (!g || vid) return;
      view.home(false); view.dirty = true;
      const v = (vid = document.createElement('video'));
      v.className = 'gal-vid'; v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = `static/play_video/${g.id}.mp4`;
      btn.classList.add('busy'); txt.textContent = 'Loading the solve…';
      v.addEventListener('canplay', () => { if (vid !== v) return; btn.classList.remove('busy'); btn.hidden = true; v.style.opacity = '1'; v.play().catch(() => {}); hint.classList.add('off'); }, { once: true });
      v.addEventListener('ended', () => { if (vid === v) { view.home(false); view.dirty = true; end(0.9); } });
      v.addEventListener('error', () => { if (vid !== v) return; btn.classList.remove('busy'); txt.textContent = 'Not available'; v.remove(); vid = null; });
      v.addEventListener('pointerdown', () => end(0.3));                 // a drag on the stage hands over to the live view at once
      stage.appendChild(v);
    };
    const setScene0 = play.setScene.bind(play);
    play.setScene = (g, base) => { if (vid) { vid.remove(); vid = null; } btn.classList.remove('busy'); setScene0(g, base); txt.textContent = 'Play the solve'; };
  }
  const k = GALLERY.findIndex((g) => `#${g.id}` === location.hash);
  open(Math.max(0, k));
  window.addEventListener('hashchange', () => { const j = GALLERY.findIndex((g) => `#${g.id}` === location.hash); if (j >= 0) { open(j); sec.scrollIntoView(); } });
  watchVisible(stage, view);
  animate(view);
  window.__solv3r.gallery = { view, open, play };
}

// ---------------------------------------------------------------- 2. how it keeps solving: join at any call
const JOINS = [{ j: 2, scene: 'concept_j02' }, { j: 4, scene: 'concept_j04' }, { j: 8, scene: 'concept_j08' }, { j: 16, scene: 'concept_j16' }, { j: 0, scene: 'concept_j00' }];
function initHow() {
  const sec = $('#how'), pick = $('.joinpick', sec);
  const bars = { with: $('.bar[data-k="with"]', sec), alone: $('.bar[data-k="alone"]', sec) };
  const loop = new LoopDiagram($('.loop-canvas', sec));
  let alone = null, cur = null;
  const player = new Player($('#how-player'), {
    view: { pointScale: 1.1 },
    onFrame: (t, states) => {
      const D = player.data;
      const init = (r) => D.meta.views[r].stage === 1;
      const ew = errStats(D, states, init);
      let ea = null;
      if (alone) { const sa = []; const seg = alone.segment(t); for (let r = 0; r < alone.V; r++) sa.push(alone.viewState(r, t, seg)); ea = errStats(alone, sa); }
      const w = (e) => (e === null ? 0 : Math.min(100, 100 * Math.log10(1 + e) / Math.log10(1 + 4)));
      bars.with.querySelector('i').style.width = `${cur?.j === 0 ? 0 : w(ew)}%`;
      bars.with.querySelector('.bar-v').textContent = cur?.j === 0 ? '–' : fmtE(ew);
      bars.alone.querySelector('i').style.width = `${w(ea)}%`;
      bars.alone.querySelector('.bar-v').textContent = fmtE(ea);
      loop.draw(t, D, states, cur?.j ?? 0);
    },
  });
  const lbl = document.createElement('span'); lbl.className = 'jp-label'; lbl.textContent = 'new views join after call'; pick.appendChild(lbl);
  for (const J of JOINS) {
    const b = document.createElement('button');
    b.className = 'jp'; b.setAttribute('role', 'radio'); b.textContent = J.j ? String(J.j) : 'never';
    b.addEventListener('click', () => choose(J));
    J.btn = b; pick.appendChild(b);
  }
  function choose(J) {
    cur = J;
    for (const x of JOINS) x.btn.setAttribute('aria-checked', String(x === J));
    player.open({ scene: J.scene, duration: 12, keepCamera: true, camera: { yaw: 0, elev: 12, dist: 3.1, target: [0, 0.05, 0] },
      marks: J.j ? [{ t: J.j + 0.5, text: '+12', n: 12 }] : [] });
  }
  loadScene(`${SCN}/concept_j00`).then((d) => { alone = d; }).catch(() => {});
  choose(JOINS[2]);
  window.__solv3r.how = { player, choose, JOINS };
}

// schematic of one call: the block reads every view state and writes it back; no step input
class LoopDiagram {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    new ResizeObserver(() => this.size()).observe(canvas);
    this.size();
  }
  size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.c.clientWidth; this.H = this.c.clientHeight;
    this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw(t, D, states, J) {
    const g = this.g, W = this.W, H = this.H;
    if (!W) return;
    g.clearRect(0, 0, W, H);
    const call = Math.floor(t + 1e-6), ph = t - call;                      // pulse within a call
    const pulse = Math.max(0, 1 - Math.abs(ph - 0.35) / 0.35);
    const bw = Math.min(260, W * 0.5), bh = 46, bx = (W - bw) / 2, by = H * 0.14;
    // block
    g.fillStyle = `rgba(69,137,208,${0.16 + 0.22 * pulse})`; g.strokeStyle = `rgba(150,196,242,${0.55 + 0.4 * pulse})`; g.lineWidth = 1.5;
    rr(g, bx, by, bw, bh, 12); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '500 16px "Google Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Solv3R block', W / 2, by + bh / 2);
    g.font = '12px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(154,165,180,1)';
    g.fillText(`call ${String(Math.max(0, call)).padStart(2, '0')}  ·  same update, no step input`, W / 2, by - 14);
    // tokens: one slot per view of the scene, in capture order; views that never join stay empty
    const SL = 16, slot = new Array(SL).fill(-1);
    for (let r = 0; r < D.V; r++) slot[D.meta.views[r].cap] = r;
    const gap = 6, tw = Math.min(30, (W - 40 - gap * (SL - 1)) / SL), th = tw * 1.25, tx0 = (W - (SL * tw + (SL - 1) * gap)) / 2, ty = H * 0.68;
    const V = SL;
    slot.forEach((r, i) => {
      const x = tx0 + i * (tw + gap);
      if (r < 0) { g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; rr(g, x, ty, tw, th, 4); g.stroke(); g.setLineDash([]); return; }
      const s = states[r], init = D.meta.views[r].stage === 1;
      const a = s.appear;
      // links to the block
      if (a > 0.02) {
        g.strokeStyle = `rgba(150,196,242,${(0.10 + 0.5 * pulse) * a})`; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + tw / 2, ty - 4); g.lineTo(bx + bw * (0.1 + 0.8 * i / Math.max(V - 1, 1)), by + bh + 2); g.stroke();
      }
      const drop = (1 - a) * 18;
      g.globalAlpha = 0.25 + 0.75 * a;
      g.fillStyle = 'rgba(255,255,255,0.06)'; rr(g, x, ty + drop, tw, th, 4); g.fill();
      if (a > 0.02) {
        const fill = Math.max(0.06, 1 - Math.pow(0.62, s.recv));
        g.save(); rr(g, x, ty + drop, tw, th, 4); g.clip();
        g.fillStyle = css(errColor(s.err), 0.95); g.fillRect(x, ty + drop + th * (1 - fill), tw, th * fill); g.restore();
      }
      if (init) { g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; rr(g, x - 3, ty + drop - 3, tw + 6, th + 6, 6); g.stroke(); }
      g.globalAlpha = 1;
    });
    g.fillStyle = 'rgba(154,165,180,1)'; g.font = '12px "JetBrains Mono", monospace';
    g.fillText('view states', W / 2, ty + th + 22);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.textAlign = 'left';
    g.fillText(J ? `ringed: the 4 initial views   ·   +12 views after call ${J}` : 'ringed: the 4 initial views   ·   no new views', 14, H - 12);
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ---------------------------------------------------------------- start
window.__solv3r = { ready: false };
if (GALLERY_HASH()) { initGallery(); $('#gallery').scrollIntoView(); } else lazy($('#gallery'), initGallery);
lazy($('#how'), initHow);
window.__solv3r.ready = true;

// ---------------------------------------------------------------- results tabs
for (const b of document.querySelectorAll('#results .seg-b')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('#results .seg-b')) {
      o.setAttribute('aria-selected', String(o === b));
      document.getElementById(o.dataset.t).hidden = o !== b;
    }
  });
}
