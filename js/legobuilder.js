// The robot builder: the LEGO Driving Base with its sensors and its attachment, built from real LEGO parts that snap
// together where LEGO really connects (see lego.js). Sensors snap onto the robot and plug into a hub port; the
// attachment is a built-in one or the child's own, built on the arm bracket's axle, which motor E turns.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadLego, usable, Scene, DRIVE_AXLE, DRIVE_PARTS, CHASSIS_DRIVES, parseLdr, toLdr, app, sub, add, scl, dot, rotAxis, mul, I3, LDU, boxesOverlap, baseBoxes, partBoxes } from './lego.js';
import { LD_TO_ROBOT, ldToRobot, loadRaw, flatten, partTemplates, partMesh, placementMatrix } from './lego3d.js';
import { MODULE_STOPS, PORT_LETTERS } from './robot.js';
import { SENSOR_PARTS, MODULES, CHASSIS, validateBuild, FREE_STOP } from './build.js';
import { InstructionsViewer } from './instructions.js';
import { EXAMPLE_ARM, TOOL_PRESETS } from './tools.js';
export { TOOL_PRESETS };

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
  // sweep the moving parts both ways until they meet the Driving Base, the bracket or the parts fixed to the robot
  // (its sensors and what holds them, the attachment's own fixed parts); pairs touching at rest don't count
  const onDrive = new Set(an.bodies.map((b, i) => (b.role === 'drive' || b.role === 'geared' ? i : -1)).filter((i) => i >= 0));
  for (let grew = true; grew;) { grew = false; for (const j of an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) if (onDrive.has(x) && !onDrive.has(y) && an.bodies[y].role !== 'base') { onDrive.add(y); grew = true; } }
  const loose = new Set(an.loose);
  const base = [...baseBoxes(D)];
  an.bodies.forEach((b, i) => { if (!onDrive.has(i)) for (const it of b.items) if (it.role === 'part' && !loose.has(it)) base.push(...it.boxes); });
  const movingBoxes = items.flatMap((it) => it.boxes);
  const at = DRIVE_AXLE.at;
  const turned = (b, deg) => { const R = driveRot(deg); return { c: add(app(R, sub(b.c, at)), at), h: b.h, R: mul(R, b.R) }; };
  const near = (a, b) => len3(sub(a.c, b.c)) < Math.hypot(...a.h) + Math.hypot(...b.h);
  // the parts are measured as boxes, a little rounder in real life: an overlap of more than about 2 mm stops the arm
  const M = OVERLAP;
  const restHits = new Set();
  movingBoxes.forEach((m, i) => base.forEach((b, j) => { if (near(m, b) && boxesOverlap(m, b, 0)) restHits.add(i + ',' + j); }));
  const hitsAt = (deg) => movingBoxes.some((m0, i) => { const m = turned(m0, deg); return base.some((b, j) => !restHits.has(i + ',' + j) && near(m, b) && boxesOverlap(m, b, M)); });
  const sweep = (dir) => { for (let a = 3; a <= 180; a += 3) if (hitsAt(dir * a)) return dir * (a - 3); return dir * 180; };
  const stops = movingBoxes.length ? [sweep(-1), sweep(1)] : [-180, 180];
  return { length: Math.round(best.length * 100) / 100, tipAngle: Math.round(best.tipAngle * 10) / 10, stops };
}
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
// how far (LDU, off each box's half size) two parts' boxes may sink into each other before a turning part counts as
// hitting: 3 lets about 2 mm through (rounded beam ends, the boxes' corners); more let arms swing into the hub. Two
// boxes that already touch at rest (a tool lying on its frame) slide along each other and never count
const OVERLAP = 3;

/**
 * The bodies a motor turns through gears (and the Advanced Driving Base's drive gears), with what hangs on them by
 * pins: Map body index -> {port, w, at} (w: the turn per motor degree as an axis vector; at: a point on the axle).
 */
export function gearedMotion(an, chassis) {
  const out = new Map();
  an.bodies.forEach((b, i) => { if (b.role === 'geared' || (b.role === 'drive' && chassis !== 'driving-base')) out.set(i, { port: b.port, w: b.w, at: b.at }); });
  for (let grew = true; grew;) {
    grew = false;
    for (const j of an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) {
      if (out.has(x) && !out.has(y) && an.bodies[y].role === 'free') { out.set(y, out.get(x)); grew = true; }
    }
  }
  return out;
}

/** How far each tool motor can turn its geared parts before they run into the robot or the parts that stay put: {port: [lo, hi]}. */
export function toolStops(D, scene, an, ports) {
  const motion = gearedMotion(an, scene.chassis);
  const loose = new Set(an.loose);
  const near = (a, b) => len3(sub(a.c, b.c)) < Math.hypot(...a.h) + Math.hypot(...b.h);
  const out = {};
  for (const port of ports) {
    const moving = [], still = [...baseBoxes(D, scene.chassis)];
    an.bodies.forEach((b, i) => {
      const m = motion.get(i);
      for (const it of b.items) {
        if (it.role !== 'part' || loose.has(it)) continue;
        if (m && m.port === port) { for (const bx of it.boxes) if (!roundAbout(bx, m)) moving.push({ bx, m }); }
        else still.push(...it.boxes);
      }
    });
    if (!moving.length) { out[port] = [-FREE_STOP, FREE_STOP]; continue; }
    const turned = ({ bx, m }, deg) => { const R = rotAxis(unitV(m.w), deg * len3(m.w) * DEG); return { c: add(app(R, sub(bx.c, m.at)), m.at), h: bx.h, R: mul(R, bx.R) }; };
    const rest = new Set();
    // (the Advanced Driving Base's tools keep the looser 8: their stops were checked against LEGO's instructions)
    moving.forEach((mv, i) => still.forEach((s, j) => { if (near(mv.bx, s) && boxesOverlap(mv.bx, s, 8)) rest.add(i + ',' + j); }));
    const hits = (deg) => moving.some((mv, i) => { const t = turned(mv, deg); return still.some((s, j) => !rest.has(i + ',' + j) && near(t, s) && boxesOverlap(t, s, 8)); });
    // sweep the motor until what it drives has turned half a turn (geared down, the motor turns further than that)
    const ratio = Math.max(...moving.map((mv) => len3(mv.m.w))) || 1, step = 3 / ratio;
    const sweep = (dir) => { for (let a = step; a <= 180 / ratio + 1e-6; a += step) if (hits(dir * a)) return dir * Math.round(a - step); return dir * FREE_STOP; };
    out[port] = [sweep(-1), sweep(1)];
  }
  return out;
}
const unitV = (v) => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** A box that turns about its own middle line (a gear or an axle on the axle it turns on) sweeps nothing new. */
function roundAbout(bx, m) {
  const u = unitV(m.w), off = sub(bx.c, m.at), along = dot(off, u);
  if (len3(sub(off, [u[0] * along, u[1] * along, u[2] * along])) > 2) return false;
  for (let k = 0; k < 3; k++) {
    const col = [bx.R[k], bx.R[3 + k], bx.R[6 + k]];
    if (Math.abs(Math.abs(dot(col, u)) - 1) > 1e-3) continue;
    const others = [0, 1, 2].filter((x) => x !== k).map((x) => bx.h[x]);
    return Math.abs(others[0] - others[1]) <= 1;
  }
  return false;
}


const shortName = (d) => d.replace(/^[~=]?(Technic\s+)?/i, '').replace(/\s+/g, ' ').trim();
// the colours the SPIKE Prime sets come in (LDraw codes, values from LDConfig.ldr)
const KIT_COLOURS = {
  0: ['black', '#1B2A34'], 1: ['blue', '#1E5AA8'], 4: ['red', '#B40000'], 14: ['yellow', '#FAC80A'], 15: ['white', '#F4F4F4'],
  19: ['tan', '#D7BA8C'], 26: ['magenta', '#901F76'], 43: ['clear light blue', '#AEE9EF'], 47: ['clear', '#FCFCFC'],
  70: ['brown', '#5F3109'], 71: ['light grey', '#969696'], 72: ['dark grey', '#646464'], 288: ['dark green', '#00451A'],
  322: ['light blue', '#68C3E2'],
};
const colourName = (c) => (KIT_COLOURS[c] || [`colour ${c}`])[0];
// names that say what a child would call the part, where LDraw's description runs long
const NAMES = {
  '39367p01': 'Wheel 56 mm', '49295p01': 'Wheel 88 mm', '18939': 'Turntable 60 base', '18938': 'Turntable 60 top',
  '99009': 'Turntable 28 base', '99010': 'Turntable 28 top', '39369': 'Panel 11 x 19', '65817': 'Panel 11 x 15',
  '45590': 'Rubber joiner', '6553': 'Catch', '69819': 'Fork cross block', '35185': 'Gear 20 angled', '99773': 'Triangle',
  '39370': 'Ball caster cup', '50450': 'Axle 32', '3167': 'Fork beam', '31511': 'Round connector', '49283': 'Cable clip',
  '35327': 'Dish 6 x 6', '41750': 'Shell left', '41749': 'Shell right', '11215': 'Bracket 5 x 2', '6143': 'Round brick 2 x 2',
  '4032a': 'Round plate 2 x 2', '18674': 'Round plate with stud', '15535': 'Round tile with hole', '14769': 'Round tile 2 x 2',
  '98138': 'Round tile 1 x 1', '44126': 'Curved brick 6 x 2', '42022': 'Curved brick 6 x 1', '24309': 'Curved brick 3 x 2',
  '85984': 'Slope 1 x 2', '39789': 'Brick 2 x 4 with holes', '3003': 'Brick 2 x 2',
};

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

const partKey = (q) => q.f + ' ' + q.p.map((v) => Math.round(v)).join(',');
/** Which tool motor's frame a part of the Advanced Driving Base belongs to: the nearer one, front (D) or back (C). */
function toolSide(chassis, q) {
  let best = null, d = Infinity;
  for (const dv of CHASSIS_DRIVES[chassis] || []) { const e = Math.abs(q.p[2] - dv.at[2]); if (e < d) { d = e; best = dv.port; } }
  return best;
}

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
    this.tools = {};          // the Advanced Driving Base's tool motors in the preview: port -> degrees
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
    // a build saved before the stops were worked out this way gets the new ones on the robot
    if (this.mode === 'custom' && !this._toolPorts().length && this.parts.length) {
      const was = this.build.attachment.stops || [], now = motionOf(this.D, this.scene, this.an).stops;
      if (was[0] !== now[0] || was[1] !== now[1]) this._emit();
    }
    this._resize();
    this._loop();
  }

  /** Take a whole build into the builder (on opening, or a robot preset). */
  _load(build, lastCustom) {
    this.build = this.normalize(build);
    this._context(this.build.chassis);
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

  /** The robot's own model in the view (the chassis, its wheels, the Driving Base's arm bracket), once per chassis. */
  _context(chassis) {
    if (!this.three || this.contextOf === chassis) return;
    this.contextOf = chassis;
    const ch = CHASSIS[chassis] || CHASSIS['driving-base'];
    const { ld, controls } = this.three;
    for (const c of ld.children.filter((c) => c.userData.context)) ld.remove(c);
    ld.matrix.copy(ldToRobot(ch.axleZ * LDU));
    ld.matrixWorldNeedsUpdate = true;
    const gen = (this.contextGen = (this.contextGen || 0) + 1);
    for (const url of [ch.model, ch.wheels, ...ch.context]) {
      loadRaw(url).then((g) => { if (g && gen === this.contextGen) { const f = flatten(g); f.userData.context = true; ld.add(f); } });
    }
    // look at the arm bracket's axle on the Driving Base, at the middle of the front on another chassis
    if (chassis === 'driving-base') { const pivot = toRobot(DRIVE_AXLE.at); controls.target.set(pivot[0] + 3, pivot[1] - 1, pivot[2]); }
    else controls.target.set(ch.footprint.x1 - 6, 3, 0);
    this.home = { target: controls.target.clone(), pos: controls.target.clone().add(this.three.homeOffset) };
    this.three.camera.position.copy(this.home.pos);
    this.camAnim = null;
    const attach = !!ch.attachments;
    this.root.querySelectorAll('.lb-preset').forEach((b) => {
      const m = b.dataset.module;
      if (b.dataset.tool) { b.hidden = b.dataset.chassis !== chassis; return; }
      b.hidden = !attach && m !== 'none' && m !== 'custom';      // the bracket's attachments only show on the Driving Base
      b.disabled = !attach && m !== 'none' && !(m === 'custom' && ch.custom);
      b.title = b.disabled ? `Made for the Driving Base's arm bracket` : m === 'custom' && ch.tools.length ? 'Build tools on the front and back frames: a gear meshing with a tool motor\'s 28-tooth gear turns with it' : (BUILT_IN.find((x) => x.module === m) || {}).note || '';
    });
    const sub = this.root.querySelector('.lb-presets > span');
    if (sub) sub.innerHTML = ch.tools.length ? 'Attachment <small>tool motors D and C</small>' : 'Attachment <small>motor E</small>';
    this._sliders();
  }

  /** Show a built-in attachment, none, or the child's own build ('custom'); `tell` puts the choice on the robot. */
  setModule(module, tell = false) {
    if (!this.three || !this.D) { this.mode = module; return; }
    const chs = this.build && (CHASSIS[this.build.chassis] || {});
    if (module !== 'none' && chs && !(module === 'custom' ? chs.custom : chs.attachments)) {
      this.message(`The attachments here fit the Driving Base's arm bracket. The ${CHASSIS[this.build.chassis].label} has none yet.`);
      return;
    }
    if (this.mode === 'custom' && module !== 'custom') this._settleBody();
    // building your own from the arm starts from the arm's own parts
    if (module === 'custom' && this.mode === 'arm' && !this.parts.length) this.parts = parseLdr(EXAMPLE_ARM);
    this._dropGhost();
    this.mode = module;
    this.selected = null;
    this._presetMarks();
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
    const onDrive = new Set(an.bodies.map((b, i) => (b.role === 'drive' || b.role === 'geared' ? i : -1)).filter((i) => i >= 0));
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
      else if ((CHASSIS[this.build.chassis] || {}).tools.length) {
        const scene = new Scene(this.D, [...body, ...keep], this.build.chassis);
        attachment = { module: 'custom', ldr: keep.length ? toLdr(keep) : '', stops: toolStops(this.D, scene, scene.analyze(), this._toolPorts()) };
      } else {
        const scene = new Scene(this.D, [...body, ...keep], this.build.chassis);
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

  /** A ready-made tool (TOOL_PRESETS): its parts become the child's own build, to use or change. */
  useTool(id) {
    const t = (TOOL_PRESETS[this.build.chassis] || []).find((x) => x.id === id);
    if (!t) return;
    this._push();
    const was = this.mode === 'custom';
    if (!was) this.setModule('custom');
    // it replaces what is on its own tool frame and keeps the other frame's tool (a lift arm in front, a dozer behind);
    // a tool with no motor goes on next to what is there (the arm comes along)
    const own = new Set(parseLdr(t.ldr).map(partKey));
    const keep = !t.port ? this.parts.filter((q) => !own.has(partKey(q))) : was ? this.parts.filter((q) => toolSide(this.build.chassis, q) !== t.port) : [];
    this.parts = keep.concat(parseLdr(t.ldr).filter((q) => this.D.parts.parts[q.f]));
    this.selected = null;
    this._rebuild(true);
    this.message(`${t.label}: ${t.note}. Change it as you like.`);
  }

  /** Which button in the attachment row is the robot's: a built-in, a ready-made tool (when the build is it), or My own. */
  _presetMarks() {
    if (!this.root) return;
    // a ready-made tool is on when all its parts are there; "My own" when the build is anything more (or other)
    const have = new Set(this.mode === 'custom' ? this.parts.map(partKey) : []);
    const on = (TOOL_PRESETS[this.build && this.build.chassis] || []).filter((t) => have.size && parseLdr(t.ldr).every((q) => have.has(partKey(q))));
    const covered = new Set(on.flatMap((t) => parseLdr(t.ldr).map(partKey)));
    const mine = this.mode === 'custom' && (!on.length || [...have].some((k) => !covered.has(k)));
    this.root.querySelectorAll('.lb-preset').forEach((b) => b.classList.toggle('on', b.dataset.tool ? on.some((t) => t.id === b.dataset.tool) : b.dataset.module === this.mode && (this.mode !== 'custom' || mine)));
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

  /** LEGO-style steps to build the attachment on the robot now (a built-in one from its model, or the child's own). */
  async instructions() {
    if (!this.D) return;
    const chassis = this.build.chassis;
    let build = null;
    const b = BUILT_IN.find((x) => x.module === this.mode);
    if (b && b.file) {
      // the model's own parts, in the robot's frame (the file's origin is on the drive axle)
      const text = await (await fetch(`models/attach/${b.file}.mpd`)).text();
      const main = text.split(/^0 FILE /m).filter(Boolean)[0] || '';
      const at = b.at || DRIVE_AXLE.at;
      build = { title: `${b.label}`, chassis, file: b.file, at, qs: parseLdr(main).map((q) => ({ ...q, p: add(q.p, at) })) };
    } else if (this.mode === 'custom' && this.parts.length) {
      const tools = (TOOL_PRESETS[chassis] || []).filter((t) => this.root.querySelector(`.lb-preset.on[data-tool="${t.id}"]`));
      build = { title: tools.length === 1 && !this.root.querySelector('.lb-preset.on[data-module="custom"]') ? tools[0].label : 'My attachment', chassis, qs: this.parts.slice() };
    }
    if (!build) { this.message('Pick an attachment first (or build your own): the instructions are for the one on the robot.'); return; }
    if (!this.viewer) this.viewer = new InstructionsViewer({ names: NAMES });
    await this.viewer.open(this.D, build);
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
          ${BUILT_IN.filter((b) => b.module !== 'custom').map((b) => `<button type="button" class="lb-preset" data-module="${b.module}"${b.note ? ` title="${b.note}"` : ''}>${b.label}</button>`).join('')}
          ${Object.entries(TOOL_PRESETS).flatMap(([ch, list]) => list.map((t) => `<button type="button" class="lb-preset" data-tool="${t.id}" data-chassis="${ch}" title="${t.note}" hidden>${t.label}</button>`)).join('')}
          <button type="button" class="lb-preset" data-module="custom">My own</button>
        </div>
        <div class="lb-tools">
          <button type="button" class="tb" data-act="steps" title="Step-by-step pictures to build this attachment with the real LEGO parts">Instructions</button>
          <a class="tb" href="tools.html" target="_blank" rel="noopener" title="Which missions each Advanced Driving Base tool scores, where to put the robot and the moves">Tool guide</a>
          <button type="button" class="tb" data-act="clear" data-custom title="Take your attachment's parts off">Clear</button>
          <button type="button" class="tb" data-act="load" data-custom>Open .ldr</button>
          <button type="button" class="tb" data-act="save" data-custom>Save .ldr</button>
        </div>
      </div>
      <div class="lb-body">
        <div class="lb-palette" role="list"></div>
        <div class="lb-view">
          <div class="lb-keys">Pick a part on the left, then click the robot where it goes. <b>Drag</b> to look around · <b>right-drag</b> to shift the view · <b>scroll</b> to zoom · <b>double-click</b> to look closer</div>
          <div class="lb-cam" role="group" aria-label="View">
            <button type="button" data-cam="front" title="Look at the front of the robot">Front</button>
            <button type="button" data-cam="side" title="Look at the robot from the side">Side</button>
            <button type="button" data-cam="back" title="Look at the back of the robot">Back</button>
            <button type="button" data-cam="top" title="Look down on the robot">Top</button>
            <button type="button" data-cam="in" title="Zoom in" aria-label="Zoom in">+</button>
            <button type="button" data-cam="out" title="Zoom out" aria-label="Zoom out">−</button>
            <button type="button" data-cam="home" title="Back to the first view">Reset</button>
          </div>
          <div class="lb-hand" hidden>
            <b class="lb-hand-name"></b>
            <button type="button" class="tb" data-hand="turn" title="Turn it a quarter turn (R)">↻ Turn</button>
            <button type="button" class="tb" data-hand="flip" title="Flip it over (F)">⇅ Flip</button>
            <button type="button" class="tb" data-hand="hole" title="Hold it by another hole or pin (Tab)">Other hole</button>
            <span class="lb-colours" data-for="hand" hidden></span>
            <span class="lb-hand-slide"><button type="button" class="tb" data-hand="back" title="Slide it along ([)" aria-label="Slide back">◀</button><small>slide</small><button type="button" class="tb" data-hand="fwd" title="Slide it along (])" aria-label="Slide forward">▶</button></span>
            <button type="button" class="lb-sel-x" data-hand="cancel" title="Put it back (Esc or right-click)" aria-label="Put it back">×</button>
          </div>
          <div class="lb-sel" hidden>
            <b class="lb-sel-name"></b>
            <label class="lb-sel-port" hidden>Port <select></select></label>
            <span class="lb-colours" data-for="sel" hidden></span>
            <button type="button" class="tb" data-sel="move" title="Pick it up and put it somewhere else (M)">Move</button>
            <button type="button" class="tb" data-sel="delete" title="Take it off (Delete)">Remove</button>
            <button type="button" class="lb-sel-x" data-sel="close" title="Deselect (Esc, or click empty space)" aria-label="Deselect">×</button>
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
    r.querySelector('.lb-presets').addEventListener('click', (e) => {
      const b = e.target.closest('.lb-preset');
      if (!b) return;
      if (b.dataset.tool) this.useTool(b.dataset.tool); else this.setModule(b.dataset.module, true);
    });
    r.querySelector('.lb-robots').addEventListener('click', (e) => { const b = e.target.closest('.lb-robot'); if (b) this.usePreset(b.dataset.robot); });
    this.msgEl = r.querySelector('.lb-msg');
    this.statusEl = r.querySelector('.lb-status');
    r.querySelector('.lb-motor').addEventListener('input', (e) => {
      const port = e.target.dataset.port;
      if (port === 'E') this.setMotor(Number(e.target.value)); else if (port) this.setTool(port, Number(e.target.value));
    });
    // the selected part's bar: its port (a sensor), move it, take it off
    this.selEl = r.querySelector('.lb-sel');
    this.selEl.addEventListener('click', (e) => { const sw = e.target.closest('[data-colour]'); if (sw) { this.colourSelected(Number(sw.dataset.colour)); return; } const b = e.target.closest('[data-sel]'); if (!b) return; if (b.dataset.sel === 'move') this.moveSelected(); else if (b.dataset.sel === 'close') this.deselect(); else this.removeSelected(); });
    this.selEl.querySelector('select').addEventListener('change', (e) => { if (this.selected) this.setPort(this.selected.q, e.target.value); });
    // the part in hand's bar: the same moves as R, F, Tab and [ ]
    this.handEl = r.querySelector('.lb-hand');
    this.handEl.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-colour]'); if (sw) { this.colourHand(Number(sw.dataset.colour)); return; }
      const b = e.target.closest('[data-hand]'); if (!b) return;
      const a = b.dataset.hand;
      if (a === 'turn') this.turnHand(1); else if (a === 'flip') this.flipHand(); else if (a === 'hole') this.otherHole(1);
      else if (a === 'back') this.slideHand(-1); else if (a === 'fwd') this.slideHand(1); else this.deselect();
    });
    r.querySelector('.lb-cam').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (b) this.view3(b.dataset.cam); });
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
      else if (act === 'steps') this.instructions();
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
    const motor = MODULES[b.attachment.module] && MODULES[b.attachment.module].motor && !((CHASSIS[b.chassis] || {}).tools || []).length;
    const rows = [
      `<div class="lb-port"><i class="dev motor"></i><span>Left wheel motor</span>${sel(b.ports.left, 'data-wheel="left" aria-label="Left wheel motor port"')}</div>`,
      `<div class="lb-port"><i class="dev motor"></i><span>Right wheel motor</span>${sel(b.ports.right, 'data-wheel="right" aria-label="Right wheel motor port"')}</div>`,
    ];
    if (motor) rows.push(`<div class="lb-port"><i class="dev motor"></i><span>Attachment motor</span><b class="fixed">E</b></div>`);
    for (const t of (CHASSIS[b.chassis] || {}).tools || []) rows.push(`<div class="lb-port"><i class="dev motor"></i><span>${t.label}</span><b class="fixed">${t.port}</b></div>`);
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
    const used = new Set([b.ports.left, b.ports.right, motor ? 'E' : null, ...((CHASSIS[b.chassis] || {}).tools || []).map((t) => t.port), ...[...this.ports.values()]]);
    const free = PORT_LETTERS.filter((p) => !used.has(p));
    const issues = validateBuild(b);
    const sensors = this.body.some((q) => SENSOR_PARTS[q.f]);
    this.sideEl.innerHTML = `<h4>Hub ports</h4>${rows.join('')}
      ${sensors ? '' : '<p class="lb-hint">No sensors yet: pick one from Sensors on the left and snap it onto the robot.</p>'}
      <p class="lb-hint">Free: ${free.length ? free.join(', ') : 'none'}</p>
      <p class="lb-issues">${issues.join(' ')}</p>
      <p class="lb-hint">A color sensor reads the mat when it looks down at it from close by (up to about 2 cm; nothing past 4.5). A distance sensor measures along the way its eyes look. A force sensor's button reads when something is against it, harder the harder the robot pushes (up to 10 N).</p>`;
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
    const tools = ((CHASSIS[this.build.chassis] || {}).tools || []);
    if (port === 'E' && MODULES[this.build.attachment.module].motor && !tools.length) { this.message('Port E is the attachment motor.'); this._sidePanel(); this._selBar(); return; }
    const tool = tools.find((t) => t.port === port);
    if (tool) { this.message(`Port ${port} is the ${tool.label.toLowerCase()}.`); this._sidePanel(); this._selBar(); return; }
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
    const used = new Set([b.ports.left, b.ports.right, MODULES[b.attachment.module].motor ? 'E' : null, ...((CHASSIS[b.chassis] || {}).tools || []).map((t) => t.port), ...this.ports.values()]);
    return ['B', 'F', 'A', 'E', 'C', 'D'].find((p) => !used.has(p)) || null;
  }

  _palette() {
    const pal = this.root.querySelector('.lb-palette');
    if (pal.childElementCount) return;
    for (const cat of this.D.parts.categories) {
      if (cat.name.startsWith('_')) continue;           // parts kept only so old builds load
      const det = document.createElement('details');
      det.open = ['Sensors', 'Beams', 'Pins', 'Axles', 'Connectors'].includes(cat.name);
      det.innerHTML = `<summary>${cat.name}</summary><div class="lb-grid"></div>`;
      if (cat.name === 'Sensors') { det.classList.add('sensors'); det.querySelector('summary').insertAdjacentHTML('afterend', '<p class="lb-hint">Snap one onto the robot, then pick its port.</p>'); }
      const grid = det.querySelector('.lb-grid');
      for (const f of cat.parts) {
        const info = this.D.parts.parts[f];
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lb-part'; b.dataset.part = f;
        const cs = info.cs || [[info.c, 0]];
        b.title = `${NAMES[f] || shortName(info.d)} (${f}). In the kit: ${cs.map(([c, n]) => `${n} ${colourName(c)}`).join(', ')}`;
        b.innerHTML = `<img alt=""><span>${SENSOR_PARTS[f] ? SENSOR_PARTS[f].label : NAMES[f] || shortName(info.d)}</span>`
          + (cs.length > 1 ? `<i class="lb-dots">${cs.map(([c]) => `<b style="background:${(KIT_COLOURS[c] || [0, '#999'])[1]}"></b>`).join('')}</i>` : '');
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
    controls.zoomToCursor = true;          // scroll zooms toward what the pointer is on
    controls.minDistance = 3; controls.maxDistance = 160;
    controls.addEventListener('start', () => { this.camAnim = null; });
    const homeOffset = camera.position.clone().sub(controls.target);
    const ld = new THREE.Group(); ld.matrixAutoUpdate = false; ld.matrix.copy(LD_TO_ROBOT); scene.add(ld);
    const drive = new THREE.Group(); drive.matrixAutoUpdate = false; ld.add(drive);
    const bmove = new THREE.Group(); bmove.matrixAutoUpdate = false; ld.add(bmove);   // a built-in attachment's moving part
    this.three = { renderer, scene, camera, controls, ld, drive, bmove, grid, homeOffset };
    this.contextOf = null;
    this.marker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshBasicMaterial({ color: 0xFFB000, transparent: true, opacity: 0.85, depthTest: false }));
    this.marker.renderOrder = 10; this.marker.visible = false; ld.add(this.marker);
    const el = renderer.domElement;
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerdown', (e) => { this.downAt = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      const still = this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) < 5;
      this.downAt = null;
      if (!still) { if (this.ghost) { this.mouse = this._pointer(e); this._snap(); } return; }
      if (e.button === 2) this.deselect(); else this._click(e);      // right-click: put it down, or deselect
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => { this.mouse = this._pointer(e); this.focusAt(); });
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
      this._camStep(controls, camera);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();
  }

  /** The camera buttons: look at the robot from the front, side, back or top, zoom, or the first view again. */
  view3(which) {
    if (!this.three) return;
    const { camera, controls } = this.three;
    const t = controls.target.clone(), off = camera.position.clone().sub(t);
    let target = t, pos;
    if (which === 'home') { target = this.home.target.clone(); pos = this.home.pos.clone(); }
    else if (which === 'in' || which === 'out') pos = t.clone().addScaledVector(off, which === 'in' ? 0.65 : 1.5);
    else {
      // the whole robot: its middle, from far enough to see all of it (the robot's +x is its front, +y up, +z its right)
      const fp = (CHASSIS[this.build && this.build.chassis] || CHASSIS['driving-base']).footprint;
      target = new THREE.Vector3((fp.x0 + fp.x1) / 2, 6, 0);
      const dir = { front: [1, 0.45, 0], back: [-1, 0.45, 0], side: [0, 0.45, -1], top: [-0.03, 1, 0] }[which];
      if (!dir) return;
      pos = target.clone().addScaledVector(new THREE.Vector3(...dir).normalize(), Math.max(38, Math.min(70, off.length())));
    }
    const d = pos.distanceTo(target), lim = Math.max(controls.minDistance, Math.min(controls.maxDistance, d));
    pos = target.clone().addScaledVector(pos.clone().sub(target).normalize(), lim);
    this._camTo(pos, target);
  }

  /** Double-click: look closer at the spot under the pointer (it becomes what the view turns around). */
  focusAt() {
    const m = this.mouse;
    if (!m || !this.three) return;
    const { camera, controls, ld } = this.three;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(m.x / m.w * 2 - 1, -(m.y / m.h) * 2 + 1), camera);
    const targets = ld.children.filter((o) => o !== this.marker && (!this.ghost || o !== this.ghost.mesh));
    const hit = ray.intersectObjects(targets, true).find((h) => h.object.visible && (h.object.isMesh));
    if (!hit) return;
    const off = camera.position.clone().sub(controls.target);
    const d = Math.max(controls.minDistance, Math.min(off.length() * 0.6, 22));
    this._camTo(hit.point.clone().addScaledVector(off.normalize(), d), hit.point.clone());
  }

  _camTo(pos, target) {
    const { camera, controls } = this.three;
    this.camAnim = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now() };
  }

  /** One frame of a camera move (a third of a second, eased). */
  _camStep(controls, camera) {
    const a = this.camAnim;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.start) / 350), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(a.p0, a.p1, e);
    controls.target.lerpVectors(a.t0, a.t1, e);
    if (k >= 1) { this.camAnim = null; if (this.ghost) this._snap(); }
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
    this.rebuilds = (this.rebuilds || 0) + 1;
    this.scene = new Scene(this.D, this._all(), this.build.chassis);
    const { ld, drive } = this.three;
    for (const m of this.meshes || []) m.parent && m.parent.remove(m);
    for (const g of this.gearGroups || []) ld.remove(g.group);
    this.meshes = [];
    this.an = this.scene.analyze();
    this.stopsCache = null; this.toolStopsCache = null;
    // bodies turned through gears get a group each, turned about their axle in the preview
    const motion = gearedMotion(this.an, this.build.chassis);
    const groupOf = new Map();
    this.gearGroups = [];
    for (const [i, m] of motion) {
      const group = new THREE.Group(); group.matrixAutoUpdate = false; ld.add(group);
      groupOf.set(i, group); this.gearGroups.push({ group, ...m });
    }
    const bodyOf = new Map();
    this.an.bodies.forEach((b, i) => b.items.forEach((it) => bodyOf.set(it, i)));
    // bodies hinged to the drive move with it in the preview
    const onDrive = new Set(this.an.bodies.map((b, i) => (b.role === 'drive' && !motion.has(i) ? i : -1)).filter((i) => i >= 0));
    for (let grew = true; grew;) { grew = false; for (const j of this.an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) if (onDrive.has(x) && !onDrive.has(y) && this.an.bodies[y].role !== 'base' && !motion.has(y)) { onDrive.add(y); grew = true; } }
    const loose = new Set(this.an.loose);
    for (const it of this.scene.items) {
      const tpl = this.tpl.get(it.q.f);
      if (!tpl) continue;
      const m = partMesh(tpl, it.q, this.D.parts.parts[it.q.f].c);
      m.userData.item = it;
      if (loose.has(it)) tint(m, 0xE8232A, 0.45);
      if (it === this.selected) { tint(m, 0x0A8DFF, 0.5); m.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0x0A4F99); }); }   // black parts show it too
      const bi = bodyOf.get(it);
      (groupOf.get(bi) || (onDrive.has(bi) ? drive : ld)).add(m);
      this.meshes.push(m);
    }
    this._poseDrive();
    this._summary();
    this._presetMarks();
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
    for (const g of this.gearGroups || []) {
      const deg = g.port === 'E' ? this.motor : (this.tools[g.port] || 0);
      turn(g.group, rotAxis(unitV(g.w), deg * len3(g.w) * DEG), g.at);
    }
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

  /** The tool motors of this chassis (the Advanced Driving Base's D and C), or none. */
  _toolPorts() { return ((this.build && CHASSIS[this.build.chassis]) || {}).tools ? CHASSIS[this.build.chassis].tools.map((t) => t.port) : []; }

  /** How far a tool motor can turn what its gears drive in the preview. */
  _toolStop(port) {
    if (this.mode !== 'custom' || !this.parts.length) return [-120, 120];
    if (!this.toolStopsCache) this.toolStopsCache = toolStops(this.D, this.scene, this.an, this._toolPorts());
    // the slider goes as far as the build lets the motor turn, up to a turn each way (a geared-down tool needs more than 120)
    return (this.toolStopsCache[port] || [-120, 120]).map((v) => Math.max(-360, Math.min(360, v)));
  }

  /** Turn a tool motor in the preview (its slider, or Q/E for the first and Z/X for the second). */
  setTool(port, deg) {
    const [lo, hi] = this._toolStop(port);
    this.tools[port] = Math.round(Math.max(lo, Math.min(hi, deg)));
    const s = this.sliders && this.sliders[port];
    if (s) { s.input.min = lo; s.input.max = hi; s.input.value = this.tools[port]; s.out.textContent = `${this.tools[port]}°`; }
    this._poseDrive();
    if (this.ghost) this._snap();
  }

  /** The "Try motor" sliders for this chassis: motor E, or one per tool motor. */
  _sliders() {
    const box = this.root.querySelector('.lb-motor');
    const tools = ((this.build && CHASSIS[this.build.chassis]) || {}).tools || [];
    const list = tools.length ? tools.map((t) => ({ port: t.port, label: `Motor ${t.port} <small>${t.label.replace(' tool motor', '').toLowerCase()}</small>` })) : [{ port: 'E', label: 'Try motor E' }];
    box.innerHTML = list.map((x, i) => `<label title="Keys: ${i ? 'Z and X' : 'Q and E'}">${x.label} <input type="range" min="-120" max="120" value="0" step="1" data-port="${x.port}"></label><output data-port="${x.port}">0°</output>`).join('');
    this.sliders = {};
    for (const x of list) this.sliders[x.port] = { input: box.querySelector(`input[data-port="${x.port}"]`), out: box.querySelector(`output[data-port="${x.port}"]`) };
    this.slider = this.sliders.E ? this.sliders.E.input : null; this.sliderOut = this.sliders.E ? this.sliders.E.out : null;
    this.tools = {};
    box.hidden = false;
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
      const tp = this._toolPorts();
      if (tp.length) {
        const motion = gearedMotion(an, this.build.chassis);
        const per = tp.map((p) => { const n = this.scene.parts.filter((it) => an.bodies.some((bd, i) => motion.get(i) && motion.get(i).port === p && bd.items.includes(it))).length; return `${n} turn${n === 1 ? 's' : ''} with motor ${p}`; });
        bits.push(this.parts.length ? `Your tools: ${this.parts.length} part${this.parts.length === 1 ? '' : 's'}, ${per.join(', ')}` : 'Your tools: empty. Build on the magenta frame at the front (motor D) or back (motor C): a gear that meshes with the 28-tooth gear under it turns with that motor');
        if (an.gearJam) { bits.push('Some gears are locked against each other or the robot: those motors cannot turn.'); warn = true; }
      } else {
        const onDrive = this._driveBodies();
        const moving = this.scene.parts.filter((it) => an.bodies.some((bd, i) => onDrive.has(i) && bd.items.includes(it))).length;
        bits.push(this.parts.length ? `Your attachment: ${this.parts.length} part${this.parts.length === 1 ? '' : 's'}, ${moving} turn${moving === 1 ? 's' : ''} with motor E` : 'Your attachment: empty. Snap a part onto the orange axle in the bracket (motor E turns it)');
        if (an.jammed) { bits.push('The drive axle is locked to the robot: motor E cannot turn.'); warn = true; }
      }
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
    this.selEl.querySelector('.lb-sel-name').textContent = sp ? sp.label : (NAMES[it.q.f] || shortName(this.D.parts.parts[it.q.f].d));
    const portEl = this.selEl.querySelector('.lb-sel-port');
    portEl.hidden = !sp;
    this._swatches(this.selEl.querySelector('.lb-colours'), it.q.f, it.q.c);
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

  /** Put down the part in hand, or else let go of the selected part. */
  deselect() {
    if (this.ghost) { if (this.ghost.carry) this.undo(); this._dropGhost(); return; }
    if (this.selected) { this.selected = null; this._rebuild(); this.message(''); }
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
    if (!carry && this.ghost && this.ghost.f === f && !this.ghost.carry) { this._dropGhost(); return; }   // its button again: put it down
    // a part that isn't a sensor goes on the child's own attachment: picking one switches to "My own" (from the arm,
    // its parts come along to build on)
    let switched = '';
    if (!carry && !SENSOR_PARTS[f] && this.mode !== 'custom' && (CHASSIS[this.build.chassis] || {}).custom) {
      const from = this.mode;
      this.setModule('custom', true);
      switched = from === 'arm' ? 'Now building your own attachment, starting from the arm\'s parts. '
        : from !== 'none' ? 'Now building your own attachment (My own). ' : '';
    }
    this._dropGhost();
    this.selected = null;
    this._selBar();
    const tpl = this.tpl.get(f);
    if (!tpl) return;
    const own = this.D.snaps[f].s.filter((c) => c.k === 'cyl' && usable(c));
    this.lastColour = this.lastColour || {};
    const colour = carry && carry.from ? carry.from.c : this.lastColour[f] ?? this.D.parts.parts[f].c;
    const mesh = this._ghostMesh(f, colour);
    this.ghost = { f, own, k: 0, flip: false, roll: 0, slide: 0, mesh, q: null, ok: false, carry, colour };
    this.root.querySelectorAll('.lb-part').forEach((b) => b.classList.toggle('on', b.dataset.part === f));
    this._handBar();
    const sp = SENSOR_PARTS[f];
    const name = sp ? sp.label : (NAMES[f] || shortName(this.D.parts.parts[f].d));
    this.message(switched + (sp ? `${name}: snap it onto a hole or pin of the robot.${sp.type === 'color' ? ' Point it down at the mat, close to it.' : ''}`
      : this.mode === 'custom' && this._toolPorts().length ? `${name}: snap it onto the tool frame or another part. A gear that meshes with a tool motor's 28-tooth gear turns with that motor.`
      : this.mode === 'custom' ? `${name}: move it onto the orange axle (motor E turns it), or onto a hole or pin.`
      : `${name}: snap it onto the robot.`));
    this._guide();
  }

  /** The part in hand's look: see-through, drawn over everything (it is often half inside the robot), in its colour. */
  _ghostMesh(f, colour) {
    const m = partMesh(this.tpl.get(f), { f, c: colour, p: [0, 0, 0], r: I3 }, this.D.parts.parts[f].c);
    m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.75; o.material.depthWrite = false; o.material.depthTest = false; o.renderOrder = 9; } });
    m.visible = false;
    this.three.ld.add(m);
    return m;
  }

  /** Pick the colour of the part in hand (one of the colours the kit has it in). */
  colourHand(c) {
    const g = this.ghost;
    if (!g) return;
    g.colour = c;
    this.lastColour[g.f] = c;
    const old = g.mesh;
    g.mesh = this._ghostMesh(g.f, c);
    g.mesh.matrix.copy(old.matrix); g.mesh.visible = old.visible;
    old.parent && old.parent.remove(old);
    this._handBar();
    this._snap();
  }

  /** Change a placed part's colour (undo puts it back). */
  colourSelected(c) {
    const it = this.selected;
    if (!it || it.q.c === c) return;
    this._push();
    const q = { ...it.q, c };
    for (const list of [this.body, this.parts]) { const i = list.indexOf(it.q); if (i >= 0) list[i] = q; }
    if (this.ports.has(it.q)) { this.ports.set(q, this.ports.get(it.q)); this.ports.delete(it.q); }
    this.lastColour = this.lastColour || {}; this.lastColour[q.f] = c;
    this._rebuild(true);
    this._selectQ(q);
  }

  /** Swatches for the colours the kit has a part in (none when it comes in one), the current one marked. */
  _swatches(el, f, current) {
    const cs = (this.D.parts.parts[f] || {}).cs || [];
    const list = cs.some(([c]) => c === current) ? cs : [[current, 0], ...cs];
    el.hidden = list.length < 2;
    el.innerHTML = list.map(([c, n]) => `<button type="button" data-colour="${c}" class="${c === current ? 'on' : ''}" style="background:${(KIT_COLOURS[c] || [0, '#999'])[1]}" title="${colourName(c)}${n ? ` (${n} in the kit)` : ' (not in the kit)'}" aria-label="${colourName(c)}"></button>`).join('');
  }

  // the part in hand: turn it, flip it, hold it by another hole or pin, slide it along (keys R, F, Tab, [ ])
  turnHand(dir = 1) { const g = this.ghost; if (!g) return; g.roll = (g.roll + (dir < 0 ? 3 : 1)) % 4; this._snap(); }
  flipHand() { const g = this.ghost; if (!g) return; g.flip = !g.flip; g.slide = 0; this._snap(); }
  otherHole(dir = 1) { const g = this.ghost; if (!g) return; g.k = ((g.kUsed ?? g.k) + (dir < 0 ? g.own.length - 1 : 1)) % g.own.length; g.slide = 0; this._snap(); }
  slideHand(dir) { const g = this.ghost; if (!g) return; g.slide += dir; this._snap(); }

  /** The bar over the view while a part is in hand: its name and buttons for what the keys do. */
  _handBar() {
    if (!this.handEl) return;
    const g = this.ghost;
    this.handEl.hidden = !g;
    if (!g) return;
    const sp = SENSOR_PARTS[g.f];
    this.handEl.querySelector('.lb-hand-name').textContent = sp ? sp.label : (NAMES[g.f] || shortName(this.D.parts.parts[g.f].d));
    this.handEl.querySelector('[data-hand="hole"]').hidden = g.own.length < 2;
    this.handEl.querySelector('.lb-hand-slide').hidden = !(g.slides > 1);
    this._swatches(this.handEl.querySelector('.lb-colours'), g.f, g.colour);
  }

  _dropGhost() {
    if (!this.ghost) return;
    this.ghost.mesh.parent && this.ghost.mesh.parent.remove(this.ghost.mesh);
    this.ghost = null;
    this._handBar();
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
    if (e.buttons) return;              // turning the view: the part waits until the button is up
    if (this.ghost) this._snap();
    else this._hover();
  }

  /** Screen position (px) of a point in the LDraw frame, and its depth. */
  _project(p) {
    const v = new THREE.Vector3(...p).applyMatrix4(this.three.ld.matrixWorld);
    const d = v.clone().project(this.three.camera);
    return { x: (d.x + 1) / 2 * this.mouse.w, y: (1 - d.y) / 2 * this.mouse.h, z: d.z };
  }

  /**
   * How far the nearest surface is from the camera at each pixel of the view (half size), drawn again only when the
   * view or the robot changed: {w, h, buf} (buf: RGBA floats from the bottom row, R = depth in cm, A = 0 for nothing).
   */
  _depthMap() {
    const { renderer, scene, camera, ld, grid } = this.three;
    const el = renderer.domElement, w = Math.max(1, Math.round(el.clientWidth / 2)), h = Math.max(1, Math.round(el.clientHeight / 2));
    camera.updateMatrixWorld();
    const key = `${camera.matrixWorld.elements.map((v) => v.toFixed(3)).join()}|${w}x${h}|${this.motor}|${JSON.stringify(this.tools)}|${ld.children.length}|${this.rebuilds || 0}`;
    if (this.depth && this.depth.key === key) return this.depth;
    if (!this.depthRT || this.depthRT.width !== w || this.depthRT.height !== h) {
      if (this.depthRT) this.depthRT.dispose();
      this.depthRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    }
    if (!this.depthMat) {
      this.depthMat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        vertexShader: 'varying float vD; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying float vD; void main() { gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }',
      });
    }
    const hide = [this.marker, grid, this.ghost && this.ghost.mesh].filter(Boolean).map((o) => [o, o.visible]);
    hide.forEach(([o]) => { o.visible = false; });
    const bg = scene.background, clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    scene.background = null; scene.overrideMaterial = this.depthMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.depthRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    scene.overrideMaterial = null; scene.background = bg;
    renderer.setClearColor(clear, alpha);
    hide.forEach(([o, v]) => { o.visible = v; });
    const buf = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(this.depthRT, 0, 0, w, h, buf);
    this.depth = { key, w, h, buf };
    return this.depth;
  }

  /** Whether a point (LDraw frame) can be seen from the camera: nothing else is clearly in front of it. */
  _visible(p, dm) {
    const { camera, ld } = this.three;
    const v = new THREE.Vector3(...p).applyMatrix4(ld.matrixWorld);
    const dist = -v.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const s = v.project(camera);
    if (s.z > 1 || Math.abs(s.x) > 1 || Math.abs(s.y) > 1) return false;
    const px = Math.floor((s.x + 1) / 2 * dm.w), py = Math.floor((s.y + 1) / 2 * dm.h);
    // the farthest surface in a little square around it: a hole's rim drawn in front of its middle doesn't hide it
    let far = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= dm.w || y >= dm.h) continue;
      const i = (y * dm.w + x) * 4;
      far = Math.max(far, dm.buf[i + 3] ? dm.buf[i] : Infinity);
    }
    return dist <= far + 0.5;           // within 5 mm of the surface there (a pin's middle is 2.4 mm inside it)
  }

  /** Find where the ghost part goes for the current pointer: the nearest connector it fits on that can be seen. */
  _snap() {
    const g = this.ghost, m = this.mouse;
    if (!g || !m) return;
    this.three.ld.updateMatrixWorld(true);
    let dm = null;
    try { dm = this._depthMap(); } catch (err) { dm = null; }
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
        if (dist >= 26) continue;
        // a hole or pin hidden behind other parts is not where the pointer means
        const ends = [c.o, add(c.o, scl(c.d, c.len / 2)), add(c.o, scl(c.d, c.len))];
        const seen = !dm || ends.some((p) => this._visible(shown(it, p), dm));
        if (!seen && it.role !== 'drive') continue;
        cands.push({ c, it, dist: dist - bias + (seen ? 0 : 20), z: Math.min(a.z, b.z), at: frac * c.len });
      }
    }
    cands.sort((p, q) => p.dist - q.dist || p.z - q.z);
    let found = null, near = null;
    for (const cand of cands.slice(0, 8)) {
      if (this._turned() && this._onDriveItem(cand.it)) continue;
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
    if (this._turned() && !found && cands.some((c) => this._onDriveItem(c.it))) this.message('Set the "Try motor" sliders back to 0 to add parts to what they turn.');
    const res = found || near;
    if (!res) {
      g.q = null; g.ok = false; g.mesh.visible = false;
      this._guide();
      return;
    }
    g.q = res.q; g.ok = !!found; g.kUsed = found ? found.k : g.k;
    g.slides = found ? found.slides : 0;
    this._handBar();
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
    const name = (NAMES[g.f] || shortName(this.D.parts.parts[g.f].d));
    this.message(!found ? `It ${res.why} here: try Turn, Flip or Other hole.`
      : found.spins ? `${name}: click to place. Its round hole spins freely on the axle, so motor E will not turn it: start with a part that has a + hole (a bent liftarm, a cross block, the 2 liftarm) and build on that.`
      : `${name}: click to place it.`);
  }

  /** Nothing under the pointer to snap onto: show where to start, the drive axle in the bracket. */
  _guide() {
    if (this.mode !== 'custom' || this._toolPorts().length || (this.ghost && SENSOR_PARTS[this.ghost.f])) { this.marker.visible = false; return; }
    const L = 140, mid = DRIVE_AXLE.at;
    this.marker.position.set(...mid);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...DRIVE_AXLE.axis));
    this.marker.scale.set(4, L + 4, 4);
    this.marker.material.color.setHex(0xFFB000);
    this.marker.visible = true;
  }

  _onDriveItem(it) { return this.meshes && this.meshes.some((m) => m.userData.item === it && (m.parent === this.three.drive || (this.gearGroups || []).some((g) => g.group === m.parent))); }
  _turned() { return this.motor !== 0 || Object.values(this.tools || {}).some((v) => v !== 0); }

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
      g.q.c = g.colour;
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
      // one at a time: the part goes back in the box and the placed one is selected (Shift-click keeps it in hand)
      if (g.carry || !e.shiftKey) {
        this._dropGhost();
        this.selected = this.scene.parts.find((it) => it.q === g.q) || null;
        this._rebuild();
        this.message(g.carry ? note : `${note} Shift-click to place several.`);
        return;
      }
      this.message(`${note} Shift-click to put another ${sp ? sp.label.toLowerCase() : (NAMES[g.f] || shortName(this.D.parts.parts[g.f].d))} on; right-click or Esc to stop.`);
      return;
    }
    const it = this._raycast();
    this.selected = it || null;
    this._rebuild();
    if (it) this.message(SENSOR_PARTS[it.q.f] ? 'Pick its port above, or move it.' : '');
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
    else if (g && (k === 'r' || k === 'R')) this.turnHand(e.shiftKey ? -1 : 1);
    else if (g && (k === 'f' || k === 'F')) this.flipHand();
    else if (g && k === 'Tab') this.otherHole(e.shiftKey ? -1 : 1);
    else if (g && k === ']') this.slideHand(1);
    else if (g && k === '[') this.slideHand(-1);
    else if ((k === 'Delete' || k === 'Backspace') && this.selected) this.removeSelected();
    else if (!e.ctrlKey && !e.metaKey && (k === 'q' || k === 'Q' || k === 'e' || k === 'E')) {
      const tp = this._toolPorts();
      if (tp.length) this.setTool(tp[0], (this.tools[tp[0]] || 0) + (k.toLowerCase() === 'q' ? 4 : -4));
      else this.setMotor(this.motor + (k.toLowerCase() === 'q' ? 4 : -4));   // like driving: Q raises, E lowers
    } else if (!e.ctrlKey && !e.metaKey && (k === 'z' || k === 'Z' || k === 'x' || k === 'X') && this._toolPorts()[1]) {
      const p2 = this._toolPorts()[1];
      this.setTool(p2, (this.tools[p2] || 0) + (k.toLowerCase() === 'z' ? 4 : -4));
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
