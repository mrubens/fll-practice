// Referee: reads the physical state of the mission models every step and keeps the scoresheet the way the
// Robot Game Rulebook does. Mission points are "what you would get if the match ended now"; a launched match
// adds the equipment-inspection bonus and the precision tokens, and freezes everything when 2:30 is up.
import { MISSIONS } from './missions.js';
import { FIELD, inLaunchArea, inHome, outlineInLaunchArea, outlineInHome } from './mechanisms.js';

const DEG = Math.PI / 180;

/** A mission's most points: one of each set of alternatives (M05's partly OR completely extended root), all the rest. */
export function maxPoints(m) {
  let total = 0;
  for (const t of m.tasks) {
    if (t.or) continue;
    const alts = m.tasks.filter((x) => x.or === t.id);
    total += Math.max(t.points, ...alts.map((x) => x.points));
  }
  return total;
}

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
    this.primed = false;     // the first evaluation after a reset is the baseline: no "done" fanfare for what is met at the start
    this.emit({ type: 'reset' });
  }

  // ---------------- match rules ----------------

  /** A launch from a launch area. The first launch of a match also runs the equipment inspection. */
  launch() {
    const { area, top } = this.fit();
    if (!this.match.launched) {
      this.match.launched = true;
      this.match.inspection = area && top <= FIELD.heightLimit ? FIELD.inspectionBonus : 0;
    }
    this.recompute();
    return { area, top, inspection: this.match.inspection };
  }

  /** Technicians touched the robot while it was running: outside home that costs a precision token. */
  /** The robot as built (attachment and tools too): the launch area it fits completely in, how tall it is, whether all of it is in home. */
  fit() {
    const r = this.robot, ol = this.world.physics && this.world.physics.robotOutline();
    if (!ol) return { area: inLaunchArea(r.x, r.y, r.geom.radius), top: 0, home: inHome(r.x, r.y) };
    return { area: outlineInLaunchArea(ol.pts), top: ol.top, home: outlineInHome(ol.pts) };
  }

  interrupt() {
    if (!this.match.launched || this.match.ended) return null;
    // the robot (or anything it carries) even partly outside home costs a token
    const outside = !this.fit().home;
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
      // the robot or the team's equipment touching the model right now (the no-equipment constraint)
      touchingNow: (id) => !!(ph && ph.equipmentTouching(id)),
      flag: (k) => !!self.flags[k],
      setFlag: (k) => { self.flags[k] = true; },
    };
  }

  /** Called every simulation sub-step while a program runs (and once after resets). */
  /** A mission whose models have all been taken off the table is not in play. */
  inPlay(m) { const h = this.world.hiddenIds; return !h || !m.models.every((id) => h.has(id)); }

  update(dt) {
    if (this.match.ended) return;
    if (!this.world.physics) return;
    const c = this.ctx();
    let changed = false;
    for (const m of MISSIONS) {
      if (!this.inPlay(m)) continue;
      try { if (m.watch) m.watch(c); } catch { /* model not loaded yet */ }
      // a mission-wide zero can come and go while no task changes (the katydid leaves the habitat)
      if (m.zeroIf) { let z = false; try { z = !!m.zeroIf(c); } catch { z = false; } if (z !== !!(this.missionPoints[m.id] && this.missionPoints[m.id].zero)) changed = true; }
      for (const t of m.tasks) {
        const s = this.state[m.id + '.' + t.id];
        let met = false, count = 0;
        try {
          if (t.count) { count = t.count(c); met = count > 0; } else met = !!t.met(c);
        } catch { met = false; }
        if (met !== s.met || count !== s.count) changed = true;
        if (met && !s.everMet) {
          s.everMet = true;
          if (this.primed && (!t.bonusOf || this.isDone(m.id, t.bonusOf))) this.emit({ type: 'done', mission: m, task: t, obstacle: this.world.obstacles.find((o) => m.models.includes(o.id)) });
        } else if (!met && s.met && this.primed && !t.count) {
          this.emit({ type: 'lost', mission: m, task: t });
        }
        s.met = met; s.count = count;
      }
    }
    this.primed = true;
    if (changed) this.recompute();
  }

  recompute(final = false) {
    const c = this.ctx();
    let total = 0;
    for (const m of MISSIONS) {
      if (!this.inPlay(m)) { this.missionPoints[m.id] = { points: 0, zero: false }; continue; }
      let pts = 0;
      let zero = false;
      try { zero = !!(m.zeroIf && m.zeroIf(c)); } catch { zero = false; }
      // the no-equipment constraint, judged model by model when the match ends: a task tied to one model (M10's two
      // habitats) is lost only if that model is touched; the others if any of the mission's models is
      let touched = null;
      if (final && m.noEquipment) touched = new Set(m.models.filter((id) => c.touchingNow(id)));
      const lost = (t) => !!touched && (t.model ? touched.has(t.model) : touched.size > 0);
      if (touched && m.tasks.every(lost)) zero = true;
      if (!zero) {
        for (const t of m.tasks) {
          const s = this.state[m.id + '.' + t.id];
          if (lost(t)) continue;
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

  /** Models whose "leave it as it was" task (guard) is lost right now: M10's habitats knocked out of place. */
  lostGuards() {
    const out = new Set();
    this._guardCtx = null;
    for (const m of MISSIONS) {
      if (!this.inPlay(m)) continue;
      for (const t of m.tasks) {
        if (!t.guard || !t.model) continue;
        // judged live from the model itself, and only once its pieces exist (not while the field is still loading)
        const c = this._guardCtx || (this._guardCtx = this.ctx());
        const pieces = c.p(t.model);
        if (!pieces || !Object.keys(pieces).length) continue;
        let ok = true;
        try { ok = !!t.met(c); } catch { ok = true; }
        if (!ok) out.add(t.model);
      }
    }
    return out;
  }

  isDone(missionId, taskId) { const s = this.state[missionId + '.' + taskId]; return !!(s && s.met); }

  /** Scoresheet rows. */
  sheet() {
    return MISSIONS.filter((m) => this.inPlay(m)).map((m) => ({
      mission: m,
      tasks: m.tasks.map((t) => { const s = this.state[m.id + '.' + t.id]; return { task: t, done: s.met && (!t.bonusOf || this.isDone(m.id, t.bonusOf)), count: s.count }; }),
      points: (this.missionPoints[m.id] || { points: 0 }).points,
      zero: (this.missionPoints[m.id] || { zero: false }).zero,
      max: maxPoints(m),
    }));
  }

  /** Match extras for the score chip. */
  extras() {
    const m = this.match;
    return { launched: m.launched, ended: m.ended, tokens: m.tokens, tokenPoints: FIELD.tokens.points[m.tokens], inspection: m.inspection, missions: this.missions || 0 };
  }
}

