// Referee: reads the physical state of the mission models every step and keeps the scoresheet the way the
// Robot Game Rulebook does. Mission points are "what you would get if the match ended now"; a launched match
// adds the equipment-inspection bonus and the precision tokens, and freezes everything when 2:30 is up.
import { MISSIONS } from './missions.js';
import { FIELD, inLaunchArea, inHome } from './mechanisms.js';

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
    for (const m of MISSIONS) for (const t of m.tasks) this.state[m.id + '.' + t.id] = { met: false, everMet: false, count: 0 };
    this.flags = {};
    this.missionPoints = {};
    this.match = { launched: false, ended: false, tokens: FIELD.tokens.start, inspection: 0, interruptions: 0, final: null };
    this.score = 0;
    this.emit({ type: 'reset' });
  }

  // ---------------- match rules ----------------

  /** A launch from a launch area. The first launch of a match also runs the equipment inspection. */
  launch() {
    const r = this.robot;
    const area = inLaunchArea(r.x, r.y, r.geom.radius);
    if (!this.match.launched) {
      this.match.launched = true;
      this.match.inspection = area ? FIELD.inspectionBonus : 0;
    }
    this.recompute();
    return { area, inspection: this.match.inspection };
  }

  /** Technicians touched the robot while it was running: outside home that costs a precision token. */
  interrupt() {
    if (!this.match.launched || this.match.ended) return null;
    const r = this.robot;
    const outside = !inHome(r.x, r.y);
    if (outside && this.match.tokens > 0) { this.match.tokens--; this.match.interruptions++; this.recompute(); this.emit({ type: 'token', tokens: this.match.tokens }); }
    return outside;
  }

  /** 2:30 is up: freeze the sheet, applying the no-equipment constraint. */
  endMatch() {
    if (!this.match.launched || this.match.ended) return;
    this.match.ended = true;
    this.recompute(true);
    this.match.final = { score: this.score, sheet: this.sheet() };
    this.emit({ type: 'end', score: this.score });
  }

  // ---------------- evaluation ----------------

  ctx() {
    const ph = this.world.physics;
    const self = this;
    const frames = new Map();
    return {
      p: (id) => (ph ? ph.pieceState(id) : {}),
      eq: (id) => { if (!ph) return null; const pc = ph.pieces.find((q) => q.equipment && q.name === id); return pc ? pc.state : null; },
      obstacle: (id) => this.world.obstacles.find((o) => o.id === id) || null,
      local: (id, pos) => {
        if (!frames.has(id)) { const o = this.world.obstacles.find((x) => x.id === id); frames.set(id, o && ph ? ph.modelFrame(o) : null); }
        const f = frames.get(id);
        if (!f) return [0, 0, 0];
        const v = { x: pos[0] - f.p.x, y: pos[1] - f.p.y, z: pos[2] - f.p.z };
        // inverse rotation about y
        const a = -2 * Math.atan2(f.q.y, f.q.w);
        const c = Math.cos(a), s = Math.sin(a);
        return [v.x * c + v.z * s, v.y, -v.x * s + v.z * c];
      },
      touching: (id) => { const o = this.world.obstacles.find((x) => x.id === id); return !!(o && o.touched !== undefined && self.robot.time - o.touched < 0.3); },
      flag: (k) => !!self.flags[k],
      setFlag: (k) => { self.flags[k] = true; },
    };
  }

  /** Called every simulation sub-step while a program runs (and once after resets). */
  update(dt) {
    if (this.match.ended) return;
    if (!this.world.physics) return;
    const c = this.ctx();
    let changed = false;
    for (const m of MISSIONS) {
      try { if (m.watch) m.watch(c); } catch { /* model not loaded yet */ }
      for (const t of m.tasks) {
        const s = this.state[m.id + '.' + t.id];
        let met = false, count = 0;
        try {
          if (t.count) { count = t.count(c); met = count > 0; } else met = !!t.met(c);
        } catch { met = false; }
        if (met !== s.met || count !== s.count) changed = true;
        if (met && !s.everMet) { s.everMet = true; this.emit({ type: 'done', mission: m, task: t, obstacle: this.world.obstacles.find((o) => m.models.includes(o.id)) }); }
        s.met = met; s.count = count;
      }
    }
    if (changed) this.recompute();
  }

  recompute(final = false) {
    const c = this.ctx();
    let total = 0;
    for (const m of MISSIONS) {
      let pts = 0;
      let zero = false;
      try { zero = !!(m.zeroIf && m.zeroIf(c)); } catch { zero = false; }
      if (final && m.noEquipment && m.models.some((id) => c.touching(id))) zero = true;
      if (!zero) {
        for (const t of m.tasks) {
          const s = this.state[m.id + '.' + t.id];
          if (t.bonusOf && !this.isDone(m.id, t.bonusOf)) continue;
          if (t.count) pts += s.count * t.each;
          else if (s.met) pts += t.points;
        }
      }
      this.missionPoints[m.id] = { points: pts, zero };
      total += pts;
    }
    this.missions = total;
    this.score = total + (this.match.launched ? this.match.inspection + FIELD.tokens.points[this.match.tokens] : 0);
    this.emit({ type: 'score', score: this.score });
  }

  isDone(missionId, taskId) { const s = this.state[missionId + '.' + taskId]; return !!(s && s.met); }

  /** Where a mission is on the table (its first model), for the practice ring and the result text. */
  zoneOf(mission) {
    const o = this.world.obstacles.find((x) => mission.models.includes(x.id));
    return o ? { x: o.x, y: o.y, r: Math.max(o.w, o.d) / 2 + 6, obstacle: o } : null;
  }

  /** Scoresheet rows. */
  sheet() {
    return MISSIONS.map((m) => ({
      mission: m,
      tasks: m.tasks.map((t) => { const s = this.state[m.id + '.' + t.id]; return { task: t, done: s.met && (!t.bonusOf || this.isDone(m.id, t.bonusOf)), count: s.count }; }),
      points: (this.missionPoints[m.id] || { points: 0 }).points,
      zero: (this.missionPoints[m.id] || { zero: false }).zero,
      max: m.tasks.reduce((s, t) => s + t.points, 0),
    }));
  }

  /** Match extras for the score chip. */
  extras() {
    const m = this.match;
    return { launched: m.launched, ended: m.ended, tokens: m.tokens, tokenPoints: FIELD.tokens.points[m.tokens], inspection: m.inspection, missions: this.missions || 0 };
  }
}

/** Result of a practice run: how far the robot's front ended from the mission's model. */
export function practiceResult(scoring, mission) {
  const z = scoring.zoneOf(mission);
  if (!z) return null;
  const r = scoring.robot;
  const front = r._point(r.geom.radius, 0);
  const dist = Math.hypot(front[0] - z.x, front[1] - z.y);
  const bearing = Math.atan2(z.y - front[1], z.x - front[0]) / DEG;
  let off = ((bearing - r.heading + 540) % 360) - 180;
  const row = scoring.sheet().find((s) => s.mission.id === mission.id);
  const done = row.tasks.filter((t) => t.done).length;
  return { dist, off, done, total: mission.tasks.length, points: row.points };
}
