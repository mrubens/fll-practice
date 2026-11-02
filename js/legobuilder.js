// The attachment builder: build a robot attachment from real LEGO parts that snap together where LEGO really
// connects (see lego.js), on the Driving Base's arm bracket, whose axle motor E turns.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadLego, Scene, DRIVE_AXLE, DRIVE_PARTS, parseLdr, toLdr, app, sub, add, scl, dot, rotAxis, mul, I3, LDU, boxesOverlap, baseBoxes, partBoxes } from './lego.js';
import { LD_TO_ROBOT, loadRaw, flatten, partTemplates, partMesh, placementMatrix } from './lego3d.js';

const DEG = Math.PI / 180;
const P = [0, 0, -1, 0, -1, 0, -1, 0, 0];                 // LDraw axes -> robot axes (a proper rotation, its own inverse)
const toRobot = (v) => scl(app(P, v), LDU);                // a point in the Driving Base frame -> robot frame (cm)
const MOTOR_AXIS_LD = [-1, 0, 0];                          // motor angle + raises the arm: about the robot's +z

/** Rotation matrix (LDraw frame) of the drive at a motor angle (degrees). */
const driveRot = (deg) => rotAxis(MOTOR_AXIS_LD, deg * DEG);

/**
 * Where a build's moving part reaches and how far motor E can turn it before it runs into the robot itself.
 * Returns {length, tipAngle, stops: [lo, hi]} (cm, degrees), from the analysis of a Scene.
 */
export function motionOf(D, scene, an) {
  const moving = an.bodies.find((b) => b.role === 'drive');
  const items = moving ? moving.items.filter((it) => it.role === 'part') : [];
  const pivot = toRobot(DRIVE_AXLE.at);
  let best = { length: 0, tipAngle: 0 };
  for (const it of items) for (const b of it.boxes) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const local = [b.h[0] * sx, b.h[1] * sy, b.h[2] * sz];
      const p = toRobot(add(b.c, app(b.R, local)));
      const dx = p[0] - pivot[0], dy = p[1] - pivot[1];
      const L = Math.hypot(dx, dy);
      if (L > best.length) best = { length: L, tipAngle: Math.atan2(dy, dx) / DEG };
    }
  }
  // sweep the moving parts both ways until they meet the Driving Base or the bracket (pairs touching at rest don't count)
  const base = baseBoxes(D);
  const movingBoxes = items.flatMap((it) => it.boxes);
  const at = DRIVE_AXLE.at;
  const turned = (b, deg) => { const R = driveRot(deg); return { c: add(app(R, sub(b.c, at)), at), h: b.h, R: mul(R, b.R) }; };
  const near = (a, b) => len3(sub(a.c, b.c)) < Math.hypot(...a.h) + Math.hypot(...b.h);
  // the robot's parts are measured as boxes, rounder in real life: only a clear overlap (over 3 mm) stops the arm
  const M = 8;
  const restHits = new Set();
  movingBoxes.forEach((m, i) => base.forEach((b, j) => { if (near(m, b) && boxesOverlap(m, b, M)) restHits.add(i + ',' + j); }));
  const hitsAt = (deg) => movingBoxes.some((m0, i) => { const m = turned(m0, deg); return base.some((b, j) => !restHits.has(i + ',' + j) && near(m, b) && boxesOverlap(m, b, M)); });
  const sweep = (dir) => { for (let a = 3; a <= 180; a += 3) if (hitsAt(dir * a)) return dir * (a - 3); return dir * 180; };
  const stops = movingBoxes.length ? [sweep(-1), sweep(1)] : [-180, 180];
  return { length: Math.round(best.length * 100) / 100, tipAngle: Math.round(best.tipAngle * 10) / 10, stops };
}
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);

const EXAMPLE_ARM = `0 Driving Base 2 arm (from models/src/arm-moving.ldr without its drive axle and gear; a 7-long axle joins the angle connectors, which take one stud of axle each)
1 0 -40 -181.423 -221.2836 0 -1 0 0.6428 0 -0.766 0.766 0 0.6428 32009.dat
1 322 -20 -130 -160 0 1 0 -0.766 0 -0.6428 -0.6428 0 0.766 60483.dat
1 322 20 -130 -160 0 1 0 -0.766 0 -0.6428 -0.6428 0 0.766 60483.dat
1 0 40 -181.423 -221.2836 0 -1 0 0.6428 0 -0.766 0.766 0 0.6428 32009.dat
1 71 -60 -130 -160 0 0 -1 0 1 0 1 0 0 3713.dat
1 71 0 -58.8559 -324.1296 1 0 0 0 0.6428 -0.766 0 0.766 0.6428 44294.dat
1 15 -80 -58.8559 -324.1296 0 0 -1 0.6428 0.766 0 0.766 -0.6428 0 32192.dat
1 15 80 -58.8559 -324.1296 0 0 1 0.6428 -0.766 0 0.766 0.6428 0 32192.dat
`;

const shortName = (d) => d.replace(/^~?Technic\s+/i, '').replace(/\s+/g, ' ').trim();

export class AttachmentBuilder {
  constructor({ onApply }) {
    this.onApply = onApply;
    this.root = null;
    this.parts = [];          // placements
    this.history = [];
    this.ghost = null;
    this.motor = 0;
  }

  async open(ldr) {
    if (!this.root) this._dom();
    this.root.hidden = false;
    document.body.classList.add('lego-building');
    this.status('Loading the parts...');
    this.D = await loadLego();
    this.tpl = await partTemplates(this.D);
    if (!this.three) await this._three();
    this._palette();
    this.parts = parseLdr(ldr || '').filter((q) => this.D.parts.parts[q.f]);
    this.history = [];
    this._rebuild();
    this._resize();
    this._loop();
  }

  close() {
    if (!this.root) return;
    this.root.hidden = true;
    document.body.classList.remove('lego-building');
    this._dropGhost();
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  // ---------------- DOM ----------------
  _dom() {
    const r = document.createElement('section');
    r.className = 'lego-builder';
    r.setAttribute('aria-label', 'Attachment builder');
    r.innerHTML = `
      <div class="lb-head">
        <h3>Attachment builder</h3>
        <span class="lb-sub">Real LEGO parts snap where they really connect. The axle in the bracket is turned by motor E.</span>
        <div class="lb-tools">
          <button type="button" class="tb" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="tb" data-act="clear">Clear</button>
          <button type="button" class="tb" data-act="example" title="Load the Driving Base 2 arm to start from">Example arm</button>
          <button type="button" class="tb" data-act="load">Open .ldr</button>
          <button type="button" class="tb" data-act="save">Save .ldr</button>
          <button type="button" class="tb primary" data-act="apply">Put it on the robot</button>
          <button type="button" class="tb" data-act="close">Close</button>
        </div>
      </div>
      <div class="lb-body">
        <div class="lb-palette" role="list"></div>
        <div class="lb-view">
          <div class="lb-keys">Click a part, then click to place it where it snaps. <b>R</b> turn · <b>F</b> flip · <b>Tab</b> use another hole or pin · <b>[ ]</b> slide · <b>Esc</b> put it down · click a placed part, then <b>Delete</b></div>
          <div class="lb-msg" aria-live="polite"></div>
          <div class="lb-motor"><label>Try motor E <input type="range" min="-120" max="120" value="0" step="1"></label><output>0°</output></div>
        </div>
      </div>
      <div class="lb-status" aria-live="polite"></div>
      <input type="file" accept=".ldr,.mpd,.dat,text/plain" hidden>`;
    document.body.appendChild(r);
    this.root = r;
    this.view = r.querySelector('.lb-view');
    this.msgEl = r.querySelector('.lb-msg');
    this.statusEl = r.querySelector('.lb-status');
    const slider = r.querySelector('.lb-motor input'), out = r.querySelector('.lb-motor output');
    slider.addEventListener('input', () => { this.motor = Number(slider.value); out.textContent = `${this.motor}°`; this._poseDrive(); });
    this.slider = slider; this.sliderOut = out;
    const file = r.querySelector('input[type=file]');
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      const all = parseLdr(await f.text());
      const known = all.filter((q) => this.D.parts.parts[q.f]);
      this._push();
      this.parts = known;
      this._rebuild();
      this.message(known.length < all.length ? `Opened ${f.name}: ${all.length - known.length} part(s) are not in this parts box and were left out.` : `Opened ${f.name}.`);
    });
    r.querySelector('.lb-tools').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'undo') this.undo();
      else if (act === 'clear') { if (this.parts.length) { this._push(); this.parts = []; this._rebuild(); } }
      else if (act === 'example') { this._push(); this.parts = parseLdr(EXAMPLE_ARM); this._rebuild(); this.message('The Driving Base 2 arm from the FIRST robot guide. Change it, or clear it and build your own.'); }
      else if (act === 'load') file.click();
      else if (act === 'save') this._download();
      else if (act === 'apply') this._apply();
      else if (act === 'close') this.close();
    });
    this._keys = (e) => this._key(e);
    window.addEventListener('keydown', this._keys, true);
    window.addEventListener('resize', () => this._resize());
  }

  _palette() {
    const pal = this.root.querySelector('.lb-palette');
    if (pal.childElementCount) return;
    for (const cat of this.D.parts.categories) {
      const det = document.createElement('details');
      det.open = cat.name === 'Beams' || cat.name === 'Pins' || cat.name === 'Axles' || cat.name === 'Connectors';
      det.innerHTML = `<summary>${cat.name}</summary><div class="lb-grid"></div>`;
      const grid = det.querySelector('.lb-grid');
      for (const f of cat.parts) {
        const info = this.D.parts.parts[f];
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lb-part'; b.dataset.part = f;
        b.title = `${info.d} (${f})`;
        b.innerHTML = `<img alt=""><span>${shortName(info.d)}</span>`;
        b.addEventListener('click', () => this.pick(f));
        grid.appendChild(b);
      }
      pal.appendChild(det);
    }
    this._thumbs();
  }

  /** Little pictures of each part for the palette, drawn one at a time so the builder stays responsive. */
  _thumbs() {
    const size = 72;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(2); r.setSize(size, size);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, 2, 1.5); sc.add(dl);
    const cam = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    const holder = new THREE.Group(); holder.rotation.x = Math.PI; sc.add(holder);
    const buttons = [...this.root.querySelectorAll('.lb-part')];
    const next = () => {
      const b = buttons.shift();
      if (!b) { r.dispose(); return; }
      const t = this.tpl.get(b.dataset.part);
      if (t) {
        holder.clear(); const m = t.clone(); holder.add(m);
        const box = new THREE.Box3().setFromObject(holder), s = box.getBoundingSphere(new THREE.Sphere());
        const dir = new THREE.Vector3(1, 0.8, 1.3).normalize();
        cam.position.copy(s.center).addScaledVector(dir, s.radius / Math.sin(15 * DEG) * 1.05);
        cam.lookAt(s.center); cam.near = s.radius * 0.1; cam.far = s.radius * 10; cam.updateProjectionMatrix();
        r.render(sc, cam);
        b.querySelector('img').src = r.domElement.toDataURL();
      }
      setTimeout(next, 0);
    };
    next();
  }

  status(text, warn = false) { if (this.statusEl) { this.statusEl.textContent = text; this.statusEl.classList.toggle('warn', warn); } }
  message(text) { if (this.msgEl) this.msgEl.textContent = text || ''; }

  // ---------------- three.js view ----------------
  async _three() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = false;
    this.view.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEEF1F6);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa1ad, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(30, 60, 40); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-40, 20, -30); scene.add(fill);
    const grid = new THREE.GridHelper(64, 40, 0xC9D0DB, 0xDDE2EA); scene.add(grid);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
    camera.position.set(26, 19, -17);
    const controls = new OrbitControls(camera, renderer.domElement);
    const pivot = toRobot(DRIVE_AXLE.at);
    controls.target.set(pivot[0] + 3, pivot[1] - 1, pivot[2]);
    controls.enableDamping = true;
    const ld = new THREE.Group(); ld.matrixAutoUpdate = false; ld.matrix.copy(LD_TO_ROBOT); scene.add(ld);
    const drive = new THREE.Group(); drive.matrixAutoUpdate = false; ld.add(drive);
    this.three = { renderer, scene, camera, controls, ld, drive };
    // the robot as context
    for (const url of ['models/driving-base.mpd', 'models/attach/arm-fixed.mpd']) {
      loadRaw(url).then((g) => { if (g) { const f = flatten(g); f.userData.context = true; ld.add(f); } });
    }
    this.marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshBasicMaterial({ color: 0xFFB000, transparent: true, opacity: 0.85, depthTest: false }));
    this.marker.renderOrder = 10; this.marker.visible = false; ld.add(this.marker);
    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => { if (this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) < 5) this._click(e); this.downAt = null; });
    el.addEventListener('pointerleave', () => { if (this.ghost) { this.ghost.mesh.visible = false; this.marker.visible = false; } });
  }

  _resize() {
    if (!this.three || this.root.hidden) return;
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (!w || !h) return;
    this.three.renderer.setSize(w, h);
    this.three.camera.aspect = w / h; this.three.camera.updateProjectionMatrix();
  }

  _loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const { renderer, scene, camera, controls } = this.three;
      if (this.view.clientWidth !== renderer.domElement.clientWidth || this.view.clientHeight !== renderer.domElement.clientHeight) this._resize();
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
  }

  // ---------------- the build ----------------
  _push() { this.history.push(this.parts.map((q) => ({ ...q, p: q.p.slice(), r: q.r.slice() }))); if (this.history.length > 200) this.history.shift(); }
  undo() { if (!this.history.length) return; this.parts = this.history.pop(); this.selected = null; this._rebuild(); }

  /** Rebuild the scene, meshes and status after any change. */
  _rebuild() {
    this.scene = new Scene(this.D, this.parts);
    const { ld, drive } = this.three;
    for (const m of this.meshes || []) m.parent && m.parent.remove(m);
    this.meshes = [];
    this.an = this.scene.analyze();
    const bodyOf = new Map();
    this.an.bodies.forEach((b, i) => b.items.forEach((it) => bodyOf.set(it, i)));
    // bodies hinged to the drive move with it in the preview
    const onDrive = new Set(this.an.bodies.map((b, i) => (b.role === 'drive' ? i : -1)).filter((i) => i >= 0));
    for (let grew = true; grew;) { grew = false; for (const j of this.an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) if (onDrive.has(x) && !onDrive.has(y) && this.an.bodies[y].role !== 'base') { onDrive.add(y); grew = true; } }
    const loose = new Set(this.an.loose);
    for (const it of this.scene.items) {
      const tpl = this.tpl.get(it.q.f);
      if (!tpl) continue;
      const m = partMesh(tpl, it.q);
      m.userData.item = it;
      if (loose.has(it)) tint(m, 0xE8232A, 0.45);
      if (it === this.selected) tint(m, 0x0A8DFF, 0.5);
      (onDrive.has(bodyOf.get(it)) ? drive : ld).add(m);
      this.meshes.push(m);
    }
    this._poseDrive();
    this._summary();
    if (this.ghost) this._snap();
  }

  _poseDrive() {
    const R = driveRot(this.motor), at = DRIVE_AXLE.at;
    const t = sub(at, app(R, at));
    this.three.drive.matrix.set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1);
    this.three.drive.matrixWorldNeedsUpdate = true;
  }

  _summary() {
    const an = this.an;
    const count = (role) => an.bodies.filter((b) => b.role === role).reduce((s, b) => s + b.items.filter((it) => it.role === 'part').length, 0);
    const moving = count('drive'), fixed = count('base'), swinging = count('free');
    const hinges = an.joints.length;
    const n = this.parts.length;
    if (!n) { this.status('Empty: pick a part on the left and snap it onto the axle in the bracket (motor E turns it) or onto the robot.'); return; }
    const bits = [`${n} part${n === 1 ? '' : 's'}`];
    if (moving) bits.push(`${moving} turn${moving === 1 ? 's' : ''} with motor E`);
    if (fixed) bits.push(`${fixed} fixed to the robot`);
    if (swinging) bits.push(`${swinging} on hinges (${hinges} pin joint${hinges === 1 ? '' : 's'}; friction pins hold, the others swing)`);
    let warn = false;
    if (an.jammed) { bits.push('The drive axle is locked to the robot: motor E cannot turn.'); warn = true; }
    if (an.loose.length) { bits.push(`${an.loose.length} part${an.loose.length === 1 ? ' is' : 's are'} not attached to anything (red) and would fall off.`); warn = true; }
    this.status(bits.join(' · '), warn);
  }

  _download() {
    const blob = new Blob([toLdr(this.parts)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'attachment.ldr';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  _apply() {
    if (this.an.jammed) { this.message('Motor E could not turn this: the drive axle is locked to the robot.'); return; }
    const keep = this.parts.filter((q) => !this.an.loose.some((it) => it.q === q));
    const scene = new Scene(this.D, keep);
    const an = scene.analyze();
    const motion = motionOf(this.D, scene, an);
    this.onApply && this.onApply({ ldr: keep.length ? toLdr(keep) : '', ...motion });
    this.close();
  }

  // ---------------- placing parts ----------------
  pick(f) {
    this._dropGhost();
    this.selected = null;
    const tpl = this.tpl.get(f);
    if (!tpl) return;
    const own = this.D.snaps[f].s.filter((c) => c.k === 'cyl' && !c.gp);
    const mesh = tpl.clone();
    mesh.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.7; o.material.depthWrite = false; } });
    mesh.matrixAutoUpdate = false; mesh.visible = false;
    this.three.ld.add(mesh);
    this.ghost = { f, own, k: 0, flip: false, roll: 0, slide: 0, mesh, q: null, ok: false };
    this.root.querySelectorAll('.lb-part').forEach((b) => b.classList.toggle('on', b.dataset.part === f));
    this.message(`${shortName(this.D.parts.parts[f].d)}: move it onto a hole, axle or pin.`);
  }

  _dropGhost() {
    if (!this.ghost) return;
    this.ghost.mesh.parent && this.ghost.mesh.parent.remove(this.ghost.mesh);
    this.ghost = null;
    this.marker && (this.marker.visible = false);
    this.root && this.root.querySelectorAll('.lb-part.on').forEach((b) => b.classList.remove('on'));
    this.message('');
  }

  _pointer(e) {
    const rect = this.three.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
  }

  _move(e) {
    this.mouse = this._pointer(e);
    if (this.ghost) this._snap();
    else this._hover();
  }

  /** Screen position (px) of a point in the LDraw frame, and its depth. */
  _project(p) {
    const v = new THREE.Vector3(...p).applyMatrix4(this.three.ld.matrixWorld);
    const d = v.clone().project(this.three.camera);
    return { x: (d.x + 1) / 2 * this.mouse.w, y: (1 - d.y) / 2 * this.mouse.h, z: d.z };
  }

  /** Find where the ghost part goes for the current pointer: the nearest connector it fits on. */
  _snap() {
    const g = this.ghost, m = this.mouse;
    if (!g || !m) return;
    this.three.ld.updateMatrixWorld(true);
    const R = driveRot(this.motor), at = DRIVE_AXLE.at;
    const shown = (it, p) => (this._onDriveItem(it) ? add(app(R, sub(p, at)), at) : p);
    const cands = [];
    const genders = new Set(g.own.map((c) => c.g));
    for (const it of this.scene.all()) {
      for (const c of it.conns) {
        if (!genders.has(c.g === 'M' ? 'F' : 'M')) continue;
        const a = this._project(shown(it, c.o)), b = this._project(shown(it, add(c.o, scl(c.d, c.len))));
        if (a.z > 1 || b.z > 1) continue;
        const [dist, frac] = segDist(m.x, m.y, a, b);
        if (dist < 26) cands.push({ c, it, dist, z: Math.min(a.z, b.z), at: frac * c.len });
      }
    }
    cands.sort((p, q) => p.dist - q.dist || p.z - q.z);
    let found = null, near = null;
    for (const cand of cands.slice(0, 8)) {
      if (this.motor !== 0 && this._onDriveItem(cand.it)) continue;
      for (let i = 0; i < g.own.length && !found; i++) {
        const k = (g.k + i) % g.own.length;
        if (g.own[k].g === cand.c.g) continue;
        const opts = this.scene.placementsOnto(g.f, k, cand.c, g.flip, g.roll);
        if (!opts.length) continue;
        // the best fits, nearest the pointer first
        const good = opts.filter((o) => this.scene.check(o.q).ok).sort((p, q) => Math.round(q.eng) - Math.round(p.eng) || Math.abs(p.mid - cand.at) - Math.abs(q.mid - cand.at));
        if (!good.length) { if (!near) near = { q: opts[0].q, why: this.scene.check(opts[0].q).why, c: cand.c }; continue; }
        const byT = good.slice().sort((p, q) => p.t - q.t);
        const i0 = byT.indexOf(good[0]);
        const pick = byT[Math.max(0, Math.min(byT.length - 1, i0 + g.slide))];
        found = { q: pick.q, c: cand.c, k, slides: byT.length };
      }
      if (found) break;
    }
    if (this.motor !== 0 && !found && cands.some((c) => this._onDriveItem(c.it))) this.message('Set "Try motor E" back to 0 to add parts to the moving arm.');
    const res = found || near;
    if (!res) {
      g.q = null; g.ok = false; g.mesh.visible = false; this.marker.visible = false;
      return;
    }
    g.q = res.q; g.ok = !!found; g.kUsed = found ? found.k : g.k;
    g.mesh.matrix.copy(placementMatrix(res.q)); g.mesh.visible = true;
    g.mesh.traverse((o) => { if (o.isMesh) { o.material.emissive && o.material.emissive.setHex(found ? 0x0E5A1E : 0x7A0A0A); } });
    // mark the connector it goes onto
    const c = res.c, mid = add(c.o, scl(c.d, c.len / 2));
    this.marker.position.set(...mid);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...c.d));
    this.marker.scale.set(3, c.len + 2, 3);
    this.marker.material.color.setHex(found ? 0xFFB000 : 0xE8232A);
    this.marker.visible = true;
    this.message(found ? `${shortName(this.D.parts.parts[g.f].d)}: click to place.${found.slides > 1 ? ' [ ] slides it along.' : ''}` : `It ${res.why} here: try R, F or Tab.`);
  }

  _onDriveItem(it) { return this.meshes && this.meshes.some((m) => m.userData.item === it && m.parent === this.three.drive); }

  _hover() {
    const hit = this._raycast();
    this.three.renderer.domElement.style.cursor = hit ? 'pointer' : '';
  }

  _raycast() {
    const m = this.mouse;
    if (!m) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(m.x / m.w * 2 - 1, -(m.y / m.h) * 2 + 1), this.three.camera);
    const targets = this.meshes.filter((x) => x.userData.item.role === 'part');
    const hits = ray.intersectObjects(targets, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.item) o = o.parent;
    return o ? o.userData.item : null;
  }

  _click(e) {
    this.mouse = this._pointer(e);
    if (this.ghost) {
      this._snap();
      if (!this.ghost.ok || !this.ghost.q) return;
      this._push();
      this.parts.push(this.ghost.q);
      this._rebuild();
      return;
    }
    const it = this._raycast();
    this.selected = it || null;
    this._rebuild();
    if (it) this.message(`${shortName(this.D.parts.parts[it.q.f].d)} selected: Delete removes it.`);
    else this.message('');
  }

  _key(e) {
    if (!this.root || this.root.hidden) return;
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    const g = this.ghost;
    let used = true;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') this.undo();
    else if (k === 'Escape') { if (g) this._dropGhost(); else this.close(); }
    else if (g && (k === 'r' || k === 'R')) { g.roll = (g.roll + (e.shiftKey ? 3 : 1)) % 4; this._snap(); }
    else if (g && (k === 'f' || k === 'F')) { g.flip = !g.flip; g.slide = 0; this._snap(); }
    else if (g && k === 'Tab') { g.k = ((g.kUsed ?? g.k) + (e.shiftKey ? g.own.length - 1 : 1)) % g.own.length; g.slide = 0; this._snap(); }
    else if (g && k === ']') { g.slide++; this._snap(); }
    else if (g && k === '[') { g.slide--; this._snap(); }
    else if ((k === 'Delete' || k === 'Backspace') && this.selected) {
      this._push();
      this.parts = this.parts.filter((q) => q !== this.selected.q);
      this.selected = null;
      this._rebuild();
      this.message('');
    } else if (!e.ctrlKey && !e.metaKey && ((k.length === 1 && 'wasdqeWASDQE'.includes(k)) || k.startsWith('Arrow'))) {
      e.stopPropagation();          // the robot does not drive about under the builder
      return;
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
}

function tint(obj, hex, k) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.color) o.material.color.lerp(new THREE.Color(hex), k);
  });
}

function segDist(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return [Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)), t];
}
