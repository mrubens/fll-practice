// three.js view of the table and the robot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TABLE } from './world.js';

const DEG = Math.PI / 180;

/** "M01 Drone Survey" -> "01", "Dock NE (M13-15)" -> "13-15", anything else -> its first word. */
function labelFor(id) {
  const s = String(id || '');
  let m = /^M(\d+)/i.exec(s);
  if (m) return m[1].padStart(2, '0');
  m = /M(\d+-\d+)/i.exec(s);
  if (m) return m[1];
  return s.split(' ')[0].slice(0, 5);
}

const labelCache = new Map();
function labelTexture(text) {
  if (labelCache.has(text)) return labelCache.get(text);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${text.length > 2 ? 44 : 78}px Nunito, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.strokeText(text, 64, 68);
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  labelCache.set(text, tex);
  return tex;
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

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
    controls.minDistance = 25;
    controls.maxDistance = 600;
    this.controls = controls;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b3, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
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
    robot.on('matrix', () => { this.matrixDirty = true; });
    robot.on('build', () => this.buildRobot());
  }

  buildTable() {
    const { scene, world } = this;
    const matTex = new THREE.CanvasTexture(world.matCanvas);
    matTex.colorSpace = THREE.SRGBColorSpace;
    matTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w, TABLE.h), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.9 }));
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
    this.buildObstacles();
    world.onChange((what) => {
      if (what === 'mat') this.matTex.needsUpdate = true;
      if (what === 'season') this.buildObstacles();
    });
  }

  buildObstacles() {
    for (const m of this.obstacleMeshes) this.scene.remove(m);
    this.obstacleMeshes = [];
    for (const o of this.world.obstacles) {
      const m = box(o.w, o.h, o.d, o.color);
      m.position.set(o.x, o.h / 2, o.y);
      m.userData.obstacle = o;
      const label = labelFor(o.id);
      if (label) {
        // White number painted on the roof, readable from the default (south) camera.
        const side = 7; // same size on every model, whatever its footprint
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(side, side), new THREE.MeshBasicMaterial({ map: labelTexture(label), transparent: true, depthTest: false }));
        roof.renderOrder = 5;
        roof.rotation.x = -Math.PI / 2;
        roof.position.y = o.h / 2 + 0.05;
        m.add(roof);
      }
      this.scene.add(m);
      this.obstacleMeshes.push(m);
    }
  }

  buildRobot() {
    if (this.robotGroup) { this.scene.remove(this.robotGroup); this.robotGroup = null; }
    const r = this.robot, build = r.build, geom = r.geom;
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

    // Colour sensor pointing down, with a disc showing what it sees.
    const c = geom.color;
    const cs = box(2.2, 2.4, 2.4, dark); cs.position.set(c.fwd, 2.3, c.lat); body.add(cs);
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
      this.armPivot.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 3.6), armMat));
    } else if (a.module === 'lift') {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 16, 6), armMat); mast.position.set(1, 3, 0);
      const fork = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 7), red); fork.position.set(5, 0, 0);
      this.armPivot.add(mast); this.armMoving.add(fork);
    } else if (a.module === 'plow') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 14), red); blade.position.set(4, -2.5, 0);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 1.6), armMat); strut.position.set(2, 0, 0);
      this.armPivot.add(blade, strut);
    }
    this.armPivot.visible = a.module !== 'none';
    this.armPivot.position.set(a.fwd, 6, a.lat);
    this.armPivot.rotation.y = -a.angle * DEG;
    body.add(this.armPivot);

    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    this.robotGroup = g;
    this.scene.add(g);
    this.matrixDirty = true;
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
      if (!this.dragging) return;
      this.dragging = false;
      this.controls.enabled = true;
      el.style.cursor = '';
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  render() {
    const r = this.robot, g = this.robotGroup;
    for (const m of this.obstacleMeshes) { const o = m.userData.obstacle; m.position.x = o.x; m.position.z = o.y; }
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
