// Collision layer on top of Rapier (loaded from the CDN; the sim falls back to the old circle/box code without it).
// The robot stays kinematic (programs move it exactly as before); Rapier only decides what it may not pass through:
// walls, mission models and the attachment, with the character controller doing collide-and-slide. Movable practice
// boxes are dynamic bodies that get shoved. Frames: sim x east / y south / heading clockwise  <->  Rapier x east / z south / y up.
import * as THREE from 'three';
import { LIFT } from './robot.js';
import { SCOOP_PARTS } from './build.js';
import { MECHANISMS, partInfo, pieceOfPart } from './mechanisms.js';
import { buildCustom, removeCustom, customStep, placeCustom, restoreCustom } from './legophysics.js';

const S = 0.01;                 // cm -> m (Rapier's defaults are tuned for meters)
const DEG = Math.PI / 180;
const SKIN = 0.25;              // cm the controller keeps between the robot and whatever it touches
const STALL_MARGIN = 0.35;      // cm the attachment shape is shrunk by for "would this motor move hit something" tests

/** Boxes that lie entirely inside another box of the same piece (a pin in a beam's hole) are left out. */
function dropHidden(boxes) {
  const inside = (p, b) => {
    const v = new THREE.Vector3(p.x - b.c[0], p.y - b.c[1], p.z - b.c[2]).applyQuaternion(b.qi);
    return Math.abs(v.x) <= b.h[0] + 1e-3 && Math.abs(v.y) <= b.h[1] + 1e-3 && Math.abs(v.z) <= b.h[2] + 1e-3;
  };
  const all = boxes.map((b) => ({ ...b, qi: new THREE.Quaternion(...b.q).invert(), vol: b.h[0] * b.h[1] * b.h[2] }));
  return all.filter((b) => {
    const q = new THREE.Quaternion(...b.q);
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * b.h[0], sy * b.h[1], sz * b.h[2]).applyQuaternion(q).add(new THREE.Vector3(...b.c)));
    return !all.some((o) => o !== b && o.vol >= b.vol && corners.every((p) => inside(p, o)));
  });
}

const RIDE = 0.7;   // cm an attachment rides over
const ATTACH_FRICTION = 0.3;   // LEGO plastic on LEGO plastic: pieces slide off an attachment instead of clinging to it
/** Highest / lowest point of a cuboid collider (cm), from its current pose. */
function colliderExtent(c, sign) {
  let h = null;
  try { h = c.halfExtents(); } catch { h = null; }
  if (!h) { const hh = c.halfHeight(), rr = c.radius(); h = { x: rr, y: hh + rr, z: rr }; }   // a capsule (axle)
  const r = c.rotation(), t = c.translation();
  const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  let best = sign * -Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const y = new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z).applyQuaternion(q).y + t.y;
    best = sign > 0 ? Math.max(best, y) : Math.min(best, y);
  }
  return best / S;
}
const colliderTop = (c) => colliderExtent(c, 1);
const colliderBottom = (c) => colliderExtent(c, -1);

/** Up to 26 outermost corners (one per direction) of a piece's part boxes, relative to its anchor. */
/** A measured box's rotation: its own (a liftarm leg, [.., qx, qy, qz, qw]) or the part's. */
const boxQuat = (b, e) => (b.length >= 10 ? b.slice(6, 10) : e.q);

function supportPoints(entries, anchor) {
  const pts = [];
  for (const e of entries) {
    for (const b of e.b || [[...e.p, ...e.h]]) {
      const q = new THREE.Quaternion(...boxQuat(b, e));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
        pts.push(new THREE.Vector3(sx * b[3], sy * b[4], sz * b[5]).applyQuaternion(q).add(new THREE.Vector3(b[0] - anchor[0], b[1] - anchor[1], b[2] - anchor[2])));
    }
  }
  const out = new Set();
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    if (!dx && !dy && !dz) continue;
    let best = null, bv = -Infinity;
    for (const p of pts) { const v = p.x * dx + p.y * dy + p.z * dz; if (v > bv) { bv = v; best = p; } }
    out.add(best);
  }
  return [...out];
}

export async function createPhysics(world) {
  let R;
  try {
    const mod = await import('rapier');
    R = mod.default || mod;
    await R.init();
  } catch (err) {
    console.warn('Physics unavailable (Rapier did not load); using the simple collision model.', err);
    return null;
  }
  await loadAttachParts();
  return new Physics(R, world);
}

/** The moving half of each preset attachment, measured part by part (tools/part-boxes.py on models/attach/*.mpd). */
const ATTACH_FILES = { arm: 'arm-moving', plow: 'dozer-moving', basket: 'basket-moving', sweeper: 'sweeper-moving', scoop: 'scoop-moving' };
const ATTACH_PARTS = {};
async function loadAttachParts() {
  await Promise.all(Object.entries(ATTACH_FILES).map(async ([module, f]) => {
    try { const r = await fetch(`models/parts/${f}.json`); if (r.ok) ATTACH_PARTS[module] = await r.json(); } catch { /* the hand-drawn boxes stand in */ }
  }));
}

// Collision groups: bit 0 = everything shared (robot, walls, mat, loose equipment, practice boxes); each mission
// model gets its own bit so its pieces never collide with their own base (the LEGO geometry overlaps there).
const ALL = 0xFFFF;
const grp = (member, filter) => ((member & 0xFFFF) << 16) | (filter & 0xFFFF);
const SHARED = grp(1, ALL);
const MODEL_BIT = {};   // assigned as the models are built
const modelGroup = (id, ground = true) => { if (!(id in MODEL_BIT)) { const n = Object.keys(MODEL_BIT).length; MODEL_BIT[id] = 2 + (n % 12); } const b = 1 << MODEL_BIT[id]; return grp(b, ALL & ~b & (ground ? ALL : ~MAT_BIT)); };
// two spare bits let a piece touch chosen pieces of its own model (the M10 catch leaning on the web's upright)
const PAIR_A = 1 << 14, PAIR_B = 1 << 15;
// The robot never touches the parts of its own attachment that hang on pins (members of PAIR_B only, see legophysics.js)
const ROBOT = grp(1, ALL & ~PAIR_B), ATTACH = grp(PAIR_B, ALL & ~PAIR_B);
const withPair = (g, member, filter) => (((g >>> 16) | member) << 16) | ((g & 0xFFFF) | filter);
const MAT_BIT = 2;   // the table (mat and walls) has a group of its own: a piece whose square ends would dig into it can skip it

const yawQuat = (headingDeg) => { const a = -headingDeg * DEG / 2; return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }; };
const yawOf = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) / DEG;   // degrees, counter-clockwise from above

export class Physics {
  constructor(R, world) {
    this.R = R;
    this.sim = world;
    this.pieces = [];
    this.obstacleBodies = [];
    this.robotParts = [];
    this.newWorld();
  }

  /** A brand-new Rapier world with the walls and the mat; everything else is added back by the callers. */
  newWorld() {
    const { R } = this;
    if (this.world) this.world.free();
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    // Jointed mission pieces are pushed by kinematic (infinitely heavy) robot parts: give the solver more passes
    // so the joint and the contact agree instead of the robot plowing straight through the piece.
    if (this.world.integrationParameters) { this.world.integrationParameters.numSolverIterations = 24; }
    this.obstacleBodies = [];
    this.pieces = [];              // moving mission-model pieces (see mechanisms.js) and equipment
    this.colliderToPiece = new Map();
    this.colliderTop = new Map();     // fixed model colliders: their top (cm), for an attachment riding over them
    this.colliderToObstacle = new Map();
    this.robotBody = null; this.armBody = null;
    this.robotParts = [];        // { collider, node } attachment pieces that follow the attachment motor
    this.custom = null;          // a custom attachment's hinged bodies and joints (legophysics.js)
    this.bodyCollider = null;
    this.cc = this.world.createCharacterController(SKIN * S);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(1.5);
    this.buildWalls();
  }

  /** Everything about the physics world at this instant: the Rapier world's bytes plus the pieces' bookkeeping. */
  snapshot() {
    return {
      bytes: this.world.takeSnapshot(),
      lastArmAngle: this.lastArmAngle,
      pieces: this.pieces.map((pc) => ({ locked: pc.locked, released: pc.released, latched: pc.latched, touched: pc.touched, carried: !!pc.carried, angle: pc.angle, ext: pc.ext, height: pc.height,
        joint: pc.joint ? pc.joint.handle : null, carryJoint: pc.carryJoint ? pc.carryJoint.handle : null })),
      obstacles: this.obstacleBodies.map((ob) => ({ touched: ob.o.touched, impact: ob.o.impact, x: ob.o.x, y: ob.o.y, angle: ob.o.angle })),
    };
  }

  /** Put the world back exactly as a snapshot had it; the body, collider and joint handles survive the round trip. */
  restore(snap) {
    const { R } = this;
    const fresh = R.World.restoreSnapshot(snap.bytes);
    this.world.free();
    this.world = fresh;
    if (this.world.integrationParameters) this.world.integrationParameters.numSolverIterations = 24;
    const body = (b) => (b ? this.world.getRigidBody(b.handle) : null);
    const col = (c) => (c ? this.world.getCollider(c.handle) : null);
    this.cc = this.world.createCharacterController(SKIN * S);
    this.cc.setSlideEnabled(true); this.cc.setApplyImpulsesToDynamicBodies(true); this.cc.setCharacterMass(1.5);
    this.wallsBody = body(this.wallsBody);
    this.robotBody = body(this.robotBody); this.armBody = body(this.armBody);
    this.bodyCollider = col(this.bodyCollider);
    for (const p of this.robotParts) p.collider = col(p.collider);
    restoreCustom(this);
    for (const ob of this.obstacleBodies) { ob.body = body(ob.body); ob.collider = col(ob.collider); if (ob.colliders) ob.colliders = ob.colliders.map(col); }
    this.pieces.forEach((pc, i) => {
      const s = snap.pieces[i];
      pc.body = body(pc.body);
      pc.colliders = pc.colliders.map(col); pc.collider = pc.colliders[0];
      pc.joint = s.joint !== null ? this.world.getImpulseJoint(s.joint) : null;
      pc.carryJoint = s.carryJoint !== null ? this.world.getImpulseJoint(s.carryJoint) : null;
      Object.assign(pc, { locked: s.locked, released: s.released, latched: s.latched, touched: s.touched, carried: s.carried, angle: s.angle, ext: s.ext, height: s.height });
    });
    this.obstacleBodies.forEach((ob, i) => { const s = snap.obstacles[i]; ob.o.touched = s.touched; ob.o.impact = s.impact; ob.o.x = s.x; ob.o.y = s.y; ob.o.angle = s.angle; });
    this.lastArmAngle = snap.lastArmAngle;
    this.readPieces(0);
  }

  /**
   * Start a run from an identical physics state every time: rebuild the whole world (models at their start
   * poses, equipment where it stands, the robot where it is). Rapier is deterministic from a fresh world with the
   * same sequence of operations, which is what lets a stepped run be replayed exactly.
   */
  rebuildWorld() {
    const equipment = this.pieces.filter((pc) => pc.equipment).map((pc) => { const t = pc.body.translation(); return { ...pc.equipment, x: t.x / S, y: t.z / S, h: t.y / S }; });
    const robot = this.robot;
    this.newWorld();
    this.rebuildObstacles();
    if (equipment.length) this.spawnEquipment(equipment);
    if (robot) { this.rebuildRobot(robot); this.setRobotPose(robot.x, robot.y, robot.heading); }
    this.readPieces(0);
  }

  buildWalls() {
    const { R } = this;
    const t = this.sim.table;
    const hw = this.sim.innerHalfW, hh = this.sim.innerHalfH, w = t.wall, h = t.wallHeight;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const add = (x, z, hx, hz) => this.world.createCollider(R.ColliderDesc.cuboid(hx * S, (h / 2) * S, hz * S).setTranslation(x * S, (h / 2) * S, z * S).setCollisionGroups(grp(MAT_BIT, ALL)), body);
    add(0, -hh - w / 2, hw + w, w / 2);
    add(0, hh + w / 2, hw + w, w / 2);
    add(-hw - w / 2, 0, w / 2, hh + w);
    add(hw + w / 2, 0, w / 2, hh + w);
    this.world.createCollider(R.ColliderDesc.cuboid((hw + w) * S, 1 * S, (hh + w) * S).setTranslation(0, -1 * S, 0).setFriction(0.8).setCollisionGroups(grp(MAT_BIT, ALL)), body);   // the mat
    this.wallsBody = body;
  }

  // ---------------- obstacles ----------------

  rebuildObstacles() {
    const { R } = this;
    for (const ob of this.obstacleBodies) this.world.removeRigidBody(ob.body);
    this.obstacleBodies = [];
    this.colliderTop = new Map();
    for (const pc of this.pieces) if (!pc.equipment) this.world.removeRigidBody(pc.body);
    this.pieces = this.pieces.filter((pc) => pc.equipment);
    this.colliderToPiece = new Map(this.pieces.map((pc) => [pc.collider.handle, pc]));
    for (const o of this.sim.obstacles) {
      if (MECHANISMS[o.id] && o.model) { this.buildMechanism(o, MECHANISMS[o.id]); continue; }
      const desc = o.movable
        ? R.RigidBodyDesc.dynamic().enabledTranslations(true, false, true).enabledRotations(false, true, false).setLinearDamping(6).setAngularDamping(6)
        : R.RigidBodyDesc.fixed();
      desc.setTranslation(o.x * S, (o.h / 2) * S, o.y * S);
      const body = this.world.createRigidBody(desc);
      const col = this.world.createCollider(R.ColliderDesc.cuboid((o.w / 2) * S, (o.h / 2) * S, (o.d / 2) * S).setFriction(0.7).setMass(0.4).setCollisionGroups(SHARED), body);
      this.obstacleBodies.push({ o, body, collider: col });
      o.angle = 0;
    }
    this.colliderToObstacle = new Map(this.obstacleBodies.filter((ob) => ob.collider).map((ob) => [ob.collider.handle, ob.o]));
    for (const ob of this.obstacleBodies) for (const c of ob.colliders || []) this.colliderToObstacle.set(c.handle, ob.o);
    this.settlePieces();
    this.readPieces(0);
  }

  /** Let every mission piece come to rest once (a leaf onto its cam, a seed onto the mat), take that as its start pose,
   * and put it to sleep: a resting field costs nothing to simulate, and a reset puts the pieces back asleep. */
  settlePieces(seconds = 1.5) {
    const key = (pc) => pc.o.id + '/' + pc.name + (pc.o.parts ? '' : '/boxes');   // a build before the part shapes arrived settles differently
    const pieces = this.pieces.filter((pc) => !pc.equipment && pc.o && pc.body.bodyType() === 0);
    this.settled ||= new Map();
    if (!pieces.every((pc) => this.settled.has(key(pc)))) {
      // first time this field is built: run the mechanisms until everything has come to rest
      const dt = this.world.timestep;
      this.world.timestep = 1 / 200;
      this.readPieces(0);
      for (let i = 0; i < seconds * 200; i++) { this.updateMechanisms(-1); this.world.step(); this.readPieces(0); }
      this.world.timestep = dt;
      for (const pc of pieces) { const t = pc.body.translation(), r = pc.body.rotation(); this.settled.set(key(pc), { t: { ...t }, r: { x: r.x, y: r.y, z: r.z, w: r.w } }); }
    }
    for (const pc of pieces) {
      const p = this.settled.get(key(pc));
      pc.body.setTranslation(p.t, false); pc.body.setRotation(p.r, false);
      pc.body.setLinvel({ x: 0, y: 0, z: 0 }, false); pc.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      pc.start = new THREE.Vector3(p.t.x / S, p.t.y / S, p.t.z / S);
      pc.qStart = new THREE.Quaternion(p.r.x, p.r.y, p.r.z, p.r.w);
      pc.body.sleep();
    }
  }

  // ---------------- mission mechanisms ----------------

  /** Pose of a model's own frame on the table (cm): the LDraw holder transform used by the 3D view. */
  modelFrame(o) {
    const pose = o.modelPose || { x: o.x, y: o.y, heading: 0 };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (pose.heading || 0) * DEG);
    return { p: new THREE.Vector3(pose.x, 0, pose.y), q };
  }

  buildMechanism(o, def) {
    const { R } = this;
    const frame = this.modelFrame(o);
    const toWorld = (v) => new THREE.Vector3(...v).applyQuaternion(frame.q).add(frame.p);
    const rq = { x: frame.q.x, y: frame.q.y, z: frame.q.z, w: frame.q.w };
    // fixed base
    const base = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(frame.p.x * S, 0, frame.p.z * S).setRotation(rq));
    const groups = modelGroup(o.id);
    const colliders = [];
    // which measured part belongs to which piece (the same split the 3D view draws)
    const own = { base: [] };
    for (const n of Object.keys(def.pieces || {})) own[n] = [];
    // soft parts (plants, flexible hoses, string) are drawn but bend out of the way, so they get no colliders
    if (o.parts) for (const e of o.parts) { const info = partInfo(e); const who = pieceOfPart(def, info); if (who && !(who === 'base' && def.soft && def.soft(info))) own[who].push(e); }
    if (o.parts) colliders.push(...this._partColliders(own.base, base, [0, 0, 0], groups, 0, 0.7, true));   // parts buried inside others (pins in holes) dropped
    for (const c of colliders) this.colliderTop.set(c.handle, colliderTop(c));
    for (const b of (o.parts ? def.baseExtra : def.base) || []) {
      const cd = R.ColliderDesc.cuboid((b.box[0] / 2) * S, (b.box[1] / 2) * S, (b.box[2] / 2) * S).setTranslation(b.at[0] * S, b.at[1] * S, b.at[2] * S).setFriction(0.7).setCollisionGroups(groups);
      if (b.rot) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.rot[0] * DEG, b.rot[1] * DEG, b.rot[2] * DEG)); cd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
      colliders.push(this.world.createCollider(cd, base));
    }
    this.obstacleBodies.push({ o, body: base, colliders });
    o.angle = 0;
    for (const [name, pd] of Object.entries(def.pieces || {})) {
      const anchorW = toWorld(pd.anchor);
      const startW = pd.shift ? toWorld(pd.anchor.map((v, i) => v + pd.shift[i])) : anchorW.clone();   // a piece may start away from its anchor (a drawer pulled out)
      const locked = !!pd.locked;
      let desc;
      if (pd.kind === 'lift' || pd.kind === 'follow' || pd.kind === 'gear') desc = R.RigidBodyDesc.kinematicPositionBased();
      else desc = R.RigidBodyDesc.dynamic().setLinearDamping(pd.kind === 'loose' ? 1.5 : 0.8).setAngularDamping(pd.kind === 'loose' ? 1.5 : 0.8).setGravityScale(pd.gravity === false ? 0 : 1);
      // A locked piece is a dynamic body with every degree of freedom switched off (a body born fixed cannot be
      // jointed later), released by switching them back on.
      if (locked) desc.enabledTranslations(false, false, false).enabledRotations(false, false, false);
      else if (pd.planar && pd.kind === 'loose') desc.enabledTranslations(true, false, true).enabledRotations(false, true, false);
      // a follower starts turned to where its driver starts (the young trees lean out while the platform is up)
      // a gear starts turned to where its driver starts (the M06 camshaft with the rack pulled out)
      const driverStart = (d) => { const src = def.pieces[d.piece]; return src && src.shift ? src.shift.reduce((t, v, i) => t + v * src.axis[i], 0) : 0; };
      const turn = pd.kind === 'follow' ? pd.angle : pd.kind === 'gear' ? (driverStart(pd.drivenBy) * pd.drivenBy.ratio) / DEG : pd.kind === 'hinge' && pd.start ? pd.start : 0;
      const q0 = turn ? frame.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...pd.axis).normalize(), turn * DEG)) : frame.q;
      desc.setTranslation(startW.x * S, startW.y * S, startW.z * S).setRotation({ x: q0.x, y: q0.y, z: q0.z, w: q0.w }).setCcdEnabled(pd.kind === 'loose');   // resting pieces sleep; a push wakes them
      const body = this.world.createRigidBody(desc);
      const pieceGroups = pd.whole || pd.kind === 'loose' ? SHARED : pd.noGround ? modelGroup(o.id, false) : groups;
      let cols;
      if (pd.shape && pd.shape.length || !o.parts || !own[name].length) {
        // hand-drawn boxes (relative to the anchor): only where a piece needs something its parts do not give
        const shapes = pd.shape && pd.shape.length ? pd.shape : [{ box: [2, 2, 2], at: [0, 1, 0] }];
        cols = shapes.map((sh, i) => {
          const cd = R.ColliderDesc.cuboid((sh.box[0] / 2) * S, (sh.box[1] / 2) * S, (sh.box[2] / 2) * S).setTranslation(sh.at[0] * S, sh.at[1] * S, sh.at[2] * S)
            .setFriction(pd.friction ?? 0.7).setMass(i === 0 ? (pd.mass ?? 0.05) : 0.001).setCollisionGroups(pieceGroups);
          if (sh.rot) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(sh.rot[0] * DEG, sh.rot[1] * DEG, sh.rot[2] * DEG)); cd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
          return this.world.createCollider(cd, body);
        });
      } else {
        // one box per real part, placed relative to the anchor; the weight spread by volume (or held at pd.com)
        cols = this._partColliders(own[name], body, pd.anchor, pieceGroups, pd.com ? 0 : (pd.mass ?? 0.05), pd.friction ?? 0.7, true, pd.shrink || 0);
        if (pd.com) {
          const m = pd.mass ?? 0.05, c = pd.com.map((v, i) => (v - pd.anchor[i]) * S), r = 2 * S;
          body.setAdditionalMassProperties(m, { x: c[0], y: c[1], z: c[2] }, { x: m * r * r, y: m * r * r, z: m * r * r }, { x: 0, y: 0, z: 0, w: 1 }, true);
        }
      }
      // a few outermost points of the piece (body frame) for its lowest point, from its real parts when it has them
      const hull = !(pd.shape && pd.shape.length) && o.parts && own[name].length ? supportPoints(own[name], pd.anchor) : null;
      const pc = { o, name, def: pd, body, colliders: cols, hull, baseHandles: pd.contact ? new Set(colliders.map((c) => c.handle)) : null, collider: cols[0], anchor: anchorW, q0: frame.q.clone(), qStart: q0.clone ? q0.clone() : frame.q.clone(), axisW: pd.axis ? new THREE.Vector3(...pd.axis).applyQuaternion(frame.q).normalize() : null,
        locked, released: !locked, latched: false, touched: -1, angle: 0, ext: 0, height: 0, start: startW.clone() };
      if (pd.kind === 'hinge' && !pd.parent) this._hingeJoint(pc, base, locked);
      if (pd.kind === 'slider') this._sliderJoint(pc, base, locked);
      // a tether (the M12 support tie's chain): a rope from a point on the model to a point on the piece
      if (pd.tether) {
        const t = pd.tether;
        pc.tetherJoint = this.world.createImpulseJoint(R.JointData.rope(t.length * S, { x: t.from[0] * S, y: t.from[1] * S, z: t.from[2] * S }, { x: t.to[0] * S, y: t.to[1] * S, z: t.to[2] * S }), base, body, true);
      }
      this.pieces.push(pc);
      for (const c of cols) this.colliderToPiece.set(c.handle, pc);
    }
    // hinges on another piece of the same model (a linkage), once every piece has a body
    for (const pc of this.pieces) {
      if (pc.o !== o) continue;
      if (pc.def.kind === 'hinge' && pc.def.parent) {
        const parent = this.pieces.find((q) => q.o === o && q.name === pc.def.parent);
        if (parent) this._hingeJoint(pc, parent.body, pc.locked, parent);
      }
      // a piece that leans on chosen pieces of its own model
      for (const n of pc.def.collidesWith || []) {
        const other = this.pieces.find((q) => q.o === o && q.name === n);
        if (!other) continue;
        for (const c of pc.colliders) c.setCollisionGroups(withPair(c.collisionGroups(), PAIR_A, PAIR_B));
        for (const c of other.colliders) c.setCollisionGroups(withPair(c.collisionGroups(), PAIR_B, PAIR_A));
      }
      // pins to other pieces that close a loop (the M10 web's cross beams on its three uprights)
      for (const l of pc.def.links || []) {
        const other = this.pieces.find((q) => q.o === o && q.name === l.piece);
        if (!other) continue;
        const a1 = l.at.map((v, i) => (v - other.def.anchor[i]) * S), a2 = l.at.map((v, i) => (v - pc.def.anchor[i]) * S), ax = pc.def.axis;
        (pc.linkJoints ||= []).push(this.world.createImpulseJoint(R.JointData.revolute({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: ax[0], y: ax[1], z: ax[2] }), other.body, pc.body, true));
      }
    }
  }

  /** Colliders for measured parts on a body whose origin sits at `origin` in the model frame (one box per part, or
   * the part's several boxes); `mass` (kg) is spread over them by volume, 0 for none. */
  _partColliders(entries, body, origin, groups, mass, friction, merge = false, shrink = 0) {
    const { R } = this;
    let boxes = [];
    for (const e of entries) {
      const list = e.b || [[...e.p, ...e.h]];
      for (const b of list) boxes.push({ c: b.slice(0, 3), h: b.slice(3, 6).map((v) => Math.max(0.05, v - shrink)), q: boxQuat(b, e) });   // shrink: a loose fit (a leaf in its slot)
    }
    if (merge && boxes.length > 8) boxes = dropHidden(boxes);   // a moving piece: boxes buried inside others add nothing
    const vol = (b) => Math.max(1e-3, 8 * b.h[0] * b.h[1] * b.h[2]);
    const total = boxes.reduce((t, b) => t + vol(b), 0);
    return boxes.map((b) => {
      // a long thin part with a square section (an axle, a bar) is round in real life: a capsule along its length, so
      // things roll and wedge on it instead of sitting flat
      const order = [0, 1, 2].sort((i, j) => b.h[i] - b.h[j]);
      const [a0, a1, a2] = order.map((i) => b.h[i]);
      let cd, rot = new THREE.Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]);
      if (a0 < 0.4 && a1 - a0 < 0.06 && a2 > 2.5 * a1) {
        const r = (a0 + a1) / 2;
        cd = R.ColliderDesc.capsule(Math.max(0.01, a2 - r) * S, r * S);
        const along = [0, 0, 0]; along[order[2]] = 1;
        rot = rot.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...along)));
      } else cd = R.ColliderDesc.cuboid(Math.max(0.02, b.h[0]) * S, Math.max(0.02, b.h[1]) * S, Math.max(0.02, b.h[2]) * S);
      cd.setTranslation((b.c[0] - origin[0]) * S, (b.c[1] - origin[1]) * S, (b.c[2] - origin[2]) * S)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setFriction(friction).setCollisionGroups(groups);
      cd.setMass(mass > 0 ? (mass * vol(b)) / total : 0);
      return this.world.createCollider(cd, body);
    });
  }

  _hingeJoint(pc, base, collapsed = false, parent = null) {
    const { R } = this;
    const ax = pc.def.axis;
    // the anchor in the first body's frame: the model frame for the base, or relative to a parent piece's own anchor
    const a = parent ? pc.def.anchor.map((v, i) => v - parent.def.anchor[i]) : pc.def.anchor;
    // Rapier measures the revolute angle the other way round from the right-hand rule used in mechanisms.js
    // (checked empirically), so the limits are mirrored.
    const data = R.JointData.revolute({ x: a[0] * S, y: a[1] * S, z: a[2] * S }, { x: 0, y: 0, z: 0 }, { x: -ax[0], y: -ax[1], z: -ax[2] });
    const j = this.world.createImpulseJoint(data, base, pc.body, true);
    pc.joint = j;
    this._jointLimits(pc, collapsed);
    if (pc.def.spring) j.configureMotorPosition(-pc.def.spring.target * DEG, pc.def.spring.k, pc.def.spring.d);   // driven towards an angle (mirrored like the limits)
    else if (pc.def.damp) j.configureMotorVelocity(0, pc.def.damp * 4e-6);
  }
  _sliderJoint(pc, base, collapsed = false) {
    const { R } = this;
    const a = pc.def.anchor, ax = pc.def.axis;
    const data = R.JointData.prismatic({ x: a[0] * S, y: a[1] * S, z: a[2] * S }, { x: 0, y: 0, z: 0 }, { x: ax[0], y: ax[1], z: ax[2] });
    const j = this.world.createImpulseJoint(data, base, pc.body, true);
    pc.joint = j;
    this._jointLimits(pc, collapsed);
    if (pc.def.spring) j.configureMotorPosition(pc.def.spring.target * S, pc.def.spring.k, pc.def.spring.d);   // pushed back towards its rest
    else if (pc.def.damp) j.configureMotorVelocity(0, pc.def.damp * 0.003);
  }
  /** Joint limits for a piece: its range, collapsed to the start while locked, or pinned at the end once latched. */
  _jointLimits(pc, collapsed = false, latched = false) {
    if (!pc.joint) return;
    const r = pc.range || pc.def.range;
    if (pc.def.kind === 'hinge') {
      if (collapsed) pc.joint.setLimits(-r[0] * DEG, -r[0] * DEG);
      else if (latched) { const at = pc.def.latchAt ?? r[1]; pc.joint.setLimits(-at * DEG, -at * DEG); }
      else pc.joint.setLimits(-r[1] * DEG, -r[0] * DEG);
    } else {
      if (collapsed) pc.joint.setLimits(r[0] * S, r[0] * S);
      else if (latched) pc.joint.setLimits(r[1] * S, r[1] * S);
      else pc.joint.setLimits(r[0] * S, r[1] * S);
    }
  }

  /** Let a locked piece go (it becomes a free or jointed body) with an optional kick (cm/s). */
  releasePiece(pc) {
    if (pc.released) return;
    pc.released = true; pc.locked = false;
    const planar = pc.def.planar && pc.def.kind === 'loose';
    pc.body.setEnabledTranslations(true, !planar, true, true);
    pc.body.setEnabledRotations(!planar, true, !planar, true);
    // a joint that was created collapsed stays stuck when widened, so build a fresh one
    if (pc.joint) { this.world.removeImpulseJoint(pc.joint, true); pc.joint = null; }
    const base = this.obstacleBodies.find((ob) => ob.o === pc.o);
    const parent = pc.def.parent && this.pieces.find((q) => q.o === pc.o && q.name === pc.def.parent);
    if (parent && pc.def.kind === 'hinge') this._hingeJoint(pc, parent.body, false, parent);
    else if (base && pc.def.kind === 'hinge') this._hingeJoint(pc, base.body);
    if (base && pc.def.kind === 'slider') this._sliderJoint(pc, base.body);
    pc.body.wakeUp();
    if (pc.def.kick) {
      const k = new THREE.Vector3(...pc.def.kick).applyQuaternion(pc.q0);
      pc.body.setLinvel({ x: k.x * 0.5, y: k.y * 0.5, z: k.z * 0.5 }, true);
    }
    // a nearly balanced piece let go (the M09 camera trap) gets the nudge that starts it falling (rad/s about its axis)
    if (pc.def.kickSpin && pc.axisW) { const w = pc.axisW.clone().multiplyScalar(pc.def.kickSpin); pc.body.setAngvel({ x: w.x, y: w.y, z: w.z }, true); }
  }

  /** A jointed piece comes loose for good (off the end of its bar): no joint, and it now collides with its own model. */
  freePiece(pc) {
    pc.freed = true; pc.released = true; pc.locked = false;
    if (pc.joint) { this.world.removeImpulseJoint(pc.joint, true); pc.joint = null; }
    pc.body.setEnabledTranslations(true, true, true, true);
    pc.body.setEnabledRotations(true, true, true, true);
    const damp = pc.def.tether && pc.def.tether.rest ? 8 : 1.5;   // a seed on a stiff hose does not swing about
    pc.body.setLinearDamping(damp); pc.body.setAngularDamping(damp);
    for (const c of pc.colliders) c.setCollisionGroups(SHARED);
    const t = pc.def.tether;
    if (t && t.rest && !pc.springJoint) {
      // a springy hose: once free, the seed is held out where the bent hose puts it (a soft spring to that point)
      const base = this.obstacleBodies.find((ob) => ob.o === pc.o);
      if (base) pc.springJoint = this.world.createImpulseJoint(this.R.JointData.spring(0, t.k ?? 4, t.d ?? 0.15,
        { x: t.rest[0] * S, y: t.rest[1] * S, z: t.rest[2] * S }, { x: t.to[0] * S, y: t.to[1] * S, z: t.to[2] * S }), base.body, pc.body, true);
    }
    if (pc.def.kick) {
      const k = new THREE.Vector3(...pc.def.kick).applyQuaternion(pc.q0);
      const v = pc.body.linvel();
      pc.body.setLinvel({ x: v.x + k.x * S, y: v.y + k.y * S, z: v.z + k.z * S }, true);   // kick in cm/s
    }
    pc.body.wakeUp();
  }

  /** Current state of every piece of a model, for the scoring rules. */
  pieceState(obstacleId) {
    const out = {};
    for (const pc of this.pieces) if (pc.o && pc.o.id === obstacleId) out[pc.name] = pc.state;
    return out;
  }

  /** Reset mechanism pieces to their start (new launch). */
  resetPieces() {
    for (const pc of this.pieces) {
      const qs = pc.qStart || pc.q0;
      const rq = { x: qs.x, y: qs.y, z: qs.z, w: qs.w };
      pc.body.setTranslation({ x: pc.start.x * S, y: pc.start.y * S, z: pc.start.z * S }, false);
      pc.body.setRotation(rq, false);
      pc.body.setLinvel({ x: 0, y: 0, z: 0 }, false); pc.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      pc.lastDrive = undefined; pc.lastPhi = undefined;
      pc.latched = false; pc.touched = -1; pc.angle = 0; pc.ext = 0; pc.height = 0; pc.floor = 0; pc.propped = false; pc.range = null;
      if (pc.easing && pc.joint) pc.joint.configureMotorVelocity(0, (pc.def.damp || 0) * 4e-6);
      pc.easing = false;
      if (pc.carried) {
        if (pc.carryJoint) this.world.removeImpulseJoint(pc.carryJoint, true);
        pc.carryJoint = null; pc.carried = false;
        pc.body.setAngularDamping(1.5);
        for (const c of pc.colliders) c.setCollisionGroups(SHARED);
      }
      if (pc.def.locked) {
        pc.locked = true; pc.released = false;
        pc.body.setEnabledTranslations(false, false, false, true); pc.body.setEnabledRotations(false, false, false, true);
        if (pc.joint) { this.world.removeImpulseJoint(pc.joint, true); pc.joint = null; }
        const base = this.obstacleBodies.find((ob) => ob.o === pc.o);
        if (base && pc.def.kind === 'hinge') this._hingeJoint(pc, base.body, true);
        if (base && pc.def.kind === 'slider') this._sliderJoint(pc, base.body, true);
      } else if (pc.freed) {
        // back on its bar: joint and own-model collision filter restored
        pc.freed = false;
        if (pc.springJoint) { this.world.removeImpulseJoint(pc.springJoint, true); pc.springJoint = null; }
        pc.body.setLinearDamping(0.8); pc.body.setAngularDamping(0.8);
        for (const c of pc.colliders) c.setCollisionGroups(modelGroup(pc.o.id));
        const base = this.obstacleBodies.find((ob) => ob.o === pc.o);
        const parent = pc.def.parent && this.pieces.find((q) => q.o === pc.o && q.name === pc.def.parent);
        if (base && pc.def.kind === 'slider') this._sliderJoint(pc, base.body);
        if (pc.def.kind === 'hinge') { if (parent) this._hingeJoint(pc, parent.body, false, parent); else if (base) this._hingeJoint(pc, base.body); }
      } else {
        this._jointLimits(pc, false);
      }
    }
    for (const pc of this.pieces) if (!pc.equipment && pc.body.bodyType() === 0) pc.body.sleep();   // back at rest: asleep until touched
    this.readPieces(0);
  }

  /** Spawn loose equipment pieces (the keystone species, the seeds) at table positions (cm). */
  spawnEquipment(items) {
    const { R } = this;
    for (const pc of this.pieces) if (pc.equipment) { this.world.removeRigidBody(pc.body); this.colliderToPiece.delete(pc.collider.handle); }
    this.pieces = this.pieces.filter((pc) => !pc.equipment);
    for (const it of items) {
      const h = it.h ?? (it.box[1] / 2 + 0.2);
      const desc = R.RigidBodyDesc.dynamic().setTranslation(it.x * S, h * S, it.y * S).setLinearDamping(1.5).setAngularDamping(1.5).setCcdEnabled(true).setCanSleep(false);
      const body = this.world.createRigidBody(desc);
      const col = this.world.createCollider(R.ColliderDesc.cuboid((it.box[0] / 2) * S, (it.box[1] / 2) * S, (it.box[2] / 2) * S).setFriction(0.8).setMass(it.mass || 0.02).setCollisionGroups(SHARED), body);
      const pc = { o: null, equipment: it, name: it.id, def: { kind: 'loose', box: it.box }, body, colliders: [col], collider: col,
        anchor: new THREE.Vector3(it.x, h, it.y), q0: new THREE.Quaternion(), axisW: null, locked: false, released: true, touched: -1, start: new THREE.Vector3(it.x, h, it.y) };
      this.pieces.push(pc);
      this.colliderToPiece.set(col.handle, pc);
    }
    this.readPieces(0);
  }

  /** Before a physics step: releases, latches, driven lifts. */
  updateMechanisms(time, impactSpeed) {
    customStep(this);
    for (const pc of this.pieces) {
      if (pc.o && pc.o.id !== undefined) {
        const st = this.pieceState(pc.o.id);
        st._impact = pc.o.impact || 0;
        if (!pc.released && pc.def.releaseWhen && pc.def.releaseWhen(st)) this.releasePiece(pc);
        // a slider that comes off the end of its travel (a ring slid off its bar) is a free piece from then on
        if (!pc.freed && ((pc.def.kind === 'slider' && pc.def.freeAt !== undefined && pc.ext >= pc.def.freeAt) || (pc.def.freeWhen && pc.def.freeWhen(st)))) this.freePiece(pc);
      }
      if (pc.def.pushedBy && pc.joint && !pc.freed) {
        // threaded behind another piece on the same bar: it is shoved along when that one comes up against it
        const d = this.pieces.find((q) => q.o === pc.o && q.name === pc.def.pushedBy);
        if (d && !d.freed && d.ext > pc.ext + 0.005) {
          const p = pc.anchor.clone().addScaledVector(pc.axisW, d.ext);
          pc.body.setTranslation({ x: p.x * S, y: p.y * S, z: p.z * S }, true);
          pc.body.setLinvel(d.body.linvel(), true);
          pc.ext = d.ext;
        }
      }
      if (pc.def.latch && pc.joint && !pc.latched) {
        const atEnd = pc.def.kind === 'hinge' ? (pc.def.latchAt !== undefined ? Math.abs(pc.angle - pc.def.latchAt) < 3 : Math.abs(pc.angle) >= Math.max(Math.abs(pc.def.range[0]), Math.abs(pc.def.range[1])) - 3) : pc.ext >= pc.def.range[1] - 0.3;
        if (atEnd) { pc.latched = true; this._jointLimits(pc, false, true); }
      }
      // pin and slide friction: a jointed piece loses a fixed amount of speed every step (rad/s^2 or cm/s^2), so a light
      // bump dies out while a real push, or gravity once it has a proper hold (a cane past centre, a falling web), wins
      if (pc.joint && !pc.def.parent && !pc.freed && (pc.def.kind === 'hinge' || pc.def.kind === 'slider')) {
        const drag = pc.def.drag ?? (pc.def.kind === 'hinge' ? 12 : 25);
        if (drag > 0) {
          const dt = this.world.timestep;
          if (pc.def.kind === 'hinge') {
            const w = pc.body.angvel(), wv = new THREE.Vector3(w.x, w.y, w.z), along = wv.dot(pc.axisW);
            const cut = Math.sign(along) * Math.min(Math.abs(along), drag * dt);
            // leave a piece at rest alone, so it can fall asleep
            if (Math.abs(along) > 1e-3) { wv.addScaledVector(pc.axisW, -cut); pc.body.setAngvel({ x: wv.x, y: wv.y, z: wv.z }, false); }
          } else {
            const v = pc.body.linvel(), vv = new THREE.Vector3(v.x, v.y, v.z), along = vv.dot(pc.axisW);
            const cut = Math.sign(along) * Math.min(Math.abs(along), drag * S * dt);
            if (Math.abs(along) > 1e-5) { vv.addScaledVector(pc.axisW, -cut); pc.body.setLinvel({ x: vv.x, y: vv.y, z: vv.z }, false); }
          }
        }
      }
      if (pc.def.stiction) {
        // pin friction (the M10 web): while nothing pushes on it and it is barely moving, it stays where it is; once
        // gravity has it moving properly (a few degrees over) it goes
        const d = pc.def.stiction, group = d.pieces.map((n) => this.pieces.find((x) => x.o === pc.o && x.name === n)).filter(Boolean);
        const pushed = group.some((q) => q.touched >= 0 && time - q.touched < 0.3);
        const slow = group.every((q) => { const w = q.body.angvel(); return Math.hypot(w.x, w.y, w.z) < (d.below ?? 0.05); });
        if (!pushed && slow) for (const q of group) { q.body.setAngvel({ x: 0, y: 0, z: 0 }, false); q.body.setLinvel({ x: 0, y: 0, z: 0 }, false); }
      }
      if (pc.def.rangeWhen && pc.joint && pc.o) {
        // a stop that is only there in some poses (the M05 root arm rests on the trunk's foot only while the extension
        // is folded down): its narrower range applies while `when` holds. A piece caught outside it (the extension fell
        // back with the arm hanging forward) is not snapped in: it cannot swing further out and is eased back, as the
        // trunk's foot would push it.
        const rw = pc.def.rangeWhen, parent = pc.def.parent && this.pieces.find((q) => q.o === pc.o && q.name === pc.def.parent);
        const rel = ((((pc.angle - (parent ? parent.angle : 0)) + 180) % 360) + 360) % 360 - 180;
        let want = null, ease = false;
        if (rw.when(this.pieceState(pc.o.id))) {
          if (pc.range === rw.range || (rel >= rw.range[0] - 1 && rel <= rw.range[1] + 1)) want = rw.range;
          else { ease = true; want = [rw.range[0], Math.max(rw.range[1], Math.min(rel + 1, pc.range ? pc.range[1] : 180))]; }
        }
        if (want !== (pc.range || null)) { pc.range = want; this._jointLimits(pc); }
        if (ease && !pc.easing) { pc.easing = true; pc.joint.configureMotorPosition(-rw.range[1] * DEG, 3000, 120); }
        else if (!ease && pc.easing) { pc.easing = false; pc.joint.configureMotorVelocity(0, (pc.def.damp || 0) * 4e-6); }
      }
      if (pc.def.prop && pc.joint && !pc.propped && pc.angle > pc.def.prop.after) {
        // a prop that swings under once the piece has been lifted far enough (the M15 canopy's L-liftarm)
        pc.propped = true;
        const r = pc.def.range;
        pc.joint.setLimits(-r[1] * DEG, -pc.def.prop.rest * DEG);
      }
      if (pc.def.ratchet && pc.joint) {
        // a ladder of catches (the M09 platform's bar over the trunk's stud pins): once past one it cannot drop below it
        const floor = Math.max(0, ...pc.def.ratchet.filter((r) => pc.ext >= r));
        if (floor > (pc.floor || 0)) { pc.floor = floor; pc.joint.setLimits(floor * S, pc.def.range[1] * S); }
      }
      if (pc.def.couple && pc.joint) {
        // geared to another hinge both ways (the M03 levers and the rock): the piece is held where the driver puts it,
        // and pushing it ahead (or behind) of that turns the driver to catch up
        const c = pc.def.couple;
        const src = this.pieces.find((q) => q.o === pc.o && q.name === c.piece);
        if (src && src.joint) {
          const th = src.angle, phi = c.map(th);
          if (pc.lastPhi === undefined || Math.abs(phi - pc.lastPhi) > 0.05) { pc.lastPhi = phi; pc.joint.configureMotorPosition(-phi * DEG, c.k ?? 1500, c.d ?? 80); }   // acceleration-based: stiff enough to follow
          const slope = (c.map(th + 1) - c.map(th - 1)) / 2;
          const e = pc.angle - phi;
          if (Math.abs(e) > 1.5 && Math.abs(slope) > 0.1 && pc.touched >= 0 && time - pc.touched < 0.3) {
            const rate = Math.max(-8, Math.min(8, (e / slope) * (c.gain ?? 20) * DEG));   // rad/s along the driver's axis
            const ax = new THREE.Vector3(...src.def.axis).applyQuaternion(src.q0).normalize();
            const w = src.body.angvel(), wv = new THREE.Vector3(w.x, w.y, w.z);
            const now = wv.dot(ax);
            if (Math.sign(rate) !== Math.sign(now) || Math.abs(rate) > Math.abs(now)) {
              wv.addScaledVector(ax, rate - now);
              src.body.setAngvel({ x: wv.x, y: wv.y, z: wv.z }, true);
            }
          }
        }
      }
      if (pc.def.kind === 'gear') {
        // kinematic: turns on its own axle in step with its driver (ratio in radians per cm the driver slides)
        const d = pc.def.drivenBy;
        const src = this.pieces.find((q) => q.o === pc.o && q.name === d.piece);
        // a kinematic body never sleeps and keeps waking what rests on it (the M06 leaves on the cams), so a gear whose
        // driver is still is made fixed until it turns again
        if (src && src.ext === pc.lastDrive && pc.body.bodyType() !== 1) pc.body.setBodyType(1, false);
        if (src && src.ext !== pc.lastDrive) {
          if (pc.body.bodyType() !== 2) this._unfreeze(pc);
          pc.lastDrive = src.ext;
          const a = src.ext * d.ratio;
          const q = pc.q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...pc.def.axis).normalize(), a));
          pc.angle = a / DEG;
          pc.body.setNextKinematicTranslation({ x: pc.anchor.x * S, y: pc.anchor.y * S, z: pc.anchor.z * S });
          pc.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        }
      }
      if (pc.def.kind === 'follow') {
        // kinematic: rides on its driver (a slider) and turns with how far the driver has travelled
        const d = pc.def.drivenBy;
        const src = this.pieces.find((q) => q.o === pc.o && q.name === d.piece);
        const e = src ? src.ext : d.travel;
        if (e === pc.lastDrive) { if (pc.body.bodyType() !== 1) pc.body.setBodyType(1, false); continue; }
        if (pc.body.bodyType() !== 2) this._unfreeze(pc);
        pc.lastDrive = e;
        const t = Math.max(0, Math.min(1, e / d.travel));
        const p = pc.anchor.clone().add(new THREE.Vector3(0, e, 0));
        const q = pc.q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...pc.def.axis).normalize(), pc.def.angle * t * DEG));
        pc.angle = pc.def.angle * t;
        pc.body.setNextKinematicTranslation({ x: p.x * S, y: p.y * S, z: p.z * S });
        pc.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      if (pc.def.kind === 'lift' && pc.def.drivenBy) {
        const d = pc.def.drivenBy;
        const srcId = d.model || pc.o.id;
        const src = this.pieces.find((q) => q.o && q.o.id === srcId && q.name === d.piece);
        const drive = src ? (src.def.kind === 'hinge' ? src.angle : src.ext) : 0;
        const h = Math.max(0, drive * d.ratio);
        pc.height = h;
        pc.body.setNextKinematicTranslation({ x: pc.start.x * S, y: (pc.start.y + h) * S, z: pc.start.z * S });
      }
    }
  }

  /** After a step: read every piece's pose and derived numbers. */
  readPieces(time) {
    for (const pc of this.pieces) {
      const t = pc.body.translation(), r = pc.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const pos = new THREE.Vector3(t.x / S, t.y / S, t.z / S);
      if (pc.axisW && pc.def.kind === 'hinge') {
        const rel = pc.q0.clone().invert().multiply(q);
        if (rel.w < 0) { rel.x = -rel.x; rel.y = -rel.y; rel.z = -rel.z; rel.w = -rel.w; }   // same rotation, short arc
        const ax = new THREE.Vector3(...pc.def.axis).normalize();
        const dot = rel.x * ax.x + rel.y * ax.y + rel.z * ax.z;
        pc.angle = (2 * Math.atan2(dot, rel.w)) / DEG;
      } else if (pc.axisW && pc.def.kind === 'slider') {
        const ext = pos.clone().sub(pc.anchor).dot(pc.axisW);
        const dt = time - (pc.extTime ?? time);
        pc.vel = dt > 0 ? (ext - pc.ext) / dt : 0;    // cm/s along the slide
        pc.ext = ext; pc.extTime = time;
      }
      const moved = Math.hypot(pos.x - pc.start.x, pos.z - pc.start.z);
      const relq = pc.q0.clone().invert().multiply(q);
      const rotated = 2 * Math.acos(Math.min(1, Math.abs(relq.w))) / DEG;
      // lowest point of the first shape (approximate: box corners)
      let bottom = Infinity;
      if (pc.hull) for (const h of pc.hull) { const c = h.clone().applyQuaternion(q); if (c.y + pos.y < bottom) bottom = c.y + pos.y; }
      else {
        const sh = (pc.def.shape && pc.def.shape[0]) || { box: pc.def.box || [2, 2, 2], at: [0, 0, 0] };
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const c = new THREE.Vector3(sh.at[0] + sx * sh.box[0] / 2, sh.at[1] + sy * sh.box[1] / 2, sh.at[2] + sz * sh.box[2] / 2).applyQuaternion(q).add(pos);
          if (c.y < bottom) bottom = c.y;
        }
      }
      // pieces whose scoring asks "no longer touching the model": real contact with the model's fixed parts, and
      // where its outline lies on the table
      let touchesBase = false, outline = null;
      if (pc.baseHandles) {
        for (const c of pc.colliders) {
          this.world.contactPairsWith(c, (other) => {
            if (touchesBase || !pc.baseHandles.has(other.handle)) return;
            this.world.contactPair(c, other, (m) => { if (m.numContacts() > 0) touchesBase = true; });
          });
          if (touchesBase) break;
        }
      }
      if ((pc.baseHandles || pc.def.outline) && pc.hull) {
        outline = pc.hull.map((h) => { const c = h.clone().applyQuaternion(q).add(pos); return [c.x, c.z]; });
      }
      pc.state = { touchesBase, outline, freed: !!pc.freed, angle: pc.angle, ext: pc.ext, vel: pc.vel || 0, height: pc.def.kind === 'lift' ? pc.height : pos.y - pc.start.y, pos: [pos.x, pos.y, pos.z], x: pos.x, y: pos.z, moved, rotated, bottom,
        touched: pc.touched >= 0 && time - pc.touched < 0.3, everTouched: pc.touched >= 0, released: pc.released, latched: pc.latched, q: [q.x, q.y, q.z, q.w] };
    }
  }

  /** World pose of a piece for rendering: position (cm) and quaternion. */
  piecePose(obstacleId, name) {
    const pc = this.pieces.find((q) => (q.o ? q.o.id === obstacleId : obstacleId === null) && q.name === name);
    if (!pc || !pc.state) return null;
    return { p: pc.state.pos, q: pc.state.q };
  }

  resetObstacles() {
    for (const { o, body } of this.obstacleBodies) {
      if (!o.movable) continue;
      body.setTranslation({ x: o.x * S, y: (o.h / 2) * S, z: o.y * S }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      o.angle = 0;
    }
    this.resetPieces();
  }

  /** Copy dynamic body poses back to the sim's obstacle records (x, y, angle). */
  syncObstacles() {
    let moved = false;
    for (const { o, body } of this.obstacleBodies) {
      if (!o.movable) continue;
      const t = body.translation();
      const x = t.x / S, y = t.z / S, angle = -yawOf(body.rotation());
      if (Math.abs(x - o.x) > 1e-4 || Math.abs(y - o.y) > 1e-4 || Math.abs(angle - (o.angle || 0)) > 1e-3) {
        o.x = x; o.y = y; o.angle = angle; moved = true;
      }
    }
    if (moved) this.sim.obstaclesDirty = true;
  }

  // ---------------- robot ----------------

  /** (Re)create the robot's kinematic body and its colliders from the build geometry (robot-local: x forward, y up, z right). */
  rebuildRobot(robot) {
    const { R } = this;
    if (this.robotBody) this.world.removeRigidBody(this.robotBody);
    this.robot = robot;
    const geom = robot.geom;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(robot.x * S, 0, robot.y * S).setRotation(yawQuat(robot.heading)));
    this.robotBody = body;
    const ACT = R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED;
    const fp = geom.footprint;
    // the body reaches from just off the mat to the top of the hub (7.2 cm on the Driving Base, measured from its model):
    // anything taller let pieces rest in mid-air above the robot (a seed lifted off by the arm stayed hovering there)
    const top = 7.2, bottom = 0.4, round = 0.8, half = (top - bottom) / 2;
    const bodyDesc = fp
      ? R.ColliderDesc.roundCuboid(((fp.x1 - fp.x0) / 2 - round) * S, (half - round) * S, ((fp.z1 - fp.z0) / 2 - round) * S, round * S).setTranslation(((fp.x0 + fp.x1) / 2) * S, (bottom + half) * S, ((fp.z0 + fp.z1) / 2) * S)
      : R.ColliderDesc.cylinder(half * S, geom.radius * S).setTranslation(0, (bottom + half) * S, 0);
    this.bodyCollider = this.world.createCollider(bodyDesc.setFriction(0.5).setCollisionGroups(ROBOT).setActiveCollisionTypes(ACT), body);

    // Attachment: a tiny scene graph mirroring the 3D view. Parts that move with the motor ride on their own
    // kinematic body (so the solver sees real velocities when the arm lifts or sweeps something); parts fixed to
    // the mount stay on the robot body.
    removeCustom(this);
    if (this.armBody) { this.world.removeRigidBody(this.armBody); this.armBody = null; }
    this.robotParts = [];
    const a = geom.attachment;
    const root = new THREE.Object3D();
    const pivot = new THREE.Object3D();
    const moving = new THREE.Object3D();
    pivot.position.set(a.fwd, a.height, a.lat);
    pivot.rotation.y = -a.angle * DEG;
    pivot.add(moving);
    root.add(pivot);
    this.armRoot = root; this.armPivot = pivot; this.armMoving = moving;
    const hasMoving = ['arm', 'sweeper', 'basket', 'lift', 'plow', 'scoop'].includes(a.module);
    const armBody = hasMoving ? this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(robot.x * S, 0, robot.y * S).setRotation(yawQuat(robot.heading))) : null;
    this.armBody = armBody;
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.updateMatrixWorld(true);
    const part = (parent, size, pos, pitch = 0) => {       // pitch: degrees about z, nose up
      const node = new THREE.Object3D();
      node.position.set(...pos);
      node.rotation.z = pitch * DEG;
      parent.add(node);
      node.updateMatrixWorld(true);
      const onArm = parent === moving && armBody;
      const desc = R.ColliderDesc.cuboid((size[0] / 2) * S, (size[1] / 2) * S, (size[2] / 2) * S).setFriction(ATTACH_FRICTION).setCollisionGroups(ROBOT).setActiveCollisionTypes(ACT);
      if (onArm) { desc.setTranslation(pos[0] * S, pos[1] * S, pos[2] * S); if (pitch) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, pitch * DEG)); desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); } }   // relative to the moving frame
      else { const w = new THREE.Vector3(); node.getWorldPosition(w); const q = new THREE.Quaternion(); node.getWorldQuaternion(q); desc.setTranslation(w.x * S, w.y * S, w.z * S).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
      const collider = this.world.createCollider(desc, onArm ? armBody : body);
      this.robotParts.push({ collider, node, half: size.map((v) => v / 2), onArm: !!onArm });
    };
    // a part box in the attachment's own frame (the moving model is drawn turned a quarter turn about y): an axle-like
    // part is a capsule, so things rest on the real thin axle and slide along it instead of snagging on a block
    const realPart = (box, q) => {
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const pos = new THREE.Vector3(box[0], box[1], box[2]).applyQuaternion(turn);
      const rot = turn.clone().multiply(new THREE.Quaternion(...q));
      const h = [box[3], box[4], box[5]];
      const node = new THREE.Object3D();
      node.position.copy(pos); node.quaternion.copy(rot);
      moving.add(node); node.updateMatrixWorld(true);
      const order = [0, 1, 2].sort((i, j) => h[i] - h[j]);
      let desc, cr = rot.clone();
      if (h[order[0]] < 0.4 && h[order[1]] - h[order[0]] < 0.06 && h[order[2]] > 2.5 * h[order[1]]) {
        const r = (h[order[0]] + h[order[1]]) / 2;
        desc = R.ColliderDesc.capsule(Math.max(0.01, h[order[2]] - r) * S, r * S);
        const along = [0, 0, 0]; along[order[2]] = 1;
        cr.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...along)));
      } else desc = R.ColliderDesc.cuboid(Math.max(0.05, h[0]) * S, Math.max(0.05, h[1]) * S, Math.max(0.05, h[2]) * S);
      desc.setFriction(ATTACH_FRICTION).setCollisionGroups(ROBOT).setActiveCollisionTypes(ACT).setTranslation(pos.x * S, pos.y * S, pos.z * S).setRotation({ x: cr.x, y: cr.y, z: cr.z, w: cr.w });
      const collider = this.world.createCollider(desc, armBody);
      this.robotParts.push({ collider, node, half: h, onArm: true });
    };
    const measured = armBody && ATTACH_PARTS[a.module];
    if (measured) {
      const boxes = [];
      for (const e of measured) for (const b of e.b || [[...e.p, ...e.h]]) boxes.push({ c: b.slice(0, 3), h: b.slice(3, 6), q: boxQuat(b, e) });
      for (const b of dropHidden(boxes)) if (Math.max(...b.h) > 0.25) realPart([...b.c, ...b.h], b.q);   // loose pins add nothing
      if (a.module !== 'sweeper') part(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);   // the bracket on the hub
    } else if (a.module === 'arm') {
      // The Driving Base 2 arm, in the frame of its axle: two double-bent liftarms (a short leg up to the elbow,
      // a long leg down to the tip), the 9-long cross bar with its angle connectors, and the bracket on the hub.
      for (const z of [-1.6, 1.6]) { part(moving, [3.4, 0.8, 0.8], [1.23, 1.03, z], 40); part(moving, [6.6, 0.8, 0.8], [4.5, -0.4, z], -50); }
      part(moving, [1.6, 1.6, 8.6], [6.56, -2.85, 0]);
      part(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);
    } else if (a.module === 'scoop') {
      for (const p of SCOOP_PARTS) part(moving, p.size, p.at, p.pitch || 0);
      part(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);    // the bracket on the hub
    } else if (a.module === 'sweeper') {
      part(moving, [12, 0.8, 0.8], [6.4, 0, 0]);        // the 15-long beam on edge, running forward from the axle
      part(moving, [0.8, 2.4, 0.8], [0.8, 0, 0]);       // the cross block on the axle
    } else if (a.module === 'basket') {
      for (const z of [-1.6, 1.6]) part(moving, [2.4, 0.8, 0.8], [0.8, 0, z]);    // cross blocks forward to the second axle
      for (const z of [-2.4, 2.4]) part(moving, [0.8, 2.4, 0.8], [1.6, -0.8, z]); // cross blocks hanging from it
      part(moving, [4, 0.8, 5.6], [4, -3.2, 0]);        // the 7x5 frame floor
      part(moving, [0.8, 0.8, 5.6], [2.4, -2.4, 0]);    // rails: back, front, sides
      part(moving, [0.8, 0.8, 5.6], [5.6, -2.4, 0]);
      for (const z of [-2.4, 2.4]) part(moving, [2.4, 0.8, 0.8], [4, -2.4, z]);
      part(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);    // the bracket on the hub
    } else if (a.module === 'plow') {
      for (const z of [-1.6, 1.6]) part(moving, [2.4, 0.8, 0.8], [0.8, 0, z]);    // cross blocks forward to the second axle
      for (const z of [-2.4, 2.4]) part(moving, [0.8, 2.4, 0.8], [1.6, -0.8, z]); // cross blocks hanging from it
      part(moving, [0.8, 0.8, 12], [2.4, -0.8, 0]);     // 15-long beam across
      part(moving, [0.8, 0.8, 8.8], [2.4, -1.6, 0]);    // 11-long beam below it
      part(moving, [1.6, 2.4, 8.8], [3.6, -1.6, 0]);    // the blade panel
      part(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);    // the bracket on the hub
    } else if (a.module === 'lift') {
      part(pivot, [4, 4, 3.6], [0, 0, 0]);              // motor
      for (const z of [-1.8, 1.8]) part(pivot, [0.8, 12, 0.8], [2.4, 3, z]);   // the mast's two uprights
      part(moving, [6, 0.7, 6.4], [4.8, 0, 0]);         // the fork's tines
      part(moving, [0.8, 2.4, 4], [1.6, 1.2, 0]);       // the fork's back
      part(moving, [0.8, 9.6, 0.8], [0.9, 4.8, 0]);     // the rack
    }
    if (a.module === 'custom') buildCustom(this, robot, { pivot, moving, ACT, ROBOT, ATTACH });
    this.module = a.module;
    this.lastArmAngle = this.attachmentAngle(robot);
    this.placeArm(robot.x, robot.y, robot.heading, this.lastArmAngle, true);
  }

  attachmentAngle(robot) {
    const port = robot.config.attachment;
    return port && robot.motors[port] ? robot.motors[port].angle : 0;
  }

  /** Pose the attachment graph for a robot pose and motor angle (degrees); returns the moving frame's world pose (cm). */
  syncAttachment(x, y, heading, angle) {
    const mv = this.armMoving;
    if (this.module === 'arm' || this.module === 'plow' || this.module === 'scoop') mv.rotation.set(0, 0, angle * DEG);
    else if (this.module === 'basket') mv.rotation.set(0, 0, -Math.max(0, angle) * DEG);
    else if (this.module === 'sweeper') mv.rotation.set(0, angle * DEG, 0);
    else if (this.module === 'lift') mv.position.y = Math.max(LIFT.low, Math.min(LIFT.high, LIFT.low + (angle / 360) * LIFT.cmPerRotation)) - this.armPivot.position.y;
    else if (this.module === 'custom') mv.rotation.set(0, 0, angle * DEG);
    this.armRoot.position.set(x, 0, y);
    this.armRoot.rotation.set(0, -heading * DEG, 0);
    this.armRoot.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    mv.getWorldPosition(p); mv.getWorldQuaternion(q);
    return { p, q };
  }

  /** Move the attachment body to match the robot (teleport, or as the next kinematic pose for the coming step). */
  placeArm(x, y, heading, angle, teleport = false) {
    if (!this.armBody) { this.syncAttachment(x, y, heading, angle); return; }
    const { p, q } = this.syncAttachment(x, y, heading, angle);
    const t = { x: p.x * S, y: p.y * S, z: p.z * S }, r = { x: q.x, y: q.y, z: q.z, w: q.w };
    if (teleport) { this.armBody.setTranslation(t, true); this.armBody.setRotation(r, true); }
    else { this.armBody.setNextKinematicTranslation(t); this.armBody.setNextKinematicRotation(r); }
  }

  /** Would the attachment pieces (shrunk a little) overlap anything at this robot pose and motor angle? */
  _partsHit(x, y, heading, angle, margin = STALL_MARGIN) {
    const { R } = this;
    this.syncAttachment(x, y, heading, angle);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    let hit = false;
    for (const part of this.robotParts) {
      part.node.getWorldPosition(p); part.node.getWorldQuaternion(q);
      const h = part.half.map((v) => Math.max(0.1, v - margin) * S);
      const shape = new R.Cuboid(h[0], h[1], h[2]);
      this.world.intersectionsWithShape({ x: p.x * S, y: p.y * S, z: p.z * S }, { x: q.x, y: q.y, z: q.z, w: q.w }, shape, () => { hit = true; return false; }, R.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, this._notRobot());
      if (hit) break;
    }
    return hit;
  }

  /** True when moving the attachment motor to `angle` would push the attachment into a wall or model. */
  attachmentBlocked(angle) {
    if (!this.robotBody || !this.robotParts.length) return false;
    const r = this.robot;
    const hit = this._partsHit(r.x, r.y, r.heading, angle);
    this.syncAttachment(r.x, r.y, r.heading, this.attachmentAngle(r));
    return hit;
  }

  setRobotPose(x, y, heading) {
    if (!this.robotBody || ![x, y, heading].every(Number.isFinite)) return;   // NaN would poison the physics world
    this.robotBody.setTranslation({ x: x * S, y: 0, z: y * S }, true);
    this.robotBody.setRotation(yawQuat(heading), true);
    this.lastArmAngle = this.attachmentAngle(this.robot);
    this.placeArm(x, y, heading, this.lastArmAngle, true);
    placeCustom(this, x, y, heading, this.lastArmAngle);
  }

  _notRobot() { const h = this.robotBody.handle, ha = this.armBody ? this.armBody.handle : -1; return (c) => { const p = c.parent(); return !p || (p.handle !== h && p.handle !== ha); }; }

  /**
   * Move the robot from its current pose towards (nx, ny, nh): spins that sweep the attachment into something are
   * refused, translations are collide-and-slid against walls and models (pushing movable boxes). Returns the pose reached.
   */
  moveRobot(robot, nx, ny, nh, dt) {
    const { R } = this;
    const body = this.robotBody;
    if (![nx, ny, nh].every(Number.isFinite)) return [robot.x, robot.y, robot.heading];
    const angle = this.attachmentAngle(robot);
    const cur = body.translation();
    let heading = nh;
    if (nh !== robot.heading && this.robotParts.length && this._partsHit(robot.x, robot.y, nh, angle)) heading = robot.heading;
    const q = yawQuat(heading);
    body.setRotation(q, true);                        // queries below see the new heading
    let move = { x: (nx - robot.x) * S, y: 0, z: (ny - robot.y) * S };
    const notRobot = this._notRobot();
    const touched = new Set();
    const speed = Math.hypot(move.x, move.z) / S / dt;   // cm/s
    const pass = (collider) => {
      // an attachment rides over studs and plate edges: fixed parts that stick up less than RIDE above its underside
      // do not stop the drive (a real arm resting on a model lifts over them)
      let filter = notRobot;
      if (collider !== this.bodyCollider) {
        const under = colliderBottom(collider) + RIDE;
        filter = (c) => notRobot(c) && !(this.colliderTop.has(c.handle) && this.colliderTop.get(c.handle) < under);
      }
      this.cc.computeColliderMovement(collider, move, R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined, filter);
      const m = this.cc.computedMovement();
      move = { x: m.x, y: 0, z: m.z };
      for (let i = 0; i < this.cc.numComputedCollisions(); i++) {
        const c = this.cc.computedCollision(i);
        if (!c || !c.collider) continue;
        const o = this.colliderToObstacle.get(c.collider.handle);
        if (o) { touched.add(o); if (speed > (o.impact || 0)) o.impact = speed; }
        const pc = this.colliderToPiece.get(c.collider.handle);
        if (pc) { pc.touched = robot.time; if (pc.o) touched.add(pc.o); }
      }
    };
    pass(this.bodyCollider);
    for (const part of this.robotParts) pass(part.collider);
    if (this.robotParts.length) pass(this.bodyCollider);
    // Several physics substeps per robot step: the arm can sweep a centimeter per step, and jointed pieces need
    // the kinematic push spread over small moves to react properly.
    const SUB = this.substeps || this.sim.physicsSubsteps || 3;
    const h0 = robot.heading, a0 = this.lastArmAngle ?? angle;
    for (let k = 1; k <= SUB; k++) {
      const f = k / SUB;
      const hx = cur.x + move.x * f, hz = cur.z + move.z * f;
      const hh = h0 + (heading - h0) * f, ha = a0 + (angle - a0) * f;
      body.setNextKinematicTranslation({ x: hx, y: 0, z: hz });
      body.setNextKinematicRotation(yawQuat(hh));
      this.placeArm(hx / S, hz / S, hh, ha);
      this.updateMechanisms(robot.time);
      this.world.timestep = dt / SUB;
      this.world.step();
    }
    this.lastArmAngle = angle;
    this.robotContacts(robot.time, speed, touched);
    for (const o of touched) o.touched = robot.time;
    for (const ob of this.obstacleBodies) if (ob.o.impact && !touched.has(ob.o)) ob.o.impact = 0;
    this.readPieces(robot.time);
    this.syncObstacles();
    const t = body.translation();
    return [t.x / S, t.z / S, heading];
  }

  /** Everything the robot's colliders are in contact with after a step: marks pieces and models as touched. */
  robotContacts(time, speed, touched) {
    const cols = [this.bodyCollider, ...this.robotParts.map((p) => p.collider)];
    if (this.custom) cols.push(...this.custom.colliders);
    for (const c of cols) {
      const armPart = c !== this.bodyCollider;
      this.world.contactPairsWith(c, (other) => {
        // a pair exists as soon as bounding boxes overlap: only count it when the shapes really meet
        let real = false;
        this.world.contactPair(c, other, (m) => { for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) <= 0.0005) { real = true; break; } });
        if (!real) return;
        const pc = this.colliderToPiece.get(other.handle);
        if (pc) { pc.touched = time; if (pc.o) touched.add(pc.o); if (armPart && pc.def.carry && !pc.carried) { if (!pc.released) this.releasePiece(pc); this._carry(pc); } }
        const o = this.colliderToObstacle.get(other.handle);
        if (o) { touched.add(o); if (speed > (o.impact || 0)) o.impact = speed; }
      });
    }
    // pieces that hit their own model hard (the ant cart ramming the nest) count as impacts on that model
    for (const pc of this.pieces) {
      if (!pc.def.impactor || !pc.o) continue;
      const v = pc.body.linvel();
      const sp = Math.hypot(v.x, v.z) / S;
      if (sp > (pc.o.impact || 0)) pc.o.impact = sp;
    }
  }

  /**
   * A piece the attachment picks up (the M11 seed by its red connector) hooks onto the arm and rides with it:
   * a fixed joint to the arm body, and no more collisions until the field is reset.
   */
  _carry(pc) {
    if (!this.armBody) return;
    const { R } = this;
    // The piece hangs from the arm by its connector: a ball joint 1.6 cm above the piece's center, so it dangles
    // under gravity and swings as the robot moves instead of sticking out at whatever angle it was caught.
    const at = this.armBody.translation(), ar = this.armBody.rotation();
    const pt = pc.body.translation(), pr = pc.body.rotation();
    const qa = new THREE.Quaternion(ar.x, ar.y, ar.z, ar.w), qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const hook = new THREE.Vector3(pt.x, pt.y + 1.6 * S, pt.z);
    const onArm = hook.clone().sub(new THREE.Vector3(at.x, at.y, at.z)).applyQuaternion(qa.clone().invert());
    const onPiece = new THREE.Vector3(0, 1.6 * S, 0).applyQuaternion(qp.clone().invert());
    const data = R.JointData.spherical({ x: onArm.x, y: onArm.y, z: onArm.z }, { x: onPiece.x, y: onPiece.y, z: onPiece.z });
    pc.carryJoint = this.world.createImpulseJoint(data, this.armBody, pc.body, true);
    pc.body.setAngularDamping(6);
    for (const c of pc.colliders) c.setCollisionGroups(0);
    pc.carried = true;
  }

  /** A fixed gear or follower starts moving again: kinematic, and what rests on it woken (a sleeping leaf on a turning
   * cam is not woken by Rapier and gets cut into and flung). */
  _unfreeze(pc) {
    pc.body.setBodyType(2, true);
    for (const q of this.pieces) if (q.o === pc.o && q.body.bodyType() === 0) q.body.wakeUp();
  }

  /** Let loose pieces settle while no program runs (gravity keeps working between runs). */
  idleStep(dt) {
    if (!this.robotBody) return;
    // nothing moving and the robot where it was: the world is at rest, so there is nothing to step
    const rt = this.robotBody.translation(), rr = this.robotBody.rotation();
    const sig = [rt.x, rt.z, rr.y, rr.w, this.robot ? this.attachmentAngle(this.robot) : 0].join();
    const awake = this.pieces.some((pc) => pc.body.bodyType() === 0 && !pc.body.isSleeping());
    if (!awake && sig === this.idleSig) { this.idleAcc = 0; return; }
    this.idleSig = sig;
    const t = this.robot ? this.robot.time : 0;
    this.idleAcc = Math.min(0.05, (this.idleAcc || 0) + dt);
    const STEP = 1 / 200;                 // joint limits need small, fixed steps or they bounce
    while (this.idleAcc >= STEP) {
      this.updateMechanisms(t);
      this.world.timestep = STEP;
      this.world.step();
      this.idleAcc -= STEP;
    }
    this.readPieces(t);
    this.syncObstacles();
  }

  /** Distance (cm) along (dx, dy) from (x, y) at `height` cm to the first wall/model, or Infinity. */
  raycast(x, y, dx, dy, height, maxDist) {
    const ray = new this.R.Ray({ x: x * S, y: height * S, z: y * S }, { x: dx, y: 0, z: dy });
    const hit = this.world.castRay(ray, maxDist * S, true, undefined, undefined, undefined, this.robotBody);
    if (!hit) return Infinity;
    const toi = hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
    return toi / S;
  }
}
