// LEGO-style building instructions for an attachment. The steps come from how its parts connect: the attachment is
// built on the table first (pins before the beam that goes on them, parts slid onto an axle in order along it), then it
// goes onto the robot, and last come the axles that go through the robot and what sits on them. A viewer shows one step
// at a time in 3D (the new parts in full colour, the ones already on paler), with the parts the step needs, and prints.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Scene, fit, categoryOf, sub, dot } from './lego.js';
import { loadRaw, flatten, partTemplates, partMesh, ldToRobot } from './lego3d.js';
import { CHASSIS } from './build.js';

// older LDraw numbers of a part the kits have, counted and named as the kit's
const SAME = { '2780': '61332' };
const kitPart = (f) => SAME[f] || f;

const descOf = (D, f) => ((D.parts.parts[f] || (D.snaps && D.snaps[f]) || {}).d || '').replace(/^[~=]/, '');
/** What sort of part: a pin goes into holes, an axle through them, a bush or gear sits on an axle, anything else is a part. */
function kindOf(D, f) {
  const d = descOf(D, f), cat = categoryOf(D, kitPart(f));
  if (cat === 'Pins' || /\bPin\b/.test(d) && !/Connector|Joiner|Block/.test(d)) return 'pin';
  if (cat === 'Axles' || /^Technic Axle\s+\d/.test(d)) return 'axle';
  if (cat === 'Bushes' || /\bBush\b/.test(d) && !/Pin/.test(d)) return 'bush';
  return 'part';
}

function near(a, b, pad = 4) { return a.lo.every((v, i) => v - pad <= b.hi[i] && b.lo[i] - pad <= a.hi[i]); }
function linked(A, B) {
  if (!near(A.aabb, B.aabb)) return false;
  for (const a of A.conns) for (const b of B.conns) { const r = fit(a, b); if (r && !r.collide) return true; }
  return false;
}
const centre = (it) => { const c = [0, 0, 0]; for (const b of it.boxes) for (let k = 0; k < 3; k++) c[k] += b.c[k] / it.boxes.length; return it.boxes.length ? c : it.q.p; };
const volume = (it) => it.boxes.reduce((v, b) => v + b.h[0] * b.h[1] * b.h[2], 0);
/** An axle's middle and direction (its longest box side). */
function axleLine(it) {
  const b = it.boxes[0];
  if (!b) return null;
  const k = b.h.indexOf(Math.max(...b.h));
  return { o: b.c, d: [b.R[k], b.R[3 + k], b.R[6 + k]] };
}

/**
 * The steps to build `qs` (placements in the robot's LDraw frame) on `chassis`. `useDrive`: the robot's own drive
 * axle is there already (a child's build on it); false when the build brings its own (a built-in attachment's file).
 * Returns {steps: [{parts: [index], attach?}], kinds}: indexes into qs; the step with `attach` puts the attachment on.
 */
export function planSteps(D, chassis, qs, { useDrive = true } = {}) {
  const scene = new Scene(D, qs, chassis);
  const items = scene.parts;
  const n = items.length;
  const anchors = [scene.base, ...(useDrive ? scene.items.filter((it) => it.role === 'drive') : [])];
  const kinds = items.map((it) => kindOf(D, it.q.f));
  const adj = items.map(() => new Set());
  const onRobot = items.map((it) => anchors.some((a) => linked(it, a)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (linked(items[i], items[j])) { adj[i].add(j); adj[j].add(i); }

  // on the robot at the end: axles that go through it, and what hangs only on those (a gear, a bush)
  // (and a part held only by the robot, like a bush on the bracket's axle)
  // (on the Advanced Driving Base a tool is built whole and dropped into its frame: only what hangs on the robot alone)
  const dropIn = chassis !== 'driving-base';
  const late = new Set(items.map((_, i) => i).filter((i) => onRobot[i] && ((kinds[i] === 'axle' && !dropIn) || !adj[i].size)));
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < n; i++) if (!late.has(i) && adj[i].size && [...adj[i]].every((j) => late.has(j))) { late.add(i); grew = true; }
  }
  // what the attachment goes onto: the robot's drive axle (pushed through it) or the robot's holes
  const drives = scene.items.filter((it) => it.role === 'drive');
  const onAxle = useDrive && items.some((it, i) => !late.has(i) && drives.some((d) => linked(it, d)));

  const lines = items.map((it, i) => (kinds[i] === 'axle' ? axleLine(it) : null));
  const along = (a, j) => dot(sub(centre(items[j]), lines[a].o), lines[a].d);
  /** Whether part i can go on now: nothing still to come sits on an axle between it and what is built there. */
  const ready = (i, built) => {
    for (const a of adj[i]) {
      if (kinds[a] !== 'axle' || !built.has(a) || !lines[a]) continue;
      const others = [...adj[a]].filter((j) => j !== i);
      const ts = others.filter((j) => built.has(j)).map((j) => along(a, j));
      if (!ts.length) continue;
      const lo = Math.min(...ts), hi = Math.max(...ts), ti = along(a, i);
      if (ti > lo && ti < hi) continue;
      const [x0, x1] = ti >= hi ? [hi, ti] : [ti, lo];
      if (others.some((j) => !built.has(j) && kinds[j] !== 'axle' && along(a, j) > x0 + 1 && along(a, j) < x1 - 1)) return false;
    }
    return true;
  };

  const steps = [];
  /** Steps that add `todo` to what is built, starting with the biggest part when nothing is built yet. */
  const grow = (todo, built, robotThere) => {
    const left = new Set(todo);
    const touches = (i) => [...adj[i]].some((j) => built.has(j)) || (robotThere && onRobot[i]);
    while (left.size) {
      const adjacent = [...left].filter(touches);
      if (!adjacent.length) {                                    // a new piece to start: its biggest part
        // the part that sits on the robot first (a tool's frame), else the biggest
        const start = [...left].sort((a, b) => onRobot[a] - onRobot[b] || (kinds[a] === 'part') - (kinds[b] === 'part') || volume(items[a]) - volume(items[b])).pop();
        steps.push({ parts: [start] }); left.delete(start); built.add(start);
        continue;
      }
      let cand = adjacent.filter((i) => ready(i, built));
      if (!cand.length) cand = adjacent;
      const of = (k) => cand.filter((i) => kinds[i] === k);
      let pick = [];
      const smalls = [...of('pin'), ...of('axle')];
      if (smalls.length) {
        // the most of one kind first, up to six in a step
        const byF = new Map();
        for (const i of smalls) byF.set(kitPart(items[i].q.f), [...(byF.get(kitPart(items[i].q.f)) || []), i]);
        for (const group of [...byF.values()].sort((a, b) => b.length - a.length)) { if (pick.length + group.length > 6 && pick.length) break; pick.push(...group.slice(0, 6)); }
      } else if (of('bush').length) pick = of('bush').slice(0, 6);
      else {
        const links = (i) => [...adj[i]].filter((j) => built.has(j)).length + (robotThere && onRobot[i] ? 1 : 0);
        const parts = of('part').sort((a, b) => links(b) - links(a) || volume(items[b]) - volume(items[a]));
        // with the same parts that can go on now too (both sides', or a row of them), up to four
        pick = [parts[0], ...parts.filter((i) => i !== parts[0] && items[i].q.f === items[parts[0]].q.f)].slice(0, 4);
      }
      steps.push({ parts: pick });
      for (const i of pick) { left.delete(i); built.add(i); }
    }
  };
  const early = items.map((_, i) => i).filter((i) => !late.has(i));
  const built = new Set();
  grow(early, built, false);
  // what goes on the robot's own drive axle goes on with the attachment, as that axle is pushed back through
  // a build's own axle through the robot goes in with the parts it holds there (not the gear or bush on its end)
  let withAxle = useDrive ? [...late].filter((i) => drives.some((d) => linked(items[i], d))) : [];
  if (!useDrive) {
    const axles = [...late].filter((i) => kinds[i] === 'axle' && onRobot[i]);
    withAxle = [...axles, ...[...late].filter((i) => kinds[i] === 'part' && !/Gear/.test(descOf(D, items[i].q.f)) && axles.some((a) => adj[i].has(a)))];
  }
  steps.push({ parts: withAxle, attach: true, onAxle: onAxle || withAxle.length > 0 });
  for (const i of withAxle) built.add(i);
  grow([...late].filter((i) => !withAxle.includes(i)), built, true);
  // a build with nothing to put together first starts on the robot
  if (!early.length) steps.shift();
  // the same part going on in steps one after another (slid onto an axle in turn): one step, up to four of them
  const same = (s) => !s.attach && s.parts.length && s.parts.every((i) => items[i].q.f === items[s.parts[0]].q.f);
  for (let k = steps.length - 1; k > 0; k--) {
    const a = steps[k - 1], b = steps[k];
    if (same(a) && same(b) && items[a.parts[0]].q.f === items[b.parts[0]].q.f && a.parts.length + b.parts.length <= 4) { a.parts.push(...b.parts); steps.splice(k, 1); }
  }
  return { steps, kinds, onRobot };
}

/** Group placements by kit part and colour: [{f, c, n, i}] (i: one of them), most first. */
function tally(D, qs, idx) {
  const m = new Map();
  for (const i of idx) { const q = qs[i], k = kitPart(q.f) + '|' + q.c; const e = m.get(k) || { f: kitPart(q.f), c: q.c, n: 0, i }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export class InstructionsViewer {
  constructor({ names } = {}) {
    this.names = names || {};
  }

  /**
   * Show the instructions for a build: {title, chassis, qs (placements in the robot's LDraw frame), file?, at?} — with
   * `file` (models/attach/<file>.mpd, its origin at `at`) the parts' looks come from that model, else from the parts box.
   */
  async open(D, build) {
    this.D = D;
    if (!this.root) this._dom();
    this.root.hidden = false;
    this.root.querySelector('.ins-title').textContent = build.title;
    this.status('Working out the steps...');
    if (!this.three) this._three();
    const { ld } = this.three;
    ld.clear();
    this.build = build;
    const ch = CHASSIS[build.chassis] || CHASSIS['driving-base'];
    ld.matrix.copy(ldToRobot(ch.axleZ * LDU_CM)); ld.matrixWorldNeedsUpdate = true;
    const plan = planSteps(D, build.chassis, build.qs, { useDrive: !build.file });
    this.plan = plan;
    // the parts' meshes, in the robot's LDraw frame
    this.meshes = [];
    this.tpl = await partTemplates(D, build.qs.map((q) => q.f));
    if (build.file) {
      const g = await loadRaw(`models/attach/${build.file}.mpd`);
      const kids = g ? [...g.children] : [];
      build.qs.forEach((q, i) => {
        const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.makeTranslation(...(build.at || [0, 0, 0]));
        if (kids[i]) holder.add(kids[i].clone());
        this.meshes.push(holder);
      });
    } else {
      const tpl = this.tpl;
      build.qs.forEach((q) => { const t = tpl.get(q.f); this.meshes.push(t ? partMesh(t, q, D.parts.parts[q.f].c) : new THREE.Group()); });
    }
    for (const m of this.meshes) ld.add(m);
    // the robot, shown from the step that puts the attachment on
    this.robot = new THREE.Group(); ld.add(this.robot);
    for (const url of [ch.model, ch.wheels, ...ch.context]) loadRaw(url).then((g) => { if (g && this.build === build) { const f = flatten(g); fade(f, 0.55); this.robot.add(f); } });
    this.stepAt = build.qs.map(() => 0);
    plan.steps.forEach((s, k) => s.parts.forEach((i) => { this.stepAt[i] = k + 1; }));
    this.attachAt = plan.steps.findIndex((s) => s.attach) + 1;
    this.thumbCache = new Map();
    this.status('');
    this.show(0);
    this._loop();
  }

  close() { if (this.root) this.root.hidden = true; cancelAnimationFrame(this.raf); this.raf = null; }

  /** Page k: 0 is the parts list for the whole build, then one page per step. */
  show(k) {
    const N = this.plan.steps.length;
    this.page = Math.max(0, Math.min(N, k));
    const step = this.plan.steps[this.page - 1];
    const r = this.root;
    r.querySelector('.ins-count').textContent = this.page ? `Step ${this.page} of ${N}` : 'Parts you need';
    r.querySelector('[data-ins="back"]').disabled = this.page === 0;
    r.querySelector('[data-ins="next"]').disabled = this.page === N;
    const all = this.build.qs.map((_, i) => i);
    const list = this.page ? tally(this.D, this.build.qs, step.parts) : tally(this.D, this.build.qs, all);
    const box = r.querySelector('.ins-callout');
    box.classList.toggle('whole', !this.page);
    box.innerHTML = list.length ? list.map((e) => `<figure title="${this._name(e.f)}"><img alt="" src="${this._thumb(e)}"><figcaption>${e.n}x</figcaption></figure>`).join('')
      : '';
    box.hidden = !list.length;
    const note = r.querySelector('.ins-note');
    note.textContent = !this.page ? `${this.build.qs.length} pieces. Press Next to start.`
      : step.attach ? (step.onAxle ? 'Put it on the robot: hold it in place and push the axle in the arm bracket through it.' : 'Put it on the robot.')
      : this.page > this.attachAt && this.attachAt ? 'On the robot.' : '';
    // what shows: everything up to this step in its own colours (a faded or tinted black would look grey or orange),
    // this step's new parts outlined in orange; the robot, paler, once the attachment goes on
    const upto = this.page || N;
    this.meshes.forEach((m, i) => {
      m.visible = this.stepAt[i] <= upto;
      outline(m, !!this.page && this.stepAt[i] === this.page);
    });
    this.robot.visible = this.page === 0 ? false : this.attachAt > 0 && this.page >= this.attachAt;
    this._frame(this.page ? (step.attach ? this.meshes.filter((_, i) => this.stepAt[i] <= this.page) : this.meshes.filter((_, i) => this.stepAt[i] <= this.page)) : this.meshes);
  }

  /** Point the camera at what this page shows, from the way the viewer is looking now. */
  _frame(objs, dir = null) {
    const { camera, controls } = this.three;
    this.three.ld.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const o of objs) if (o.visible !== false) box.expandByObject(o);
    if (box.isEmpty()) return;
    const s = box.getBoundingSphere(new THREE.Sphere());
    const d = dir || camera.position.clone().sub(controls.target).normalize();
    const dist = Math.max(s.radius, 3) / Math.sin((camera.fov / 2) * Math.PI / 180) * 1.1;
    controls.target.copy(s.center);
    camera.position.copy(s.center).addScaledVector(d, dist);
    camera.near = dist / 50; camera.far = dist * 20; camera.updateProjectionMatrix();
  }

  _name(f) { return this.names[f] || descOf(this.D, f).replace(/^Technic\s+/, ''); }

  /** A picture of a part in its colour, for the parts boxes. */
  _thumb(e) {
    const key = e.f + '|' + e.c;
    if (this.thumbCache.has(key)) return this.thumbCache.get(key);
    if (!this.thumbR) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(2); r.setSize(80, 80);
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
      const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, 2, 1.5); sc.add(dl);
      const holder = new THREE.Group(); holder.rotation.x = Math.PI; sc.add(holder);
      this.thumbR = { r, sc, holder, cam: new THREE.PerspectiveCamera(30, 1, 1, 5000) };
    }
    const { r, sc, holder, cam } = this.thumbR;
    holder.clear();
    // the kit part in its own frame when the parts box has it, else the piece as the build holds it
    const t = this.tpl && this.tpl.get(e.f);
    if (t) holder.add(partMesh(t, { f: e.f, c: e.c, p: [0, 0, 0], r: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, this.D.parts.parts[e.f].c));
    else {
      const src = this.meshes[e.i], from = [];
      src.traverse((o) => { if (o.isMesh) from.push(o); });
      const m = src.clone(true);
      let k = 0;
      const rims = [];
      m.traverse((o) => { if (o.isMesh) { const f = from[k++]; if (f && f.userData.rim) rims.push(o); else { o.material = (f && f.userData.full) || o.material; o.userData = {}; } } });
      for (const r of rims) r.parent && r.parent.remove(r);
      holder.add(m);
    }
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), s = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(1, 0.8, 1.3).normalize();
    cam.position.copy(s.center).addScaledVector(dir, s.radius / Math.sin(15 * Math.PI / 180) * 1.05);
    cam.lookAt(s.center); cam.near = s.radius * 0.1; cam.far = s.radius * 10; cam.updateProjectionMatrix();
    r.render(sc, cam);
    const url = r.domElement.toDataURL();
    this.thumbCache.set(key, url);
    return url;
  }

  /** The matrix that puts part i where the build has it (LDraw frame). */
  _placement(i) {
    const q = this.build.qs[i], r = q.r;
    return new THREE.Matrix4().set(r[0], r[1], r[2], q.p[0], r[3], r[4], r[5], q.p[1], r[6], r[7], r[8], q.p[2], 0, 0, 0, 1);
  }

  status(t) { if (this.root) this.root.querySelector('.ins-status').textContent = t || ''; }

  /** Every page as a picture, laid out to print (or save as PDF). */
  print() {
    const { renderer, camera, controls } = this.three;
    const dir = new THREE.Vector3(...VIEW).normalize();
    const keep = { pos: camera.position.clone(), target: controls.target.clone(), page: this.page, w: renderer.domElement.width, h: renderer.domElement.height };
    renderer.setSize(900, 620, false); camera.aspect = 900 / 620;
    const pages = [];
    for (let k = 0; k <= this.plan.steps.length; k++) {
      this.show(k);
      this._frame(this.page ? this.meshes.filter((_, i) => this.stepAt[i] <= this.page) : this.meshes, dir);
      renderer.render(this.three.scene, camera);
      pages.push({ img: renderer.domElement.toDataURL('image/png'), count: this.root.querySelector('.ins-count').textContent, note: this.root.querySelector('.ins-note').textContent, callout: this.root.querySelector('.ins-callout').innerHTML });
    }
    let out = document.querySelector('.ins-print');
    if (!out) { out = document.createElement('div'); out.className = 'ins-print'; document.body.appendChild(out); }
    out.innerHTML = `<h1>${escapeHtml(this.build.title)}</h1>` + pages.map((p) => `<section><h2>${p.count}</h2><div class="ins-callout${p.count === 'Parts you need' ? ' whole' : ''}">${p.callout}</div><img src="${p.img}" alt=""><p>${escapeHtml(p.note)}</p></section>`).join('');
    document.body.classList.add('printing-instructions');
    const done = () => { document.body.classList.remove('printing-instructions'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    this._resize();
    camera.position.copy(keep.pos); controls.target.copy(keep.target);
    this.show(keep.page);
    setTimeout(() => { try { window.print(); } catch (err) { done(); } }, 50);
  }

  _dom() {
    const r = document.createElement('section');
    r.className = 'ins';
    r.setAttribute('aria-label', 'Building instructions');
    r.innerHTML = `
      <div class="ins-head">
        <h3 class="ins-title"></h3>
        <span class="ins-count"></span>
        <div class="ins-tools">
          <button type="button" class="tb" data-ins="print" title="Print the steps, or save them as a PDF">Print</button>
          <button type="button" class="tb primary" data-ins="close">Done</button>
        </div>
      </div>
      <div class="ins-view">
        <div class="ins-callout"></div>
        <p class="ins-note"></p>
        <p class="ins-status"></p>
        <div class="ins-nav">
          <button type="button" class="tb" data-ins="back" aria-label="Back">◀ Back</button>
          <button type="button" class="tb primary" data-ins="next" aria-label="Next">Next ▶</button>
        </div>
      </div>`;
    document.body.appendChild(r);
    this.root = r;
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]'); if (!b) return;
      const a = b.dataset.ins;
      if (a === 'close') this.close(); else if (a === 'back') this.show(this.page - 1); else if (a === 'next') this.show(this.page + 1); else if (a === 'print') this.print();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { this.show(this.page + 1); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'ArrowLeft') { this.show(this.page - 1); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape') { this.close(); e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('resize', () => this._resize());
  }

  _three() {
    const view = this.root.querySelector('.ins-view');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    view.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF6F8FB);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa1ad, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(30, 60, 40); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-40, 20, -30); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
    camera.position.set(...VIEW);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const ld = new THREE.Group(); ld.matrixAutoUpdate = false; scene.add(ld);
    this.three = { renderer, scene, camera, controls, ld, view };
    this._resize();
  }

  _resize() {
    if (!this.three || this.root.hidden) return;
    const { renderer, camera, view } = this.three;
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  _loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const { renderer, scene, camera, controls, view } = this.three;
      if (view.clientWidth !== renderer.domElement.clientWidth || view.clientHeight !== renderer.domElement.clientHeight) this._resize();
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
  }
}

const LDU_CM = 0.04;
// the way the pictures look at the build: from in front, a little to the robot's left, and above
const VIEW = [0.7, 0.55, -0.45];

/** Make an object's parts paler (k: how far toward white), or back to their own colours (k = 0). */
function fade(obj, k) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.full) o.userData.full = o.material;
    if (!k) { o.material = o.userData.full; return; }
    const key = 'faded' + k;
    if (!o.userData[key]) {
      const m = o.userData.full.clone();
      if (m.color) m.color.lerp(new THREE.Color(0xffffff), k);
      if (m.emissive) m.emissive.setHex(0x000000);
      o.userData[key] = m;
    }
    o.material = o.userData[key];
  });
}

// an orange rim around a part: its own surfaces pushed out along their normals, drawn from behind
const RIM = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  vertexShader: 'void main() { vec3 p = position + normalize(normal) * 2.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'void main() { gl_FragColor = vec4(1.0, 0.45, 0.0, 1.0); }',
});
const RIMS = new WeakMap();
/** Outline a part (this step's new parts), or take the outline off. */
function outline(obj, on) {
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && !o.userData.rim) meshes.push(o); });
  for (const o of meshes) {
    if (!RIMS.has(o)) {
      if (!on || !o.geometry.attributes.normal) continue;
      const r = new THREE.Mesh(o.geometry, RIM);
      r.userData.rim = true;
      o.add(r);
      RIMS.set(o, r);
    }
    RIMS.get(o).visible = on;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
