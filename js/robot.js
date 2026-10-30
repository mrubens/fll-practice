// Robot + hub model: motors, differential-drive kinematics, sensors, timer, gyro, LED matrix, sound state.
// Pure simulation state; no DOM or three.js here.
import { START_POSE } from './world.js';
import { COLOR_BY_CODE } from './spec.js';
import { textColumns, charMatrix } from './matrixfont.js';
import { defaultBuild, normalizeBuild, geometryFor, portsOf } from './build.js';

export const MAX_DEG_PER_S = 900;        // motor speed at 100 %
const ACCEL = 3600;                       // deg/s^2 ramp
export const PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const DEG = Math.PI / 180;
const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

export class Robot {
  constructor(world) {
    this.world = world;
    this.listeners = {};
    this.applyBuild(defaultBuild());
    this.reset();
    this.resetPose();
  }

  /** Apply a robot build (see build.js): ports and geometry derive from it. */
  applyBuild(build) {
    this.build = normalizeBuild(build);
    this.geom = geometryFor(this.build);
    this.config = portsOf(this.build);
    if (this.movement) this.movement.cmPerRotation = this.geom.calibration;
    this.emit('build');
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); }
  emit(event, data) { (this.listeners[event] || []).forEach((fn) => fn(data)); }

  /** Program state (motors, hub, goals). Called when a program starts and when the robot is reset. */
  reset() {
    this.time = 0;
    this.motors = {};
    for (const p of PORT_LETTERS) this.motors[p] = { velocity: 0, target: 0, angle: 0, speedPct: 75, goal: null };
    this.movement = { pair: null, speedPct: 50, cmPerRotation: this.geom ? this.geom.calibration : 17.5, goal: null, hint: null };
    this.hub = {
      yawOffset: 0, timerStart: 0,
      matrix: new Array(25).fill(0), centerColor: null,
      buttons: { left: false, right: false }, buttonEvents: [],
      textGoal: null, imageGoal: null,
      sound: { note: null, goal: null, version: 0 },
    };
  }

  resetPose(pose = this.world.startPose || START_POSE) {
    this.x = pose.x; this.y = pose.y; this.heading = pose.heading;
    this.hub.yawOffset = this.heading;
    this.emit('pose');
  }

  setPose(x, y, heading = this.heading) {
    [this.x, this.y] = this.world.resolveCircle(x, y, this.geom.radius);
    this.heading = heading;
    this.emit('pose');
  }

  // ---------------- movement pair ----------------

  _pairPorts() {
    const wheels = [this.config.left, this.config.right];
    const pair = this.movement.pair;
    if (!pair) return { left: wheels[0], right: wheels[1] };
    if (pair[0] === wheels[0] && pair[1] === wheels[1]) return { left: wheels[0], right: wheels[1] };
    if (pair[0] === wheels[1] && pair[1] === wheels[0]) return { left: wheels[1], right: wheels[0], swapped: true };
    if (!this.movement.hint) {
      this.movement.hint = `Movement motors are set to ${pair[0]}+${pair[1]}, but this robot's wheels are on ${wheels[0]}+${wheels[1]}. Driving anyway (the real robot would need the right ports).`;
      this.emit('hint', this.movement.hint);
    }
    return { left: wheels[0], right: wheels[1] };
  }

  setMovementPair(code) {
    const s = String(code || '').toUpperCase().replace(/[^A-F]/g, '');
    if (s.length >= 2) this.movement.pair = [s[0], s[1]];
  }

  setMovementSpeed(pct) { this.movement.speedPct = clamp(num(pct), -100, 100); }
  setCmPerRotation(value, unit) { const v = Math.abs(num(value)) || 17.5; this.movement.cmPerRotation = unit === 'inches' ? v * 2.54 : v; }

  /** Wheel speed fractions for a steering value (-100..100): 0 straight, 50 pivot, 100 spin. */
  _steerFractions(steering) {
    const s = clamp(num(steering), -100, 100);
    if (s >= 0) return { l: 1, r: 1 - s / 50 };
    return { l: 1 + s / 50, r: 1 };
  }

  _driveWheels(lFrac, rFrac, speedPct) {
    const ports = this._pairPorts();
    const base = (clamp(num(speedPct), -100, 100) / 100) * MAX_DEG_PER_S;
    let l = lFrac * base, r = rFrac * base;
    if (ports.swapped) [l, r] = [r, l];
    this.motors[ports.left].target = l;
    this.motors[ports.right].target = r;
    this.motors[ports.left].goal = null;
    this.motors[ports.right].goal = null;
    return ports;
  }

  _degreesFor(amount, unit) {
    const a = Math.abs(num(amount));
    switch (unit) {
      case 'degrees': return a;
      case 'cm': return (a / this.movement.cmPerRotation) * 360;
      case 'inches': return ((a * 2.54) / this.movement.cmPerRotation) * 360;
      default: return a * 360; // rotations
    }
  }

  /** move DIRECTION/steering for amount unit. Returns a goal object whose .done flips when finished. */
  moveFor({ direction = 'forward', steering = 0, amount = 1, unit = 'rotations' }) {
    let sign = direction === 'back' ? -1 : 1;
    if (num(amount) < 0) sign = -sign;
    const { l, r } = this._steerFractions(steering);
    const speed = this.movement.speedPct;
    const ports = this._driveWheels(l * sign, r * sign, speed);
    const goal = { done: false, type: unit === 'seconds' ? 'time' : 'deg', remaining: unit === 'seconds' ? Math.abs(num(amount)) : this._degreesFor(amount, unit), ports };
    if (goal.remaining <= 0) { goal.done = true; this.stopMove(); return goal; }
    this.movement.goal = goal;
    return goal;
  }

  startMove({ direction = 'forward', steering = 0 }) {
    const sign = direction === 'back' ? -1 : 1;
    const { l, r } = this._steerFractions(steering);
    this.movement.goal = null;
    this._driveWheels(l * sign, r * sign, this.movement.speedPct);
  }

  startDual(leftPct, rightPct) {
    this.movement.goal = null;
    const ports = this._pairPorts();
    let l = (clamp(num(leftPct), -100, 100) / 100) * MAX_DEG_PER_S;
    let r = (clamp(num(rightPct), -100, 100) / 100) * MAX_DEG_PER_S;
    if (ports.swapped) [l, r] = [r, l];
    this.motors[ports.left].target = l; this.motors[ports.left].goal = null;
    this.motors[ports.right].target = r; this.motors[ports.right].goal = null;
  }

  stopMove() {
    const ports = this._pairPorts();
    for (const p of [ports.left, ports.right]) { this.motors[p].target = 0; this.motors[p].velocity = 0; this.motors[p].goal = null; }
    if (this.movement.goal) { this.movement.goal.done = true; this.movement.goal = null; }
  }

  // ---------------- single motors ----------------

  _motor(port) { return this.motors[String(port || '').toUpperCase()[0]] || null; }

  motorRunFor(port, direction, amount, unit) {
    const m = this._motor(port);
    const goal = { done: false };
    if (!m) { goal.done = true; return goal; }
    let sign = direction === 'counterclockwise' ? -1 : 1;
    if (num(amount) < 0) sign = -sign;
    m.target = sign * (m.speedPct / 100) * MAX_DEG_PER_S;
    goal.type = unit === 'seconds' ? 'time' : 'deg';
    goal.remaining = unit === 'seconds' ? Math.abs(num(amount)) : this._degreesFor(amount, unit === 'rotations' ? 'rotations' : 'degrees');
    if (goal.remaining <= 0) { goal.done = true; m.target = 0; return goal; }
    m.goal = goal;
    return goal;
  }

  motorStart(port, direction) {
    const m = this._motor(port);
    if (!m) return;
    m.goal = null;
    m.target = (direction === 'counterclockwise' ? -1 : 1) * (m.speedPct / 100) * MAX_DEG_PER_S;
  }

  motorStop(port) {
    const m = this._motor(port);
    if (!m) return;
    if (m.goal) { m.goal.done = true; m.goal = null; }
    m.target = 0; m.velocity = 0;
  }

  motorSetSpeed(port, pct) { const m = this._motor(port); if (m) m.speedPct = clamp(Math.abs(num(pct)), 0, 100); }
  motorPosition(port) { const m = this._motor(port); return m ? Math.round(norm180(m.angle)) : 0; }
  motorSpeedPct(port) { const m = this._motor(port); return m ? Math.round((m.velocity / MAX_DEG_PER_S) * 100) : 0; }

  stopAllMotors() {
    for (const p of PORT_LETTERS) this.motorStop(p);
    this.movement.goal = null;
  }

  // ---------------- sensors ----------------

  /** World point for a robot-relative offset (fwd along the heading, lat towards the robot's right). */
  _point(fwd, lat) {
    const h = this.heading * DEG;
    return [this.x + Math.cos(h) * fwd - Math.sin(h) * lat, this.y + Math.sin(h) * fwd + Math.cos(h) * lat];
  }

  colorSample(port) {
    if (String(port).toUpperCase() !== this.config.color) return null;
    const [px, py] = this._point(this.geom.color.fwd, this.geom.color.lat);
    return classify(this.world.sampleRGB(px, py));
  }

  /** Distance in cm from the distance sensor, or null when nothing is in range / no sensor on that port. */
  distanceCm(port) {
    if (String(port).toUpperCase() !== this.config.distance) return null;
    const d0 = this.geom.distance;
    const a = (this.heading + d0.angle) * DEG;
    const [px, py] = this._point(d0.fwd, d0.lat);
    const d = this.world.raycast(px, py, Math.cos(a), Math.sin(a), 200);
    return Number.isFinite(d) ? Math.max(0, d) : null;
  }

  /**
   * Attachment state: pivot and tip (cm), motor angle, tip height and whether it is low enough to touch models.
   * Modules: arm (lifts about a horizontal axis), sweeper (swings about a vertical axis), lift (slides up), plow (fixed).
   */
  arm() {
    const a0 = this.geom.attachment;
    if (!a0 || a0.module === 'none') return null;
    const port = this.config.attachment;
    const motor = port ? this.motors[port] : null;
    const angle = motor ? motor.angle : 0;
    const [px, py] = this._point(a0.fwd, a0.lat);
    const out = (this.heading + a0.angle) * DEG;
    const L = a0.length;
    const base = { module: a0.module, mount: a0.mount, px, py, angle };
    switch (a0.module) {
      case 'sweeper': {
        const dir = out - angle * DEG;
        return { ...base, tx: px + Math.cos(dir) * L, ty: py + Math.sin(dir) * L, tipHeight: 3, down: true };
      }
      case 'lift': {
        const height = Math.max(1.5, Math.min(16, 1.5 + (angle / 360) * 6));
        return { ...base, tx: px + Math.cos(out) * L * 0.6, ty: py + Math.sin(out) * L * 0.6, tipHeight: height, down: height < 12, liftHeight: height };
      }
      case 'plow':
        return { ...base, tx: px + Math.cos(out) * 4, ty: py + Math.sin(out) * 4, tipHeight: 1.5, down: true };
      default: {
        const a = angle * DEG;
        return { ...base, tx: px + Math.cos(out) * Math.cos(a) * L, ty: py + Math.sin(out) * Math.cos(a) * L, tipHeight: a0.height + Math.sin(a) * L, down: Math.sin(a) * L < 2 };
      }
    }
  }

  yaw() { return Math.round(norm180(this.heading - this.hub.yawOffset)); }
  resetYaw() { this.hub.yawOffset = this.heading; }
  timer() { return this.time - this.hub.timerStart; }
  resetTimer() { this.hub.timerStart = this.time; }

  // ---------------- hub: buttons, light, sound ----------------

  setButton(side, down) {
    down = !!down;
    if (this.hub.buttons[side] === down) return;
    this.hub.buttons[side] = down;
    this.hub.buttonEvents.push({ side, event: down ? 'pressed' : 'released' });
  }

  setMatrix(value) {
    const m = this.hub.matrix;
    if (typeof value === 'string') { for (let i = 0; i < 25; i++) m[i] = Number(value[i] || 0) || 0; }
    else for (let i = 0; i < 25; i++) m[i] = Number(value[i] || 0) || 0;
    this.emit('matrix');
  }
  matrixOff() { this.setMatrix(new Array(25).fill(0)); }

  showImage(value, seconds) {
    this.hub.textGoal = null;
    this.setMatrix(value);
    if (seconds === undefined) return { done: true };
    const goal = { done: false, remaining: Math.max(0, num(seconds)) };
    this.hub.imageGoal = goal;
    return goal;
  }

  writeText(text) {
    const s = String(text ?? '');
    this.hub.imageGoal = null;
    if (s.length === 0) { this.matrixOff(); return { done: true }; }
    if (s.length === 1) { this.setMatrix(charMatrix(s)); return { done: true }; }
    const cols = textColumns(s);
    const goal = { done: false, cols, frame: 0, acc: 0, total: cols.length + 5 };
    this.hub.textGoal = goal;
    this._renderTextFrame(goal);
    return goal;
  }

  _renderTextFrame(goal) {
    const m = new Array(25).fill(0);
    for (let c = 0; c < 5; c++) {
      const idx = goal.frame - 4 + c;
      const col = idx >= 0 && idx < goal.cols.length ? goal.cols[idx] : null;
      if (col) col.forEach((bit, r) => { if (bit) m[r * 5 + c] = 9; });
    }
    this.setMatrix(m);
  }

  setCenterLight(code) {
    const c = COLOR_BY_CODE[String(code)];
    this.hub.centerColor = c && c.hex ? c.hex : null;
    this.emit('light');
  }

  beep(note, seconds) {
    const s = this.hub.sound;
    s.note = clamp(num(note), 24, 108);
    s.version++;
    if (s.goal) s.goal.done = true;
    if (seconds === undefined) { s.goal = null; return { done: true }; }
    const goal = { done: false, remaining: Math.max(0, num(seconds)) };
    s.goal = goal;
    return goal;
  }

  stopSound() {
    const s = this.hub.sound;
    if (s.goal) { s.goal.done = true; s.goal = null; }
    s.note = null;
    s.version++;
  }

  // ---------------- simulation step ----------------

  update(dt) {
    this.time += dt;
    // Motors: ramp towards target, integrate angle, count down goals.
    for (const p of PORT_LETTERS) {
      const m = this.motors[p];
      const dv = m.target - m.velocity;
      const step = ACCEL * dt;
      m.velocity += Math.abs(dv) <= step ? dv : Math.sign(dv) * step;
      m.angle += m.velocity * dt;
      if (m.goal) {
        m.goal.remaining -= m.goal.type === 'time' ? dt : Math.abs(m.velocity) * dt;
        if (m.goal.remaining <= 0) { m.goal.done = true; m.goal = null; m.target = 0; m.velocity = 0; }
      }
    }
    const g = this.movement.goal;
    if (g) {
      const l = this.motors[g.ports.left], r = this.motors[g.ports.right];
      g.remaining -= g.type === 'time' ? dt : Math.max(Math.abs(l.velocity), Math.abs(r.velocity)) * dt;
      if (g.remaining <= 0) {
        g.done = true; this.movement.goal = null;
        for (const m of [l, r]) { m.target = 0; m.velocity = 0; }
      }
    }
    // Kinematics from the configured wheel motors.
    const circ = Math.PI * this.geom.wheelDiameter;
    const vL = (this.motors[this.config.left].velocity / 360) * circ;
    const vR = (this.motors[this.config.right].velocity / 360) * circ;
    const v = (vL + vR) / 2;
    const w = (vL - vR) / this.geom.track; // rad/s, clockwise positive (y axis points down)
    this.heading += (w * dt) / DEG;
    const h = this.heading * DEG;
    const nx = this.x + Math.cos(h) * v * dt;
    const ny = this.y + Math.sin(h) * v * dt;
    [this.x, this.y] = this.world.resolveCircle(nx, ny, this.geom.radius);
    const arm = this.arm();
    this.armContact = null;
    if (arm && arm.down) {
      for (const o of this.world.obstacles) {
        if (arm.tipHeight > o.h) continue;
        const push = this.world.circleBoxPush(arm.tx, arm.ty, arm.module === 'plow' ? 5 : 2, o);
        if (!push) continue;
        this.armContact = o;
        o.touched = this.time;
        if (o.movable) this.world.pushObstacle(o, -push[0], -push[1]);
      }
    }

    // Hub goals.
    const hub = this.hub;
    if (hub.imageGoal) {
      hub.imageGoal.remaining -= dt;
      if (hub.imageGoal.remaining <= 0) { hub.imageGoal.done = true; hub.imageGoal = null; this.matrixOff(); }
    }
    if (hub.textGoal) {
      const t = hub.textGoal;
      t.acc += dt;
      while (t.acc >= 0.09 && !t.done) {
        t.acc -= 0.09;
        t.frame++;
        if (t.frame >= t.total) { t.done = true; hub.textGoal = null; this.matrixOff(); }
        else this._renderTextFrame(t);
      }
    }
    if (hub.sound.goal) {
      hub.sound.goal.remaining -= dt;
      if (hub.sound.goal.remaining <= 0) { hub.sound.goal.done = true; hub.sound.goal = null; hub.sound.note = null; hub.sound.version++; }
    }
  }
}

// ---------------- helpers ----------------

export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Classify an RGB sample into a SPIKE colour code/name plus reflectivity (0..100). */
export function classify([r, g, b]) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const lum = 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;
  const sat = max === 0 ? 0 : (max - min) / max;
  let hue = 0;
  if (max !== min) {
    if (max === rn) hue = ((gn - bn) / (max - min)) % 6;
    else if (max === gn) hue = (bn - rn) / (max - min) + 2;
    else hue = (rn - gn) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;
  }
  let code;
  if (lum < 0.22) code = '0';
  else if (sat < 0.25) code = lum > 0.55 ? '10' : '-1';
  else if (hue < 18 || hue >= 335) code = '9';
  else if (hue < 68) code = '7';
  else if (hue < 170) code = '6';
  else if (hue < 200) code = '4';
  else if (hue < 262) code = '3';
  else code = '1';
  const reflect = Math.round(clamp(lum * 100, 0, 100));
  return { code, name: COLOR_BY_CODE[code].name, reflect, rgb: [r, g, b] };
}
