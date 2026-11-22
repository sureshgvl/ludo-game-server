/* 3D board renderer for the Ludo web client. Bundled with esbuild into public/vendor/board3d.js
   (npm run build:web). The game logic and animation state live in app.js; this file only draws. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const PAL = [
  { main: 0xe53935, light: 0xff8a80, dark: 0x8d0f0c },
  { main: 0x2e9d4a, light: 0x8be3a0, dark: 0x125224 },
  { main: 0xf9c70c, light: 0xfff09a, dark: 0xa87a00 },
  { main: 0x1e6fe0, light: 0x8fc0ff, dark: 0x0a3487 },
];
const TRACK = [
  [1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],[7,0],[8,0],
  [8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],[14,8],
  [13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14],[6,14],
  [6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],[0,6],
];
const START = [0, 13, 26, 39];
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const HOME_COL = [
  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  [[7,1],[7,2],[7,3],[7,4],[7,5]],
  [[13,7],[12,7],[11,7],[10,7],[9,7]],
  [[7,13],[7,12],[7,11],[7,10],[7,9]],
];
const YARD_ORIGIN = [[0,0],[9,0],[9,9],[0,9]];
const YARD_SPOTS = [[2,2],[4,2],[2,4],[4,4]];

const wx = (gx) => gx - 7.5;
const TILE_TOP = 0.12;
const YARD_TOP = 0.36;

function starShape(R) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? R * 0.45 : R;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function create(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    return null;
  }
  if (!renderer.getContext()) return null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 120);
  const camDir = new THREE.Vector3(0, 0.84, 0.54).normalize();
  const camTarget = new THREE.Vector3(0, 0, 0.9);

  // ---- lights
  scene.add(new THREE.HemisphereLight(0xcdbbff, 0x1a0a40, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(5, 16, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);
  const rim = new THREE.PointLight(0x8a63ff, 90, 40);
  rim.position.set(-8, 7, -9);
  scene.add(rim);
  const fill = new THREE.PointLight(0xffb36b, 40, 40);
  fill.position.set(9, 5, 10);
  scene.add(fill);

  // ---- materials
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf7f4ff, roughness: 0.38, metalness: 0.04 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.25, metalness: 0.95, emissive: 0x6a4300, emissiveIntensity: 0.4 });
  const silverStar = new THREE.MeshStandardMaterial({ color: 0xb7aee6, roughness: 0.3, metalness: 0.6 });
  const colorMats = PAL.map((p) => new THREE.MeshStandardMaterial({ color: p.main, roughness: 0.28, metalness: 0.15, emissive: p.dark, emissiveIntensity: 0.25 }));
  const yardMats = PAL.map((p) => new THREE.MeshStandardMaterial({ color: p.main, roughness: 0.3, metalness: 0.2, emissive: p.main, emissiveIntensity: 0 }));

  // ---- board
  const board = new THREE.Group();
  scene.add(board);

  // frame: gold rim under a dark violet slab
  const rimShape = roundedRectShape(16.9, 16.9, 1.3);
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.55, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 4, curveSegments: 24 });
  rimGeo.rotateX(-Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, goldMat);
  rimMesh.position.y = -0.62;
  rimMesh.receiveShadow = true; rimMesh.castShadow = true;
  board.add(rimMesh);
  const slabGeo = new THREE.ExtrudeGeometry(roundedRectShape(16.2, 16.2, 1.0), { depth: 0.2, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 24 });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x2a1670, roughness: 0.4, metalness: 0.5 }));
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  board.add(slab);

  const tileGeo = new RoundedBoxGeometry(0.94, 0.16, 0.94, 3, 0.07);
  function tile(c, r, mat) {
    const m = new THREE.Mesh(tileGeo, mat);
    m.position.set(wx(c + 0.5), TILE_TOP - 0.08, wx(r + 0.5));
    m.receiveShadow = true; m.castShadow = false;
    board.add(m);
    return m;
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.34), { depth: 0.03, bevelEnabled: false });
  starGeo.rotateX(-Math.PI / 2);
  function star(gx, gy, mat) {
    const m = new THREE.Mesh(starGeo, mat);
    m.position.set(wx(gx), TILE_TOP + 0.002, wx(gy));
    m.receiveShadow = true;
    board.add(m);
  }

  TRACK.forEach((t, i) => {
    const seat = START.indexOf(i);
    tile(t[0], t[1], seat >= 0 ? colorMats[seat] : whiteMat);
    if (SAFE.indexOf(i) >= 0) star(t[0] + 0.5, t[1] + 0.5, seat >= 0 ? whiteMat : silverStar);
  });
  HOME_COL.forEach((cells, seat) => cells.forEach((c) => tile(c[0], c[1], colorMats[seat])));

  // direction chevrons at each home-column entrance
  const chevron = new THREE.Shape();
  chevron.moveTo(0.3, 0); chevron.lineTo(-0.18, 0.26); chevron.lineTo(-0.18, -0.26); chevron.closePath();
  const chevGeo = new THREE.ShapeGeometry(chevron); chevGeo.rotateX(-Math.PI / 2);
  [[0.5, 7.5, 0], [7.5, 0.5, Math.PI / 2], [14.5, 7.5, Math.PI], [7.5, 14.5, -Math.PI / 2]].forEach(([gx, gy, a]) => {
    const m = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xb7aee6 }));
    m.position.set(wx(gx), TILE_TOP + 0.003, wx(gy));
    m.rotation.y = -a;
    board.add(m);
  });

  // yards
  const yardGeo = new RoundedBoxGeometry(6, 0.5, 6, 4, 0.12);
  const plateGeo = new RoundedBoxGeometry(4.1, 0.14, 4.1, 4, 0.5);
  const socketGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 32);
  const socketRim = new THREE.TorusGeometry(0.5, 0.05, 10, 32); socketRim.rotateX(Math.PI / 2);
  const yardMeshes = [];
  YARD_ORIGIN.forEach((o, seat) => {
    const y = new THREE.Mesh(yardGeo, yardMats[seat]);
    y.position.set(wx(o[0] + 3), 0.0, wx(o[1] + 3));
    y.receiveShadow = true; y.castShadow = true;
    board.add(y); yardMeshes.push(y);
    const plate = new THREE.Mesh(plateGeo, whiteMat);
    plate.position.set(wx(o[0] + 3), 0.27, wx(o[1] + 3));
    plate.receiveShadow = true;
    board.add(plate);
    YARD_SPOTS.forEach((sp) => {
      const s = new THREE.Mesh(socketGeo, new THREE.MeshStandardMaterial({ color: PAL[seat].light, roughness: 0.35, metalness: 0.1, emissive: PAL[seat].main, emissiveIntensity: 0.15 }));
      s.position.set(wx(o[0] + sp[0] + 0.5), 0.36, wx(o[1] + sp[1] + 0.5));
      s.receiveShadow = true;
      board.add(s);
      const ring = new THREE.Mesh(socketRim, goldMat);
      ring.position.set(s.position.x, 0.38, s.position.z);
      board.add(ring);
    });
  });

  // centre: four coloured triangles and a gem
  const C = [7.5, 7.5];
  [[[6,6],[6,9]], [[6,6],[9,6]], [[9,6],[9,9]], [[6,9],[9,9]]].forEach((pair, seat) => {
    const sh = new THREE.Shape();
    sh.moveTo(wx(pair[0][0]), -wx(pair[0][1]));
    sh.lineTo(wx(pair[1][0]), -wx(pair[1][1]));
    sh.lineTo(wx(C[0]), -wx(C[1]));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, colorMats[[0, 1, 2, 3][seat]]);
    m.position.y = -0.02;
    m.receiveShadow = true; m.castShadow = true;
    board.add(m);
  });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), new THREE.MeshPhysicalMaterial({
    color: 0xfff1a8, roughness: 0.08, metalness: 0.9, emissive: 0xffb300, emissiveIntensity: 0.9, clearcoat: 1,
  }));
  gem.position.set(0, 1.0, 0);
  gem.castShadow = true;
  board.add(gem);
  const gemGlow = new THREE.PointLight(0xffd27a, 8, 6);
  gemGlow.position.set(0, 1.4, 0);
  board.add(gemGlow);

  // ---- pawns
  const profile = [[0, 0], [0.44, 0], [0.5, 0.05], [0.48, 0.13], [0.34, 0.2], [0.22, 0.36], [0.17, 0.52], [0.25, 0.6], [0.31, 0.72], [0.28, 0.86], [0.18, 0.96], [0, 1.0]]
    .map((p) => new THREE.Vector2(p[0], p[1]));
  const pawnGeo = new THREE.LatheGeometry(profile, 36);
  const collarGeo = new THREE.TorusGeometry(0.27, 0.05, 10, 30); collarGeo.rotateX(Math.PI / 2);
  const glowGeo = new THREE.TorusGeometry(0.62, 0.07, 10, 40); glowGeo.rotateX(Math.PI / 2);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd34d });
  const pawnMats = PAL.map((p) => new THREE.MeshPhysicalMaterial({ color: p.main, roughness: 0.18, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, emissive: p.dark, emissiveIntensity: 0.3 }));
  const shadowDisc = new THREE.CircleGeometry(0.5, 24); shadowDisc.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });

  const pawns = {};
  function pawnFor(seat, idx) {
    const key = seat + ":" + idx;
    if (pawns[key]) return pawns[key];
    const g = new THREE.Group();
    const body = new THREE.Mesh(pawnGeo, pawnMats[seat]);
    body.scale.set(0.98, 1.02, 0.98);
    body.castShadow = true; body.receiveShadow = true;
    const collar = new THREE.Mesh(collarGeo, goldMat);
    collar.position.y = 0.58;
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 0.04;
    glow.visible = false;
    g.add(body, collar, glow);
    const sh = new THREE.Mesh(shadowDisc, shadowMat.clone());
    scene.add(g, sh);
    return (pawns[key] = { g, glow, shadow: sh });
  }

  // ---- capture effects
  const fxPool = [];
  for (let i = 0; i < 6; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false;
    const dots = [];
    for (let k = 0; k < 10; k++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      d.visible = false; scene.add(d); dots.push(d);
    }
    scene.add(ring);
    fxPool.push({ ring, dots });
  }

  // ---- sizing
  let W = 0, H = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w; H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const fitW = 18.6 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const fitH = 15.6 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const dist = Math.max(fitW, fitH);
    camera.position.copy(camTarget).addScaledVector(camDir, dist);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Adaptive quality: if the first frames are slow, drop to simpler rendering.
  let frames = 0, slow = 0, lastT = 0, lowQuality = false;
  function watchPerformance(now) {
    if (lowQuality) return;
    if (lastT) { frames++; if (now - lastT > 45) slow++; }
    lastT = now;
    if (frames === 60) {
      if (slow > 30) {
        lowQuality = true;
        renderer.setPixelRatio(1);
        renderer.shadowMap.enabled = false;
        sun.castShadow = false;
        W = 0; // force a resize with the new pixel ratio
        scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      }
      frames = 0; slow = 0;
      if (!lowQuality) lastT = 0;
    }
  }

  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
  const hit = new THREE.Vector3();

  function render(frame) {
    resize();
    watchPerformance(frame.time);
    const t = frame.time / 1000, pulse = frame.pulse;
    gem.rotation.y = t * 1.2;
    gem.position.y = 1.0 + Math.sin(t * 2) * 0.08;
    yardMeshes.forEach((m, seat) => { yardMats[seat].emissiveIntensity = frame.turnSeat === seat ? 0.1 + 0.22 * pulse : 0; });

    const seen = {};
    frame.pieces.forEach((p) => {
      const o = pawnFor(p.seat, p.idx);
      seen[p.seat + ":" + p.idx] = true;
      const baseY = p.yard ? YARD_TOP : p.home ? 0.3 : TILE_TOP;
      const x = wx(p.gx), z = wx(p.gy);
      const scale = p.scale || 1;
      o.g.visible = true;
      o.g.position.set(x, baseY + (p.lift || 0) * 0.9, z);
      o.g.scale.setScalar(scale * 0.9);
      o.glow.visible = !!p.legal;
      if (p.legal) { const s = 1 + pulse * 0.25; o.glow.scale.set(s, 1, s); }
      o.shadow.visible = true;
      o.shadow.position.set(x, baseY + 0.01, z);
      const sh = scale * 0.9 * (1 - Math.min(0.5, (p.lift || 0) * 0.35));
      o.shadow.scale.set(sh * 1.1, 1, sh * 1.1);
      o.shadow.material.opacity = 0.38 - Math.min(0.2, (p.lift || 0) * 0.15);
    });
    Object.keys(pawns).forEach((k) => { if (!seen[k]) { pawns[k].g.visible = false; pawns[k].shadow.visible = false; } });

    fxPool.forEach((f) => { f.ring.visible = false; f.dots.forEach((d) => (d.visible = false)); });
    (frame.fx || []).slice(0, fxPool.length).forEach((e, i) => {
      const f = fxPool[i], u = e.t, x = wx(e.gx), z = wx(e.gy);
      f.ring.visible = true;
      f.ring.position.set(x, 0.3, z);
      f.ring.scale.setScalar(1 + u * 4);
      f.ring.material.opacity = 0.9 * (1 - u);
      f.dots.forEach((d, k) => {
        const a = (k / f.dots.length) * Math.PI * 2 + u;
        const r = 0.2 + u * 1.5;
        d.visible = true;
        d.position.set(x + Math.cos(a) * r, 0.4 + Math.sin(u * Math.PI) * 1.4, z + Math.sin(a) * r);
        d.material.color.setHex(e.col);
        d.material.opacity = 1 - u;
        d.scale.setScalar(1 - u * 0.6);
      });
    });

    renderer.render(scene, camera);
  }

  /** Canvas pixel position (client coordinates) of a board position given in cells. */
  function project(gx, gy) {
    resize();
    const v = new THREE.Vector3(wx(gx), 0.5, wx(gy)).project(camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  /** Board position in cells under a client pixel. */
  function pick(clientX, clientY) {
    resize();
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return [hit.x + 7.5, hit.z + 7.5];
  }

  return { render, project, pick, resize };
}
