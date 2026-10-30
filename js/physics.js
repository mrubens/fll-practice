// Collision layer on top of Rapier (loaded from the CDN; the sim falls back to the old circle/box code without it).
// The robot stays kinematic (programs move it exactly as before); Rapier only decides what it may not pass through:
// walls, mission models and the attachment, with the character controller doing collide-and-slide. Movable practice
// boxes are dynamic bodies that get shoved. Frames: sim x east / y south / heading clockwise  <->  Rapier x east / z south / y up.
import * as THREE from 'three';

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

const yawQuat = (headingDeg) => { const a = -headingDeg * DEG / 2; return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) }; };
const yawOf = (q) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) / DEG;   // degrees, counter-clockwise from above

export class Physics {
  constructor(R, world) {
    this.R = R;
    this.sim = world;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this.obstacleBodies = [];
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
    const add = (x, z, hx, hz) => this.world.createCollider(R.ColliderDesc.cuboid(hx * S, (h / 2) * S, hz * S).setTranslation(x * S, (h / 2) * S, z * S), body);
    add(0, -hh - w / 2, hw + w, w / 2);
    add(0, hh + w / 2, hw + w, w / 2);
    add(-hw - w / 2, 0, w / 2, hh + w);
    add(hw + w / 2, 0, w / 2, hh + w);
    this.wallsBody = body;
  }

  // ---------------- obstacles ----------------

  rebuildObstacles() {
    const { R } = this;
    for (const ob of this.obstacleBodies) this.world.removeRigidBody(ob.body);
    this.obstacleBodies = [];
    for (const o of this.sim.obstacles) {
      const desc = o.movable
        ? R.RigidBodyDesc.dynamic().enabledTranslations(true, false, true).enabledRotations(false, true, false).setLinearDamping(6).setAngularDamping(6)
        : R.RigidBodyDesc.fixed();
      desc.setTranslation(o.x * S, (o.h / 2) * S, o.y * S);
      const body = this.world.createRigidBody(desc);
      const col = this.world.createCollider(R.ColliderDesc.cuboid((o.w / 2) * S, (o.h / 2) * S, (o.d / 2) * S).setFriction(0.7).setMass(0.4), body);
      this.obstacleBodies.push({ o, body, collider: col });
      o.angle = 0;
    }
    this.colliderToObstacle = new Map(this.obstacleBodies.map((ob) => [ob.collider.handle, ob.o]));
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
    this.bodyCollider = this.world.createCollider(R.ColliderDesc.cylinder(4.5 * S, geom.radius * S).setTranslation(0, 5 * S, 0).setFriction(0.5), body);

    // Attachment: a tiny scene graph mirroring the 3D view, so collider poses follow the motor the same way the meshes do.
    this.robotParts = [];
    const a = geom.attachment;
    const root = new THREE.Object3D();
    const pivot = new THREE.Object3D();
    const moving = new THREE.Object3D();
    pivot.position.set(a.fwd, a.height, a.lat);
    pivot.rotation.y = -a.angle * DEG;
    pivot.add(moving);
    root.add(pivot);
    this.armPivot = pivot; this.armMoving = moving;
    const part = (parent, size, pos) => {
      const node = new THREE.Object3D();
      node.position.set(...pos);
      parent.add(node);
      const collider = this.world.createCollider(R.ColliderDesc.cuboid((size[0] / 2) * S, (size[1] / 2) * S, (size[2] / 2) * S).setFriction(0.5), body);
      this.robotParts.push({ collider, node, half: size.map((s) => s / 2) });
    };
    if (a.module === 'arm' || a.module === 'sweeper') {
      part(moving, [13.6, 4, 4], [6.8, 0, 0]);          // beam + paddle
      part(pivot, [4, 4, 3.6], [0, 0, 0]);              // motor block
    } else if (a.module === 'lift') {
      part(pivot, [1.6, 16, 6], [1, 3, 0]);             // mast
      part(moving, [8, 0.8, 7], [5, 0, 0]);             // fork
    } else if (a.module === 'plow') {
      part(pivot, [1.2, 5, 14], [4, -2.5, 0]);          // blade
      part(pivot, [4, 1.6, 1.6], [2, 0, 0]);            // strut
    }
    this.module = a.module;
    this.syncAttachment(this.attachmentAngle(robot));
  }

  attachmentAngle(robot) {
    const port = robot.config.attachment;
    return port && robot.motors[port] ? robot.motors[port].angle : 0;
  }

  /** Place the attachment colliders for a motor angle (degrees). */
  syncAttachment(angle) {
    if (!this.robotParts.length) return;
    const mv = this.armMoving;
    if (this.module === 'arm') mv.rotation.set(0, 0, angle * DEG);
    else if (this.module === 'sweeper') mv.rotation.set(0, angle * DEG, 0);
    else if (this.module === 'lift') mv.position.y = Math.max(1.5, Math.min(16, 1.5 + (angle / 360) * 6)) - this.armPivot.position.y;
    this.armPivot.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const part of this.robotParts) {
      part.node.matrixWorld.decompose(p, q, s);
      part.local = { p: { x: p.x * S, y: p.y * S, z: p.z * S }, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
      part.collider.setTranslationWrtParent(part.local.p);
      part.collider.setRotationWrtParent(part.local.q);
    }
  }

  setRobotPose(x, y, heading) {
    if (!this.robotBody) return;
    this.robotBody.setTranslation({ x: x * S, y: 0, z: y * S }, true);
    this.robotBody.setRotation(yawQuat(heading), true);
  }

  _notRobot() { const h = this.robotBody.handle; return (c) => { const p = c.parent(); return !p || p.handle !== h; }; }

  /** Would the attachment pieces (shrunk a little) overlap anything at this robot pose? */
  _partsHit(trans, rot, margin = STALL_MARGIN) {
    const { R } = this;
    const tq = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    let hit = false;
    for (const part of this.robotParts) {
      const lp = new THREE.Vector3(part.local.p.x, part.local.p.y, part.local.p.z).applyQuaternion(tq);
      const pos = { x: trans.x + lp.x, y: trans.y + lp.y, z: trans.z + lp.z };
      const wq = tq.clone().multiply(new THREE.Quaternion(part.local.q.x, part.local.q.y, part.local.q.z, part.local.q.w));
      const h = part.half.map((v) => Math.max(0.1, v - margin) * S);
      const shape = new R.Cuboid(h[0], h[1], h[2]);
      this.world.intersectionsWithShape(pos, { x: wq.x, y: wq.y, z: wq.z, w: wq.w }, shape, () => { hit = true; return false; }, undefined, undefined, undefined, this.robotBody);
      if (hit) break;
    }
    return hit;
  }

  /** True when moving the attachment motor to `angle` would push the attachment into a wall or model. */
  attachmentBlocked(angle) {
    if (!this.robotBody || !this.robotParts.length) return false;
    const prev = this.attachmentAngle(this.robot);
    this.syncAttachment(angle);
    const hit = this._partsHit(this.robotBody.translation(), this.robotBody.rotation());
    this.syncAttachment(prev);
    return hit;
  }

  /**
   * Move the robot from its current pose towards (nx, ny, nh): spins that sweep the attachment into something are
   * refused, translations are collide-and-slid against walls and models (pushing movable boxes). Returns the pose reached.
   */
  moveRobot(robot, nx, ny, nh, dt) {
    const { R } = this;
    const body = this.robotBody;
    this.syncAttachment(this.attachmentAngle(robot));
    const cur = body.translation();
    let heading = nh;
    if (nh !== robot.heading && this.robotParts.length && this._partsHit(cur, yawQuat(nh))) heading = robot.heading;
    const q = yawQuat(heading);
    body.setRotation(q, true);                        // queries below see the new heading
    let move = { x: (nx - robot.x) * S, y: 0, z: (ny - robot.y) * S };
    const notRobot = this._notRobot();
    const touched = new Set();
    const pass = (collider) => {
      this.cc.computeColliderMovement(collider, move, undefined, undefined, notRobot);
      const m = this.cc.computedMovement();
      move = { x: m.x, y: 0, z: m.z };
      for (let i = 0; i < this.cc.numComputedCollisions(); i++) {
        const c = this.cc.computedCollision(i);
        const o = c && c.collider ? this.colliderToObstacle.get(c.collider.handle) : null;
        if (o) touched.add(o);
      }
    };
    pass(this.bodyCollider);
    for (const part of this.robotParts) pass(part.collider);
    if (this.robotParts.length) pass(this.bodyCollider);
    body.setNextKinematicTranslation({ x: cur.x + move.x, y: 0, z: cur.z + move.z });
    body.setNextKinematicRotation(q);
    this.world.timestep = dt;
    this.world.step();
    for (const o of touched) o.touched = robot.time;
    this.syncObstacles();
    const t = body.translation();
    return [t.x / S, t.z / S, heading];
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
