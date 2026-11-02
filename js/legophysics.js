// Physics for an attachment built in the attachment builder (see lego.js): parts locked to the drive axle ride on the
// attachment's kinematic body (motor E turns it), parts locked to the robot ride on the robot, and everything hung
// on pins becomes a dynamic body on a revolute joint. Pin friction is a holding torque: each joint is held at an
// angle by a stiff spring whose torque is capped at what the pins can hold, so a friction pin keeps a beam where it
// was put and a push or a heavy load makes it slip; a free pin barely drags.
import * as THREE from 'three';
import { legoReady, buildOf, DRIVE_AXLE, LDU } from './lego.js';

const S = 0.01;                    // cm -> m, as in physics.js
const DENSITY = 0.00045;           // kg per cm^3 of a part's box (a 15-long beam's box is 7.7 cm^3; the beam weighs 3.4 g)
const SLIP = 0.6 * Math.PI / 180;  // how far a held joint gives before it slips (rad)
const MOTOR_SIGN = 1;              // our joints take the axis as is, so Rapier's angle and ours agree (checked)

const toRobot = (v, lift) => [-v[2] * LDU, -v[1] * LDU + lift, -v[0] * LDU];
const P = new THREE.Matrix4().set(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
/** A box's rotation in the robot frame: its axes are the part's LDraw axes (R), seen from the robot (P R). */
function boxQuat(R) {
  const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(P, m));
}
const yawQuat = (h) => { const a = -h * Math.PI / 360; return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }; };

/** Take a previous build's dynamic bodies out of the world (their joints and colliders go with them). */
export function removeCustom(ph) {
  if (!ph.custom) return;
  for (const b of ph.custom.bodies) if (b && b.role === 'free') ph.world.removeRigidBody(b.body);   // the robot's and the arm's own bodies are not ours
  ph.custom = null;
}

/**
 * Colliders, bodies and joints for a custom attachment. `frame`: the attachment graph from rebuildRobot (pivot,
 * moving), the robot's collision groups and active collision types, and the group for hinged parts.
 */
export function buildCustom(ph, robot, frame) {
  removeCustom(ph);
  const { R } = ph;
  const D = legoReady();
  const a = robot.geom.attachment;
  const { pivot, moving, ACT, ROBOT, ATTACH } = frame;
  if (!ph.armBody) ph.armBody = ph.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(robot.x * S, 0, robot.y * S).setRotation(yawQuat(robot.heading)));
  const fixedBox = (parent, size, pos) => {     // the bracket on the hub, as for the other modules
    const node = new THREE.Object3D(); node.position.set(...pos); parent.add(node); node.updateMatrixWorld(true);
    const w = new THREE.Vector3(); node.getWorldPosition(w);
    const desc = R.ColliderDesc.cuboid(size[0] / 2 * S, size[1] / 2 * S, size[2] / 2 * S).setTranslation(w.x * S, w.y * S, w.z * S).setFriction(0.5).setCollisionGroups(ROBOT).setActiveCollisionTypes(ACT);
    ph.robotParts.push({ collider: ph.world.createCollider(desc, ph.robotBody), node, half: size.map((v) => v / 2), onArm: false });
  };
  fixedBox(pivot, [3.2, 3.9, 4.0], [-1.2, -1.6, 0]);
  if (!D || !a.ldr) return;
  const { an } = buildOf(D, a.ldr);
  const lift = robot.geom.lift;
  const pv = pivot.position.clone();
  const custom = { bodies: [], joints: [], colliders: [], onDrive: new Set() };
  ph.custom = custom;
  const boxesOf = (items) => items.flatMap((it) => (it.role === 'part' ? it.boxes : [])).map((b) => ({ c: new THREE.Vector3(...toRobot(b.c, lift)), h: b.h.map((v) => v * LDU), q: boxQuat(b.R) }));
  // parts on the robot and on the drive: kinematic, like the other modules' pieces (they also stall the motor)
  an.bodies.forEach((body, i) => {
    if (body.role === 'free') return;
    const onArm = body.role === 'drive';
    for (const b of boxesOf(body.items)) {
      const node = new THREE.Object3D();
      node.position.copy(b.c).sub(pv); node.quaternion.copy(b.q);
      (onArm ? moving : pivot).add(node); node.updateMatrixWorld(true);
      const at = onArm ? node.position : b.c;
      const desc = R.ColliderDesc.cuboid(Math.max(0.02, b.h[0]) * S, Math.max(0.02, b.h[1]) * S, Math.max(0.02, b.h[2]) * S)
        .setTranslation(at.x * S, at.y * S, at.z * S).setRotation({ x: b.q.x, y: b.q.y, z: b.q.z, w: b.q.w })
        .setFriction(0.6).setCollisionGroups(ROBOT).setActiveCollisionTypes(ACT);
      ph.robotParts.push({ collider: ph.world.createCollider(desc, onArm ? ph.armBody : ph.robotBody), node, half: b.h, onArm });
    }
    custom.bodies[i] = { role: body.role, body: onArm ? ph.armBody : ph.robotBody };
  });
  // parts hung on pins: dynamic bodies, created in the robot's frame (their local frame is the robot's at rest)
  an.bodies.forEach((body, i) => {
    if (body.role !== 'free') return;
    const rb = ph.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(robot.x * S, 0, robot.y * S).setRotation(yawQuat(robot.heading))
      .setLinearDamping(0.3).setAngularDamping(0.3).setCcdEnabled(true));
    let mass = 0;
    const com = new THREE.Vector3();
    for (const b of boxesOf(body.items)) {
      const vol = 8 * b.h[0] * b.h[1] * b.h[2];
      const m = Math.max(0.0002, vol * DENSITY);
      mass += m; com.addScaledVector(b.c, m);
      const desc = R.ColliderDesc.cuboid(Math.max(0.02, b.h[0]) * S, Math.max(0.02, b.h[1]) * S, Math.max(0.02, b.h[2]) * S)
        .setTranslation(b.c.x * S, b.c.y * S, b.c.z * S).setRotation({ x: b.q.x, y: b.q.y, z: b.q.z, w: b.q.w })
        .setFriction(0.6).setMass(m).setCollisionGroups(ATTACH);
      const col = ph.world.createCollider(desc, rb);
      custom.colliders.push(col);
    }
    custom.bodies[i] = { role: 'free', body: rb, mass, com: com.multiplyScalar(1 / Math.max(mass, 1e-9)) };
  });
  // which bodies ride on the drive (directly or through other hinged bodies), for teleports
  const drive = an.bodies.findIndex((b) => b.role === 'drive');
  if (drive >= 0) {
    custom.onDrive.add(drive);
    for (let grew = true; grew;) {
      grew = false;
      for (const j of an.joints) for (const [x, y] of [[j.a, j.b], [j.b, j.a]]) if (custom.onDrive.has(x) && !custom.onDrive.has(y) && an.bodies[y].role === 'free') { custom.onDrive.add(y); grew = true; }
    }
  }
  // the joints
  for (const j of an.joints) {
    const A = custom.bodies[j.a], B = custom.bodies[j.b];
    if (!A || !B || (A.role !== 'free' && B.role !== 'free')) continue;      // two kinematic bodies: nothing to join
    const at = new THREE.Vector3(...toRobot(j.at, lift));
    const axis = new THREE.Vector3(-j.axis[2], -j.axis[1], -j.axis[0]).normalize();
    const anchor = (X) => (X.body === ph.armBody ? at.clone().sub(pv) : at);
    const a1 = anchor(A), a2 = anchor(B);
    const data = R.JointData.revolute({ x: a1.x * S, y: a1.y * S, z: a1.z * S }, { x: a2.x * S, y: a2.y * S, z: a2.z * S }, { x: axis.x, y: axis.y, z: axis.z });
    const joint = ph.world.createImpulseJoint(data, A.body, B.body, true);
    joint.setContactsEnabled(false);
    joint.configureMotorModel(R.MotorModel.ForceBased);
    // how hard it holds: torque cap (N m) from the pins; the spring and its damping from the hung body's inertia
    const free = [A, B].filter((X) => X.role === 'free');
    const inertia = Math.min(...free.map((X) => { const r = X.com.distanceTo(at) * S; return X.mass * (r * r + 1e-4); }));
    const k = j.friction / SLIP;
    const d = 1.4 * Math.sqrt(k * inertia);
    joint.configureMotorPosition(0, k, d);
    custom.joints.push({ joint, a: A, b: B, axis: [axis.x, axis.y, axis.z], tmax: j.friction, k, d, hold: 0, angle: 0, frictionPins: j.frictionPins });
  }
}

/** Joint angle (rad) of b relative to a about the joint's axis (in a's frame), unwrapped against the last value. */
function jointAngle(j) {
  const qa = j.a.body.rotation(), qb = j.b.body.rotation();
  const A = new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w), B = new THREE.Quaternion(qb.x, qb.y, qb.z, qb.w);
  const rel = A.invert().multiply(B);
  const s = rel.x * j.axis[0] + rel.y * j.axis[1] + rel.z * j.axis[2];
  let th = 2 * Math.atan2(s, rel.w);
  th = j.angle + Math.atan2(Math.sin(th - j.angle), Math.cos(th - j.angle));
  return th;
}

/** Before each physics step: the pins' holding torque follows the joint, slipping once the load is more than it can hold. */
export function customStep(ph) {
  const c = ph.custom;
  if (!c) return;
  for (const j of c.joints) {
    const th = jointAngle(j);
    j.angle = th;
    const lim = j.tmax / j.k, err = j.hold - th;
    if (err > lim) j.hold = th + lim; else if (err < -lim) j.hold = th - lim;
    j.joint.configureMotorPosition(MOTOR_SIGN * j.hold, j.k, j.d);
  }
}

/** Teleport the hinged parts with the robot (a new pose or a reset): back to how they were built. */
export function placeCustom(ph, x, y, heading, armAngle = 0) {
  const c = ph.custom;
  if (!c) return;
  const yaw = new THREE.Quaternion(...Object.values(yawQuat(heading)));
  const pv = ph.armPivot ? ph.armPivot.position.clone() : new THREE.Vector3();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), armAngle * Math.PI / 180);
  c.bodies.forEach((b, i) => {
    if (!b || b.role !== 'free') return;
    let q = yaw.clone(), t = new THREE.Vector3(x, 0, y);
    if (c.onDrive.has(i) && armAngle) {
      // the body's frame turned about the pivot with the arm: origin goes to pivot - turn(pivot)
      const o = pv.clone().sub(pv.clone().applyQuaternion(turn));
      t.add(o.applyQuaternion(yaw));
      q = yaw.clone().multiply(turn);
    }
    b.body.setTranslation({ x: t.x * S, y: t.y * S, z: t.z * S }, true);
    b.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });
  for (const j of c.joints) { j.angle = 0; j.angle = jointAngle(j); j.hold = j.angle; }
}

/** After a snapshot is restored: look the bodies, colliders and joints up again by handle. */
export function restoreCustom(ph) {
  const c = ph.custom;
  if (!c) return;
  for (const b of c.bodies) if (b) b.body = b.role === 'base' ? ph.robotBody : b.role === 'drive' ? ph.armBody : ph.world.getRigidBody(b.body.handle);
  c.colliders = c.colliders.map((col) => ph.world.getCollider(col.handle));
  for (const j of c.joints) j.joint = ph.world.getImpulseJoint(j.joint.handle);
}

/** World pose (cm, quaternion) of each hinged body, for drawing: [{index, p, q}]. */
export function customPoses(ph) {
  const c = ph && ph.custom;
  if (!c) return null;
  const out = [];
  c.bodies.forEach((b, i) => {
    if (!b || b.role !== 'free') return;
    const t = b.body.translation(), r = b.body.rotation();
    out.push({ index: i, p: [t.x / S, t.y / S, t.z / S], q: [r.x, r.y, r.z, r.w] });
  });
  return out;
}
