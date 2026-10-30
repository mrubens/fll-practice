// three.js view of the table and the robot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TABLE } from './world.js';
import { MECHANISMS } from './mechanisms.js';

const DEG = Math.PI / 180;
const LDU = 0.04; // 1 LDraw unit = 0.4 mm = 0.04 cm

// ---- LDraw models (real LEGO geometry) ----
let ldrawLoader = null, ldrawMaterials = null;
const ldrawCache = new Map();
function ldraw() {
  if (!ldrawLoader) {
    ldrawLoader = new LDrawLoader();
    ldrawLoader.smoothNormals = true;
    ldrawLoader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    ldrawMaterials = ldrawLoader.preloadMaterials('models/LDConfig.ldr').catch(() => {});
  }
  return ldrawLoader;
}
/** Merge every mesh of an LDraw group into one mesh per material (far fewer draw calls). */
function flattenLDraw(group) {
  group.updateMatrixWorld(true);
  return flattenObjects([group]);
}
/** Merge the meshes under the given objects (matrixWorld must be current) into one mesh per material. */
function flattenObjects(objects) {
  const byMaterial = new Map();
  for (const root of objects) root.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    if (Array.isArray(o.material)) o.material = o.material[0];   // multi-material parts: keep the first (rare)
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    if (geo.index) { const g2 = geo.toNonIndexed(); geo.dispose(); byMaterial.set(o.material, (byMaterial.get(o.material) || []).concat(g2)); }
    else byMaterial.set(o.material, (byMaterial.get(o.material) || []).concat(geo));
  });
  const out = new THREE.Group();
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

/** True when a build has the LEGO Driving Base's geometry, whatever its ports: small wheels, 11.2 cm track, flat hub. */
function isDrivingBase(build) {
  const a = build.attachment || {};
  return build.wheel === '5.6' && Math.abs(build.track - 11.2) < 0.05 && build.hub !== 'upright' && (a.module === 'none' || a.module === 'arm');
}

/**
 * A stand-in for a model while its LEGO parts load: the model's outline, with a translucent block that
 * builds up inside it layer by layer under a bright scan line, then starts over. Its origin is on the mat.
 */
function shimmerBox(w, h, d) {
  const g = new THREE.Group();
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: 0x7FA8E0, transparent: true, opacity: 0.8 }));
  edges.position.y = h / 2;
  const fill = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), new THREE.MeshStandardMaterial({ color: 0x9FBCE8, emissive: 0x6F9BE0, emissiveIntensity: 0.35, transparent: true, opacity: 0.45, roughness: 0.3, depthWrite: false }));
  const scan = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.18, d + 0.4), new THREE.MeshBasicMaterial({ color: 0xE8F2FF, transparent: true, opacity: 0.95 }));
  g.add(edges, fill, scan);
  g.userData = { shimmer: true, h, fill, scan, edges, phase: Math.random() };
  return g;
}

/** Load a packed .mpd without flattening; resolves to a fresh clone of the raw part hierarchy (or null). */
const rawCache = new Map();
function loadLDrawRaw(url) {
  if (!rawCache.has(url)) {
    const job = ldrawQueue.then(async () => {
      const loader = ldraw();
      await ldrawMaterials;
      return new Promise((resolve) => loader.load(url, (group) => resolve(group), undefined, (err) => { console.warn('LDraw model failed', url, err); resolve(null); }));
    });
    ldrawQueue = job.catch(() => {});
    rawCache.set(url, job);
  }
  return rawCache.get(url).then((g) => (g ? g.clone() : null));
}

/**
 * Split a raw LDraw model into its mechanism pieces: returns { base: Group, pieces: { name: Group } } with every
 * group in the model's own frame (cm, y up), ready to hang under a holder or a moving piece node.
 */
function splitModel(raw, def) {
  const tmp = new THREE.Group();
  raw.rotation.x = Math.PI; raw.scale.setScalar(LDU);
  tmp.add(raw);
  tmp.updateMatrixWorld(true);
  const names = Object.keys(def.pieces || {});
  const buckets = { base: [] };
  for (const n of names) buckets[n] = [];
  for (const child of raw.children) {
    const bb = new THREE.Box3().setFromObject(child);
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    let color = '';
    child.traverse((m) => { if (!color && m.isMesh) { const mat = Array.isArray(m.material) ? m.material[0] : m.material; color = String(mat.userData.code ?? mat.name); } });
    const info = { color, c: [c.x, c.y, c.z], s: [sz.x, sz.y, sz.z], file: child.userData.fileName || '' };
    const hit = names.find((n) => { try { return def.pieces[n].parts(info); } catch { return false; } });
    buckets[hit || 'base'].push(child);
  }
  const out = { base: flattenObjects(buckets.base), pieces: {} };
  for (const n of names) out.pieces[n] = flattenObjects(buckets[n]);
  return out;
}

// Loads run one after another: LDrawLoader shares one parse cache and parallel loads can race on embedded subparts.
let ldrawQueue = Promise.resolve();
/** Load a packed .mpd once (flattened); resolves to a fresh clone each time, or null when it cannot be loaded. */
export function loadLDrawModel(url) {
  if (!ldrawCache.has(url)) {
    const job = ldrawQueue.then(async () => {
      const loader = ldraw();
      await ldrawMaterials;
      return new Promise((resolve) => loader.load(url, (group) => resolve(flattenLDraw(group)), undefined, (err) => { console.warn('LDraw model failed', url, err); resolve(null); }));
    });
    ldrawQueue = job.catch(() => {});
    ldrawCache.set(url, job);
  }
  return ldrawCache.get(url).then((g) => {
    if (!g) return null;
    const c = g.clone();
    c.traverse((o) => { if (o.isMesh && o.material && typeof o.material.clone === 'function') o.material = o.material.clone(); });   // per-model materials so highlights stay local
    return c;
  });
}
/** Wrap an LDraw group so LDraw's y-down frame becomes y-up and LDU become cm. */
function ldrawToWorld(group) {
  const holder = new THREE.Group();
  group.rotation.x = Math.PI;      // y down -> y up (also flips z: LDraw front -z -> +z)
  group.scale.setScalar(LDU);
  holder.add(group);
  return holder;
}

function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.65, metalness: 0.05 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class Sim3D {
  constructor(container, world, robot) {
    this.container = container;
    this.world = world;
    this.robot = robot;
    this.follow = false;
    this.locked = false;
    this.dragging = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    // Graphics tiers: picked from the device up front, then stepped down automatically if frames get slow.
    this.shimmers = [];
    this.quality = null;
    this.frameEma = 1 / 60;
    this.slowSince = null;
    this.qualityChangedAt = 0;
    this.onQualityChange = null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xE4E8EF);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
    camera.position.set(-40, 210, 150);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    // Touchpad: two-finger scroll pans the view, pinch (ctrl+wheel on Macs) zooms; the mouse wheel still zooms.
    renderer.domElement.addEventListener('wheel', (e) => {
      const touchpad = Math.abs(e.deltaX) > 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY / 100));
      if (e.ctrlKey || !touchpad) return;                 // pinch or a real wheel: OrbitControls zooms
      e.preventDefault(); e.stopImmediatePropagation();
      const dist = camera.position.distanceTo(controls.target);
      const perPx = (2 * dist * Math.tan((camera.fov / 2) * DEG)) / renderer.domElement.clientHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const move = right.multiplyScalar(e.deltaX * perPx).add(up.multiplyScalar(-e.deltaY * perPx));
      camera.position.add(move); controls.target.add(move);
      this.follow = false;
    }, { capture: true, passive: false });
    controls.minDistance = 25;
    controls.maxDistance = 600;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b3, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun = sun;
    sun.position.set(70, 220, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 110, bottom: -110, near: 10, far: 600 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    this.buildTable();
    this.buildRobot();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.installDrag();
    this.matrixDirty = true;
    this.effects = [];           // running model animations / pulses
    this.buildTrail();
    this.buildZoneMarker();
    robot.on('matrix', () => { this.matrixDirty = true; });
    robot.on('build', () => this.buildRobot());
  }

  buildTable() {
    const { scene, world } = this;
    const matTex = new THREE.CanvasTexture(world.matCanvas);
    matTex.colorSpace = THREE.SRGBColorSpace;
    matTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.h), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
    this.matMesh = mat;
    mat.rotation.x = -Math.PI / 2;
    mat.receiveShadow = true;
    scene.add(mat);

    const base = box(TABLE.w + TABLE.wall * 2, 3, TABLE.h + TABLE.wall * 2, 0xB08A5A);
    base.position.y = -1.75;
    scene.add(base);

    const wallColor = 0x2E3440;
    const t = TABLE.wall, hgt = TABLE.wallHeight;
    const long = TABLE.w + t * 2, short = TABLE.h;
    const w1 = box(long, hgt, t, wallColor); w1.position.set(0, hgt / 2, -(TABLE.h / 2 + t / 2));
    const w2 = box(long, hgt, t, wallColor); w2.position.set(0, hgt / 2, TABLE.h / 2 + t / 2);
    const w3 = box(t, hgt, short, wallColor); w3.position.set(-(TABLE.w / 2 + t / 2), hgt / 2, 0);
    const w4 = box(t, hgt, short, wallColor); w4.position.set(TABLE.w / 2 + t / 2, hgt / 2, 0);
    scene.add(w1, w2, w3, w4);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0xD5DAE3, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.01;
    floor.receiveShadow = true;
    scene.add(floor);

    this.matTex = matTex;
    this.obstacleMeshes = [];
    this.pieceNodes = [];
    this.equipmentNodes = [];
    this.buildObstacles();
    this.setQuality(this.detectQuality());
    world.onChange((what) => {
      if (what === 'mat') this.matTex.needsUpdate = true;
      if (what === 'season') this.loadMatTexture();
      if (what === 'season') this.buildObstacles();
    });
  }

  /** Where to start: desktops get everything, touch devices and small CPUs start a tier down. */
  detectQuality() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const maxTex = this.renderer.capabilities.maxTextureSize || 0;
    if (mem <= 2 || cores <= 2) return 'low';
    if (coarse || cores <= 4 || maxTex < 8192) return 'medium';
    return 'high';
  }

  /** Apply a graphics tier: pixel ratio, shadows and the mat texture. */
  setQuality(q, reason) {
    if (q === this.quality) return;
    const prev = this.quality;
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const r = this.renderer;
    if (q === 'high') { r.setPixelRatio(Math.min(dpr, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; this.sun.shadow.mapSize.set(2048, 2048); }
    else if (q === 'medium') { r.setPixelRatio(Math.min(dpr, 1.5)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; this.sun.shadow.mapSize.set(1024, 1024); }
    else { r.setPixelRatio(1); r.shadowMap.enabled = false; }
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.scene.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    this.world.physicsSubsteps = q === 'low' ? 2 : 3;
    if (this.world.physics) this.world.physics.substeps = this.world.physicsSubsteps;
    this.hiResUrl = null;
    this.loadMatTexture();
    this.qualityChangedAt = performance.now();
    this.slowSince = null;
    if (prev && this.onQualityChange) this.onQualityChange(q, reason);
  }

  /** Frame-time watchdog: step the tier down when the page cannot keep up. */
  watchPerformance(dt) {
    if (document.hidden || dt > 0.5 || !this.quality || this.quality === 'low') return;
    this.frameEma = this.frameEma * 0.9 + dt * 0.1;
    const now = performance.now();
    if (now - this.qualityChangedAt < 8000) return;      // settle after a change (textures, shaders)
    if (this.frameEma > 1 / 28) {
      if (this.slowSince === null) this.slowSince = now;
      else if (now - this.slowSince > 2500) this.setQuality(this.quality === 'high' ? 'medium' : 'low', 'slow');
    } else this.slowSince = null;
  }

  /**
   * Texture the mat from the season image itself rather than the sensor canvas: the 16 px/cm image everywhere,
   * and the full-resolution copy on GPUs that can take it (desktops and most laptops). The practice field, which is
   * drawn on the canvas, keeps the canvas texture.
   */
  loadMatTexture() {
    const season = this.world.season;
    if (!season) { this.hiResUrl = null; this.matMesh.material.map = this.matTex; this.matMesh.material.needsUpdate = true; return; }
    const maxTex = this.renderer.capabilities.maxTextureSize || 0;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const url = (season.matHi && maxTex >= 8192 && !coarse && this.quality === 'high') ? season.matHi : season.mat;
    if (!url || this.hiResUrl === url) return;
    this.hiResUrl = url;
    new THREE.TextureLoader().load(url, (tex) => {
      if (this.hiResUrl !== url) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.matMesh.material.map = tex;
      this.matMesh.material.needsUpdate = true;
    });
  }

  buildObstacles() {
    for (const m of this.obstacleMeshes) this.scene.remove(m);
    for (const m of this.obstacleExtras || []) this.scene.remove(m);
    for (const m of this.shimmers.filter((x) => !x.userData.robot)) this.scene.remove(m);
    this.shimmers = this.shimmers.filter((x) => x.userData.robot);
    for (const pn of this.pieceNodes || []) this.scene.remove(pn.node);
    this.obstacleMeshes = [];
    this.obstacleExtras = [];
    this.pieceNodes = [];
    this.buildGeneration = (this.buildGeneration || 0) + 1;
    const generation = this.buildGeneration;
    for (const o of this.world.obstacles) {
      const m = box(o.w, o.h, o.d, o.color);
      m.position.set(o.x, o.h / 2, o.y);
      m.userData.obstacle = o;
      m.visible = !o.model;             // a model entry never shows its collision box unless the file fails
      this.scene.add(m);
      this.obstacleMeshes.push(m);
      let ghost = null;
      if (o.model) {                    // building-up stand-in until the real bricks arrive
        ghost = shimmerBox(o.w, o.h, o.d);
        ghost.position.set(o.x, 0, o.y);
        this.scene.add(ghost);
        this.shimmers.push(ghost);
      }
      const unghost = () => { if (ghost) { this.scene.remove(ghost); this.shimmers = this.shimmers.filter((x) => x !== ghost); } };
      const def = MECHANISMS[o.id];
      if (o.model && def) {
        loadLDrawRaw(o.model).then((raw) => {
          if (generation !== this.buildGeneration) return;
          unghost();
          if (!raw) { m.visible = true; return; }
          const split = splitModel(raw, def);
          const pose = o.modelPose || { x: o.x, y: o.y, heading: 0 };
          const holder = new THREE.Group();
          holder.add(split.base);
          holder.position.set(pose.x, 0, pose.y);
          holder.rotation.y = (pose.heading || 0) * DEG;
          holder.userData.obstacle = o;
          holder.userData.offset = [pose.x - o.x, pose.y - o.y];
          this.scene.add(holder);
          this.obstacleExtras.push(holder);
          for (const [name, pd] of Object.entries(def.pieces || {})) {
            const node = new THREE.Group();
            const inner = new THREE.Group();
            inner.position.set(-pd.anchor[0], -pd.anchor[1], -pd.anchor[2]);
            inner.add(split.pieces[name]);
            node.add(inner);
            node.userData.obstacle = o;
            this.scene.add(node);
            this.pieceNodes.push({ o, name, node, anchor: new THREE.Vector3(...pd.anchor), holder });
          }
          o.hasModel = true;
        });
        continue;
      }
      if (o.model) {
        loadLDrawModel(o.model).then((group) => {
          if (generation !== this.buildGeneration) return;
          unghost();
          if (!group) { m.visible = true; return; }
          const holder = ldrawToWorld(group);
          const pose = o.modelPose || { x: o.x, y: o.y, heading: 0 };
          holder.position.set(pose.x, 0, pose.y);
          holder.rotation.y = (pose.heading || 0) * DEG;   // 0 = facing north, positive = counter-clockwise from above
          holder.userData.obstacle = o;
          holder.userData.offset = [pose.x - o.x, pose.y - o.y];
          this.scene.add(holder);
          this.obstacleExtras.push(holder);
          o.hasModel = true;
        });
      }
    }
  }

  buildRobot() {
    if (this.robotGroup) { this.scene.remove(this.robotGroup); this.robotGroup = null; }
    this.robotBuildGen = (this.robotBuildGen || 0) + 1;   // one generation per build: late loads for an old build are dropped
    const r = this.robot, build = r.build, geom = r.geom;
    this.robotLego = isDrivingBase(build);                 // real bricks: nothing primitive shows until every part is in
    this.robotPending = 0; this.revealRobot = null;
    this.shimmers = this.shimmers.filter((m) => !m.userData.robot);
    const g = new THREE.Group();
    const body = new THREE.Group();          // everything that rides on the wheels
    body.position.y = geom.lift;
    g.add(body);
    const grey = 0xD9DEE6, dark = 0x2A2F3A, yellow = 0xFFD500;
    const halfTrack = geom.track / 2;
    const chassisW = Math.max(13, geom.track + 1.6);

    const chassis = box(16, 2.4, chassisW - 3, grey); chassis.position.set(-0.5, 3.4, 0); body.add(chassis);
    for (const side of [1, -1]) {
      const motor = box(6, 4, 3.6, 0xC3C9D3); motor.position.set(0, 3.2, side * (halfTrack - 2.2)); body.add(motor);
    }

    // Hub: flat (display up) or upright (display facing back, standing on its port end).
    const hubGroup = new THREE.Group();
    const hub = box(11.2, 3.2, 8.8, yellow); hub.position.set(0, 1.6, 0); hubGroup.add(hub);
    const top = box(11, 0.5, 8.6, 0xF7F8FA); top.position.set(0, 3.45, 0); hubGroup.add(top);
    const mc = document.createElement('canvas');
    mc.width = 160; mc.height = 160;
    this.matrixCanvas = mc;
    this.matrixTex = new THREE.CanvasTexture(mc);
    this.matrixTex.colorSpace = THREE.SRGBColorSpace;
    const matrix = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), new THREE.MeshBasicMaterial({ map: this.matrixTex }));
    matrix.rotation.x = -Math.PI / 2; matrix.rotation.z = -Math.PI / 2;
    matrix.position.set(1.6, 3.72, 0);
    hubGroup.add(matrix);
    const btn = (x, z, color, rad = 0.8) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.4, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      m.position.set(x, 3.85, z); hubGroup.add(m); return m;
    };
    btn(-3.3, 2.6, 0xC9CED8); btn(-3.3, -2.6, 0xC9CED8);
    this.centerButton = btn(-3.3, 0, 0xFFFFFF, 1.0);
    if (build.hub === 'upright') { hubGroup.rotation.z = Math.PI / 2; hubGroup.position.set(-4.5, 4.6 + 5.6, 0); }
    else hubGroup.position.set(-1, 4.6, 0);
    body.add(hubGroup);

    // Wheels (in the root group: they sit on the mat whatever the size).
    this.wheels = [];
    for (const side of [1, -1]) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(geom.wheelRadius, geom.wheelRadius, 2.8, 28), new THREE.MeshStandardMaterial({ color: 0x23272F, roughness: 0.9 }));
      tire.rotation.x = Math.PI / 2; tire.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(geom.wheelRadius * 0.6, geom.wheelRadius * 0.6, 3.0, 20), new THREE.MeshStandardMaterial({ color: yellow, roughness: 0.6 }));
      rim.rotation.x = Math.PI / 2;
      const spoke = box(geom.wheelRadius * 0.85, 0.5, 3.1, 0x6B7280);
      wg.add(tire, rim, spoke);
      wg.position.set(0, geom.wheelRadius, side * halfTrack);
      g.add(wg);
      this.wheels.push(wg);
    }
    const caster = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.4 }));
    caster.position.set(-7, 1.4, 0); caster.castShadow = true; g.add(caster);
    if (geom.lift > 0.5) { const leg = box(2, geom.lift, 2, grey); leg.position.set(-7, 2.8 + geom.lift / 2, 0); g.add(leg); }

    // Distance sensor at its mount, facing out.
    const d = geom.distance;
    const ds = new THREE.Group();
    const dsBox = box(2.2, 3.2, 5.2, 0xF7F8FA); ds.add(dsBox);
    for (const z of [1.45, -1.45]) {
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x1F2937, roughness: 0.3 }));
      eye.rotation.z = Math.PI / 2; eye.position.set(1.2, 0, z); ds.add(eye);
    }
    ds.position.set(d.fwd - 1.2, 5.6, d.lat);
    ds.rotation.y = -d.angle * DEG;
    body.add(ds);

    // Color sensor pointing down, with a disc showing what it sees.
    const c = geom.color;
    const cs = box(2.2, 2.4, 2.4, dark); cs.position.set(c.fwd, 2.3, c.lat); body.add(cs);
    const csMount = new THREE.Group(); csMount.position.set(c.fwd, 0, c.lat); body.add(csMount);
    this.legoColorSensor(csMount, cs);
    this.sensorDisc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.sensorDisc.rotation.x = -Math.PI / 2;
    this.sensorDisc.position.set(c.fwd, 0.08, c.lat);
    g.add(this.sensorDisc);

    // Attachment module at its mount point.
    const a = geom.attachment;
    this.armPivot = new THREE.Group();
    this.armMoving = new THREE.Group();
    this.armPivot.add(this.armMoving);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xC3C9D3, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xE3000B, roughness: 0.6 });
    if (a.module === 'arm' || a.module === 'sweeper') {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 1.6, 1.6), armMat); beam.position.x = 6;
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4, 4), red); paddle.position.x = 12;
      this.armMoving.add(beam, paddle);
      const block = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 3.6), armMat);
      this.armPivot.add(block);
      if (a.module === 'arm') this.legoArm([beam, paddle, block]);
    } else if (a.module === 'lift') {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 16, 6), armMat); mast.position.set(1, 3, 0);
      const fork = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 7), red); fork.position.set(5, 0, 0);
      this.armPivot.add(mast); this.armMoving.add(fork);
    } else if (a.module === 'plow') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 14), red); blade.position.set(4, -2.5, 0);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 1.6), armMat); strut.position.set(2, 0, 0);
      this.armPivot.add(blade, strut);
    } else if (a.module === 'basket') {
      // The basket tips about its front lip (like a dump truck), so the lip stays high while the load slides out.
      const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 12), armMat); floor.position.set(-5, -0.4, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 12), red); back.position.set(-9.6, 2, 0);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 0.8), red); sideL.position.set(-5, 2, -5.6);
      const sideR = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 0.8), red); sideR.position.set(-5, 2, 5.6);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 12), red); lip.position.set(0, 0.8, 0);
      this.armMoving.add(floor, back, sideL, sideR, lip);
      const motor = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 3.6), armMat); motor.position.set(-10, 0, 0);
      this.armPivot.add(motor);
    }
    this.armPivot.visible = a.module !== 'none';
    this.armPivot.position.set(a.fwd + (a.module === 'basket' ? 10 : 0), 6, a.lat);
    this.armPivot.rotation.y = -a.angle * DEG;
    body.add(this.armPivot);

    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    this.robotLDrawParts = body.children.filter((n) => n !== this.armPivot && n !== csMount);
    this.robotGroup = g;
    this.scene.add(g);
    this.matrixDirty = true;

    // Real LEGO body (packed LDraw model) for the Training Camp Driving Base; wheels stay the spinning primitives.
    // Any build with the Driving Base's geometry (small wheels, 11.2 cm track, flat hub) gets the real bricks,
    // whatever ports it uses. Nothing primitive shows while the parts load: a glimmering block stands in.
    const modelUrl = this.robotModelUrl || (this.world.season && this.world.season.robotModel) || 'models/driving-base.mpd';
    if (isDrivingBase(build)) {
      const gen = this.robotBuildGen;
      const ghost = shimmerBox(20, 9, 16); ghost.position.set(-1, 0, 0); ghost.userData.robot = true;
      g.add(ghost); this.shimmers.push(ghost);
      const shown = [body, caster].concat(this.wheels);
      shown.forEach((n) => { n.visible = false; });
      this.revealRobot = () => {
        if (gen !== this.robotBuildGen || --this.robotPending > 0) return;
        g.remove(ghost); this.shimmers = this.shimmers.filter((x) => x !== ghost);
        shown.forEach((n) => { n.visible = true; });
        this.revealRobot = null;
      };
      this.robotPending++;
      loadLDrawModel(modelUrl).then((group) => {
        if (gen !== this.robotBuildGen || this.robotGroup !== g) return;
        if (group) {
          // Model frame: origin at the axle midpoint on the table, forward -z, left +x, y down.
          // Ours: x forward, y up, z right.  our = (-z_l, -y_l, -x_l), scaled to cm.
          group.matrixAutoUpdate = false;
          group.matrix.set(0, 0, -LDU, 0, 0, -LDU, 0, 0, -LDU, 0, 0, 0, 0, 0, 0, 1);
          g.add(group);
          this.robotLDraw = group;
          this.robotLDrawParts.forEach((node) => { node.visible = false; });   // primitives the bricks replace
        }
        this.revealRobot && this.revealRobot();
      });
    }
  }

  /** Real LEGO parts for the arm: a medium motor at the mount, a 15-long liftarm, a red 5-long liftarm as the paddle. */
  legoArm(primitives) {
    const gen = this.robotBuildGen;
    const pivot = this.armPivot, moving = this.armMoving;
    if (this.robotLego) this.robotPending++;
    const place = (group, pos, rot) => { group.matrixAutoUpdate = false; const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)); m.setPosition(...pos); group.matrix.copy(m); return group; };
    const toSim = (g) => { const h = new THREE.Group(); g.rotation.x = Math.PI; g.scale.setScalar(LDU); h.add(g); return h; };   // LDraw y-down -> y-up, LDU -> cm
    Promise.all([loadLDrawModel('models/parts/motor.mpd'), loadLDrawModel('models/parts/beam15.mpd'), loadLDrawModel('models/parts/beam5.mpd')]).then(([motor, beam, paddle]) => {
      const done = () => { if (gen === this.robotBuildGen && this.revealRobot) this.revealRobot(); };
      if (gen !== this.robotBuildGen || !motor || !beam || !paddle || !pivot.parent) { done(); return; }
      // the motor's output axle is at its origin along z (lateral): body behind and above the pivot
      pivot.add(place(toSim(motor), [0, 0, 0], [0, Math.PI, 0]));
      // the liftarms run along z in their own frame with the holes along y: two 15-long arms side by side,
      // turned to run forward, and the red 5-long paddle across the end with its holes facing forward
      for (const z of [-0.8, 0.8]) moving.add(place(toSim(z < 0 ? beam : beam.clone()), [6, 0, z], [0, Math.PI / 2, 0]));
      moving.add(place(toSim(paddle), [12.4, 0, 0], [0, 0, Math.PI / 2]));
      primitives.forEach((m) => { m.visible = false; });
      done();
    });
  }

  /** Real LEGO color sensor at the sensor mount, lens down. */
  legoColorSensor(mount, hideMesh) {
    const gen = this.robotBuildGen;
    if (this.robotLego) this.robotPending++;
    loadLDrawModel('models/parts/colorsensor.mpd').then((sensor) => {
      const done = () => { if (gen === this.robotBuildGen && this.revealRobot) this.revealRobot(); };
      if (!sensor || gen !== this.robotBuildGen || !mount.parent) { done(); return; }
      const h = new THREE.Group(); sensor.rotation.x = Math.PI; sensor.scale.setScalar(LDU); h.add(sensor);
      h.rotation.set(-Math.PI / 2, 0, 0);
      h.position.set(0, 2.6, 0);
      mount.add(h);
      if (hideMesh) hideMesh.visible = false;
      done();
    });
  }

  // ---- path trail ----
  buildTrail() {
    this.trailMax = 4000;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailMax * 3);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0x0A8DFF, transparent: true, opacity: 0.9 }));
    this.trail.frustumCulled = false;
    this.trailCount = 0;
    this.trailLast = null;
    this.scene.add(this.trail);
  }
  clearTrail() { this.trailCount = 0; this.trailLast = null; this.trailGeo.setDrawRange(0, 0); }
  addTrailPoint(x, y) {
    if (this.trailLast && Math.hypot(x - this.trailLast[0], y - this.trailLast[1]) < 0.8) return;
    if (this.trailCount >= this.trailMax) return;
    const i = this.trailCount * 3;
    this.trailPos[i] = x; this.trailPos[i + 1] = 0.3; this.trailPos[i + 2] = y;
    this.trailCount++;
    this.trailLast = [x, y];
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.setDrawRange(0, this.trailCount);
  }

  // ---- zone marker for the mission being practiced ----
  buildZoneMarker() {
    this.zoneRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0x2FC25B, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.zoneRing.rotation.x = -Math.PI / 2;
    this.zoneRing.renderOrder = 6;
    this.zoneRing.visible = false;
    this.scene.add(this.zoneRing);
  }
  showZone(zone) {
    if (!zone) { this.zoneRing.visible = false; return; }
    this.zoneRing.visible = true;
    this.zoneRing.position.set(zone.x, 0.4, zone.y);
    this.zoneRing.scale.setScalar(zone.r);
  }

  // ---- mission feedback: green pulse plus an optional whole-model motion ----
  extrasFor(obstacle) { return this.obstacleExtras.filter((e) => e.userData.obstacle === obstacle); }
  celebrate(obstacle, animate) {
    if (!obstacle) return;
    const targets = this.extrasFor(obstacle).concat(this.obstacleMeshes.filter((m) => m.userData.obstacle === obstacle && m.visible));
    for (const target of targets) {
      const base = { px: target.position.x, py: target.position.y, pz: target.position.z, rz: target.rotation.z, rx: target.rotation.x };
      this.effects.push({ target, base, animate: animate || null, t: 0, duration: animate ? 0.9 : 0.6 });
    }
  }
  updateEffects(dt) {
    for (const e of this.effects) {
      e.t += dt;
      const k = Math.min(1, e.t / e.duration);
      const pulse = Math.sin(Math.min(1, e.t / 0.6) * Math.PI) * 0.5;
      e.target.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setRGB(0, pulse, 0); });
      const a = e.animate, b = e.base, ease = 1 - Math.pow(1 - k, 3);
      if (a && a.kind === 'rise') e.target.position.y = b.py + a.cm * ease;
      else if (a && a.kind === 'tilt') e.target.rotation.z = b.rz + (a.degrees || 20) * DEG * ease;
      else if (a && a.kind === 'slide') { const d = a.cm * ease; if (a.dir === 'east') e.target.position.x = b.px + d; else if (a.dir === 'west') e.target.position.x = b.px - d; else if (a.dir === 'south') e.target.position.z = b.pz + d; else e.target.position.z = b.pz - d; }
      else if (a && a.kind === 'wobble') e.target.rotation.z = b.rz + Math.sin(k * Math.PI * 4) * 6 * DEG * (1 - k);
    }
    this.effects = this.effects.filter((e) => {
      if (e.t < e.duration) return true;
      e.target.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setRGB(0, 0, 0); });
      if (e.animate && e.animate.kind === 'wobble') e.target.rotation.z = e.base.rz;
      return false;
    });
  }
  /** Simple boxes for the team's loose equipment pieces (keystone species, seeds). */
  buildEquipment(items) {
    for (const eq of this.equipmentNodes || []) this.scene.remove(eq.node);
    this.equipmentNodes = [];
    for (const it of items) {
      const node = box(it.box[0], it.box[1], it.box[2], it.color, { roughness: 0.5 });
      node.position.set(it.x, it.box[1] / 2, it.y);
      node.userData.equipment = it;
      this.scene.add(node);
      this.equipmentNodes.push({ id: it.id, node });
    }
  }

  /** Put every model back where it started (new launch). */
  resetEffects() {
    this.effects = [];
    for (const e of this.obstacleExtras) {
      const o = e.userData.obstacle, off = e.userData.offset || [0, 0];
      e.position.set(o.x + off[0], 0, o.y + off[1]);
      e.rotation.set(0, ((o.modelPose && o.modelPose.heading) || 0) * DEG, 0);
      e.traverse((m) => { if (m.isMesh && m.material && m.material.emissive) m.material.emissive.setRGB(0, 0, 0); });
    }
  }

  drawMatrix() {
    const ctx = this.matrixCanvas.getContext('2d');
    ctx.fillStyle = '#15171C';
    ctx.fillRect(0, 0, 160, 160);
    const m = this.robot.hub.matrix;
    for (let i = 0; i < 25; i++) {
      const r = Math.floor(i / 5), c = i % 5;
      const b = m[i] / 9;
      ctx.fillStyle = b > 0 ? `rgba(255, 215, 70, ${0.25 + 0.75 * b})` : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(c * 32 + 6, r * 32 + 6, 20, 20, 4);
      ctx.fill();
    }
    this.matrixTex.needsUpdate = true;
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  installDrag() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const toNdc = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
    };
    el.addEventListener('pointerdown', (e) => {
      this.pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.locked) return;
      toNdc(e);
      const hits = ray.intersectObject(this.robotGroup, true);
      if (!hits.length) return;
      this.dragging = true;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      toNdc(e);
      if (ray.ray.intersectPlane(plane, hit)) this.robot.setPose(hit.x, hit.z);
    });
    const end = (e) => {
      // A short, still press on a mission model is a click: report it.
      if (!this.dragging && this.pressAt && performance.now() - this.pressAt.t < 400 && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) < 6) {
        toNdc(e);
        const targets = this.obstacleExtras.concat(this.obstacleMeshes.filter((m) => m.visible));
        const hits = ray.intersectObjects(targets, true);
        let obj = hits.length ? hits[0].object : null;
        while (obj && !obj.userData.obstacle) obj = obj.parent;
        if (this.onPick) this.onPick(obj ? obj.userData.obstacle : null);
      }
      this.pressAt = null;
      if (!this.dragging) return;
      this.dragging = false;
      this.controls.enabled = true;
      el.style.cursor = '';
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Smoothly move the camera to look at a point from a given offset; remembers where it was. */
  flyTo(point, offset = [24, 22, 30]) {
    if (!this.flyBack) this.flyBack = { pos: this.camera.position.clone(), target: this.controls.target.clone(), follow: this.follow };
    this.follow = false;
    this.fly = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: new THREE.Vector3(point.x + offset[0], offset[1], point.y + offset[2]), toTarget: new THREE.Vector3(point.x, 4, point.y) };
  }
  flyHome() {
    if (!this.flyBack) return;
    this.fly = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: this.flyBack.pos, toTarget: this.flyBack.target };
    this.follow = this.flyBack.follow;
    this.flyBack = null;
  }
  updateFly(dt) {
    const f = this.fly;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / 0.7);
    const k = 1 - Math.pow(1 - f.t, 3);
    this.camera.position.lerpVectors(f.fromPos, f.toPos, k);
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
    if (f.t >= 1) this.fly = null;
  }

  update(dt) { this.updateEffects(dt); this.updateShimmer(dt); this.updateFly(dt); this.watchPerformance(dt); }

  /** The loading blocks build up layer by layer (about two seconds a cycle), each on its own phase. */
  updateShimmer(dt) {
    if (!this.shimmers.length) return;
    this.shimmerT = (this.shimmerT || 0) + dt;
    for (const g of this.shimmers) {
      const u = g.userData, c = (this.shimmerT / 2.2 + u.phase) % 1;
      const grow = Math.min(1, c / 0.8);                       // rise for 80% of the cycle, hold full, start over
      const k = 1 - Math.pow(1 - grow, 2);
      const fh = Math.max(0.2, u.h * k);
      u.fill.scale.y = fh; u.fill.position.y = fh / 2;
      u.scan.position.y = fh + 0.1;
      u.scan.material.opacity = c < 0.8 ? 0.95 : 0.95 * (1 - (c - 0.8) / 0.2);
      u.edges.material.opacity = 0.55 + 0.35 * Math.sin(this.shimmerT * 2.5 + u.phase * 6.28);
    }
  }

  render() {
    const r = this.robot, g = this.robotGroup;
    for (const m of this.obstacleMeshes) { const o = m.userData.obstacle; m.position.x = o.x; m.position.z = o.y; if (o.movable) m.rotation.y = -(o.angle || 0) * DEG; }
    for (const e of this.obstacleExtras) {
      const o = e.userData.obstacle;
      const off = e.userData.offset || [0, 0];
      if (o.angle) {
        const a = o.angle * DEG, c = Math.cos(a), s = Math.sin(a);
        e.position.x = o.x + off[0] * c - off[1] * s; e.position.z = o.y + off[0] * s + off[1] * c;
        e.rotation.y = ((o.modelPose && o.modelPose.heading) || 0) * DEG - a;
      } else {
        e.position.x = o.x + off[0]; e.position.z = o.y + off[1];
      }
    }
    const ph = this.world.physics;
    for (const pn of this.pieceNodes) {
      const pose = ph ? ph.piecePose(pn.o.id, pn.name) : null;
      if (pose) { pn.node.position.set(pose.p[0], pose.p[1], pose.p[2]); pn.node.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]); }
      else { pn.node.position.copy(pn.anchor).applyQuaternion(pn.holder.quaternion).add(pn.holder.position); pn.node.quaternion.copy(pn.holder.quaternion); }
    }
    for (const eq of this.equipmentNodes || []) {
      const pose = ph ? ph.piecePose(null, eq.id) : null;
      if (pose) { eq.node.position.set(pose.p[0], pose.p[1], pose.p[2]); eq.node.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]); }
    }
    g.position.set(r.x, 0, r.y);
    g.rotation.y = -r.heading * DEG;
    const cfg = r.config;
    this.wheels[0].rotation.z = -r.motors[cfg.right].angle * DEG;  // z = +1 side is the robot's right (y down => z right)
    this.wheels[1].rotation.z = -r.motors[cfg.left].angle * DEG;
    if (this.matrixDirty) { this.drawMatrix(); this.matrixDirty = false; }
    const arm = r.arm();
    if (arm) {
      const mv = this.armMoving;
      if (arm.module === 'arm') mv.rotation.set(0, 0, arm.angle * DEG);
      else if (arm.module === 'basket') mv.rotation.set(0, 0, -Math.max(0, arm.angle) * DEG);
      else if (arm.module === 'sweeper') mv.rotation.set(0, arm.angle * DEG, 0);
      else if (arm.module === 'lift') mv.position.y = arm.liftHeight - 6;
    }
    for (const m of this.obstacleMeshes) {
      const o = m.userData.obstacle;
      const hit = o.touched !== undefined && r.time - o.touched < 0.3;
      m.material.emissive.setHex(hit ? 0x335533 : 0x000000);
    }
    this.centerButton.material.color.set(r.hub.centerColor || '#FFFFFF');
    const sample = r.colorSample(cfg.color);
    if (sample) this.sensorDisc.material.color.setRGB(sample.rgb[0] / 255, sample.rgb[1] / 255, sample.rgb[2] / 255);
    if (this.follow) {
      const target = new THREE.Vector3(r.x, 4, r.y);
      const delta = target.clone().sub(this.controls.target);
      this.controls.target.add(delta.multiplyScalar(0.18));
      this.camera.position.add(delta);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
