// An illustrative wordmark inspired by the any-order reconstruction video.
// Three batches add local surfaces, each followed by three shared updates.
// This is a procedural title animation, not an output of the learned model.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const host = document.querySelector('#title-wordmark');
if (host) initialize().catch(() => {
  host.classList.remove('is-ready');
  host.classList.add('is-fallback');
});

async function initialize() {
  const canvas = host.querySelector('canvas');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const response = await fetch(new URL('./wordmark-font.json', import.meta.url));
  if (!response.ok) throw new Error('Title font unavailable');
  const font = new FontLoader().parse(await response.json());
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-7, 7, 2, -2, .1, 100);
  camera.position.set(0, 5, 24);
  camera.lookAt(0, 0, 0);
  const sculpture = new THREE.Group();
  sculpture.rotation.set(.02, -.13, -.01);
  scene.add(sculpture);

  const surface = new TextGeometry('Solv3R', {
    font, size: 2, height: .65, curveSegments: 20, steps: 1,
    bevelEnabled: true, bevelThickness: .09, bevelSize: .055, bevelSegments: 5,
  });
  surface.center();
  surface.computeBoundingBox();
  const wordWidth = surface.boundingBox.max.x - surface.boundingBox.min.x;
  const halfWidth = wordWidth / 2;
  const positions = surface.attributes.position;
  const normals = surface.attributes.normal;

  // Area-weighted sampling preserves the same points and texture throughout.
  const areas = new Float64Array(positions.count / 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let totalArea = 0;
  for (let i = 0; i < areas.length; i++) {
    a.fromBufferAttribute(positions, i * 3);
    b.fromBufferAttribute(positions, i * 3 + 1).sub(a);
    c.fromBufferAttribute(positions, i * 3 + 2).sub(a);
    totalArea += b.cross(c).length() * .5;
    areas[i] = totalArea;
  }
  let randomState = 317;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  const clamp = x => Math.max(0, Math.min(1, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  const stages = [0, .48, .96];
  const updatesPerStage = 3;
  const updateDelay = .19;
  const updateSpacing = .105;
  const updateDuration = .065;
  const settleStart = 1.43;
  const settleDuration = .10;
  const solveEnd = 1.48;
  const duration = 1.68;
  const cameraRandom = key => { const n = Math.sin(key * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
  // Each camera observes one bounded patch. Top/bottom regions of the letters
  // arrive in different batches, leaving actual missing geometry between stages.
  const views = [
    { stage: 0, x: -.80, targetY: .52 },
    { stage: 0, x: .04,  targetY: .42 },
    { stage: 0, x: .38,  targetY: -.52 },
    { stage: 0, x: -.21, targetY: .52 },
    { stage: 1, x: -.47, targetY: -.42 },
    { stage: 1, x: .78,  targetY: .52 },
    { stage: 1, x: -.21, targetY: -.52 },
    { stage: 1, x: .04,  targetY: -.42 },
    { stage: 2, x: -.80, targetY: -.52 },
    { stage: 2, x: -.47, targetY: .42 },
    { stage: 2, x: .38,  targetY: .52 },
    { stage: 2, x: .78,  targetY: -.52 },
  ].map((view, index) => {
    // Deterministic scatter in 3D, including over the letters. The projected
    // height stays within the title, without arranging cameras into rows.
    const key = index * 11 + 7;
    const z = .6 + cameraRandom(key) * 2.5;
    const x = Math.max(-halfWidth * .98, Math.min(halfWidth * .98,
      view.x * halfWidth + (cameraRandom(key + 1) - .5) * 1.65));
    const y = z * .20 + (cameraRandom(key + 2) - .5) * 2.15;
    return { ...view, at: stages[view.stage], roll: (cameraRandom(key + 3) - .5) * 1.1,
      origin: new THREE.Vector3(x, y, z) };
  });
  // Short movements separated by holds make the iterative updates readable.
  function solverCalls(time) {
    let calls = 0;
    for (const start of stages) {
      for (let k = 0; k < updatesPerStage; k++) {
        calls += smooth((time - start - updateDelay - k * updateSpacing) / updateDuration);
      }
    }
    return calls;
  }
  const count = 96000;
  const points = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const viewIds = new Float32Array(count);
  const arrivals = new Float32Array(count);
  const firstCalls = new Float32Array(count);
  const seeds = new Float32Array(count);
  const rays = new Float32Array(count * 3);
  const spread = new Float32Array(count * 3);
  const point = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const pick = random() * totalArea;
    let lo = 0, hi = areas.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < pick) lo = mid + 1; else hi = mid; }
    const tri = lo * 3;
    const u = Math.sqrt(random()), v = random();
    const weights = [1 - u, u * (1 - v), u * v];
    point.set(0, 0, 0); n.set(0, 0, 0);
    for (let j = 0; j < 3; j++) {
      a.fromBufferAttribute(positions, tri + j);
      b.fromBufferAttribute(normals, tri + j);
      point.addScaledVector(a, weights[j]); n.addScaledVector(b, weights[j]);
    }
    n.normalize();
    const grain = random();
    // Fine grain, small pits and mineral variation fixed to the surface.
    const mineral = Math.sin(point.x * 5.4 + Math.sin(point.y * 4.7)) * Math.sin(point.y * 7.5 + point.z * 3);
    const fleck = Math.sin(point.x * 107 + point.z * 53) * Math.sin(point.y * 91 - point.x * 23);
    const tone = .065 * mineral + .035 * fleck + .11 * (grain - .5) - (grain < .055 ? .17 : 0);
    colors.set([linear(clamp(.86 + tone * .30)), linear(clamp(.60 + tone * .30)), linear(clamp(.44 + tone * .30))], i * 3);
    point.addScaledVector(n, (grain - .5) * .005);
    points.set([point.x, point.y, point.z], i * 3);
    normal.set([n.x, n.y, n.z], i * 3);
    // Overlapping, irregular coverage avoids slicing letters into solid blocks.
    const patchX = point.x / halfWidth + .035 * Math.sin(point.y * 8 + point.x * 3);
    const patchY = point.y + .13 * Math.sin(point.x * 4.7 + point.z * 7)
      + .045 * Math.sin(point.x * 17 - point.y * 11);
    let best = Infinity, view = 0;
    views.forEach((candidate, j) => {
      const dx = (patchX - candidate.x) / .26;
      const dy = (patchY - candidate.targetY) / .70;
      const score = dx * dx + dy * dy + random() * .30;
      if (score < best) { best = score; view = j; }
    });
    viewIds[i] = view;
    arrivals[i] = views[view].at + .10 + random() * .015;
    firstCalls[i] = views[view].stage * updatesPerStage;
    seeds[i] = random();
    // Depth errors follow the observing camera's rays, with independent smaller
    // lateral errors. These are fixed observations, not fresh random noise per frame.
    a.copy(point).sub(views[view].origin).normalize();
    rays.set([a.x, a.y, a.z], i * 3);
    spread.set([(random() - .5) * .32, (random() - .5) * .26, (random() - .5) * .38], i * 3);
  }
  surface.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aView', new THREE.BufferAttribute(viewIds, 1));
  geometry.setAttribute('aArrival', new THREE.BufferAttribute(arrivals, 1));
  geometry.setAttribute('aFirstCall', new THREE.BufferAttribute(firstCalls, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aRay', new THREE.BufferAttribute(rays, 3));
  geometry.setAttribute('aSpread', new THREE.BufferAttribute(spread, 3));

  const elapsed = { value: motion.matches ? duration : 0 };
  const calls = { value: motion.matches ? stages.length * updatesPerStage : 0 };
  const settled = { value: motion.matches ? 1 : 0 };
  const diameter = { value: 1.4 };
  const material = new THREE.ShaderMaterial({
    uniforms: { uElapsed: elapsed, uSize: diameter, uCalls: calls, uSettled: settled },
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute float aView;
      attribute float aArrival;
      attribute float aFirstCall;
      attribute float aSeed;
      attribute vec3 aRay;
      attribute vec3 aSpread;
      uniform float uElapsed;
      uniform float uSize;
      uniform float uCalls;
      uniform float uSettled;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying float vPresence;
      varying float vSeed;
      float hash(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
      vec3 rotateY(vec3 p, float a) { return vec3(cos(a)*p.x + sin(a)*p.z, p.y, -sin(a)*p.x + cos(a)*p.z); }
      void main() {
        float localCalls = max(0.0, uCalls - aFirstCall - aSeed * .12);
        float unresolved = 1.0 - uSettled;
        float residual = pow(.57, localCalls) * unresolved;
        // Every shared update also corrects already visible, older regions.
        float sharedResidual = pow(.90, uCalls) * unresolved;
        float id = aView + 1.0;
        vec3 error = vec3((hash(id)-.5)*.16, (hash(id+9.0)-.5)*.10, (hash(id+19.0)-.5)*.20);
        float angle = (hash(id+31.0)-.5) * .055 * residual;
        vec3 p = rotateY(position, angle) + error * residual;
        // A coarse, locally warped depth field plus per-point depth uncertainty.
        // Different decay rates let points settle through distinct 3D trajectories.
        float depthField = .34 * sin(position.x * 4.1 + position.y * 6.3 + id * .8)
          + .16 * sin(position.y * 13.7 + position.z * 9.1 + id)
          + (aSeed - .5) * 1.15;
        float depthResidual = pow(.47 + aSeed * .19, localCalls) * unresolved;
        float lateralResidual = pow(.34 + aSeed * .14, localCalls) * unresolved;
        float correction = (aSeed - .5) * .22 * sin(localCalls * 1.9 + aSeed * 2.0);
        p += aRay * (depthField + correction) * depthResidual;
        p += aSpread * lateralResidual;
        p += normal * sin(position.x * 7.0 + position.y * 9.0 + id) * .12 * depthResidual;
        p += vec3(position.y * .055, sin(position.x * .7) * .09, position.x * .025) * sharedResidual;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vColor = color;
        vNormal = normalize(normalMatrix * rotateY(normal, angle));
        float density = mix(.55 + .45 * (1.0 - pow(.52, localCalls)), 1.0, uSettled);
        vPresence = smoothstep(aArrival, aArrival + .06, uElapsed) * density;
        vSeed = aSeed;
        gl_PointSize = uSize * mix(.80, 1.0, max(uSettled, smoothstep(0.0, 2.5, localCalls)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying vec3 vNormal;
      varying float vPresence;
      varying float vSeed;
      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        if (dot(uv, uv) > 1.0 || vSeed >= vPresence) discard;
        vec3 n = normalize(vNormal);
        float diffuse = max(0.0, dot(n, normalize(vec3(-.45, .65, 1.0))));
        float top = max(0.0, n.y);
        float specular = pow(max(0.0, dot(n, normalize(vec3(-.3, .55, 1.8)))), 32.0);
        vec3 lit = vColor * (.50 + diffuse * .66 + top * .12) + specular * .045;
        gl_FragColor = vec4(lit, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const cloud = new THREE.Points(geometry, material);
  cloud.frustumCulled = false;
  sculpture.add(cloud);

  // Cameras stay readable on white throughout the solve, then fade away together.
  const cameras = views.map(view => {
    const vertices = [];
    const apex = [0, 0, 0];
    const corners = [[-.24,-.15,-.36],[.24,-.15,-.36],[.24,.15,-.36],[-.24,.15,-.36]];
    for (let i = 0; i < 4; i++) vertices.push(...apex, ...corners[i], ...corners[i], ...corners[(i + 1) % 4]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    // Explicit linear color avoids changing the gallery's global color settings.
    const color = new THREE.Color().setRGB(linear(.40), linear(.32), linear(.27));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    const wire = new THREE.LineSegments(g, m);
    wire.renderOrder = 2;
    const base = view.origin.clone();
    const aim = new THREE.Vector3(view.x * halfWidth, view.targetY, 0);
    const orientation = new THREE.Matrix4();
    wire.position.copy(base);
    wire.quaternion.setFromRotationMatrix(orientation.lookAt(base, aim, wire.up));
    wire.rotateZ(view.roll);
    sculpture.add(wire);
    return { wire, view, base, aim, orientation };
  });

  let visible = true, frame = 0, previous = 0, lost = false;
  let tiltX = 0, tiltY = 0;
  const target = { x: 0, y: 0 };
  function render(now) {
    frame = 0;
    if (!visible || document.hidden || lost) { previous = 0; return; }
    const dt = previous ? Math.min((now - previous) / 1000, .08) : 0;
    previous = now;
    if (!motion.matches) elapsed.value = Math.min(duration, elapsed.value + dt);
    calls.value = solverCalls(elapsed.value);
    settled.value = smooth((elapsed.value - settleStart) / settleDuration);
    tiltX += (target.x - tiltX) * .12; tiltY += (target.y - tiltY) * .12;
    sculpture.rotation.set(.02 + tiltY, -.13 + tiltX, -.01);
    const cameraFade = 1 - smooth((elapsed.value - solveEnd) / (duration - solveEnd));
    for (const { wire, view, base, aim, orientation } of cameras) {
      const age = elapsed.value - view.at;
      // New cameras lead the surface patches; older cameras recede between batches.
      const appears = smooth(age / .05);
      wire.material.opacity = appears * (.22 + .56 * Math.exp(-Math.max(0, age) * 4.5)) * cameraFade;
      wire.visible = wire.material.opacity > .001;
      const correction = Math.pow(.57, Math.max(0, calls.value - view.stage * updatesPerStage)) * (1 - settled.value);
      wire.position.copy(base);
      wire.position.x += .12 * correction;
      wire.position.y += .06 * correction;
      wire.quaternion.setFromRotationMatrix(orientation.lookAt(wire.position, aim, wire.up));
      wire.rotateZ(view.roll);
    }
    renderer.render(scene, camera);
    if (elapsed.value < duration || Math.abs(target.x - tiltX) + Math.abs(target.y - tiltY) > .0001) requestFrame();
    else previous = 0;
  }
  function requestFrame() {
    if (!frame && visible && !document.hidden && !lost) frame = requestAnimationFrame(render);
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    diameter.value = dpr * Math.max(1.4, 1.85 * width / 470);
    const viewWidth = wordWidth * 1.24;
    const viewHeight = viewWidth * height / width;
    camera.left = -viewWidth / 2; camera.right = viewWidth / 2;
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    requestFrame();
  }
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(entries => {
    visible = entries.at(-1).isIntersecting;
    if (visible) requestFrame(); else previous = 0;
  }).observe(host);
  document.addEventListener('visibilitychange', () => { previous = 0; requestFrame(); });
  motion.addEventListener('change', () => {
    if (motion.matches) { elapsed.value = duration; target.x = 0; target.y = 0; }
    requestFrame();
  });
  host.addEventListener('pointermove', event => {
    if (motion.matches || event.pointerType !== 'mouse') return;
    const rect = host.getBoundingClientRect();
    target.x = ((event.clientX - rect.left) / rect.width - .5) * .08;
    target.y = ((event.clientY - rect.top) / rect.height - .5) * .04;
    requestFrame();
  });
  host.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; requestFrame(); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost = true;
    host.classList.remove('is-ready'); host.classList.add('is-fallback');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false; elapsed.value = duration;
    host.classList.remove('is-fallback'); host.classList.add('is-ready'); requestFrame();
  });
  resize();
  cancelAnimationFrame(frame);
  frame = 0;
  render(performance.now());
  host.classList.remove('is-fallback'); host.classList.add('is-ready');
  requestFrame();
}
