// Drawing an attachment built in the attachment builder on the robot in the 3D view: parts locked to the robot ride
// with its body, parts on the drive axle turn with motor E (the attachment's moving frame), and parts hung on pins
// follow their physics bodies.
import * as THREE from 'three';
import { loadLego, buildOf } from './lego.js';
import { ldToRobot, loadRaw, flatten, partTemplates, partMesh } from './lego3d.js';
import { customPoses } from './legophysics.js';

/**
 * Add the parts built in the robot builder to the robot being built by `sim` (called from its robot rebuild):
 * attachment.ldr has them all (the sensors and a custom attachment); attachment.bracket draws the arm bracket a
 * custom attachment mounts on.
 */
export function drawCustom(sim, body, attachment) {
  const gen = sim.robotBuildGen;
  if (sim.robotLego) sim.robotPending++;
  const done = () => { if (gen === sim.robotBuildGen && sim.revealRobot) sim.revealRobot(); };
  sim.customBodies = [];
  sim.customGeared = [];
  const ldr = attachment.ldr || '';
  const LD_TO_ROBOT = ldToRobot(sim.robot.geom.axleFwd);
  sim.ldToRobot = LD_TO_ROBOT;
  loadLego().then(async (D) => {
    const [tpl, bracket] = await Promise.all([partTemplates(D), loadRaw('models/attach/arm-fixed.mpd')]);
    if (gen !== sim.robotBuildGen || !sim.armPivot || !sim.armPivot.parent) { done(); return; }
    if (bracket && attachment.bracket) {   // the arm bracket on the hub, with the drive axle running through it
      const b = flatten(bracket); b.matrixAutoUpdate = false; b.matrix.copy(LD_TO_ROBOT); body.add(b);
    }
    const { an } = buildOf(D, ldr, sim.robot.build.chassis);
    const pivot = sim.armPivot.position;
    const toMoving = new THREE.Matrix4().makeTranslation(-pivot.x, -(pivot.y), -pivot.z).multiply(LD_TO_ROBOT);
    an.bodies.forEach((b, i) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      for (const it of b.items) {
        if (it.role === 'base' || !tpl.get(it.q.f)) continue;
        group.add(partMesh(tpl.get(it.q.f), it.q, D.parts.parts[it.q.f].c));
      }
      if (b.role === 'geared' || (b.role === 'drive' && sim.robot.build.chassis !== 'driving-base')) {
        // turned through gears by a motor: about its gear's axle, drawn each frame from the motor's angle
        group.matrix.copy(LD_TO_ROBOT); body.add(group);
        const w = new THREE.Vector3(-b.w[2], -b.w[1], -b.w[0]);
        const at = new THREE.Vector3(-b.at[2] * 0.04 + sim.robot.geom.axleFwd, -b.at[1] * 0.04 + sim.robot.geom.lift, -b.at[0] * 0.04);
        sim.customGeared.push({ group, port: b.port, rate: w.length(), axis: w.normalize(), at });
      } else if (b.role === 'drive') { group.matrix.copy(toMoving); sim.armMoving.add(group); }
      else if (b.role === 'base') { group.matrix.copy(LD_TO_ROBOT); body.add(group); }
      else {
        // hung on pins: drawn in the robot's frame until the physics says where its body is
        group.matrix.copy(LD_TO_ROBOT); body.add(group);
        sim.customBodies.push({ index: i, group, body });
      }
    });
    done();
  }).catch(() => done());
}

const tmpM = new THREE.Matrix4(), tmpInv = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
/** Each frame: put the hinged parts where the physics has their bodies. */
export function poseCustom(sim) {
  for (const g of sim.customGeared || []) {
    const m = sim.robot.motors[g.port], deg = m ? m.angle : 0;
    tmpQ.setFromAxisAngle(g.axis, deg * g.rate * Math.PI / 180);
    tmpM.makeRotationFromQuaternion(tmpQ);
    const t = g.at.clone().sub(g.at.clone().applyQuaternion(tmpQ));
    tmpM.setPosition(t);
    g.group.matrix.multiplyMatrices(tmpM, sim.ldToRobot);
    g.group.matrixWorldNeedsUpdate = true;
  }
  if (!sim.customBodies || !sim.customBodies.length) return;
  const ph = sim.world && sim.world.physics;
  const poses = customPoses(ph);
  if (!poses) return;
  for (const cb of sim.customBodies) {
    const pose = poses.find((p) => p.index === cb.index);
    if (!pose) continue;
    cb.body.updateMatrixWorld(true);
    tmpInv.copy(cb.body.matrixWorld).invert();
    tmpM.compose(tmpP.set(...pose.p), tmpQ.set(...pose.q), ONE);
    cb.group.matrix.multiplyMatrices(tmpInv, tmpM).multiply(sim.ldToRobot);
  }
}
