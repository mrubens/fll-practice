// Collision layer on top of Rapier (loaded from the CDN; the sim falls back to the old circle/box code without it).
// The robot stays kinematic (programs move it exactly as before); Rapier only decides what it may not pass through:
// walls, mission models and the attachment, with the character controller doing collide-and-slide. Movable practice
// boxes are dynamic bodies that get shoved. Frames: sim x east / y south / heading clockwise  <->  Rapier x east / z south / y up.
import * as THREE from 'three';
import { MECHANISMS } from './mechanisms.js';

const S = 0.01;                 // cm -> m (Rapier's defaults are tuned for metres)
const DEG = Math.PI / 180;
const SKIN = 0.25;              // cm the controller keeps between the robot and whatever it touches
const STALL_MARGIN = 0.35;      // cm the attachment shape is shrunk by for "would this motor move hit something" tests

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
  return new Physics(R, world);
}

// Collision groups: bit 0 = everything shared (robot, walls, mat, loose equipment, practice boxes); each mission
// model gets its own bit so its pieces never collide with their own base (the LEGO geometry overlaps there).
const ALL = 0xFFFF;
const grp = (member, filter) => ((member & 0xFFFF) << 16) | (filter & 0xFFFF);
const SHARED = grp(1, ALL);
const MODEL_BIT = { 'M01 Drone Survey': 1, 'M01 Drone stand': 1 };   // the rest are assigned as they are built
const modelGroup = (id) => { if (!(id in MODEL_BIT)) MODEL_BIT[id] = 2 + (Object.keys(MODEL_BIT).length - 1) % 14; const b = 1 << MODEL_BIT[id]; return grp(b, ALL & ~b); };

const yawQuat = (headingDeg) => { const a = -headingDeg * DEG / 2; return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }; };
const yawOf = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) / DEG;   // degrees, counter-clockwise from above

export class Physics {
  constructor(R, world) {
    this.R = R;
    this.sim = world;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    // Jointed mission pieces are pushed by kinematic (infinitely heavy) robot parts: give the solver more passes
    // so the joint and the contact agree instead of the robot plowing straight through the piece.
    if (this.world.integrationParameters) { this.world.integrationParameters.numSolverIterations = 24; }
    this.obstacleBodies = [];
    this.pieces = [];              // moving mission-model pieces (see mechanisms.js) and equipment
    this.colliderToPiece = new Map();
    this.robotBody = null;
    this.robotParts = [];        // { collider, node } attachment pieces that follow the attachment motor
    this.bodyCollider = null;
    this.cc = this.world.createCharacterController(SKIN * S);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(1.5);
    this.buildWalls();
  }

  buildWalls() {
    const { R } = this;
    const t = this.sim.table;
    const hw = this.sim.innerHalfW, hh = this.sim.innerHalfH, w = t.wall, h = t.wallHeight;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const add = (x, z, hx, hz) => this.world.createCollider(R.ColliderDesc.cuboid(hx * S, (h / 2) * S, hz * S).setTranslation(x * S, (h / 2) * S, z * S).setCollisionGroups(SHARED), body);
    add(0, -hh - w / 2, hw + w, w / 2);
    add(0, hh + w / 2, hw + w, w / 2);
    add(-hw - w / 2, 0, w / 2, hh + w);
    add(hw + w / 2, 0, w / 2, hh + w);
    this.world.createCollider(R.ColliderDesc.cuboid((hw + w) * S, 1 * S, (hh + w) * S).setTranslation(0, -1 * S, 0).setFriction(0.8).setCollisionGroups(SHARED), body);   // the mat
    this.wallsBody = body;
  }

  // ---------------- obstacles ----------------

  rebuildObstacles() {
    const { R } = this;
    for (const ob of this.obstacleBodies) this.world.removeRigidBody(ob.body);
    this.obstacleBodies = [];
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
    this.readPieces(0);
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
    for (const b of def.base || []) {
      colliders.push(this.world.createCollider(R.ColliderDesc.cuboid((b.box[0] / 2) * S, (b.box[1] / 2) * S, (b.box[2] / 2) * S).setTranslation(b.at[0] * S, b.at[1] * S, b.at[2] * S).setFriction(0.7).setCollisionGroups(groups), base));
    }
    this.obstacleBodies.push({ o, body: base, colliders });
    o.angle = 0;
    for (const [name, pd] of Object.entries(def.pieces || {})) {
      const anchorW = toWorld(pd.anchor);
      const locked = !!pd.locked;
      let desc;
      if (pd.kind === 'lift') desc = R.RigidBodyDesc.kinematicPositionBased();
      else desc = R.RigidBodyDesc.dynamic().setLinearDamping(pd.kind === 'loose' ? 1.5 : 0.8).setAngularDamping(pd.kind === 'loose' ? 1.5 : 0.8).setGravityScale(pd.gravity === false ? 0 : 1);
      // A locked piece is a dynamic body with every degree of freedom switched off (a body born fixed cannot be
      // jointed later), released by switching them back on.
      if (locked) desc.enabledTranslations(false, false, false).enabledRotations(false, false, false);
      else if (pd.planar && pd.kind === 'loose') desc.enabledTranslations(true, false, true).enabledRotations(false, true, false);
      desc.setTranslation(anchorW.x * S, anchorW.y * S, anchorW.z * S).setRotation(rq).setCcdEnabled(true).setCanSleep(false);
      const body = this.world.createRigidBody(desc);
      const shapes = pd.shape && pd.shape.length ? pd.shape : [{ box: [2, 2, 2], at: [0, 1, 0] }];
      const cols = shapes.map((sh, i) => this.world.createCollider(
        R.ColliderDesc.cuboid((sh.box[0] / 2) * S, (sh.box[1] / 2) * S, (sh.box[2] / 2) * S).setTranslation(sh.at[0] * S, sh.at[1] * S, sh.at[2] * S)
          .setFriction(pd.friction ?? 0.7).setMass(i === 0 ? (pd.mass ?? 0.05) : 0.001).setCollisionGroups(pd.whole || pd.kind === 'loose' ? SHARED : groups), body));
      const pc = { o, name, def: pd, body, colliders: cols, collider: cols[0], anchor: anchorW, q0: frame.q.clone(), axisW: pd.axis ? new THREE.Vector3(...pd.axis).applyQuaternion(frame.q).normalize() : null,
        locked, released: !locked, latched: false, touched: -1, angle: 0, ext: 0, height: 0, start: anchorW.clone() };
      if (pd.kind === 'hinge') this._hingeJoint(pc, base, locked);
      if (pd.kind === 'slider') this._sliderJoint(pc, base, locked);
      this.pieces.push(pc);
      for (const c of cols) this.colliderToPiece.set(c.handle, pc);
    }
  }

  _hingeJoint(pc, base, collapsed = false) {
    const { R } = this;
    const a = pc.def.anchor, ax = pc.def.axis;
    // Rapier measures the revolute angle the other way round from the right-hand rule used in mechanisms.js
    // (checked empirically), so the limits are mirrored.
    const data = R.JointData.revolute({ x: a[0] * S, y: a[1] * S, z: a[2] * S }, { x: 0, y: 0, z: 0 }, { x: -ax[0], y: -ax[1], z: -ax[2] });
    const j = this.world.createImpulseJoint(data, base, pc.body, true);
    pc.joint = j;
    this._jointLimits(pc, collapsed);
    if (pc.def.damp) j.configureMotorVelocity(0, pc.def.damp * 4e-6);
  }
  _sliderJoint(pc, base, collapsed = false) {
    const { R } = this;
    const a = pc.def.anchor, ax = pc.def.axis;
    const data = R.JointData.prismatic({ x: a[0] * S, y: a[1] * S, z: a[2] * S }, { x: 0, y: 0, z: 0 }, { x: ax[0], y: ax[1], z: ax[2] });
    const j = this.world.createImpulseJoint(data, base, pc.body, true);
    pc.joint = j;
    this._jointLimits(pc, collapsed);
    if (pc.def.damp) j.configureMotorVelocity(0, pc.def.damp * 0.003);
  }
  /** Joint limits for a piece: its range, collapsed to the start while locked, or pinned at the end once latched. */
  _jointLimits(pc, collapsed = false, latched = false) {
    if (!pc.joint) return;
    const r = pc.def.range;
    if (pc.def.kind === 'hinge') {
      if (collapsed) pc.joint.setLimits(-r[0] * DEG, -r[0] * DEG);
      else if (latched) pc.joint.setLimits(-r[1] * DEG, -r[1] * DEG);
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
    if (base && pc.def.kind === 'hinge') this._hingeJoint(pc, base.body);
    if (base && pc.def.kind === 'slider') this._sliderJoint(pc, base.body);
    pc.body.wakeUp();
    if (pc.def.kick) {
      const k = new THREE.Vector3(...pc.def.kick).applyQuaternion(pc.q0);
      pc.body.setLinvel({ x: k.x * 0.5, y: k.y * 0.5, z: k.z * 0.5 }, true);
    }
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
      const rq = { x: pc.q0.x, y: pc.q0.y, z: pc.q0.z, w: pc.q0.w };
      pc.body.setTranslation({ x: pc.start.x * S, y: pc.start.y * S, z: pc.start.z * S }, true);
      pc.body.setRotation(rq, true);
      pc.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pc.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      pc.latched = false; pc.touched = -1; pc.angle = 0; pc.ext = 0; pc.height = 0;
      if (pc.carried) {
        if (pc.carryJoint) this.world.removeImpulseJoint(pc.carryJoint, true);
        pc.carryJoint = null; pc.carried = false;
        pc.body.setGravityScale(pc.def.gravity === false ? 0 : 1, true);
        for (const c of pc.colliders) c.setCollisionGroups(SHARED);
      }
      if (pc.def.locked) {
        pc.locked = true; pc.released = false;
        pc.body.setEnabledTranslations(false, false, false, true); pc.body.setEnabledRotations(false, false, false, true);
        if (pc.joint) { this.world.removeImpulseJoint(pc.joint, true); pc.joint = null; }
        const base = this.obstacleBodies.find((ob) => ob.o === pc.o);
        if (base && pc.def.kind === 'hinge') this._hingeJoint(pc, base.body, true);
        if (base && pc.def.kind === 'slider') this._sliderJoint(pc, base.body, true);
      } else {
        this._jointLimits(pc, false);
      }
    }
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
    for (const pc of this.pieces) {
      if (pc.o && pc.o.id !== undefined) {
        const st = this.pieceState(pc.o.id);
        st._impact = pc.o.impact || 0;
        if (!pc.released && pc.def.releaseWhen && pc.def.releaseWhen(st)) this.releasePiece(pc);
      }
      if (pc.def.latch && pc.joint && !pc.latched) {
        const atEnd = pc.def.kind === 'hinge' ? Math.abs(pc.angle) >= Math.max(Math.abs(pc.def.range[0]), Math.abs(pc.def.range[1])) - 3 : pc.ext >= pc.def.range[1] - 0.3;
        if (atEnd) { pc.latched = true; this._jointLimits(pc, false, true); }
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
        pc.ext = pos.clone().sub(pc.anchor).dot(pc.axisW);
      }
      const moved = Math.hypot(pos.x - pc.start.x, pos.z - pc.start.z);
      const relq = pc.q0.clone().invert().multiply(q);
      const rotated = 2 * Math.acos(Math.min(1, Math.abs(relq.w))) / DEG;
      // lowest point of the first shape (approximate: box corners)
      let bottom = Infinity;
      const sh = (pc.def.shape && pc.def.shape[0]) || { box: pc.def.box || [2, 2, 2], at: [0, 0, 0] };
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const c = new THREE.Vector3(sh.at[0] + sx * sh.box[0] / 2, sh.at[1] + sy * sh.box[1] / 2, sh.at[2] + sz * sh.box[2] / 2).applyQuaternion(q).add(pos);
        if (c.y < bottom) bottom = c.y;
      }
      pc.state = { angle: pc.angle, ext: pc.ext, height: pc.def.kind === 'lift' ? pc.height : pos.y - pc.start.y, pos: [pos.x, pos.y, pos.z], x: pos.x, y: pos.z, moved, rotated, bottom,
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
    const bodyDesc = fp
      ? R.ColliderDesc.roundCuboid(((fp.x1 - fp.x0) / 2 - 0.8) * S, 4.5 * S, ((fp.z1 - fp.z0) / 2 - 0.8) * S, 0.8 * S).setTranslation(((fp.x0 + fp.x1) / 2) * S, 5 * S, ((fp.z0 + fp.z1) / 2) * S)
      : R.ColliderDesc.cylinder(4.5 * S, geom.radius * S).setTranslation(0, 5 * S, 0);
    this.bodyCollider = this.world.createCollider(bodyDesc.setFriction(0.5).setCollisionGroups(SHARED).setActiveCollisionTypes(ACT), body);

    // Attachment: a tiny scene graph mirroring the 3D view. Parts that move with the motor ride on their own
    // kinematic body (so the solver sees real velocities when the arm lifts or sweeps something); parts fixed to
    // the mount stay on the robot body.
    if (this.armBody) { this.world.removeRigidBody(this.armBody); this.armBody = null; }
    this.robotParts = [];
    const a = geom.attachment;
    const root = new THREE.Object3D();
    const pivot = new THREE.Object3D();
    const moving = new THREE.Object3D();
    pivot.position.set(a.fwd + (a.module === 'basket' ? 10 : 0), a.height, a.lat);   // the basket pivots about its front lip
    pivot.rotation.y = -a.angle * DEG;
    pivot.add(moving);
    root.add(pivot);
    this.armRoot = root; this.armPivot = pivot; this.armMoving = moving;
    const hasMoving = ['arm', 'sweeper', 'basket', 'lift'].includes(a.module);
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
      const desc = R.ColliderDesc.cuboid((size[0] / 2) * S, (size[1] / 2) * S, (size[2] / 2) * S).setFriction(0.5).setCollisionGroups(SHARED).setActiveCollisionTypes(ACT);
      if (onArm) { desc.setTranslation(pos[0] * S, pos[1] * S, pos[2] * S); if (pitch) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, pitch * DEG)); desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); } }   // relative to the moving frame
      else { const w = new THREE.Vector3(); node.getWorldPosition(w); const q = new THREE.Quaternion(); node.getWorldQuaternion(q); desc.setTranslation(w.x * S, w.y * S, w.z * S).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
      const collider = this.world.createCollider(desc, onArm ? armBody : body);
      this.robotParts.push({ collider, node, half: size.map((v) => v / 2), onArm: !!onArm });
    };
    if (a.module === 'arm' || a.module === 'sweeper') {
      part(moving, [13.6, 2.4, 2.6], [6.8, 0, 0]);      // beam + paddle (a little narrower than it looks, so it fits the loops)
      part(pivot, [4, 4, 3.6], [0, 0, 0]);              // motor block
      // the fork: two tines ahead of the paddle, pitched up 12 degrees so they run level when the arm is lowered 12 degrees
      // (a hair narrower than the beams, so they clear the cube's posts)
      if (a.module === 'arm') for (const z of [-0.45, 0.45]) part(moving, [5.6, 0.7, 0.7], [12.4 + 2.8 * Math.cos(12 * DEG), -1.2 + 2.8 * Math.sin(12 * DEG), z], 12);
    } else if (a.module === 'basket') {
      part(moving, [10, 0.8, 12], [-5, -0.4, 0]);       // floor
      part(moving, [0.8, 4, 12], [-9.6, 2, 0]);         // back
      part(moving, [10, 4, 0.8], [-5, 2, -5.6]);        // sides
      part(moving, [10, 4, 0.8], [-5, 2, 5.6]);
      part(moving, [0.8, 1.6, 12], [0, 0.8, 0]);        // front lip
      part(pivot, [4, 4, 3.6], [-10, 0, 0]);            // motor block at the mount
    } else if (a.module === 'lift') {
      part(pivot, [1.6, 16, 6], [1, 3, 0]);             // mast
      part(moving, [8, 0.8, 7], [5, 0, 0]);             // fork
    } else if (a.module === 'plow') {
      part(pivot, [1.2, 5, 14], [4, -2.5, 0]);          // blade
      part(pivot, [4, 1.6, 1.6], [2, 0, 0]);            // strut
    }
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
    if (this.module === 'arm') mv.rotation.set(0, 0, angle * DEG);
    else if (this.module === 'basket') mv.rotation.set(0, 0, -Math.max(0, angle) * DEG);
    else if (this.module === 'sweeper') mv.rotation.set(0, angle * DEG, 0);
    else if (this.module === 'lift') mv.position.y = Math.max(1.5, Math.min(16, 1.5 + (angle / 360) * 6)) - this.armPivot.position.y;
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
      this.cc.computeColliderMovement(collider, move, R.QueryFilterFlags.EXCLUDE_DYNAMIC | R.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined, notRobot);
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
    // Several physics substeps per robot step: the arm can sweep a centimetre per step, and jointed pieces need
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
    const at = this.armBody.translation(), ar = this.armBody.rotation();
    const pt = pc.body.translation(), pr = pc.body.rotation();
    const qa = new THREE.Quaternion(ar.x, ar.y, ar.z, ar.w), qp = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const local = new THREE.Vector3(pt.x - at.x, pt.y - at.y, pt.z - at.z).applyQuaternion(qa.clone().invert());
    const rel = qa.clone().invert().multiply(qp);
    const data = R.JointData.fixed({ x: local.x, y: local.y, z: local.z }, { x: rel.x, y: rel.y, z: rel.z, w: rel.w }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    pc.carryJoint = this.world.createImpulseJoint(data, this.armBody, pc.body, true);
    pc.carryInfo = { arm: [at.x / S, at.y / S, at.z / S], seed: [pt.x / S, pt.y / S, pt.z / S], local: [local.x / S, local.y / S, local.z / S], angle: this.lastArmAngle, time: this.robot && this.robot.time };
    pc.body.setGravityScale(0, true);
    for (const c of pc.colliders) c.setCollisionGroups(0);
    pc.carried = true;
  }

  /** Let loose pieces settle while no program runs (gravity keeps working between runs). */
  idleStep(dt) {
    if (!this.robotBody) return;
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
