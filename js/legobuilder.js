// The robot builder: the LEGO Driving Base with its sensors and its attachment, built from real LEGO parts that snap
// together where LEGO really connects (see lego.js). Sensors snap onto the robot and plug into a hub port; the
// attachment is a built-in one or the child's own, built on the arm bracket's axle, which motor E turns.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadLego, Scene, DRIVE_AXLE, DRIVE_PARTS, parseLdr, toLdr, app, sub, add, scl, dot, rotAxis, mul, I3, LDU, boxesOverlap, baseBoxes, partBoxes } from './lego.js';
import { LD_TO_ROBOT, loadRaw, flatten, partTemplates, partMesh, placementMatrix } from './lego3d.js';
import { MODULE_STOPS, PORT_LETTERS } from './robot.js';
import { SENSOR_PARTS, MODULES, validateBuild } from './build.js';

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

// The attachments that come with the app: their physics is tuned for the missions, and the builder shows their parts.
export const BUILT_IN = [
  { module: 'none', label: 'None' },
  { module: 'arm', label: 'Arm', file: 'arm-moving', note: 'the Driving Base 2 arm from the FIRST robot guide: lifts up and down' },
  { module: 'plow', label: 'Dozer blade', file: 'dozer-moving', note: 'tilts up and down to push things' },
  { module: 'basket', label: 'Basket', file: 'basket-moving', note: 'carries pieces and tips to dump them', sign: -1 },
  // the sweeper turns on the motor's own (upright) axle, beside the bracket
  { module: 'sweeper', label: 'Sweeper', file: 'sweeper-moving', note: 'swings sideways on the motor\'s axle', at: [80, -140, -160], axis: [0, -1, 0] },
  { module: 'scoop', label: 'Side scoop', file: 'scoop-moving', note: 'a long plate out to the left that slides under things and lifts them' },
  { module: 'custom', label: 'My own' },
];

export class AttachmentBuilder {
  /**
   * onChange(build): the robot changed (sensors, ports, attachment); normalize(build) makes a build whole (build.js);
   * presets: {id: build} offered across the top.
   */
  constructor({ onChange, normalize, presets }) {
    this.onChange = onChange;
    this.normalize = normalize;
    this.presets = presets || {};
    this.mode = 'none';
    this.body = [];           // the robot's own parts: sensors and what holds them (placements)
    this.parts = [];          // the child's own attachment (placements), shown when the mode is 'custom'
    this.ports = new Map();   // sensor placement -> hub port
    this.root = null;
    this.history = [];
    this.ghost = null;
    this.motor = 0;
  }

  /** Open on a robot build; `lastCustom`: the child's last own attachment (.ldr), kept for "My own". */
  async open(build, lastCustom = '') {
    if (!this.root) this._dom();
    this.root.hidden = false;
    document.body.classList.add('lego-building');
    this.status('Loading the parts...');
    this.D = await loadLego();
    this.tpl = await partTemplates(this.D);
    if (!this.three) await this._three();
    this._palette();
    this.history = [];
    this._load(build, lastCustom);
    this._resize();
    this._loop();
  }

  /** Take a whole build into the builder (on opening, or a robot preset). */
  _load(build, lastCustom) {
    this.build = this.normalize(build);
    const known = (ldr) => parseLdr(ldr || '').filter((q) => this.D.parts.parts[q.f]);
    this.body = known(this.build.body.ldr);
    this.ports = new Map();
    const all = parseLdr(this.build.body.ldr || '');
    all.forEach((q, i) => { const k = this.body.findIndex((x) => x.p.join() === q.p.join() && x.f === q.f && x.r.join() === q.r.join()); if (k >= 0 && this.build.body.ports[i]) this.ports.set(this.body[k], this.build.body.ports[i]); });
    const a = this.build.attachment;
    if (a.module === 'custom') this.parts = known(a.ldr);
    else if (lastCustom !== undefined && lastCustom !== null) this.parts = known(lastCustom);
    this.mode = null;               // a new robot: nothing carries over from the last one shown
    this.setModule(a.module);
  }

  /** Show a built-in attachment, none, or the child's own build ('custom'); `tell` puts the choice on the robot. */
  setModule(module, tell = false) {
    if (!this.three || !this.D) { this.mode = module; return; }
    if (this.mode === 'custom' && module !== 'custom') this._settleBody();
    // building your own from the arm starts from the arm's own parts
    if (module === 'custom' && this.mode === 'arm' && !this.parts.length) this.parts = parseLdr(EXAMPLE_ARM);
    this._dropGhost();
    this.mode = module;
    this.selected = null;
    this.root.querySelectorAll('.lb-preset').forEach((b) => b.classList.toggle('on', b.dataset.module === module));
    this.root.querySelectorAll('[data-custom]').forEach((b) => { b.hidden = module !== 'custom'; });
    this._showBuiltIn(module);
    this._rebuild();
    this.setMotor(0);
    if (tell) this._emit();
  }

  /** Parts of the child's attachment that ended up fixed to the robot (not turned by motor E) belong to the robot. */
  _settleBody() {
    if (!this.an || !this.scene) return;
    const onDrive = this._driveBodies();
    const fixed = new Set();
    this.an.bodies.forEach((b, i) => { if (!onDrive.has(i)) for (const it of b.items) if (it.role === 'part') fixed.add(it.q); });
    const move = this.parts.filter((q) => fixed.has(q));
    if (!move.length) return;
    this.parts = this.parts.filter((q) => !fixed.has(q));
    this.body.push(...move);
  }

  /** Indexes of the bodies that turn with motor E (the drive and what hangs on it). */
  _driveBodies() {
    const an = this.an;
    const onDrive = new Set(an.bodies.map((b, i) => (b.role === 'drive' ? i : -1)).filter((i) => i >= 0));
    for (let grew = true; grew;) { grew = false; for (const j of an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) if (onDrive.has(x) && !onDrive.has(y) && an.bodies[y].role !== 'base') { onDrive.add(y); grew = true; } }
    return onDrive;
  }

  /** The robot as built now, put on the robot on the table (onChange). */
  _emit() {
    if (!this.an) return;
    const loose = new Set(this.an.loose.map((it) => it.q));
    const body = this.body.filter((q) => !loose.has(q));
    const ports = {};
    body.forEach((q, i) => { if (this.ports.get(q)) ports[i] = this.ports.get(q); });
    let attachment = { module: this.mode };
    if (this.mode === 'custom') {
      const keep = this.parts.filter((q) => !loose.has(q));
      if (this.an.jammed) attachment = this.build.attachment;      // motor E could not turn it: the last one stays
      else {
        const scene = new Scene(this.D, [...body, ...keep]);
        const motion = motionOf(this.D, scene, scene.analyze());
        attachment = { module: 'custom', ldr: keep.length ? toLdr(keep) : '', ...motion };
      }
    }
    this.build = this.normalize({ ...this.build, preset: null, name: 'Custom robot', body: { ldr: body.length ? toLdr(body, 'Robot parts') : '', ports }, attachment });
    this._sidePanel();
    if (this.onChange) this.onChange(this.build, this.mode === 'custom' ? toLdr(this.parts) : null);
  }

  /** A robot preset: its sensors, ports and attachment. */
  usePreset(id) {
    const p = this.presets[id];
    if (!p || !this.D) return;
    this._load({ ...p, preset: id }, null);
    this.history = [];               // a new robot: undo starts over
    this.build = this.normalize({ ...p, preset: id });
    this._sidePanel();
    if (this.onChange) this.onChange(this.build, null);
    this.message(`${p.name}.`);
  }

  /** The parts of a built-in attachment, on the drive axle (their files have their origin on it). */
  _showBuiltIn(module) {
    const { bmove: drive } = this.three;
    if (this.builtIn) { drive.remove(this.builtIn); this.builtIn = null; }
    const b = BUILT_IN.find((x) => x.module === module);
    if (!b || !b.file) return;
    const gen = (this.builtInGen = (this.builtInGen || 0) + 1);
    loadRaw(`models/attach/${b.file}.mpd`).then((g) => {
      if (!g || gen !== this.builtInGen || this.mode !== module) return;
      const f = flatten(g);
      f.matrixAutoUpdate = false; f.matrix.makeTranslation(...(b.at || DRIVE_AXLE.at));
      drive.add(f); this.builtIn = f;
    });
  }

  /** Done: everything is on the robot already. */
  done() { this.close(); }

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
    r.setAttribute('aria-label', 'Robot builder');
    r.innerHTML = `
      <div class="lb-head">
        <h3>Robot builder</h3>
        <div class="lb-robots" role="group" aria-label="Robots">
          <span>Start from</span>
          ${Object.entries(this.presets).map(([id, p]) => `<button type="button" class="lb-robot" data-robot="${id}" title="${p.name}">${p.label || p.name}</button>`).join('')}
        </div>
        <div class="lb-tools">
          <button type="button" class="tb" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="tb primary" data-act="done">Done</button>
        </div>
      </div>
      <div class="lb-sub">
        <div class="lb-presets" role="group" aria-label="Attachment">
          <span>Attachment <small>motor E</small></span>
          ${BUILT_IN.map((b) => `<button type="button" class="lb-preset" data-module="${b.module}"${b.note ? ` title="${b.note}"` : ''}>${b.label}</button>`).join('')}
        </div>
        <div class="lb-tools">
          <button type="button" class="tb" data-act="clear" data-custom title="Take your attachment's parts off">Clear</button>
          <button type="button" class="tb" data-act="load" data-custom>Open .ldr</button>
          <button type="button" class="tb" data-act="save" data-custom>Save .ldr</button>
        </div>
      </div>
      <div class="lb-body">
        <div class="lb-palette" role="list"></div>
        <div class="lb-view">
          <div class="lb-keys">Click a part, then click to place it where it snaps. <b>R</b> turn · <b>F</b> flip · <b>Tab</b> use another hole or pin · <b>[ ]</b> slide · <b>Esc</b> put it down · click a placed part: <b>M</b> move, <b>Delete</b> remove · <b>Q E</b> turn motor E</div>
          <div class="lb-sel" hidden>
            <b class="lb-sel-name"></b>
            <label class="lb-sel-port" hidden>Port <select></select></label>
            <button type="button" class="tb" data-sel="move" title="Pick it up and put it somewhere else (M)">Move</button>
            <button type="button" class="tb" data-sel="delete" title="Take it off (Delete)">Remove</button>
          </div>
          <div class="lb-msg" aria-live="polite"></div>
          <div class="lb-motor"><label>Try motor E <input type="range" min="-120" max="120" value="0" step="1"></label><output>0°</output></div>
        </div>
        <aside class="lb-side" aria-label="Hub ports"></aside>
      </div>
      <div class="lb-status" aria-live="polite"></div>
      <input type="file" accept=".ldr,.mpd,.dat,text/plain" hidden>`;
    document.body.appendChild(r);
    this.root = r;
    this.view = r.querySelector('.lb-view');
    this.sideEl = r.querySelector('.lb-side');
    r.querySelector('.lb-presets').addEventListener('click', (e) => { const b = e.target.closest('.lb-preset'); if (b) this.setModule(b.dataset.module, true); });
    r.querySelector('.lb-robots').addEventListener('click', (e) => { const b = e.target.closest('.lb-robot'); if (b) this.usePreset(b.dataset.robot); });
    this.msgEl = r.querySelector('.lb-msg');
    this.statusEl = r.querySelector('.lb-status');
    const slider = r.querySelector('.lb-motor input'), out = r.querySelector('.lb-motor output');
    slider.addEventListener('input', () => this.setMotor(Number(slider.value)));
    this.slider = slider; this.sliderOut = out;
    // the selected part's bar: its port (a sensor), move it, take it off
    this.selEl = r.querySelector('.lb-sel');
    this.selEl.addEventListener('click', (e) => { const b = e.target.closest('[data-sel]'); if (!b) return; if (b.dataset.sel === 'move') this.moveSelected(); else this.removeSelected(); });
    this.selEl.querySelector('select').addEventListener('change', (e) => { if (this.selected) this.setPort(this.selected.q, e.target.value); });
    this.sideEl.addEventListener('change', (e) => this._sideChange(e));
    this.sideEl.addEventListener('click', (e) => { const row = e.target.closest('[data-part]'); if (row && e.target.tagName !== 'SELECT') this._selectQ(this.body[Number(row.dataset.part)]); });
    const file = r.querySelector('input[type=file]');
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      const all = parseLdr(await f.text());
      const known = all.filter((q) => this.D.parts.parts[q.f]);
      this._push();
      this.parts = known;
      this._rebuild(true);
      this.message(known.length < all.length ? `Opened ${f.name}: ${all.length - known.length} part(s) are not in this parts box and were left out.` : `Opened ${f.name}.`);
    });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('.lb-tools button'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'undo') this.undo();
      else if (act === 'clear') { if (this.parts.length) { this._push(); this.parts = []; this._rebuild(true); } }
      else if (act === 'load') file.click();
      else if (act === 'save') this._download();
      else if (act === 'done') this.done();
    });
    this._keys = (e) => this._key(e);
    window.addEventListener('keydown', this._keys, true);
    window.addEventListener('resize', () => this._resize());
  }

  /** The hub's ports: what is plugged into each, the sensors' ports to change, and anything wrong. */
  _sidePanel() {
    if (!this.sideEl || !this.build) return;
    const b = this.build;
    const sel = (value, attrs) => `<select ${attrs}>${PORT_LETTERS.map((p) => `<option value="${p}"${p === value ? ' selected' : ''}>${p}</option>`).join('')}${value ? '' : '<option value="" selected>none</option>'}</select>`;
    const motor = MODULES[b.attachment.module] && MODULES[b.attachment.module].motor;
    const rows = [
      `<div class="lb-port"><i class="dev motor"></i><span>Left wheel motor</span>${sel(b.ports.left, 'data-wheel="left" aria-label="Left wheel motor port"')}</div>`,
      `<div class="lb-port"><i class="dev motor"></i><span>Right wheel motor</span>${sel(b.ports.right, 'data-wheel="right" aria-label="Right wheel motor port"')}</div>`,
    ];
    if (motor) rows.push(`<div class="lb-port"><i class="dev motor"></i><span>Attachment motor</span><b class="fixed">E</b></div>`);
    const counts = {};
    this.body.forEach((q, i) => {
      const sp = SENSOR_PARTS[q.f];
      if (!sp) return;
      counts[sp.type] = (counts[sp.type] || 0) + 1;
      const n = this.body.filter((x) => SENSOR_PARTS[x.f] && SENSOR_PARTS[x.f].type === sp.type).length;
      const name = n > 1 ? `${sp.label} ${counts[sp.type]}` : sp.label;
      const on = this.selected && this.selected.q === q;
      rows.push(`<div class="lb-port sensor${on ? ' on' : ''}" data-part="${i}" title="Click to find it on the robot"><i class="dev ${sp.type}"></i><span>${name}</span>${sel(this.ports.get(q) || '', `data-sensor="${i}" aria-label="${name} port"`)}</div>`);
    });
    const used = new Set([b.ports.left, b.ports.right, motor ? 'E' : null, ...[...this.ports.values()]]);
    const free = PORT_LETTERS.filter((p) => !used.has(p));
    const issues = validateBuild(b);
    const sensors = this.body.some((q) => SENSOR_PARTS[q.f]);
    this.sideEl.innerHTML = `<h4>Hub ports</h4>${rows.join('')}
      ${sensors ? '' : '<p class="lb-hint">No sensors yet: pick one from Sensors on the left and snap it onto the robot.</p>'}
      <p class="lb-hint">Free: ${free.length ? free.join(', ') : 'none'}</p>
      <p class="lb-issues">${issues.join(' ')}</p>
      <p class="lb-hint">A color sensor reads the mat when it looks down at it from close by (up to about 2 cm; nothing past 4.5). A distance sensor measures along the way its eyes look.</p>`;
  }

  _sideChange(e) {
    const t = e.target;
    if (t.dataset.sensor !== undefined) { this.setPort(this.body[Number(t.dataset.sensor)], t.value); return; }
    if (t.dataset.wheel) {
      const side = t.dataset.wheel, other = side === 'left' ? 'right' : 'left', ports = { ...this.build.ports };
      const was = ports[side];
      ports[side] = t.value;
      if (ports[other] === t.value) ports[other] = was;                   // swap with the other wheel
      for (const [q, p] of this.ports) if (p === t.value) this.ports.set(q, was);   // or with a sensor
      this.build = this.normalize({ ...this.build, ports });
      this._emit();
    }
  }

  /** Plug a sensor into a port; whatever was on that port moves to the sensor's old one. */
  setPort(q, port) {
    if (!q || !SENSOR_PARTS[q.f]) return;
    if (port === 'E' && MODULES[this.build.attachment.module].motor) { this.message('Port E is the attachment motor.'); this._sidePanel(); this._selBar(); return; }
    const was = this.ports.get(q) || null;
    const ports = { ...this.build.ports };
    if (port && (ports.left === port || ports.right === port)) {
      if (!was) { this.message(`Port ${port} drives a wheel.`); this._sidePanel(); this._selBar(); return; }
      if (ports.left === port) ports.left = was; else ports.right = was;
    }
    this._push();
    for (const [o, p] of this.ports) if (o !== q && p === port) { if (was) this.ports.set(o, was); else this.ports.delete(o); }
    if (port) this.ports.set(q, port); else this.ports.delete(q);
    this.build = this.normalize({ ...this.build, ports });
    this._emit();
    this._selBar();
  }

  /** The first port nothing is on, for a new sensor. */
  _freePort() {
    const b = this.build;
    const used = new Set([b.ports.left, b.ports.right, MODULES[b.attachment.module].motor ? 'E' : null, ...this.ports.values()]);
    return ['B', 'F', 'A', 'E', 'C', 'D'].find((p) => !used.has(p)) || null;
  }

  _palette() {
    const pal = this.root.querySelector('.lb-palette');
    if (pal.childElementCount) return;
    for (const cat of this.D.parts.categories) {
      const det = document.createElement('details');
      det.open = ['Sensors', 'Beams', 'Pins', 'Axles', 'Connectors'].includes(cat.name);
      det.innerHTML = `<summary>${cat.name}</summary><div class="lb-grid"></div>`;
      if (cat.name === 'Sensors') { det.classList.add('sensors'); det.querySelector('summary').insertAdjacentHTML('afterend', '<p class="lb-hint">Snap one onto the robot, then pick its port.</p>'); }
      const grid = det.querySelector('.lb-grid');
      for (const f of cat.parts) {
        const info = this.D.parts.parts[f];
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lb-part'; b.dataset.part = f;
        b.title = `${info.d} (${f})`;
        b.innerHTML = `<img alt=""><span>${SENSOR_PARTS[f] ? SENSOR_PARTS[f].label : shortName(info.d)}</span>`;
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
    const bmove = new THREE.Group(); bmove.matrixAutoUpdate = false; ld.add(bmove);   // a built-in attachment's moving part
    this.three = { renderer, scene, camera, controls, ld, drive, bmove };
    // the robot as context
    for (const url of ['models/driving-base.mpd', 'models/attach/wheels.mpd', 'models/attach/arm-fixed.mpd']) {
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
  _push() {
    this.history.push({ body: this.body.slice(), parts: this.parts.slice(), ports: new Map(this.ports), wheels: { ...this.build.ports } });
    if (this.history.length > 200) this.history.shift();
  }
  undo() {
    const h = this.history.pop();
    if (!h) return;
    this.body = h.body; this.parts = h.parts; this.ports = h.ports;
    this.build = this.normalize({ ...this.build, ports: h.wheels });
    this.selected = null;
    this._rebuild(true);
  }

  /** The parts in the scene: the robot's own, and the child's attachment when it is the one on the robot. */
  _all() { return this.mode === 'custom' ? [...this.body, ...this.parts] : this.body; }

  /** Rebuild the scene, meshes and status after any change; `changed`: the robot changed, put it on the table. */
  _rebuild(changed = false) {
    this.scene = new Scene(this.D, this._all());
    const { ld, drive } = this.three;
    for (const m of this.meshes || []) m.parent && m.parent.remove(m);
    this.meshes = [];
    this.an = this.scene.analyze();
    this.stopsCache = null;
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
      if (it === this.selected) { tint(m, 0x0A8DFF, 0.5); m.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0x0A4F99); }); }   // black parts show it too
      (onDrive.has(bodyOf.get(it)) ? drive : ld).add(m);
      this.meshes.push(m);
    }
    this._poseDrive();
    this._summary();
    this._selBar();
    if (changed) this._emit(); else this._sidePanel();
    if (this.ghost) this._snap();
  }

  _poseDrive() {
    if (!this.three) return;
    const turn = (group, R, at) => {
      const t = sub(at, app(R, at));
      group.matrix.set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1);
      group.matrixWorldNeedsUpdate = true;
    };
    turn(this.three.drive, driveRot(this.motor), DRIVE_AXLE.at);
    const b = BUILT_IN.find((x) => x.module === this.mode) || {};
    turn(this.three.bmove, b.axis ? rotAxis(b.axis, this.motor * DEG) : driveRot((b.sign || 1) * this.motor), b.at || DRIVE_AXLE.at);
  }

  /** How far motor E can turn what is on it: a built-in attachment's stops, or where the child's build meets the robot. */
  _stops() {
    if (this.mode === 'none') return [-120, 120];
    if (this.mode !== 'custom') return MODULE_STOPS[this.mode] || [-120, 120];
    if (!this.stopsCache) this.stopsCache = this.parts.length ? motionOf(this.D, this.scene, this.an).stops.map((v) => Math.max(-120, Math.min(120, v))) : [-120, 120];
    return this.stopsCache;
  }

  /** Turn motor E in the preview (the slider, or Q and E), only as far as the build lets it. */
  setMotor(deg) {
    const [lo, hi] = this._stops();
    this.motor = Math.round(Math.max(lo, Math.min(hi, deg)));
    if (this.slider) { this.slider.min = lo; this.slider.max = hi; this.slider.value = this.motor; this.sliderOut.textContent = `${this.motor}°`; }
    this._poseDrive();
    if (this.ghost) this._snap();
  }

  _summary() {
    const an = this.an;
    const sensorItems = this.scene.parts.filter((it) => SENSOR_PARTS[it.q.f]);
    const base = an.bodies.find((b) => b.role === 'base');
    const notFixed = sensorItems.filter((it) => !base || !base.items.includes(it)).length;
    const nSensors = sensorItems.length;
    const bits = [];
    let warn = false;
    bits.push(nSensors ? `${nSensors} sensor${nSensors === 1 ? '' : 's'}` : 'No sensors');
    if (notFixed) { bits.push(`${notFixed === 1 ? 'A sensor is' : `${notFixed} sensors are`} not fixed to the robot: it reads from where it was built, so fix sensors to the robot itself.`); warn = true; }
    const b = BUILT_IN.find((x) => x.module === this.mode);
    if (this.mode === 'none') bits.push('No attachment');
    else if (this.mode !== 'custom') bits.push(`${b.label}: ${b.note}. Motor E turns it`);
    else {
      const onDrive = this._driveBodies();
      const moving = this.scene.parts.filter((it) => an.bodies.some((bd, i) => onDrive.has(i) && bd.items.includes(it))).length;
      bits.push(this.parts.length ? `Your attachment: ${this.parts.length} part${this.parts.length === 1 ? '' : 's'}, ${moving} turn${moving === 1 ? 's' : ''} with motor E` : 'Your attachment: empty. Snap a part onto the orange axle in the bracket (motor E turns it)');
      if (an.jammed) { bits.push('The drive axle is locked to the robot: motor E cannot turn.'); warn = true; }
    }
    if (an.loose.length) { bits.push(`${an.loose.length} part${an.loose.length === 1 ? ' is' : 's are'} not attached to anything (red) and would fall off.`); warn = true; }
    this.status(bits.join(' · '), warn);
  }

  /** The selected part's bar over the view: its name, its port (a sensor), Move and Remove. */
  _selBar() {
    if (!this.selEl) return;
    const it = this.selected;
    this.selEl.hidden = !it;
    if (!it) return;
    const sp = SENSOR_PARTS[it.q.f];
    this.selEl.querySelector('.lb-sel-name').textContent = sp ? sp.label : shortName(this.D.parts.parts[it.q.f].d);
    const portEl = this.selEl.querySelector('.lb-sel-port');
    portEl.hidden = !sp;
    if (sp) {
      const cur = this.ports.get(it.q) || '';
      portEl.querySelector('select').innerHTML = PORT_LETTERS.map((p) => `<option value="${p}"${p === cur ? ' selected' : ''}>${p}</option>`).join('') + (cur ? '' : '<option value="" selected>none</option>');
    }
  }

  _selectQ(q) {
    if (!q || !this.scene) return;
    this.selected = this.scene.parts.find((it) => it.q === q) || null;
    this._rebuild();
  }

  removeSelected() {
    const it = this.selected;
    if (!it) return;
    this._push();
    this.body = this.body.filter((q) => q !== it.q);
    this.parts = this.parts.filter((q) => q !== it.q);
    this.ports.delete(it.q);
    this.selected = null;
    this._rebuild(true);
    this.message('');
  }

  /** Pick the selected part up again to put it somewhere else (a sensor keeps its port). */
  moveSelected() {
    const it = this.selected;
    if (!it) return;
    this._push();
    const port = this.ports.get(it.q) || null;
    const inBody = this.body.includes(it.q);
    this.body = this.body.filter((q) => q !== it.q);
    this.parts = this.parts.filter((q) => q !== it.q);
    this.ports.delete(it.q);
    this.selected = null;
    this._rebuild(true);
    this.pick(it.q.f, { port, inBody, from: it.q });
  }

  _download() {
    const blob = new Blob([toLdr(this.parts)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'attachment.ldr';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------- placing parts ----------------
  /** Take a part in hand to place it; `carry`: a part being moved ({port, inBody, from}). */
  pick(f, carry = null) {
    this._dropGhost();
    this.selected = null;
    this._selBar();
    const tpl = this.tpl.get(f);
    if (!tpl) return;
    const own = this.D.snaps[f].s.filter((c) => c.k === 'cyl' && !c.gp);
    const mesh = tpl.clone();
    // the part in hand is drawn over everything (it is often half inside the robot) and lit green where it fits
    mesh.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.75; o.material.depthWrite = false; o.material.depthTest = false; o.renderOrder = 9; } });
    mesh.matrixAutoUpdate = false; mesh.visible = false;
    this.three.ld.add(mesh);
    this.ghost = { f, own, k: 0, flip: false, roll: 0, slide: 0, mesh, q: null, ok: false, carry };
    this.root.querySelectorAll('.lb-part').forEach((b) => b.classList.toggle('on', b.dataset.part === f));
    const sp = SENSOR_PARTS[f];
    const name = sp ? sp.label : shortName(this.D.parts.parts[f].d);
    this.message(sp ? `${name}: snap it onto a hole or pin of the robot.${sp.type === 'color' ? ' Point it down at the mat, close to it.' : ''}`
      : this.mode === 'custom' ? `${name}: move it onto the orange axle (motor E turns it), or onto a hole or pin.`
      : `${name}: snap it onto the robot (to hold a sensor, say). To build an attachment, pick "My own" above.`);
    this._guide();
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
        // the drive axle is where an attachment starts: it wins over robot holes about as near the pointer. A
        // built-in attachment has it, and sensors stay off it
        if (it.role === 'drive' && (this.mode !== 'custom' || SENSOR_PARTS[g.f])) continue;
        const bias = it.role === 'drive' ? 14 : 0;
        if (dist < 26) cands.push({ c, it, dist: dist - bias, z: Math.min(a.z, b.z), at: frac * c.len });
      }
    }
    cands.sort((p, q) => p.dist - q.dist || p.z - q.z);
    let found = null, near = null;
    for (const cand of cands.slice(0, 8)) {
      if (this.motor !== 0 && this._onDriveItem(cand.it)) continue;
      // the way the part is held first; if it does not fit that way, the other turns and the flip (a beam goes onto
      // the drive axle only square to it, which a child should not have to find with R and F)
      const ways = [];
      for (const fl of [g.flip, !g.flip]) for (let d = 0; d < 4; d++) ways.push([fl, (g.roll + d) % 4]);   // R keeps going round
      for (const [flip, roll] of ways) {
      if (found) break;
      // on the drive axle a + hole grips and turns with it; a round hole only spins on it, so + holes are tried first
      const ks = g.own.map((_, i) => (g.k + i) % g.own.length);
      if (cand.it.role === 'drive') ks.sort((x, y) => gripsAxle(g.own[y]) - gripsAxle(g.own[x]));
      for (const k of ks) {
        if (found) break;
        if (g.own[k].g === cand.c.g) continue;
        const opts = this.scene.placementsOnto(g.f, k, cand.c, flip, roll);
        if (!opts.length) continue;
        // the best fits, nearest the pointer first
        const good = opts.filter((o) => this.scene.check(o.q).ok).sort((p, q) => Math.round(q.eng) - Math.round(p.eng) || Math.abs(p.mid - cand.at) - Math.abs(q.mid - cand.at));
        if (!good.length) { if (!near) near = { q: opts[0].q, why: this.scene.check(opts[0].q).why, c: cand.c }; continue; }
        const byT = good.slice().sort((p, q) => p.t - q.t);
        const i0 = byT.indexOf(good[0]);
        const pick = byT[Math.max(0, Math.min(byT.length - 1, i0 + g.slide))];
        found = { q: pick.q, c: cand.c, k, slides: byT.length, flip, roll, spins: cand.it.role === 'drive' && !gripsAxle(g.own[k]) };
      }
      }
      if (found) break;
    }
    if (this.motor !== 0 && !found && cands.some((c) => this._onDriveItem(c.it))) this.message('Set "Try motor E" back to 0 to add parts to the moving arm.');
    const res = found || near;
    if (!res) {
      g.q = null; g.ok = false; g.mesh.visible = false;
      this._guide();
      return;
    }
    g.q = res.q; g.ok = !!found; g.kUsed = found ? found.k : g.k;
    if (found) { g.flip = found.flip; g.roll = found.roll; }   // R and F carry on from the way it fits
    g.mesh.matrix.copy(placementMatrix(res.q)); g.mesh.visible = true;
    g.mesh.traverse((o) => { if (o.isMesh) { o.material.emissive && o.material.emissive.setHex(found ? 0x1FA347 : 0xC81E1E); } });
    // mark the connector it goes onto
    const c = res.c, mid = add(c.o, scl(c.d, c.len / 2));
    this.marker.position.set(...mid);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...c.d));
    this.marker.scale.set(3, c.len + 2, 3);
    this.marker.material.color.setHex(found ? 0xFFB000 : 0xE8232A);
    this.marker.visible = true;
    const name = shortName(this.D.parts.parts[g.f].d);
    this.message(!found ? `It ${res.why} here: try R, F or Tab.`
      : found.spins ? `${name}: click to place. Its round hole spins freely on the axle, so motor E will not turn it: start with a part that has a + hole (a bent liftarm, a cross block, the 2 liftarm) and build on that.`
      : `${name}: click to place.${found.slides > 1 ? ' [ ] slides it along.' : ''}`);
  }

  /** Nothing under the pointer to snap onto: show where to start, the drive axle in the bracket. */
  _guide() {
    if (this.mode !== 'custom' || (this.ghost && SENSOR_PARTS[this.ghost.f])) { this.marker.visible = false; return; }
    const L = 140, mid = DRIVE_AXLE.at;
    this.marker.position.set(...mid);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...DRIVE_AXLE.axis));
    this.marker.scale.set(4, L + 4, 4);
    this.marker.material.color.setHex(0xFFB000);
    this.marker.visible = true;
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
      const g = this.ghost;
      if (!g.ok || !g.q) return;
      this._push();
      const sp = SENSOR_PARTS[g.f];
      // sensors and whatever is built while a built-in attachment (or none) is on are the robot's own parts
      const toBody = sp || this.mode !== 'custom' || (g.carry && g.carry.inBody);
      (toBody ? this.body : this.parts).push(g.q);
      let note = 'Placed.';
      if (sp) {
        const port = (g.carry && g.carry.port) || this._freePort();
        if (port) this.ports.set(g.q, port);
        note = port ? `${sp.label} placed, on port ${port}.` : `${sp.label} placed: every port is taken, so pick one for it.`;
      }
      this._rebuild(true);
      if (g.carry) {
        this._dropGhost();
        this.selected = this.scene.parts.find((it) => it.q === g.q) || null;
        this._rebuild();
        this.message(note);
        return;
      }
      this.message(`${note} Click to put another ${sp ? sp.label.toLowerCase() : shortName(this.D.parts.parts[g.f].d)} on, or Esc to stop.`);
      return;
    }
    const it = this._raycast();
    this.selected = it || null;
    this._rebuild();
    if (it) this.message(SENSOR_PARTS[it.q.f] ? 'Pick its port above, or move it.' : 'M moves it, Delete takes it off.');
    else this.message('');
  }

  _key(e) {
    if (!this.root || this.root.hidden) return;
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    const g = this.ghost;
    let used = true;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') this.undo();
    else if (k === 'Escape') { if (g) { if (g.carry) this.undo(); this._dropGhost(); } else if (this.selected) { this.selected = null; this._rebuild(); } else this.done(); }
    else if (!g && (k === 'm' || k === 'M') && this.selected) this.moveSelected();
    else if (g && (k === 'r' || k === 'R')) { g.roll = (g.roll + (e.shiftKey ? 3 : 1)) % 4; this._snap(); }
    else if (g && (k === 'f' || k === 'F')) { g.flip = !g.flip; g.slide = 0; this._snap(); }
    else if (g && k === 'Tab') { g.k = ((g.kUsed ?? g.k) + (e.shiftKey ? g.own.length - 1 : 1)) % g.own.length; g.slide = 0; this._snap(); }
    else if (g && k === ']') { g.slide++; this._snap(); }
    else if (g && k === '[') { g.slide--; this._snap(); }
    else if ((k === 'Delete' || k === 'Backspace') && this.selected) this.removeSelected();
    else if (!e.ctrlKey && !e.metaKey && (k === 'q' || k === 'Q' || k === 'e' || k === 'E')) {
      this.setMotor(this.motor + (k.toLowerCase() === 'q' ? 4 : -4));   // like driving: Q raises, E lowers
    } else if (!e.ctrlKey && !e.metaKey && ((k.length === 1 && 'wasdWASD'.includes(k)) || k.startsWith('Arrow'))) {
      e.stopPropagation();          // the robot does not drive about under the builder
      return;
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
}

/** A female connector with an axle (+) section: an axle in it turns it. */
function gripsAxle(c) { return c.g === 'F' && (c.s || []).some((x) => x[0] === 'A') ? 1 : 0; }

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
