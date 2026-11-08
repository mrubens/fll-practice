// Robot + hub model: motors, differential-drive kinematics, sensors, timer, gyro, LED matrix, sound state.
// Pure simulation state; no DOM or three.js here.
import { START_POSE } from './world.js';
import { COLOR_BY_CODE } from './spec.js';
import { textColumns, charMatrix } from './matrixfont.js';
import { defaultBuild, normalizeBuild, geometryFor, portsOf, FREE_STOP } from './build.js';
import { loadLego, legoReady } from './lego.js';

export const MAX_DEG_PER_S = 900;        // motor speed at 100 %
// The forklift: a 12-tooth gear on the motor driving a gear rack. 12 teeth at LEGO's 3.14 mm pitch is 3.8 cm per
// rotation, and the rack gives 9 cm of travel: the fork rides from 1.5 cm to 10.5 cm above the mat.
export const LIFT = { low: 1.5, high: 10.5, cmPerRotation: 3.77 };
/** The arm's travel in motor degrees: a little below its rest pose (the mat stops it) up to where its elbows meet the hub. */
export const ARM_STOPS = { low: -35, high: 100 };   // low: the arm can come down until it rests on the mat (the mat stalls it first)
/** How far motor E turns each built-in attachment (degrees) before the build itself stops it: measured by turning
 * each attachment's LEGO parts until they meet the Driving Base's (the arm and scoop reach the mat or their old
 * stops first). */
export const MODULE_STOPS = {
  arm: [ARM_STOPS.low, ARM_STOPS.high],
  sweeper: [-78, 90],    // one way it swings across the robot's front until it meets the bracket
  scoop: [-3, 100],      // from the plate flat on the mat up to the liftarms meeting the hub
  plow: [-4, 90],        // tilting down, the blade's back meets the motor under the bracket at once
  basket: [0, 42],       // tipping forward, its towers meet the motor under the bracket (pieces slide out from ~20)
};
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
    // parts built in the robot builder (sensors, a custom attachment) need the LEGO parts data for their physics:
    // build again once it is here
    if (this.geom.partsLdr && !legoReady()) { const b = this.build; loadLego().then(() => { if (this.build === b) this.applyBuild(b); }).catch(() => {}); }
    this.config = portsOf(this.build);
    for (const p of [this.config.attachment, ...(this.config.tools || [])]) if (p && this.motors && this.motors[p]) Object.assign(this.motors[p], { angle: 0, velocity: 0, target: 0, goal: null, stalled: false });   // a new attachment (or tool) starts at rest
    if (this.movement) this.movement.cmPerRotation = this.geom.calibration;
    this.world.robot = this;
    if (this.world.physics && this.x !== undefined) this.world.physics.rebuildRobot(this);
    this.emit('build');
  }

  on(event, fn) { (this.listeners[event] ||= []).push(fn); }
  emit(event, data) { (this.listeners[event] || []).forEach((fn) => fn(data)); }

  /** Program state (motors, hub, goals). Called when a program starts and when the robot is reset. */
  reset() {
    this.time = 0;
    // a program start resets what the hub resets, not the shafts: an arm stays where the last run (or a hand) left
    // it, so a program must home its attachment itself, as on the real robot
    const was = this.motors || {};
    this.motors = {};
    for (const p of PORT_LETTERS) this.motors[p] = { velocity: 0, target: 0, angle: was[p] ? was[p].angle : 0, speedPct: 75, goal: null };
    this.movement = { pair: null, speedPct: 50, cmPerRotation: this.geom ? this.geom.calibration : 17.5, goal: null, hint: null };
    this.hub = {
      yawOffset: 0, timerStart: 0,
      matrix: new Array(25).fill(0), centerColor: null,
      buttons: { left: false, right: false }, buttonEvents: [],
      textGoal: null, imageGoal: null,
      sound: { note: null, goal: null, version: 0 },
    };
  }

  /** The technicians set the attachment and tools back by hand (field setup, Reset position). */
  homeTools() {
    for (const p of [this.config && this.config.attachment, ...((this.config && this.config.tools) || [])]) if (p && this.motors[p]) Object.assign(this.motors[p], { angle: 0, velocity: 0, target: 0, goal: null, stalled: false });
    this._syncPhysicsPose();
  }

  /** Every shaft's angle, to put back for a replay. */
  shaftAngles() { return Object.fromEntries(PORT_LETTERS.map((p) => [p, this.motors[p].angle])); }
  setShaftAngles(a) { for (const p of PORT_LETTERS) if (a && Number.isFinite(a[p])) this.motors[p].angle = a[p]; this._syncPhysicsPose(); }

  resetPose(pose = this.world.startPose || START_POSE) {
    this.x = pose.x; this.y = pose.y; this.heading = pose.heading;
    this.hub.yawOffset = this.heading;
    this._syncPhysicsPose();
    this.emit('pose');
  }

  setPose(x, y, heading = this.heading) {
    [this.x, this.y] = this.world.resolveCircle(x, y, this.geom.radius);
    this.heading = heading;
    this._syncPhysicsPose();
    this.emit('pose');
  }

  _syncPhysicsPose() {
    const ph = this.world.physics;
    if (!ph) return;
    if (!ph.robotBody) ph.rebuildRobot(this);
    ph.setRobotPose(this.x, this.y, this.heading);
  }

  /** The attachment motor is pressing against a wall or model (set by the simulation step). */
  attachmentStalled() {
    const m = this.config.attachment ? this.motors[this.config.attachment] : null;
    return !!(m && m.stalled);
  }

  // ---------------- movement pair ----------------

  /**
   * The motors a movement drives, as the hub would: the pair the program set (first = left), whatever is on those
   * ports. Paired the other way round on the real robot the "left" motor is the right wheel's, mounted mirrored, so
   * the robot drives backward with its steering flipped; on ports that are not the wheels, the wheels do not move.
   */
  _pairPorts() {
    const wheels = [this.config.left, this.config.right];
    const pair = this.movement.pair;
    if (!pair || (pair[0] === wheels[0] && pair[1] === wheels[1])) return { left: wheels[0], right: wheels[1] };
    if (pair[0] === wheels[1] && pair[1] === wheels[0]) return { left: wheels[0], right: wheels[1], reversed: true };
    if (!this.movement.hint) {
      this.movement.hint = `Movement motors are set to ${pair[0]}+${pair[1]}, but this robot's wheels are on ${wheels[0]}+${wheels[1]}: the wheels will not move. Set the movement motors to ${wheels[0]}+${wheels[1]}.`;
      this.emit('hint', this.movement.hint);
    }
    return { left: pair[0], right: pair[1] };
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
    if (ports.reversed) [l, r] = [-r, -l];
    for (const [p, v] of [[ports.left, l], [ports.right, r]]) { const m = this.motors[p]; if (!m) continue; m.target = v; this._endGoal(m); }
    return ports;
  }

  /** A command replaced by a new one ends (a block still waiting on it goes on, as on the hub). */
  _endGoal(m) { if (m && m.goal) { m.goal.done = true; m.goal = null; } }
  _endMoveGoal() { if (this.movement.goal) { this.movement.goal.done = true; this.movement.goal = null; } }

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
    this._endMoveGoal();
    const ports = this._driveWheels(l * sign, r * sign, speed);
    const goal = { done: false, type: unit === 'seconds' ? 'time' : 'deg', remaining: unit === 'seconds' ? Math.abs(num(amount)) : this._degreesFor(amount, unit), ports };
    if (goal.remaining <= 0) { goal.done = true; this.stopMove(); return goal; }
    this.movement.goal = goal;
    return goal;
  }

  startMove({ direction = 'forward', steering = 0 }) {
    const sign = direction === 'back' ? -1 : 1;
    const { l, r } = this._steerFractions(steering);
    this._endMoveGoal();
    this._driveWheels(l * sign, r * sign, this.movement.speedPct);
  }

  startDual(leftPct, rightPct) {
    this._endMoveGoal();
    this._driveWheels(clamp(num(leftPct), -100, 100) / 100, clamp(num(rightPct), -100, 100) / 100, 100);
  }

  stopMove() {
    const ports = this._pairPorts();
    for (const p of [ports.left, ports.right]) { const m = this.motors[p]; if (!m) continue; m.target = 0; m.velocity = 0; this._endGoal(m); }
    this._endMoveGoal();
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
    this._endGoal(m);
    m.goal = goal;
    return goal;
  }

  motorStart(port, direction) {
    const m = this._motor(port);
    if (!m) return;
    this._endGoal(m);
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

  /** The sensor of a type on a port (see geometryFor: its lens and the way it looks, in the robot's frame), or null. */
  sensorOn(port, type) {
    const p = String(port).toUpperCase();
    return (this.geom.sensors || []).find((s) => s.port === p && (!type || s.type === type)) || null;
  }

  /** Where a color sensor looks on the mat (x, y) and from how far (cm), or null when it does not look down at it. */
  colorSpot(s) {
    const [f, up, lat] = s.pos, [df, du, dl] = s.dir;
    if (du > -0.5) return null;                         // looking sideways or up: it sees no mat
    const t = up / -du;
    const [x, y] = this._point(f + df * t, lat + dl * t);
    return { x, y, t };
  }

  /**
   * What the color sensor on a port reads, from the mat where it looks: like the real one it has to look down at the
   * mat from close by. Its own light comes back weaker from further away (full up to 2 cm, gone by 4.5 cm), and
   * past that it reads no color.
   */
  colorSample(port) {
    const s = this.sensorOn(port, 'color');
    if (!s) return null;
    const spot = this.colorSpot(s);
    if (!spot || spot.t > 4.5) return { code: '-1', name: COLOR_BY_CODE['-1'].name, reflect: 0, rgb: [0, 0, 0] };
    const k = clamp((spot.t - 2) / 2.5, 0, 1);
    return classify(this.world.sampleRGB(spot.x, spot.y).map((v) => Math.round(v * (1 - k) + 10 * k)));
  }

  /**
   * The force sensor on a port: {newtons, pressed, hard}, or null when there is none. Its button reads when something
   * is up against it: a little for a touch (a piece leaning on it, the robot resting against a wall), more the harder
   * the robot drives into what it is pressed on (the drive that could not happen in its direction), up to 10 N.
   */
  forceSample(port) {
    const s = this.sensorOn(port, 'force');
    if (!s) return null;
    const [f, up, lat] = s.pos, [df, du, dl] = s.dir;
    const h = this.heading * DEG;
    const dx = Math.cos(h) * df - Math.sin(h) * dl, dy = Math.sin(h) * df + Math.cos(h) * dl;
    const BACK = 0.3;                                   // look from just inside the button, so a face it touches counts
    const [px, py] = this._point(f - df * BACK, lat - dl * BACK);
    const d = this.world.raycast(px, py, dx, dy, 1, up - du * BACK, du);
    let n = 0;
    if (Number.isFinite(d) && d - BACK < 0.4) {          // touching: the drive keeps 2.5 mm off what it meets (physics SKIN)
      const ph = this.world.physics, b = ph && ph.blocked;
      const push = b && b.dt > 0 ? Math.max(0, (b.x * dx + b.y * dy) / b.dt) : 0;   // cm/s of drive held back along the button
      n = Math.min(10, 2.5 + push * 0.75);
    }
    n = Math.round(n * 10) / 10;
    return { newtons: n, pressed: n >= 1, hard: n >= 8 };
  }

  /** Distance in cm from the distance sensor on a port along the way it looks, or null when nothing is in range. */
  distanceCm(port) {
    const s = this.sensorOn(port, 'distance');
    if (!s) return null;
    const [f, up, lat] = s.pos, [df, du, dl] = s.dir;
    const [px, py] = this._point(f, lat);
    const h = this.heading * DEG;
    const d = this.world.raycast(px, py, Math.cos(h) * df - Math.sin(h) * dl, Math.sin(h) * df + Math.cos(h) * dl, 200, up, du);
    return Number.isFinite(d) ? Math.max(0, d) : null;
  }

  /**
   * Attachment state: pivot and tip (cm), motor angle, tip height and whether it is low enough to touch models.
   * Modules: arm (lifts about a horizontal axis), sweeper (swings about a vertical axis), lift (slides up), plow (fixed).
   */
  /** Where the attachment motor's angle is clamped by the build itself, or null when it is free. */
  _attachmentStop(angle) {
    const module = this.geom.attachment.module;
    if (module === 'lift') { const top = ((LIFT.high - LIFT.low) / LIFT.cmPerRotation) * 360; return angle < 0 ? 0 : angle > top ? top : null; }
    const s = module === 'custom' ? this.geom.attachment.stops || [-180, 180] : MODULE_STOPS[module];   // custom: where it meets the robot itself
    if (!s) return null;
    return angle < s[0] ? s[0] : angle > s[1] ? s[1] : null;
  }

  /** Where a tool motor's own build stops it (its parts meet the robot), or null when it is free. */
  _toolStop(port, angle) {
    const a = this.geom.attachment;
    const s = a && a.module === 'tools' && a.stops && a.stops[port];
    if (!s) return null;
    // nothing in the way that far round (FREE_STOP; ±180 in builds saved before tools could be geared down): it turns on freely
    const free = (v) => Math.abs(v) >= FREE_STOP || Math.abs(v) === 180;
    return angle < s[0] && !free(s[0]) ? s[0] : angle > s[1] && !free(s[1]) ? s[1] : null;
  }

  arm() {
    const a0 = this.geom.attachment;
    if (!a0 || a0.module === 'none' || a0.module === 'tools') return null;
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
        const height = Math.max(LIFT.low, Math.min(LIFT.high, LIFT.low + (angle / 360) * LIFT.cmPerRotation));
        return { ...base, tx: px + Math.cos(out) * L * 0.6, ty: py + Math.sin(out) * L * 0.6, tipHeight: height, down: height < 12, liftHeight: height };
      }
      case 'plow':
        return { ...base, tx: px + Math.cos(out) * 4, ty: py + Math.sin(out) * 4, tipHeight: 1.5, down: true };
      case 'basket': {
        // the basket rides above the arm axle; its front lip (6 cm out, 20 degrees up from the axle) tips forward and down
        const a = (20 - Math.max(0, angle)) * DEG;
        return { ...base, tx: px + Math.cos(out) * Math.cos(a) * 6, ty: py + Math.sin(out) * Math.cos(a) * 6, tipHeight: a0.height + Math.sin(a) * 6, down: false, tilt: angle };
      }
      default: {
        const a = (angle + (a0.tipAngle || 0)) * DEG;
        const tipHeight = a0.height - (a0.drop || 0) * Math.cos(angle * DEG) + Math.sin(a) * L;
        return { ...base, tx: px + Math.cos(out) * Math.cos(a) * L, ty: py + Math.sin(out) * Math.cos(a) * L, tipHeight, down: tipHeight < 4 };
      }
    }
  }

  /** Forward speed of the robot body in cm/s (negative when reversing). */
  forwardSpeed() {
    const circ = Math.PI * this.geom.wheelDiameter;
    return ((this.motors[this.config.left].velocity + this.motors[this.config.right].velocity) / 2 / 360) * circ;
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
    const ph = this.world.physics && this.world.physics.robotBody ? this.world.physics : null;
    for (const p of PORT_LETTERS) {
      const m = this.motors[p];
      const dv = m.target - m.velocity;
      const step = ACCEL * dt;
      m.velocity += Math.abs(dv) <= step ? dv : Math.sign(dv) * step;
      const prevAngle = m.angle;
      let delta = m.velocity * dt;
      // a degrees goal ends exactly on its last degree (no overshoot past it)
      if (m.goal && m.goal.type !== 'time' && Math.abs(delta) > m.goal.remaining) delta = Math.sign(delta) * m.goal.remaining;
      m.angle += delta;
      // The attachment's own end stops: the forklift's rack runs out, the sweeper meets the robot's body.
      const tool = (this.config.tools || []).includes(p);
      const stop = p === this.config.attachment ? this._attachmentStop(m.angle) : tool ? this._toolStop(p, m.angle) : null;
      if (stop !== null) { m.angle = stop; if (Math.sign(m.velocity) === Math.sign(stop - prevAngle) || stop === prevAngle) { m.velocity = 0; m.stalled = true; m.stallTime = (m.stallTime || 0) + dt; if (m.goal && m.stallTime > 0.3) { m.goal.done = true; m.goal = null; m.target = 0; } } }
      // Attachment motor pressing into a wall or model: it stalls (and a "run for" goal gives up after a moment, like the hub).
      else if (ph && (p === this.config.attachment || tool) && m.velocity !== 0 && ph.attachmentBlocked(m.angle, p)) {
        m.angle = prevAngle; m.velocity = 0;
        m.stalled = true; m.stallTime = (m.stallTime || 0) + dt;
        if (m.goal && m.stallTime > 0.3) { m.goal.done = true; m.goal = null; m.target = 0; }
      } else if (m.stalled && m.velocity !== 0) { m.stalled = false; m.stallTime = 0; }
      m.turned = m.angle - prevAngle;              // what the shaft really turned this step (the wheels move by this)
      if (m.goal) {
        m.goal.remaining -= m.goal.type === 'time' ? dt : Math.abs(m.turned);
        if (m.goal.remaining <= 1e-9) { m.goal.done = true; m.goal = null; m.target = 0; m.velocity = 0; }
      }
    }
    const g = this.movement.goal;
    if (g) {
      const l = this.motors[g.ports.left], r = this.motors[g.ports.right];
      if (g.type === 'time') g.remaining -= dt;
      else {
        // the faster wheel counts the goal; on the last step both are cut back so it ends exactly there
        const most = Math.max(Math.abs(l.turned), Math.abs(r.turned));
        if (most > g.remaining && most > 0) {
          const k = g.remaining / most;
          for (const m of [l, r]) { const cut = m.turned * (1 - k); m.angle -= cut; m.turned -= cut; }
        }
        g.remaining -= Math.min(most, g.remaining);
      }
      if (g.remaining <= 1e-9) {
        g.done = true; this.movement.goal = null;
        for (const m of [l, r]) { m.target = 0; m.velocity = 0; }
      }
    }
    // Kinematics from the configured wheel motors.
    // from what the wheel motors actually turned this step (the same numbers their encoders count), along the arc's
    // midpoint heading
    const circ = Math.PI * this.geom.wheelDiameter;
    const sL = (this.motors[this.config.left].turned / 360) * circ;
    const sR = (this.motors[this.config.right].turned / 360) * circ;
    const ds = (sL + sR) / 2;
    const dth = (sL - sR) / this.geom.track; // rad, clockwise positive (y axis points down)
    const prevHeading = this.heading;
    const hm = prevHeading * DEG + dth / 2;
    this.heading += dth / DEG;
    const nx = this.x + Math.cos(hm) * ds;
    const ny = this.y + Math.sin(hm) * ds;
    this.armContact = null;
    if (ph) {
      const nh = this.heading;
      this.heading = prevHeading;
      [this.x, this.y, this.heading] = ph.moveRobot(this, nx, ny, nh, dt);
    } else {
      [this.x, this.y] = this.world.resolveCircle(nx, ny, this.geom.radius);
    }
    const arm = this.arm();
    if (!ph && arm && arm.down) {
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

/** Classify an RGB sample into a SPIKE color code/name plus reflectivity (0..100). */
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
  if (lum < 0.14) code = '0';
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
