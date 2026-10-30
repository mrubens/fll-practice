// three.js view of the table and the robot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TABLE } from './world.js';

const DEG = Math.PI / 180;

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

    for (const o of world.obstacles) {
      const m = box(o.w, o.h, o.d, o.color);
      m.position.set(o.x, o.h / 2, o.y);
      scene.add(m);
    }
  }

  buildRobot() {
    const g = new THREE.Group();
    const grey = 0xD9DEE6, dark = 0x2A2F3A, yellow = 0xFFD500;

    const chassis = box(16, 2.4, 13, grey); chassis.position.set(-0.5, 3.4, 0); g.add(chassis);
    const motorL = box(6, 4, 3.6, 0xC3C9D3); motorL.position.set(0, 3.2, 3.6); g.add(motorL);
    const motorR = box(6, 4, 3.6, 0xC3C9D3); motorR.position.set(0, 3.2, -3.6); g.add(motorR);

    const hub = box(11.2, 3.2, 8.8, yellow); hub.position.set(-1, 6.2, 0); g.add(hub);
    const top = box(11, 0.5, 8.6, 0xF7F8FA); top.position.set(-1, 8.05, 0); g.add(top);

    // LED matrix (canvas texture) on the hub top.
    const mc = document.createElement('canvas');
    mc.width = 160; mc.height = 160;
    this.matrixCanvas = mc;
    this.matrixTex = new THREE.CanvasTexture(mc);
    this.matrixTex.colorSpace = THREE.SRGBColorSpace;
    const matrix = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 5.4), new THREE.MeshBasicMaterial({ map: this.matrixTex }));
    matrix.rotation.x = -Math.PI / 2;
    matrix.rotation.z = -Math.PI / 2;
    matrix.position.set(0.6, 8.32, 0);
    g.add(matrix);

    // Hub buttons.
    const btn = (x, z, color, r = 0.8) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.4, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
      m.position.set(x, 8.45, z);
      g.add(m);
      return m;
    };
    btn(-4.3, 2.6, 0xC9CED8); btn(-4.3, -2.6, 0xC9CED8);
    this.centerButton = btn(-4.3, 0, 0xFFFFFF, 1.0);

    // Wheels: group rotates about z; inner cylinder axis aligned with z.
    this.wheels = [];
    for (const side of [1, -1]) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 2.8, 28), new THREE.MeshStandardMaterial({ color: 0x23272F, roughness: 0.9 }));
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.0, 20), new THREE.MeshStandardMaterial({ color: yellow, roughness: 0.6 }));
      rim.rotation.x = Math.PI / 2;
      const spoke = box(2.4, 0.5, 3.1, 0x6B7280);
      wg.add(tire, rim, spoke);
      wg.position.set(0, 2.8, side * 5.6);
      g.add(wg);
      this.wheels.push(wg);
    }

    const caster = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.4 }));
    caster.position.set(-7, 1.4, 0);
    caster.castShadow = true;
    g.add(caster);

    // Distance sensor (two eyes) at the front.
    const ds = box(2.2, 3.2, 5.2, 0xF7F8FA); ds.position.set(8.2, 5.6, 0); g.add(ds);
    for (const z of [1.45, -1.45]) {
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0x1F2937, roughness: 0.3 }));
      eye.rotation.z = Math.PI / 2;
      eye.position.set(9.4, 5.6, z);
      g.add(eye);
    }

    // Colour sensor pointing down, with a disc showing what it sees.
    const cs = box(2.2, 2.4, 2.4, dark); cs.position.set(7.5, 2.3, 0); g.add(cs);
    this.sensorDisc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.sensorDisc.rotation.x = -Math.PI / 2;
    this.sensorDisc.position.set(7.5, 0.08, 0);
    g.add(this.sensorDisc);

    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    this.robotGroup = g;
    this.scene.add(g);
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
    g.position.set(r.x, 0, r.y);
    g.rotation.y = -r.heading * DEG;
    const cfg = r.config;
    this.wheels[0].rotation.z = -r.motors[cfg.right].angle * DEG;  // z = +1 side is the robot's right (y down => z right)
    this.wheels[1].rotation.z = -r.motors[cfg.left].angle * DEG;
    if (this.matrixDirty) { this.drawMatrix(); this.matrixDirty = false; }
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
