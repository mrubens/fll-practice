// Scripted mission interactions: watches the robot every step, completes mission actions when their
// trigger is met, keeps the scoresheet, and tells the 3D view what to animate.
import { MISSIONS } from './missions.js';

const DEG = Math.PI / 180;

export class Scoring {
  constructor(robot, world) {
    this.robot = robot;
    this.world = world;
    this.listeners = [];
    this.reset();
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { this.listeners.forEach((fn) => fn(ev)); }

  reset() {
    this.state = {};
    for (const m of MISSIONS) for (const a of m.actions) {
      this.state[m.id + '.' + a.id] = { done: a.trigger.kind === 'avoid', lost: false, travel: 0, dwell: 0, armWasDown: false };
    }
    this.score = this.computeScore();
    this.emit({ type: 'reset' });
  }

  computeScore() {
    let total = 0;
    for (const m of MISSIONS) for (const a of m.actions) {
      const s = this.state[m.id + '.' + a.id];
      if (s.done && !s.lost) total += a.points;
    }
    return total;
  }

  /** Zone center for an action (table cm). */
  zoneOf(action) {
    const t = action.trigger;
    if (!t.at) return null;
    const o = this.world.obstacles.find((x) => x.id === t.at);
    if (!o) return null;
    return { x: o.x + (t.dx || 0), y: o.y + (t.dy || 0), r: t.r || 12, obstacle: o };
  }

  isDone(missionId, actionId) { const s = this.state[missionId + '.' + actionId]; return !!(s && s.done && !s.lost); }

  /** Called every simulation sub-step while a program runs. */
  update(dt) {
    const r = this.robot;
    const front = r._point(r.geom.radius, 0);
    const arm = r.arm();
    const hasArm = !!arm && arm.module !== 'plow';
    const tip = arm ? [arm.tx, arm.ty] : front;
    const armDown = arm ? arm.down : false;
    const speed = r.forwardSpeed();
    let changed = false;

    for (const m of MISSIONS) for (const a of m.actions) {
      const key = m.id + '.' + a.id;
      const s = this.state[key];
      const t = a.trigger;
      if (t.after && !this.isDone(m.id, t.after)) continue;
      if (a.bonusOf && !this.isDone(m.id, a.bonusOf)) continue;
      if (t.kind === 'auto') { if (!s.done) { s.done = true; changed = true; this.complete(m, a); } continue; }
      const z = this.zoneOf(a);
      if (!z) continue;
      const inZone = (p) => Math.hypot(p[0] - z.x, p[1] - z.y) <= z.r;

      if (t.kind === 'avoid') {
        if (s.done && !s.lost && (inZone(front) || (arm && inZone(tip) && armDown))) { s.lost = true; changed = true; this.emit({ type: 'lost', mission: m, action: a, zone: z }); }
        continue;
      }
      if (s.done) continue;
      let kind = t.kind;
      let travel = t.travel || 4;
      if (!hasArm && (kind === 'arm' || kind === 'lift')) { kind = 'push'; travel = Math.max(travel, 8); }   // no attachment: the robot body does the job, with a firmer push
      if (kind === 'push') {
        const p = hasArm ? tip : front;
        if (inZone(p) && speed > 2) s.travel += speed * dt;
        if (s.travel >= travel) { s.done = true; changed = true; this.complete(m, a, z); }
      } else if (kind === 'arm') {
        if (inZone(tip) && armDown) { s.done = true; changed = true; this.complete(m, a, z); }
      } else if (kind === 'lift') {
        if (inZone(tip) && armDown) s.armWasDown = true;
        if (s.armWasDown && inZone(tip) && !armDown) { s.done = true; changed = true; this.complete(m, a, z); }
        if (!inZone(tip)) s.armWasDown = false;
      } else if (kind === 'visit') {
        s.dwell = inZone(front) && speed < 1 ? s.dwell + dt : 0;
        if (s.dwell >= 0.5) { s.done = true; changed = true; this.complete(m, a, z); }
      }
    }
    if (changed) { this.score = this.computeScore(); this.emit({ type: 'score', score: this.score }); }
  }

  complete(mission, action, zone) {
    this.emit({ type: 'done', mission, action, zone, obstacle: zone && zone.obstacle });
  }

  /** Scoresheet rows. */
  sheet() {
    return MISSIONS.map((m) => ({
      mission: m,
      actions: m.actions.map((a) => ({ action: a, done: this.isDone(m.id, a.id), lost: this.state[m.id + '.' + a.id].lost })),
      points: m.actions.reduce((s, a) => s + (this.isDone(m.id, a.id) ? a.points : 0), 0),
      max: m.actions.reduce((s, a) => s + a.points, 0),
    }));
  }
}

/** Result of a practice run: how far the robot's front ended from the mission's first zone. */
export function practiceResult(scoring, mission) {
  const first = mission.actions[0];
  const z = scoring.zoneOf(first);
  if (!z) return null;
  const r = scoring.robot;
  const front = r._point(r.geom.radius, 0);
  const dist = Math.hypot(front[0] - z.x, front[1] - z.y);
  const bearing = Math.atan2(z.y - front[1], z.x - front[0]) / DEG;
  let off = ((bearing - r.heading + 540) % 360) - 180;
  const done = mission.actions.filter((a) => scoring.isDone(mission.id, a.id)).length;
  return { dist, off, done, total: mission.actions.length, points: scoring.sheet().find((s) => s.mission.id === mission.id).points };
}
