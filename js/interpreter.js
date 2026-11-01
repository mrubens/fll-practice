// Runs the Blockly workspace with Scratch-like semantics: one cooperative thread per hat block,
// loops yield once per iteration, event hats are edge-triggered every frame.
import { num } from './robot.js';
import { SELECTORS } from './spec.js';
import { findDefinition, argKinds } from './myblocks.js';

class StopSignal extends Error {}

export class Runtime {
  constructor({ workspace, robot, onChange, onLog }) {
    this.workspace = workspace;
    this.robot = robot;
    this.onChange = onChange || (() => {});
    this.onLog = onLog || (() => {});
    this.running = false;
    this.threads = new Map();
    this.tickWaiters = [];
    this.hats = [];
    this.edge = new Map();
    this.vars = new Map();
  }

  log(msg) { this.onLog(msg); }

  start() {
    if (this.running) return;
    const robot = this.robot;
    robot.reset();
    robot.hub.yawOffset = robot.heading;
    this.vars.clear();
    this.edge.clear();
    this.threads.clear();
    this.tickWaiters = [];
    this.hats = this.workspace.getTopBlocks(true).filter((b) => b.type.startsWith('flipperevents_when') && !b.isShadow());
    this.running = true;
    for (const hat of this.hats) if (hat.type === 'flipperevents_whenProgramStarts') this.launch(hat);
    this.onChange();
    this.checkFinished();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const t of this.threads.values()) { t.stopped = true; this.glow(t.hat, false); this.mark(t, null); }
    this.threads.clear();
    const waiters = this.tickWaiters;
    this.tickWaiters = [];
    for (const w of waiters) w();
    this.robot.stopAllMotors();
    this.robot.stopSound();
    this.robot.matrixOff();
    this.robot.hub.textGoal = null;
    this.robot.hub.imageGoal = null;
    this.onChange();
  }

  get hasEventHats() { return this.hats.some((h) => h.type !== 'flipperevents_whenProgramStarts'); }

  checkFinished() {
    if (this.running && this.threads.size === 0 && !this.hasEventHats) this.stop();
  }

  glow(block, on) {
    try { const root = block.getSvgRoot(); if (root) root.classList.toggle('spike-running', on); } catch { /* block gone */ }
  }
  /** Outline the block a thread is on right now; the outline moves with the thread and goes when it ends. */
  mark(ctx, block) {
    if (ctx.active === block) return;
    if (ctx.active) { try { const r = ctx.active.getSvgRoot(); if (r) r.classList.remove('spike-active'); } catch { /* gone */ } }
    ctx.active = block;
    if (block) { try { const r = block.getSvgRoot(); if (r) r.classList.add('spike-active'); } catch { /* gone */ } }
  }

  launch(hat) {
    const old = this.threads.get(hat.id);
    if (old) { old.stopped = true; this.glow(hat, false); }
    const ctx = { hat, stopped: false };
    this.threads.set(hat.id, ctx);
    this.glow(hat, true);
    (async () => {
      try {
        await this.execStack(hat.getNextBlock(), ctx);
      } catch (e) {
        if (!(e instanceof StopSignal)) { console.error(e); this.log('Error: ' + (e.message || e)); }
      } finally {
        this.mark(ctx, null);
        if (this.threads.get(hat.id) === ctx) { this.threads.delete(hat.id); this.glow(hat, false); }
        this.checkFinished();
      }
    })();
  }

  stopOtherThreads(ctx) {
    for (const [id, t] of this.threads) if (t !== ctx) { t.stopped = true; this.glow(t.hat, false); this.mark(t, null); this.threads.delete(id); }
  }

  /** Called once per frame after the robot has been stepped. */
  tick() {
    if (!this.running) return;
    const events = this.robot.hub.buttonEvents.splice(0);
    for (const hat of this.hats) {
      if (hat.type === 'flipperevents_whenProgramStarts') continue;
      if (hat.type === 'flipperevents_whenButton') {
        const side = hat.getFieldValue('BUTTON'), ev = hat.getFieldValue('EVENT');
        if (events.some((e) => e.side === side && e.event === ev)) this.launch(hat);
        continue;
      }
      let val = false;
      this.ctx = null;
      try { val = this.hatPredicate(hat); } catch (e) { console.error(e); }
      const prev = this.edge.get(hat.id) || false;
      if (val && !prev) this.launch(hat);
      this.edge.set(hat.id, val);
    }
    const waiters = this.tickWaiters;
    this.tickWaiters = [];
    for (const w of waiters) w();
  }

  hatPredicate(hat) {
    switch (hat.type) {
      case 'flipperevents_whenCondition': return this.bool(hat, 'CONDITION');
      case 'flipperevents_whenTimer': return this.robot.timer() > this.num(hat, 'VALUE');
      case 'flipperevents_whenColor': {
        const s = this.robot.colorSample(this.str(hat, 'PORT'));
        return !!s && s.code === this.str(hat, 'OPTION');
      }
      case 'flipperevents_whenDistance':
        return this.distanceTest(this.str(hat, 'PORT'), hat.getFieldValue('COMPARATOR'), this.num(hat, 'VALUE'), hat.getFieldValue('UNIT'));
      default: return false;
    }
  }

  yield(ctx) {
    return new Promise((resolve, reject) => {
      this.tickWaiters.push(() => (ctx.stopped || !this.running ? reject(new StopSignal()) : resolve()));
    });
  }

  async waitGoal(goal, ctx) {
    while (!goal.done) await this.yield(ctx);
  }

  async execStack(block, ctx) {
    while (block) {
      if (ctx.stopped) throw new StopSignal();
      await this.exec(block, ctx);
      block = block.getNextBlock();
    }
  }

  async exec(block, ctx) {
    this.ctx = ctx;
    this.mark(ctx, block);
    const h = HANDLERS[block.type];
    if (!h) { this.log(`"${block.type}" is not supported in the simulator yet.`); return; }
    await h.call(this, block, ctx);
  }

  // ---------- values ----------

  value(block, name) {
    const target = block.getInputTargetBlock(name);
    if (!target) return null;
    return this.evalReporter(target);
  }
  num(block, name) { return num(this.value(block, name)); }
  str(block, name) { const v = this.value(block, name); return v === null || v === undefined ? '' : String(v); }
  bool(block, name) { return toBool(this.value(block, name)); }

  evalReporter(b) {
    switch (b.type) {
      case 'math_number': case 'math_positive_number': case 'math_whole_number': return num(b.getFieldValue('NUM'));
      case 'text': return b.getFieldValue('TEXT');
      case 'data_variable': return this.getVar(b);
      case 'argument_reporter_string_number': case 'argument_reporter_boolean': return this.getArg(b.getFieldValue('VALUE'), b.type === 'argument_reporter_boolean');
    }
    if (SELECTORS[b.type]) return b.getFieldValue('field_' + b.type);
    const r = REPORTERS[b.type];
    if (r) return r.call(this, b);
    this.log(`"${b.type}" is not supported in the simulator yet.`);
    return 0;
  }

  getArg(name, boolean) {
    const frames = (this.ctx && this.ctx.frames) || [];
    for (let i = frames.length - 1; i >= 0; i--) if (name in frames[i]) return frames[i][name];
    return boolean ? false : 0;
  }

  getVar(block) {
    const id = block.getFieldValue('VARIABLE');
    return this.vars.has(id) ? this.vars.get(id) : 0;
  }
  setVar(block, value) { this.vars.set(block.getFieldValue('VARIABLE'), value); this.onChange('var'); }

  distanceValue(port, unit) {
    const d = this.robot.distanceCm(port);
    if (d === null) return null;
    if (unit === 'inches') return d / 2.54;
    if (unit === '%') return (d / 200) * 100;
    return d;
  }
  distanceTest(port, cmp, value, unit) {
    const d = this.distanceValue(port, unit);
    if (d === null) return false;
    if (cmp === '<') return d < value;
    if (cmp === '>') return d > value;
    return Math.round(d) === Math.round(value);
  }
}

// ---------- helpers ----------

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return !(s === '' || s === 'false' || s === '0');
}

export function compare(a, b) {
  const sa = String(a ?? ''), sb = String(b ?? '');
  let n1 = Number(sa), n2 = Number(sb);
  if (sa.trim() === '' || sb.trim() === '' || Number.isNaN(n1) || Number.isNaN(n2)) {
    const l1 = sa.toLowerCase(), l2 = sb.toLowerCase();
    return l1 < l2 ? -1 : l1 > l2 ? 1 : 0;
  }
  return n1 - n2;
}

const round2 = (v) => Math.round(v * 100) / 100;

// ---------- command blocks ----------

const HANDLERS = {
  // Movement
  async flippermove_move(b, ctx) {
    await this.waitGoal(this.robot.moveFor({ direction: this.str(b, 'DIRECTION'), steering: 0, amount: this.num(b, 'VALUE'), unit: b.getFieldValue('UNIT') }), ctx);
  },
  async flippermove_steer(b, ctx) {
    await this.waitGoal(this.robot.moveFor({ direction: 'forward', steering: this.num(b, 'STEERING'), amount: this.num(b, 'VALUE'), unit: b.getFieldValue('UNIT') }), ctx);
  },
  async flippermove_startMove(b) { this.robot.startMove({ direction: this.str(b, 'DIRECTION'), steering: 0 }); },
  async flippermove_startSteer(b) { this.robot.startMove({ direction: 'forward', steering: this.num(b, 'STEERING') }); },
  async flippermove_stopMove() { this.robot.stopMove(); },
  async flippermove_movementSpeed(b) { this.robot.setMovementSpeed(this.num(b, 'SPEED')); },
  async flippermove_setMovementPair(b) { this.robot.setMovementPair(this.str(b, 'PAIR')); },
  async flippermove_setDistance(b) { this.robot.setCmPerRotation(this.num(b, 'DISTANCE'), b.getFieldValue('UNIT')); },
  async flippermoremove_startDualSpeed(b) { this.robot.startDual(this.num(b, 'LEFT'), this.num(b, 'RIGHT')); },

  // Motors
  async flippermotor_motorTurnForDirection(b, ctx) {
    await this.waitGoal(this.robot.motorRunFor(this.str(b, 'PORT'), this.str(b, 'DIRECTION'), this.num(b, 'VALUE'), b.getFieldValue('UNIT')), ctx);
  },
  async flippermotor_motorStartDirection(b) { this.robot.motorStart(this.str(b, 'PORT'), this.str(b, 'DIRECTION')); },
  async flippermotor_motorStop(b) { this.robot.motorStop(this.str(b, 'PORT')); },
  async flippermotor_motorSetSpeed(b) { this.robot.motorSetSpeed(this.str(b, 'PORT'), this.num(b, 'SPEED')); },

  // Light
  async flipperlight_lightDisplayImageOn(b) { this.robot.showImage(this.str(b, 'MATRIX')); },
  async flipperlight_lightDisplayImageOnForTime(b, ctx) { await this.waitGoal(this.robot.showImage(this.str(b, 'MATRIX'), this.num(b, 'VALUE')), ctx); },
  async flipperlight_lightDisplayText(b, ctx) { await this.waitGoal(this.robot.writeText(this.str(b, 'TEXT')), ctx); },
  async flipperlight_lightDisplayOff() { this.robot.matrixOff(); },
  async flipperlight_centerButtonLight(b) { this.robot.setCenterLight(this.str(b, 'COLOR')); },

  // Sound
  async flippersound_beepForTime(b, ctx) { await this.waitGoal(this.robot.beep(this.num(b, 'NOTE'), this.num(b, 'DURATION')), ctx); },
  async flippersound_beep(b) { this.robot.beep(this.num(b, 'NOTE')); },
  async flippersound_stopSound() { this.robot.stopSound(); },

  // Control
  async control_wait(b, ctx) {
    const end = this.robot.time + Math.max(0, this.num(b, 'DURATION'));
    do { await this.yield(ctx); } while (this.robot.time < end);
  },
  async control_repeat(b, ctx) {
    const n = Math.round(this.num(b, 'TIMES'));
    for (let i = 0; i < n; i++) {
      await this.execStack(b.getInputTargetBlock('SUBSTACK'), ctx);
      await this.yield(ctx);
    }
  },
  async control_forever(b, ctx) {
    for (;;) {
      await this.execStack(b.getInputTargetBlock('SUBSTACK'), ctx);
      await this.yield(ctx);
    }
  },
  async control_if(b, ctx) {
    if (this.bool(b, 'CONDITION')) await this.execStack(b.getInputTargetBlock('SUBSTACK'), ctx);
  },
  async control_if_else(b, ctx) {
    if (this.bool(b, 'CONDITION')) await this.execStack(b.getInputTargetBlock('SUBSTACK'), ctx);
    else await this.execStack(b.getInputTargetBlock('SUBSTACK2'), ctx);
  },
  async control_wait_until(b, ctx) {
    while (!this.bool(b, 'CONDITION')) await this.yield(ctx);
  },
  async control_repeat_until(b, ctx) {
    while (!this.bool(b, 'CONDITION')) {
      await this.execStack(b.getInputTargetBlock('SUBSTACK'), ctx);
      await this.yield(ctx);
    }
  },
  async flippercontrol_stop(b, ctx) {
    const opt = b.getFieldValue('STOP_OPTION');
    if (opt === 'this stack') throw new StopSignal();
    if (opt === 'other stacks') { this.stopOtherThreads(ctx); return; }
    this.stop();
    throw new StopSignal();
  },

  // Sensors
  async flippersensors_resetYaw() { this.robot.resetYaw(); },
  async flippersensors_resetTimer() { this.robot.resetTimer(); },

  // My Blocks
  async procedures_call(b, ctx) {
    const proc = b.proc_;
    const def = findDefinition(this.workspace, proc.proccode);
    if (!def) { this.log(`My Block "${proc.proccode.split(' %')[0]}" has no definition.`); return; }
    const kinds = argKinds(proc.proccode);
    const frame = {};
    def.proc.argumentids.forEach((id, i) => {
      const name = def.proc.argumentnames[i];
      frame[name] = kinds[i] === 'b' ? this.bool(b, id) : (this.value(b, id) ?? '');
    });
    ctx.frames = ctx.frames || [];
    if (ctx.frames.length > 200) throw new Error('My Block calls itself too deeply.');
    ctx.frames.push(frame);
    try { await this.execStack(def.block.getNextBlock(), ctx); }
    finally { ctx.frames.pop(); this.ctx = ctx; }
  },

  // Variables
  async data_setvariableto(b) { this.setVar(b, this.value(b, 'VALUE') ?? ''); },
  async data_changevariableby(b) { this.setVar(b, num(this.getVar(b)) + this.num(b, 'VALUE')); },
};

// ---------- reporters ----------

const REPORTERS = {
  flippermotor_absolutePosition(b) { return this.robot.motorPosition(this.str(b, 'PORT')); },
  flippermotor_speed(b) { return this.robot.motorSpeedPct(this.str(b, 'PORT')); },

  flippersensors_isColor(b) {
    const s = this.robot.colorSample(this.str(b, 'PORT'));
    const want = this.str(b, 'VALUE');
    return s ? s.code === want : want === '-1';
  },
  flippersensors_color(b) { const s = this.robot.colorSample(this.str(b, 'PORT')); return s ? s.name : 'none'; },
  flippersensors_reflectivity(b) { const s = this.robot.colorSample(this.str(b, 'PORT')); return s ? s.reflect : 0; },
  flippersensors_isReflectivity(b) {
    const s = this.robot.colorSample(this.str(b, 'PORT'));
    if (!s) return false;
    const v = this.num(b, 'VALUE'), c = b.getFieldValue('COMPARATOR');
    return c === '<' ? s.reflect < v : c === '>' ? s.reflect > v : s.reflect === Math.round(v);
  },
  flippersensors_distance(b) {
    const d = this.distanceValue(this.str(b, 'PORT'), b.getFieldValue('UNIT'));
    return d === null ? 'none' : Math.round(d);
  },
  flippersensors_isDistance(b) {
    return this.distanceTest(this.str(b, 'PORT'), b.getFieldValue('COMPARATOR'), this.num(b, 'VALUE'), b.getFieldValue('UNIT'));
  },
  flippersensors_buttonIsPressed(b) {
    const down = !!this.robot.hub.buttons[b.getFieldValue('BUTTON')];
    return b.getFieldValue('EVENT') === 'pressed' ? down : !down;
  },
  flippersensors_orientationAxis(b) { return b.getFieldValue('AXIS') === 'yaw' ? this.robot.yaw() : 0; },
  flippersensors_timer() { return round2(this.robot.timer()); },

  operator_add(b) { return this.num(b, 'NUM1') + this.num(b, 'NUM2'); },
  operator_subtract(b) { return this.num(b, 'NUM1') - this.num(b, 'NUM2'); },
  operator_multiply(b) { return this.num(b, 'NUM1') * this.num(b, 'NUM2'); },
  operator_divide(b) { return this.num(b, 'NUM1') / this.num(b, 'NUM2'); },
  operator_random(b) {
    let lo = this.num(b, 'FROM'), hi = this.num(b, 'TO');
    if (lo > hi) [lo, hi] = [hi, lo];
    const whole = Number.isInteger(lo) && Number.isInteger(hi);
    return whole ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo);
  },
  operator_gt(b) { return compare(this.value(b, 'OPERAND1'), this.value(b, 'OPERAND2')) > 0; },
  operator_lt(b) { return compare(this.value(b, 'OPERAND1'), this.value(b, 'OPERAND2')) < 0; },
  operator_equals(b) { return compare(this.value(b, 'OPERAND1'), this.value(b, 'OPERAND2')) === 0; },
  operator_and(b) { return this.bool(b, 'OPERAND1') && this.bool(b, 'OPERAND2'); },
  operator_or(b) { return this.bool(b, 'OPERAND1') || this.bool(b, 'OPERAND2'); },
  operator_not(b) { return !this.bool(b, 'OPERAND'); },
  operator_join(b) { return this.str(b, 'STRING1') + this.str(b, 'STRING2'); },
  operator_mod(b) {
    const n = this.num(b, 'NUM1'), m = this.num(b, 'NUM2');
    let r = n % m;
    if (r / m < 0) r += m;
    return r;
  },
  operator_round(b) { return Math.round(this.num(b, 'NUM')); },
  operator_mathop(b) {
    const v = this.num(b, 'NUM');
    switch (b.getFieldValue('OPERATOR')) {
      case 'abs': return Math.abs(v);
      case 'floor': return Math.floor(v);
      case 'ceiling': return Math.ceil(v);
      case 'sqrt': return Math.sqrt(v);
      case 'sin': return round2(Math.sin((Math.PI * v) / 180) * 1e8) / 1e8;
      case 'cos': return Math.cos((Math.PI * v) / 180);
      case 'tan': return Math.tan((Math.PI * v) / 180);
      case 'asin': return (Math.asin(v) * 180) / Math.PI;
      case 'acos': return (Math.acos(v) * 180) / Math.PI;
      case 'atan': return (Math.atan(v) * 180) / Math.PI;
      case 'ln': return Math.log(v);
      case 'log': return Math.log10(v);
      case 'e ^': return Math.exp(v);
      case '10 ^': return Math.pow(10, v);
      default: return 0;
    }
  },
};
