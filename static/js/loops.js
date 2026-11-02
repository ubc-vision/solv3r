// Solv3R project page v3 (10-31): self-playing panels of "What a solver can do".
// Every panel runs only while it is on screen; with prefers-reduced-motion it shows its last state and stays still.
const RM = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function onScreen(node, cb) {
  const io = new IntersectionObserver((es) => cb(es[0].isIntersecting), { threshold: 0.15 });
  io.observe(node);
}
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// ------------------------------------------------------------------ crossfade groups (one clock per group)
// <div class="xf" data-group="g" data-frames="a.jpg,b.jpg" data-labels="x,y"> ... frames of one group advance together
function initCrossfades() {
  const groups = {};
  for (const box of $$('.xf[data-frames]')) {
    const frames = box.dataset.frames.split(','), labels = (box.dataset.labels || '').split('|');
    const sizer = document.createElement('img'); sizer.className = 'sizer'; sizer.src = frames[0]; sizer.alt = '';
    box.appendChild(sizer);
    const imgs = frames.map((f, i) => {
      const im = document.createElement('img'); im.src = f; im.alt = box.dataset.alt || ''; im.decoding = 'async'; im.loading = 'lazy';
      box.appendChild(im); return im;
    });
    const chip = document.createElement('span'); chip.className = 'chip'; box.appendChild(chip);
    const g = (groups[box.dataset.group] ??= { boxes: [], n: frames.length, hold: +(box.dataset.hold || 1700), last: +(box.dataset.last || 2600), k: -1, root: box.closest('.card') });
    g.boxes.push({ imgs, labels, chip });
  }
  for (const [name, g] of Object.entries(groups)) {
    const dots = g.root ? $(`.dots[data-group="${name}"]`, g.root) : null;
    if (dots) for (let i = 0; i < g.n; i++) dots.appendChild(document.createElement('i'));
    const photos = g.root ? $$(`.photos[data-group="${name}"] img.late`, g.root) : [];
    const show = (k) => {
      g.k = k;
      for (const b of g.boxes) { b.imgs.forEach((im, i) => im.classList.toggle('on', i === k)); b.chip.textContent = b.labels[k] || ''; }
      if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i === k));
      const join = +(g.root?.dataset.joinAt ?? 1e9);
      photos.forEach((p) => p.classList.toggle('in', k >= join));
    };
    if (RM) { show(g.n - 1); continue; }
    let timer = null, live = false;
    const step = () => { show((g.k + 1) % g.n); timer = setTimeout(step, g.k === g.n - 1 ? g.last : g.hold); };
    show(0);
    onScreen(g.boxes[0].imgs[0].parentElement, (vis) => {
      if (vis && !live) { live = true; clearTimeout(timer); timer = setTimeout(step, g.hold); }
      else if (!vis && live) { live = false; clearTimeout(timer); }
    });
  }
}

// ------------------------------------------------------------------ pipelined refinement vs re-solving the window
// Both lanes give every frame 16 calls. DejaView keeps all frames at one step: the window is solved again for each new frame
// (one estimate per 16 calls). Solv3R updates frames at different stages together: each call releases the oldest frame.
function initPipeline(box) {
  const W = 16, SW = 18, SG = 3, X0 = 166, Y = [58, 168], H = 26;
  const svg = el('svg', { viewBox: '0 0 700 292', role: 'img', 'aria-label': 'Animation: DéjàView re-solves the whole window for every new frame and outputs one frame per 16 calls; Solv3R updates frames at different stages in one call and outputs one frame per call.' }, box);
  const ACC = hex(css('--acc') || '#4589d0'), DVC = hex(css('--dv') || '#f0a3a0'), PAPER = [255, 255, 255];
  const muted = css('--muted') || '#5d6573', faint = css('--faint') || '#8a93a1';
  const shade = (base, p) => rgb(mix(PAPER, base, 0.10 + 0.90 * Math.min(1, p / W)));
  const head = el('text', { x: 0, y: 16, 'font-size': 15, fill: muted, class: 'mono' }, svg, 'call 0');
  el('text', { x: X0, y: 16, 'font-size': 13.5, fill: faint }, svg, 'window of 16 frames, darker = more calls received');
  const lanes = [
    { name: 'DéjàView', sub: 're-solves the window', col: DVC, tcol: '#c9625d', y: Y[0], pipe: false },
    { name: 'Solv3R', sub: 'pipelined', col: ACC, tcol: rgb(ACC), y: Y[1], pipe: true }];
  for (const L of lanes) {
    el('text', { x: 0, y: L.y + 11, 'font-size': 17, 'font-weight': 600, fill: L.tcol }, svg, L.name);
    el('text', { x: 0, y: L.y + 31, 'font-size': 13.5, fill: muted }, svg, L.sub);
    el('text', { x: X0 - 22, y: L.y + H / 2 + 6, 'font-size': 18, fill: faint, 'text-anchor': 'middle' }, svg, '→');
    el('text', { x: X0 - 22, y: L.y - 8, 'font-size': 12, fill: faint, 'text-anchor': 'middle' }, svg, 'new');
    L.g = el('g', {}, svg);
    L.rects = Array.from({ length: W }, (_, i) => el('rect', { x: X0 + i * (SW + SG), y: L.y, width: SW, height: H, rx: 3 }, L.g));
    L.xo = X0 + W * (SW + SG) + 18;
    el('text', { x: L.xo, y: L.y - 8, 'font-size': 12, fill: faint }, svg, 'estimates out');
    L.tray = el('g', {}, svg);
    L.count = el('text', { x: 700, y: L.y + H / 2 + 6, 'font-size': 18, 'font-weight': 600, fill: L.tcol, 'text-anchor': 'end', class: 'mono' }, svg, '0');
  }
  el('text', { x: X0, y: 256, 'font-size': 13.5, fill: muted }, svg, 'Both give every frame 16 calls, so a frame waits just as long.');
  el('text', { x: X0, y: 276, 'font-size': 13.5, fill: muted }, svg, 'Only the pipeline releases a frame at every call.');
  const reset = () => { for (const L of lanes) { L.out = 0; L.p = 0; L.prog = Array.from({ length: W }, (_, i) => (L.pipe ? i : 0)); } };
  const draw = () => {
    for (const L of lanes) {
      L.rects.forEach((r, i) => r.setAttribute('fill', shade(L.col, L.pipe ? L.prog[i] + 1 : L.p)));
      L.count.textContent = String(L.out);
      const n = Math.min(L.out, 10);
      while (L.tray.childNodes.length > n) L.tray.removeChild(L.tray.lastChild);
      while (L.tray.childNodes.length < n) {
        const k = L.tray.childNodes.length;
        el('rect', { x: L.xo + k * 8, y: L.y + 5, width: 6, height: H - 10, rx: 2, fill: rgb(L.col) }, L.tray);
      }
    }
  };
  const slide = (L, done) => {
    const a = L.g.animate?.([{ transform: 'translateX(0px)' }, { transform: `translateX(${SW + SG}px)` }], { duration: 300, easing: 'ease-in-out' });
    if (a) a.onfinish = done; else done();
  };
  let call = 0;
  const tick = () => {
    call += 1;
    if (call > 48) { call = 1; reset(); }
    head.textContent = `call ${call}`;
    for (const L of lanes) {
      if (L.pipe) {                    // one more call for every frame; the oldest (16 calls) leaves, the newest enters
        slide(L, () => { L.out += 1; L.prog = [0, ...L.prog.slice(0, W - 1).map((p) => p + 1)]; draw(); });
      } else {                         // all frames at one step; after 16 calls one new estimate, then the next frame and a new solve
        L.p += 1;
        if (L.p >= W) slide(L, () => { L.out += 1; L.p = 0; draw(); });
      }
    }
    draw();
  };
  reset(); draw();
  if (RM) { for (let i = 0; i < 40; i++) { call += 1; for (const L of lanes) { if (L.pipe) { L.out += 1; } else if (++L.p >= W) { L.out += 1; L.p = 0; } } } draw(); head.textContent = 'call 40'; return; }
  let iv = null;
  onScreen(box, (vis) => { if (vis && !iv) iv = setInterval(tick, 560); else if (!vis && iv) { clearInterval(iv); iv = null; } });
}

// ------------------------------------------------------------------ one cache for every call
function initCache(box) {
  const svg = el('svg', { viewBox: '0 0 700 278', role: 'img', 'aria-label': 'Animation: a layer-wise model reads one cache per layer, DéjàView one cache per step of its schedule, Solv3R one cache at every call. Per-view cache: 97.6, 45.8 and 2.86 MB.' }, box);
  const muted = css('--muted') || '#5d6573', faint = css('--faint') || '#8a93a1';
  const COLS = [
    { name: 'VGGT', sub: 'one cache per layer', n: 24, mb: 97.6, col: css('--vg') || '#c9b8ec', tcol: '#8a6fcf' },
    { name: 'DéjàView', sub: 'one cache per step', n: 16, mb: 45.8, col: css('--dv') || '#f0a3a0', tcol: '#c9625d' },
    { name: 'Solv3R', sub: 'one cache, every call', n: 1, mb: 2.86, col: css('--acc') || '#4589d0', tcol: css('--acc') || '#4589d0' }];
  const X = [30, 265, 500], top = 52, hh = 118;
  COLS.forEach((c, j) => {
    el('text', { x: X[j], y: 18, 'font-size': 17, 'font-weight': 600, fill: c.tcol }, svg, c.name);
    el('text', { x: X[j], y: 38, 'font-size': 13.5, fill: muted }, svg, c.sub);
    const bh = c.n === 1 ? 26 : Math.max(3, (hh - (c.n - 1) * 1.5) / c.n);
    c.bars = [];
    for (let i = 0; i < c.n; i++) {
      const y = c.n === 1 ? top + hh / 2 - 13 : top + i * (bh + 1.5);
      c.bars.push(el('rect', { x: X[j], y, width: 150, height: bh, rx: 2, fill: c.col, opacity: 0.35 }, svg));
    }
    const w = Math.max(3, 170 * c.mb / 97.6);
    el('rect', { x: X[j], y: 196, width: w, height: 10, rx: 3, fill: c.col }, svg);
    el('text', { x: X[j], y: 228, 'font-size': 14.5, fill: '#23272e', class: 'mono' }, svg, `${c.mb} MB / view`);
  });
  el('text', { x: 500, y: 250, 'font-size': 13.5, fill: muted }, svg, '16× lighter than DéjàView');
  el('text', { x: 500, y: 268, 'font-size': 13.5, fill: muted }, svg, '34× lighter than VGGT');
  el('text', { x: 30, y: 250, 'font-size': 12.5, fill: faint }, svg, 'KV cache of one solved view');
  el('text', { x: 30, y: 268, 'font-size': 12.5, fill: faint }, svg, '(the paper\'s relocalization table)');
  let t = 0;
  const frame = () => {
    t += 1;
    COLS.forEach((c) => {
      const k = c.n === 1 ? 0 : t % c.n;
      c.bars.forEach((b, i) => b.setAttribute('opacity', i === k ? 1 : 0.28));
    });
  };
  frame();
  if (RM) return;
  let iv = null;
  onScreen(box, (vis) => { if (vis && !iv) iv = setInterval(frame, 260); else if (!vis && iv) { clearInterval(iv); iv = null; } });
}

// ------------------------------------------------------------------ more calls never hurt: AUC@5 vs calls, drawn over time
function initDeep(box, D) {
  const svg = el('svg', { viewBox: '0 0 700 306', role: 'img', 'aria-label': `Chart: pose AUC@5 versus solver calls from 1 to 128. Solv3R reaches ${D.ours[128]} and stays there; DéjàView peaks at ${D.dv[16]} at 16 calls and falls to ${D.dv[128]} at 128 calls.` }, box);
  const muted = css('--muted') || '#5d6573', faint = css('--faint') || '#8a93a1', line = css('--line') || '#e5e8ed';
  const L = 52, R = 600, T = 18, B = 250;
  const lx = (k) => L + (R - L) * Math.log2(k) / 7, ly = (v) => B - (B - T) * v / 100;
  el('rect', { x: L, y: T, width: lx(16) - L, height: B - T, fill: '#f4f6f9' }, svg);
  el('text', { x: (L + lx(16)) / 2, y: T + 16, 'font-size': 13, fill: faint, 'text-anchor': 'middle' }, svg, "DéjàView's 16-step schedule");
  for (const v of [0, 25, 50, 75, 100]) {
    el('line', { x1: L, x2: R, y1: ly(v), y2: ly(v), stroke: line, 'stroke-width': 1 }, svg);
    el('text', { x: L - 8, y: ly(v) + 5, 'font-size': 13, fill: faint, 'text-anchor': 'end' }, svg, String(v));
  }
  for (const k of [1, 2, 4, 8, 16, 32, 64, 128]) el('text', { x: lx(k), y: B + 20, 'font-size': 13, fill: faint, 'text-anchor': 'middle' }, svg, String(k));
  el('text', { x: (L + R) / 2, y: B + 42, 'font-size': 14, fill: muted, 'text-anchor': 'middle' }, svg, 'solver calls');
  el('text', { x: 14, y: (T + B) / 2, 'font-size': 14, fill: muted, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(T + B) / 2})` }, svg, 'pose AUC@5 (%)');
  const path = (S) => Object.keys(S).map(Number).sort((a, b) => a - b).map((k, i) => `${i ? 'L' : 'M'}${lx(k).toFixed(1)},${ly(S[k]).toFixed(1)}`).join('');
  const clip = el('clipPath', { id: 'deepclip' }, el('defs', {}, svg));
  const cr = el('rect', { x: 0, y: 0, width: 0, height: 300 }, clip);
  const g = el('g', { 'clip-path': 'url(#deepclip)' }, svg);
  const dvc = css('--dv') || '#f0a3a0', acc = css('--acc') || '#4589d0';
  el('path', { d: path(D.dv), fill: 'none', stroke: dvc, 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  el('path', { d: path(D.ours), fill: 'none', stroke: acc, 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  const lab = el('g', { opacity: 0 }, svg);
  el('text', { x: R + 8, y: ly(D.ours[128]) + 4, 'font-size': 15, 'font-weight': 600, fill: acc }, lab, 'Solv3R');
  el('text', { x: R + 8, y: ly(D.dv[128]) - 2, 'font-size': 15, 'font-weight': 600, fill: '#c9625d' }, lab, 'DéjàView');
  const cur = el('text', { x: R, y: T + 2, 'font-size': 14, fill: muted, 'text-anchor': 'end', class: 'mono' }, svg, '');
  const DUR = 4200, HOLD = 2600;
  let t0 = null, raf = null;
  const frame = (now) => {
    t0 ??= now;
    const u = Math.min(1, (now - t0) / DUR), x = L + (R - L) * u;
    cr.setAttribute('width', x + 2);
    const k = Math.max(1, Math.round(2 ** (7 * u)));
    cur.textContent = `call ${k}`;
    lab.setAttribute('opacity', u >= 1 ? 1 : 0);
    if (now - t0 > DUR + HOLD) t0 = now;
    raf = requestAnimationFrame(frame);
  };
  if (RM) { cr.setAttribute('width', 700); lab.setAttribute('opacity', 1); cur.textContent = 'call 128'; return; }
  onScreen(box, (vis) => { if (vis && !raf) raf = requestAnimationFrame(frame); else if (!vis && raf) { cancelAnimationFrame(raf); raf = null; t0 = null; } });
}

// ------------------------------------------------------------------
const DEEP = {
  ours: { 1: 0.32, 2: 4.12, 3: 15.1, 4: 29.94, 6: 54.38, 8: 66.94, 10: 73.35, 12: 76.87, 16: 78.89, 20: 79.91, 24: 80.73, 32: 80.73, 48: 80.65, 64: 80.52, 96: 80.45, 128: 80.57 },
  dv: { 1: 0.15, 2: 2.02, 3: 9.98, 4: 21.24, 5: 33.9, 6: 44.05, 8: 58.54, 10: 67.35, 12: 73.53, 16: 78.41, 20: 74.59, 24: 67.19, 32: 46.76, 48: 6.03, 64: 0.17, 96: 0.07, 128: 0.02 },
};
// ------------------------------------------------------------------ one solver for every setting (#every)
// Three panel videos of the film's overview play together on one clock. The clips start at film-local t = 1.2 s, and the
// shared clock runs 2.6 calls per second from t = 1.6 s (media/film_v11/apps.py), so the block shows call 00 to 32.
function initEvery(box) {
  const vids = $$('video', box), out = $('.every-call', box);
  if (!vids.length) return;
  const show = (t) => { if (out) out.textContent = `call ${String(Math.floor(Math.max(0, (1.2 + t - 1.6) * 2.6))).padStart(2, '0')}`; };
  if (RM) { show(12.8); return; }
  let live = false, raf = 0;
  const tick = () => { show(vids[0].currentTime); raf = requestAnimationFrame(tick); };
  const play = () => vids.forEach((v) => { v.muted = true; v.play().catch(() => {}); });
  vids[0].addEventListener('ended', () => { vids.forEach((v) => { v.currentTime = 0; }); if (live) play(); });
  onScreen(box, (vis) => {
    live = vis;
    cancelAnimationFrame(raf);
    if (vis) { play(); raf = requestAnimationFrame(tick); } else vids.forEach((v) => v.pause());
  });
}

// ================================================================== 11-01: clips with JSON timelines (#every, method, streaming card)
// A clip's timeline, written next to its video, gives the call count over video time, when each input photo arrives (and leaves),
// and a schematic row of view-state tokens. A token has received c0 + calls(t) - calls(arrive) calls while it is present; its colour
// runs from the initial state (light) to solved (dark) as 1 - 0.8^calls. Streaming tokens also carry roles (anchor, window, cache).
const TKP = hex('#a9c6e6'), TKM = hex('#4589d0'), TK1 = hex('#1d3f6e'), TKC = hex('#b1bac6');
const tkCol = (lv) => rgb(mix(TKP, TKM, Math.min(1, lv)));        // the fill of a token: pale when barely solved, accent when solved (as the film)
function callsAt(calls, t) {
  if (!calls || !calls.length) return 0;
  if (t <= calls[0][0]) return calls[0][1];
  for (let i = 1; i < calls.length; i++) {
    const [t1, k1] = calls[i];
    if (t <= t1) { const [t0, k0] = calls[i - 1]; return t1 > t0 ? k0 + (k1 - k0) * (t - t0) / (t1 - t0) : k1; }
  }
  return calls[calls.length - 1][1];
}
const isOn = (o, t) => t >= o.arrive && (o.leave == null || t < o.leave);
const roleAt = (o, t) => { let r = null; for (const [tr, name] of o.roles || []) if (t >= tr) r = name; return r; };
const callStr = (k) => `call ${String(Math.floor(k + 1e-6)).padStart(2, '0')}`;
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });

class Strip {
  // the photos and tokens of one timeline; CSS lays them out (rows in #every, grids in the method diagram)
  constructor(T, phEl, tkEl, base = 0.8) {
    this.T = T; this.base = base;
    this.ph = phEl ? T.photos.map((p) => { const im = document.createElement('img'); im.src = p.src; im.alt = ''; im.decoding = 'async'; phEl.appendChild(im); return im; }) : [];
    this.tk = tkEl ? T.tokens.map(() => { const i = document.createElement('i'); i.className = 'tk off'; i.appendChild(document.createElement('b')); tkEl.appendChild(i); return i; }) : [];
    this.role = this.tk.map(() => null);
    this.home = this.tk.map(() => null);           // the last role other than a refresh pulse (for the group labels)
  }
  update(t, onRole = null) {
    const T = this.T, NEW = 0.9, k = callsAt(T.calls, t);
    T.photos.forEach((p, i) => {
      const im = this.ph[i]; if (!im) return;
      const on = isOn(p, t);
      im.classList.toggle('off', !on);
      im.classList.toggle('new', on && p.arrive > 0.05 && t - p.arrive < NEW);
    });
    if (this.tk.length) T.tokens.forEach((o, i) => {
      const e = this.tk[i], on = isOn(o, t);
      e.classList.toggle('off', !on);
      e.classList.toggle('tk-new', on && o.arrive > 0.05 && t - o.arrive < NEW);
      if (!on) return;
      const role = roleAt(o, t);
      if (role !== this.role[i]) { if (onRole) onRole(e, this.role[i], role); this.role[i] = role; e.dataset.role = role || ''; }
      if (role && role !== 'refresh') this.home[i] = role;
      const c = (o.c0 || 0) + Math.max(0, callsAt(T.calls, Math.min(t, o.leave ?? t)) - callsAt(T.calls, o.arrive));
      const home = role === 'refresh' ? this.home[i] : role, f = e.firstChild;
      const lv = home === 'cache' || home === 'anchor' ? 1 : 1 - Math.pow(this.base, c);
      f.style.height = `${(100 * lv).toFixed(1)}%`;
      f.style.backgroundColor = home === 'cache' ? rgb(TKC) : home === 'anchor' ? rgb(TK1) : tkCol(lv);
    });
    return k;
  }
  arrived(t) { return this.T.tokens.reduce((n, o) => n + (t >= o.arrive ? 1 : 0), 0); }
}

function playClips(box, vids, tick) {
  // plays the clips while box is on screen, all restarting together once every one has ended; tick(still) redraws the HTML
  vids = vids.filter(Boolean);
  if (RM) { tick(true); return; }
  let live = false, raf = 0;
  const loop = () => { tick(false); raf = requestAnimationFrame(loop); };
  const play = () => vids.forEach((v) => { v.muted = true; v.play().catch(() => {}); });
  for (const v of vids) v.addEventListener('ended', () => {
    if (!vids.every((w) => w.ended)) return;
    vids.forEach((w) => { w.currentTime = 0; });
    if (live) play();
  });
  onScreen(box, (vis) => {
    live = vis; cancelAnimationFrame(raf);
    if (vis) { play(); raf = requestAnimationFrame(loop); } else vids.forEach((v) => v.pause());
  });
}

// ------------------------------------------------------------------ one solver for every setting, v2 (#every)
async function initEvery2(box) {
  const ev = $('.ev', box); if (!ev) return;
  const cols = $$('.ev-in', ev).map((c) => ({ c, vid: $(`.ev-out[data-panel="${c.dataset.panel}"] video`, ev), url: `${ev.dataset.base}/${c.dataset.panel}.json` }));
  let T;
  try { T = await Promise.all(cols.map((x) => getJSON(x.url))); } catch (e) { console.warn('every2:', e.message); return; }
  cols.forEach((x, i) => {
    x.T = T[i]; x.frames = x.c.dataset.panel === 'stream';
    x.s = new Strip(T[i], $('.ev-photos', x.c), $('.ev-tokens', x.c), x.frames ? 0.95 : 0.8); x.k = $('.ev-k', x.c);
  });
  playClips(box, cols.map((x) => x.vid), (still) => {
    for (const x of cols) {
      const t = still ? x.T.duration - 0.05 : x.vid.currentTime, k = x.s.update(t);
      x.k.textContent = x.frames ? `frame ${String(x.s.arrived(t)).padStart(2, '0')}` : callStr(k);
    }
  });
}

// film-style chip rows (media/film_v11/apps.py): offline fills together, streaming enters from the right and slides left,
// arbitrary order lands in random empty slots
class FilmChips {
  constructor(el, mode, T, n = 16) {
    if (mode === 'anyorder') n = T.tokens.length;     // one slot per token, so the row ends full
    this.el = el; this.mode = mode; this.T = T; this.n = n; this.W = 12; this.G = 4;
    el.classList.add('fchips'); el.style.width = `${n * (this.W + this.G) - this.G}px`;
    this.pool = Array.from({ length: n + 3 }, () => { const i = document.createElement('i'); i.className = 'fc'; i.appendChild(document.createElement('b')); el.appendChild(i); return i; });
    const tok = [...T.tokens].sort((a, b) => a.arrive - b.arrive);
    this.A = tok.map((o) => o.arrive); this.c0 = tok.map((o) => o.c0 || 0);
    if (mode === 'anyorder') {                         // first wave at spread slots, later tokens at seeded random empty slots
      const first = tok.filter((o) => o.arrive <= tok[0].arrive + 1e-3).length, spread = [...Array(first).keys()].map((j) => Math.round((j + 0.5) * n / first - 0.5));
      let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const rest = [...Array(n).keys()].filter((q) => !spread.includes(q)).sort(() => rnd() - 0.5);
      this.slot = tok.map((_, j) => (j < first ? spread[j] : rest[j - first]));
    }
  }
  put(i, x, fill, alpha, empty = false) {
    const e = this.pool[i]; e.style.left = `${x * (this.W + this.G)}px`; e.style.opacity = alpha;
    e.classList.toggle('empty', empty);
    const f = Math.max(0, Math.min(1, fill));
    e.firstChild.style.height = `${(100 * f).toFixed(1)}%`;
    e.firstChild.style.backgroundColor = rgb(mix(TKP, TKM, f));
  }
  update(t) {
    const T = this.T, k = callsAt(T.calls, t), n = this.n;
    let used = 0;
    if (this.mode === 'offline') {
      for (let q = 0; q < n; q++) this.put(used++, q, 1 - Math.pow(0.86, k), 1);
    } else if (this.mode === 'anyorder') {
      const full = new Map();
      this.A.forEach((a, j) => { if (j < n && t >= a) full.set(this.slot[j], Math.max(0.12, 1 - Math.pow(0.62, this.c0[j] + k - callsAt(T.calls, a)))); });
      for (let q = 0; q < n; q++) { const f = full.get(q); this.put(used++, q, f ?? 0, 1, f === undefined); }
    } else {
      const A = this.A; if (t < A[0]) { this.pool.forEach((e) => { e.style.opacity = 0; }); return; }
      let lo = 0; while (lo < A.length - 1 && A[lo + 1] <= t) lo++;
      const fi = lo + (lo < A.length - 1 ? Math.min(1, (t - A[lo]) / Math.max(1e-6, A[lo + 1] - A[lo])) : 0);
      for (let f = Math.max(0, Math.floor(fi) - n - 1); f <= Math.floor(fi) && used < this.pool.length; f++) {
        const x = n - 1 - (fi - f); if (x < -0.6 || t < A[f]) continue;
        this.put(used++, x, 1 - Math.pow(0.55, (k - callsAt(T.calls, A[f])) / 8), Math.min(1, x + 0.6));
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.opacity = 0;
    return k;
  }
}

// ------------------------------------------------------------------ one solver for every setting, film order (#every, 11-02)
// The Solv3R block on top feeds three panels; each call sends a pulse down the wires. Under each 3D: its tokens and input photos.
async function initEvery3(box) {
  const ev = $('.ev3', box); if (!ev) return;
  const cols = $$('.ev3-col', ev).map((c) => ({ c, panel: c.dataset.panel, vid: $('video', c), url: c.dataset.src ? `${c.dataset.src}.json` : `${ev.dataset.base}/${c.dataset.panel}.json` }));
  let T;
  try { T = await Promise.all(cols.map((x) => getJSON(x.url))); } catch (e) { console.warn('every:', e.message); return; }
  cols.forEach((x, i) => {
    x.T = T[i]; x.frames = x.panel === 'stream';
    x.s = new Strip(T[i], $('.ev3-photos', x.c), null, 0.9); x.k = $('.ev3-k', x.c);
    x.chips = new FilmChips($('.ev3-tokens', x.c), x.panel, T[i]);
  });
  const blk = $('.ev3-block', ev), call = $('.sv-call', blk), svg = $('.ev3-wires', ev), clock = cols.find((x) => !x.frames) || cols[0];
  let paths = [];
  const wire = () => {
    const R = ev.getBoundingClientRect(), b = blk.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`); svg.innerHTML = '';
    const x0 = b.left + b.width / 2 - R.left, y0 = b.bottom - R.top, acc = css('--acc') || '#4589d0';
    paths = cols.map((x) => {
      const v = x.vid.getBoundingClientRect(), x1 = v.left + v.width / 2 - R.left, y1 = x.c.getBoundingClientRect().top - R.top - 8, ym = (y0 + y1) / 2;
      const r = Math.min(10, Math.abs(x1 - x0) / 2);
      const d = Math.abs(x1 - x0) < 1 ? `M${x0},${y0}V${y1}` : `M${x0},${y0}V${ym - r}Q${x0},${ym} ${x0 + Math.sign(x1 - x0) * r},${ym}H${x1 - Math.sign(x1 - x0) * r}Q${x1},${ym} ${x1},${ym + r}V${y1}`;
      el('path', { d, fill: 'none', stroke: acc, 'stroke-width': 1.5, opacity: 0.55 }, svg);
      el('path', { d: `M${x1 - 5},${y1 - 7}L${x1},${y1}L${x1 + 5},${y1 - 7}`, fill: 'none', stroke: acc, 'stroke-width': 1.5, opacity: 0.7 }, svg);
      const ph = el('path', { d, fill: 'none', stroke: 'none' }, svg);
      return ph;
    });
  };
  wire(); window.addEventListener('resize', wire);
  const pulses = [];
  let last = -1;
  playClips(box, cols.map((x) => x.vid), (still) => {
    const now = performance.now();
    for (const x of cols) {
      const t = still ? x.T.duration - 0.05 : x.vid.currentTime;
      x.s.update(t); const kk = x.chips.update(t);
      x.k.textContent = x.frames ? `frame ${String(x.s.arrived(t)).padStart(3, '0')}` : (x.panel === 'anyorder' ? callStr(kk) : '');
    }
    const k = callsAt(clock.T.calls, still ? clock.T.duration - 0.05 : clock.vid.currentTime), ki = Math.floor(k + 1e-6);
    call.textContent = callStr(k);
    if (ki !== last) {
      if (ki > last && ki > 0 && !still && paths.length) {
        blk.classList.remove('pulse'); void blk.offsetWidth; blk.classList.add('pulse');
        for (const ph of paths) pulses.push({ ph, t0: now, dot: el('circle', { r: 3.6, fill: '#fff', stroke: css('--acc') || '#4589d0', 'stroke-width': 2 }, svg) });
      }
      last = ki;
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const P = pulses[i], u = (now - P.t0) / 520;
      if (u >= 1 || !P.ph.isConnected) { P.dot.remove(); pulses.splice(i, 1); continue; }
      const L = P.ph.getTotalLength(), q = P.ph.getPointAtLength(L * u);
      P.dot.setAttribute('cx', q.x); P.dot.setAttribute('cy', q.y); P.dot.setAttribute('opacity', Math.min(1, 4 * (1 - u)));
    }
  });
}

// ------------------------------------------------------------------ method: one block, called again and again (#method)
async function initMethod(box) {
  const src = box.dataset.src, vid = $('video', box);
  let T;
  try { T = await getJSON(`${src}.json`); } catch (e) { console.warn('method:', e.message); return; }
  const S = new Strip(T, $('.mt-photos', box), $('.mt-tokens', box));
  const call = $('.mt-call', box), blk = $('.mt-block', box), ev = $('.mt-event', box.parentElement);
  const svg = $('.mt-loop', box);
  const wire = () => {                               // the dashed "next call" path from the view states back into the block
    if (!svg) return;
    const R = box.getBoundingClientRect(), a = $('.mt-st', box).getBoundingClientRect(), b = blk.getBoundingClientRect();
    if (a.top > b.bottom - 4) { svg.innerHTML = ''; return; }    // stacked (phone): no loop drawn
    const y = Math.max(a.bottom, b.bottom) - R.top + 34, x1 = a.left + a.width / 2 - R.left, x0 = b.left + b.width / 2 - R.left, r = 10;
    const yb = b.bottom - R.top + 16, ya = a.bottom - R.top + 6;   // the loop leaves the states and re-enters the block with room for the arrowhead
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    svg.innerHTML = '';
    el('path', { d: `M${x1},${ya}V${y - r}Q${x1},${y} ${x1 - r},${y}H${x0 + r}Q${x0},${y} ${x0},${y - r}V${yb}`, fill: 'none', stroke: css('--acc') || '#4589d0', 'stroke-width': 1.6, 'stroke-dasharray': '5 4', opacity: 0.75 }, svg);
    el('path', { d: `M${x0 - 6},${yb + 8}L${x0},${yb}L${x0 + 6},${yb + 8}`, fill: 'none', stroke: css('--acc') || '#4589d0', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
    el('text', { x: (x0 + x1) / 2, y: y + 18, 'font-size': 12, fill: css('--muted') || '#5d6573', 'text-anchor': 'middle', class: 'mono' }, svg, 'next call');
  };
  wire(); window.addEventListener('resize', wire);
  let last = -1;
  playClips(box, [vid], (still) => {
    const t = still ? T.duration - 0.05 : vid.currentTime, k = S.update(t), ki = Math.floor(k + 1e-6);
    call.textContent = callStr(k);
    if (ki !== last) { blk.classList.remove('pulse'); void blk.offsetWidth; if (ki > 0 && !still) blk.classList.add('pulse'); last = ki; }
    if (ev) { let txt = ''; for (const e of T.events || []) if (t >= e.t) txt = e.text; if (ev.textContent !== txt) ev.textContent = txt; }
  });
}

// ------------------------------------------------------------------ streaming: a video, solved as it arrives (streaming card)
async function initStreamCard(box) {
  const src = box.dataset.src, vid = $('video', box);
  let T;
  try { T = await getJSON(`${src}.json`); } catch (e) { console.warn('stream card:', e.message); return; }
  const row = $('.sc-tokens', box), out = $('.sc-out', box), call = $('.sc-call', box), svg = $('.sc-wires', box), blk = $('.sc-block', box);
  const labs = { anchor: $('.sc-lab[data-role="anchor"]', box), cache: $('.sc-lab[data-role="cache"]', box), window: $('.sc-lab[data-role="window"]', box) };
  const drop = (e, from, to) => {                     // a frame leaving the window is decoded: a ghost of its token drops into the scene
    if (RM || from !== 'window' || to !== 'cache') return;
    const R = box.getBoundingClientRect(), a = e.getBoundingClientRect(), o = out.getBoundingClientRect();
    const g = document.createElement('i'); g.className = 'sc-ghost';
    g.style.left = `${a.left - R.left}px`; g.style.top = `${a.top - R.top}px`;
    g.style.setProperty('--dy', `${o.top + o.height * 0.62 - a.top}px`); g.style.setProperty('--dx', `${o.left + o.width / 2 - a.left}px`);
    box.appendChild(g); setTimeout(() => g.remove(), 1300);
  };
  const S = new Strip(T, $('.sc-film', box), row, 0.95), rf = $('.sc-refresh', box);
  const REF = (T.events || []).filter((e) => e.kind === 'refresh').map((e) => e.t);
  const ext = (role) => {                             // horizontal extent of the visible tokens of one role, relative to the box
    let x0 = Infinity, x1 = -Infinity;
    S.tk.forEach((e, i) => { if (S.home[i] === role && !e.classList.contains('off')) { const r = e.getBoundingClientRect(); x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right); } });
    return x1 > x0 ? [x0, x1] : null;
  };
  let tw = 0;
  const wires = (now) => {                            // labels under each role group, and the block's reads (dashed) / updates (solid)
    if (now - tw < 120) return; tw = now;
    const R = box.getBoundingClientRect(), b = blk.getBoundingClientRect(), r = row.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`); svg.innerHTML = '';
    const acc = css('--acc') || '#4589d0', grey = '#9aa4b2';
    for (const [role, lab] of Object.entries(labs)) {
      const x = ext(role);
      if (!lab) continue;
      lab.style.opacity = x ? 1 : 0;
      if (!x) continue;
      const cx = (x[0] + x[1]) / 2 - R.left;          // the anchor and window labels sit beside the row's ends, the cache label under its group
      lab.style.left = `${role === 'anchor' ? x[0] - R.left - 12 : role === 'window' ? x[1] - R.left + 12 : cx}px`;
      el('path', { d: `M${x[0] - R.left},${r.bottom - R.top + 3}v4H${x[1] - R.left}v-4`, fill: 'none', stroke: role === 'window' ? acc : grey, 'stroke-width': 1.2 }, svg);
      const bx = Math.min(Math.max(cx, b.left - R.left + 18), b.right - R.left - 18);
      el('path', { d: `M${bx},${b.bottom - R.top + 1}L${cx},${r.top - R.top - 3}`, fill: 'none', stroke: role === 'window' ? acc : grey,
                   'stroke-width': role === 'window' ? 2 : 1.4, 'stroke-dasharray': role === 'window' ? '' : '4 4' }, svg);
    }
  };
  playClips(box, [vid], (still) => {
    const t = still ? T.duration - 0.05 : vid.currentTime;
    S.update(t, drop);
    call.textContent = `frame ${String(S.arrived(t)).padStart(3, '0')}`;
    if (rf) {                                         // a refresh: cached frames are solved again (real refresh steps of the run)
      const on = !still && (REF.some((x) => t >= x && t < x + 1.2) || S.role.includes('refresh'));
      rf.classList.toggle('on', on);
      if (on) { const g = ext('cache') || ext('anchor'); if (g) rf.style.left = `${(g[0] + g[1]) / 2 - box.getBoundingClientRect().left}px`; }
    }
    wires(still ? 1e9 : performance.now());
  });
  window.addEventListener('resize', () => { tw = 0; });
}

// ------------------------------------------------------------------ streaming accuracy vs speed (the paper's bubble figure)
// H100 ms per frame, pose ATE (geometric mean over TUM-dynamics, ScanNet, Sintel), peak GPU memory (GB); scripts/paper_fig_stream_bubble_h100.py
const BUB = {
  base: [['CUT3R', 51.6, 0.308, 6.1], ['TTT3R', 52.0, 0.211, 6.1], ['LingBot-Map', 119.1, 0.075, 14.3], ['Spann3R', 78.1, 0.327, 2.62], ['SLAM-Former', 72.4, 0.161, 10.4]],
  ours: [['S4', 57.6, 0.082, 2.1], ['L4', 73.8, 0.063, 5.0], ['L8', 97.1, 0.056, 5.0]],
};
function initBubble(box) {
  const svg = el('svg', { viewBox: '0 0 700 360', role: 'img', 'aria-label': 'Chart: pose error against time per frame for streaming methods, bubble area showing GPU memory. Solv3R has the lowest error at a competitive time per frame and low memory.' }, box);
  const muted = css('--muted') || '#5d6573', faint = css('--faint') || '#8a93a1', line = css('--line') || '#e5e8ed', acc = css('--acc') || '#4589d0';
  const L = 64, R = 640, T = 22, B = 300, X0 = 40, X1 = 130, Y1 = 0.35;
  const lx = (v) => L + (R - L) * (v - X0) / (X1 - X0), ly = (v) => B - (B - T) * v / Y1, rr = (gb) => 4.2 * Math.sqrt(gb);
  for (const v of [0, 0.1, 0.2, 0.3]) {
    el('line', { x1: L, x2: R, y1: ly(v), y2: ly(v), stroke: line, 'stroke-width': 1 }, svg);
    el('text', { x: L - 8, y: ly(v) + 4, 'font-size': 13, fill: faint, 'text-anchor': 'end' }, svg, v.toFixed(1));
  }
  for (const v of [40, 60, 80, 100, 120]) el('text', { x: lx(v), y: B + 20, 'font-size': 13, fill: faint, 'text-anchor': 'middle' }, svg, String(v));
  el('text', { x: (L + R) / 2, y: B + 44, 'font-size': 14, fill: muted, 'text-anchor': 'middle' }, svg, 'milliseconds per frame, one H100 GPU');
  el('text', { x: 16, y: (T + B) / 2, 'font-size': 14, fill: muted, 'text-anchor': 'middle', transform: `rotate(-90 16 ${(T + B) / 2})` }, svg, 'camera error, ATE (m)');
  el('text', { x: R - 4, y: T + 6, 'font-size': 12.5, fill: faint, 'text-anchor': 'end' }, svg, 'bubble area: GPU memory');
  el('text', { x: L + 10, y: B - 10, 'font-size': 12.5, fill: faint }, svg, '↙ faster and more accurate');
  const g = el('g', {}, svg);
  for (const [n, ms, ate, gb] of BUB.base) {
    el('circle', { cx: lx(ms), cy: ly(ate), r: rr(gb), fill: '#c3cad4', 'fill-opacity': 0.75, stroke: '#fff', 'stroke-width': 1.2 }, g);
    el('text', { x: lx(ms) + rr(gb) + 6, y: ly(ate) + 4, 'font-size': 13.5, fill: muted }, g, n);
  }
  el('path', { d: BUB.ours.map(([, ms, ate], i) => `${i ? 'L' : 'M'}${lx(ms).toFixed(1)},${ly(ate).toFixed(1)}`).join(''), fill: 'none', stroke: acc, 'stroke-width': 1.4, 'stroke-dasharray': '4 3' }, g);
  for (const [n, ms, ate, gb] of BUB.ours) {
    el('circle', { cx: lx(ms), cy: ly(ate), r: rr(gb), fill: acc, 'fill-opacity': 0.9, stroke: '#fff', 'stroke-width': 1.2 }, g);
    el('text', { x: lx(ms), y: ly(ate) - rr(gb) - 5, 'font-size': 12, fill: acc, 'text-anchor': 'middle', class: 'mono' }, g, n);
  }
  const [, msL, ateL, gbL] = BUB.ours[2];
  el('text', { x: lx(msL), y: ly(ateL) + rr(gbL) + 17, 'font-size': 15, 'font-weight': 600, fill: acc, 'text-anchor': 'middle' }, g, 'Solv3R');
}

// ------------------------------------------------------------------ one card per setting (#settings): text left, clip right, tokens under it
async function initSet(card) {
  const vid = $('video', card), k = $('.set-k', card), frames = card.dataset.mode === 'frames';
  let T;
  try { T = await getJSON(`${card.dataset.src}.json`); } catch (e) { console.warn('setting:', e.message); return; }
  const S = new Strip(T, $('.set-photos', card), $('.set-tokens', card), frames ? 0.95 : 0.86);
  playClips(card, [vid], (still) => {
    const t = still ? T.duration - 0.05 : vid.currentTime, c = S.update(t);
    k.textContent = frames ? `frame ${String(S.arrived(t)).padStart(3, '0')}` : callStr(c);
  });
}

// ------------------------------------------------------------------ "Any order, no matter." (Palace): one clip in segments, mode tabs above, tokens below
async function initAnyOrder(box) {
  const vid = $('video', box), tabs = $('.ao-tabs', box), k = $('.ao-k', box);
  let T;
  try { T = await getJSON(`${box.dataset.src}.json`); } catch (e) { console.warn('any order:', e.message); return; }
  const S = new Strip(T, $('.ao-photos', box), $('.ao-tokens', box), 0.9);
  const bt = T.segments.map((g) => {
    const b = document.createElement('button'); b.className = 'ao-tab'; b.setAttribute('role', 'tab'); b.textContent = g.label;
    b.addEventListener('click', () => { vid.currentTime = g.t0 + 0.05; vid.play().catch(() => {}); });
    tabs.appendChild(b); return b;
  });
  playClips(box, [vid], (still) => {
    const t = still ? T.duration - 0.05 : vid.currentTime, c = S.update(t);
    const i = Math.max(0, T.segments.findIndex((g) => t >= g.t0 && t < g.t1)), g = T.segments[i];
    bt.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    if (!k) return;
    if (g.count === 'call') k.textContent = callStr(c);
    else if (g.count === 'frame') k.textContent = `frame ${String(T.tokens.filter((o) => o.arrive >= g.t0 && o.arrive <= t).length).padStart(3, '0')}`;
    else k.textContent = '';
  });
}

function init() {
  initCrossfades();
  const ev = $('#every'); if (ev) { if ($('.ev3', ev)) initEvery3(ev); else initEvery2(ev); }
  const mt = $('#method .mt'); if (mt) initMethod(mt);
  const sc = $('.sc'); if (sc) initStreamCard(sc);
  const bu = $('#bubble'); if (bu) initBubble(bu);
  for (const c of $$('.set-card')) initSet(c);
  const ao = $('.ao'); if (ao) initAnyOrder(ao);
  for (const v of $$('#abilities .media > .vt video')) playClips(v.closest('.vt'), [v], () => {});
  const p = $('#pipe-anim'); if (p) initPipeline(p);
  const c = $('#cache-anim'); if (c) initCache(c);
  const d = $('#deep-anim'); if (d) initDeep(d, DEEP);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
