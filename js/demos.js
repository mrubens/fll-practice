// Tool demos: one project per mission move in tools.html, each starting the robot at its spot (a launch override) with
// the Advanced Driving Base carrying the Rake in front and LEGO's Dozer Blade behind. Open one, press Run and watch it
// score; then put the real robot on the same spot (measured from the walls) and run the same program.
import { TOOL_PRESETS, EXAMPLE_ARM } from './tools.js';
import { PRESETS, normalizeBuild } from './build.js';

const num = (type, v) => ({ shadow: { type, fields: { NUM: v } } });
const sel = (type, value) => ({ shadow: { type, fields: { ['field_' + type]: value } } });
const chain = (list) => { for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] }; return list[0]; };

export const pair = (ports = 'AE') => ({ type: 'flippermove_setMovementPair', inputs: { PAIR: sel('flippermove_movement-port-selector', ports) } });
export const speed = (pct) => ({ type: 'flippermove_movementSpeed', inputs: { SPEED: num('math_number', pct) } });
export const move = (cm) => ({ type: 'flippermove_move', fields: { UNIT: 'cm' }, inputs: { DIRECTION: sel('flippermove_custom-icon-direction', cm >= 0 ? 'forward' : 'back'), VALUE: num('math_number', Math.abs(cm)) } });
/** A tool motor turn: positive is clockwise (a front tool goes down), negative counterclockwise. */
export const turn = (port, deg) => ({ type: 'flippermotor_motorTurnForDirection', fields: { UNIT: 'degrees' },
  inputs: { PORT: sel('flippermotor_multiple-port-selector', port), DIRECTION: sel('flippermotor_custom-icon-direction', deg >= 0 ? 'clockwise' : 'counterclockwise'), VALUE: num('math_number', Math.abs(deg)) } });
export const motorSpeed = (port, pct) => ({ type: 'flippermotor_motorSetSpeed', inputs: { PORT: sel('flippermotor_multiple-port-selector', port), SPEED: num('math_number', pct) } });

/** Run a motor for some seconds (into a stop, it just stalls there): a known start whatever the arm was left at. */
export const turnSeconds = (port, sec, dir = 'counterclockwise') => ({ type: 'flippermotor_motorTurnForDirection', fields: { UNIT: 'seconds' },
  inputs: { PORT: sel('flippermotor_multiple-port-selector', port), DIRECTION: sel('flippermotor_custom-icon-direction', dir), VALUE: num('math_number', sec) } });
export const startMotor = (port, dir) => ({ type: 'flippermotor_motorStartDirection', inputs: { PORT: sel('flippermotor_multiple-port-selector', port), DIRECTION: sel('flippermotor_custom-icon-direction', dir) } });
export const stopMotor = (port) => ({ type: 'flippermotor_motorStop', inputs: { PORT: sel('flippermotor_multiple-port-selector', port) } });
export const resetYaw = () => ({ type: 'flippersensors_resetYaw' });
export const startSteer = (steer) => ({ type: 'flippermove_startSteer', inputs: { STEERING: sel('flippermove_rotation-wheel', steer) } });
export const stopMove = () => ({ type: 'flippermove_stopMove' });
/** "wait until yaw angle < v" (or > v): the gyro turn's stop. */
export const waitYaw = (cmp, v) => ({ type: 'control_wait_until', inputs: { CONDITION: { block: { type: cmp === '<' ? 'operator_lt' : 'operator_gt', inputs: {
  OPERAND1: { shadow: { type: 'text', fields: { TEXT: '' } }, block: { type: 'flippersensors_orientationAxis', fields: { AXIS: 'yaw' } } },
  OPERAND2: { shadow: { type: 'text', fields: { TEXT: String(v) } } } } } } } });
/** Spin in place until the yaw passes `yaw` (negative: to the left), at 20%, then stop. */
export const gyroTurn = (yaw) => [speed(20), startSteer(yaw < 0 ? -100 : 100), waitYaw(yaw < 0 ? '<' : '>', yaw), stopMove()];
export const wait = (sec) => ({ type: 'control_wait', inputs: { DURATION: num('math_positive_number', sec) } });

export const program = (blocks, ports = 'AE') => ({ blocks: { languageVersion: 0, blocks: [chain([{ type: 'flipperevents_whenProgramStarts', x: 40, y: 40 }, pair(ports), ...blocks])] } });

// M11: on the diagonal through the cover's middle (44, 0.1), 35 cm out to the south-east, facing north-west
const d = 35 * Math.SQRT1_2;
export const TOOL_DEMOS = [
  // each starts 10 cm short of its spot and drives in: easier to set up on the real table
  { name: 'Rake: M07 Humongous Fungus', launch: { x: 60.5, y: -21.5, heading: -90 },
    blocks: [move(10), turn('D', 40), wait(0.5), move(-4), turn('D', -40), move(-10)] },
  // LEGO's Lift Arm does M09 more reliably than the Rake (anywhere from 4 to 8 cm of driving in); it lifts in two goes,
  // creeping in between, so the rack stays under the platform as it rises. 6 cm short: further back the Dozer Blade
  // behind the robot would be in M02's model
  { name: 'Lift Arm: M09 Research Platform', front: 'lift-arm', launch: { x: -42.6, y: -16.7, heading: -90 },
    blocks: [turn('D', 6), move(6), motorSpeed('D', 30), turn('D', -70), move(2), turn('D', -70), wait(1.5), motorSpeed('D', 75), move(-12)] },
  { name: 'Rake: M03 Flip the Rock', launch: { x: -92.7, y: 20, heading: -90 },
    blocks: [turn('D', -86), move(13), motorSpeed('D', 25), turn('D', 86), wait(0.5), move(-6), motorSpeed('D', 75), turn('D', -60), move(-10)] },
  { name: 'Rake: M11 Window to the Past', launch: { x: 44 + d, y: 0.1 + d, heading: -135 },
    blocks: [turn('D', -86), move(20), motorSpeed('D', 25), turn('D', 86), wait(0.5), move(-8), motorSpeed('D', 75), turn('D', -86), move(-8)] },
  { name: 'Dozer: M06 Leafcutter Frenzy', launch: { x: 44.2 - 30 * Math.SQRT1_2, y: -40.1 + 30 * Math.SQRT1_2, heading: 135 },
    blocks: [speed(20), move(-20), wait(1), speed(50), move(10)] },
  { name: 'Dozer: M01 Drone Survey', launch: { x: -70, y: 46, heading: 180 },
    blocks: [speed(30), move(-35), speed(50), move(8)] },
];

// The Driving Base with LEGO's arm (the Guided Mission robot: wheels C and D, arm motor E). Each starts with the robot's
// back against the south wall, measured from the mat's left edge, and drives back home when it's done.
export const ARM_DEMOS = [
  // the crossbar goes over the levers, comes down behind one and pulls the rock over; the arm is pressed onto the mat
  // first so it starts the same way whatever it was left at. Works with the robot's left side 0.8-1.6 cm in from the
  // mat's left edge and 48.4-49.8 cm of driving in
  { name: 'Arm robot: M03 Flip the Rock', robot: 'guided-mission', launch: { x: -91.2, y: 50.9, heading: -90 },
    blocks: [motorSpeed('E', 20), turnSeconds('E', 0.5), motorSpeed('E', 75), turn('E', 115), move(49), turn('E', -47), speed(10), move(-3),
      motorSpeed('E', 5), startMotor('E', 'counterclockwise'), move(-2.5), stopMotor('E'), speed(50), motorSpeed('E', 75), move(-43)] },
  // the arm, half raised, runs into the seed pod from the south-west and lifting it pushes the seeds out (all three).
  // From the left launch area aimed north-east at the pod; driving in 38 to 44 cm works, 1.5 cm sideways and 4 degrees
  { name: 'Arm robot: M02 Exploding Seeds', robot: 'guided-mission', launch: { x: -71.75, y: 38.35, heading: -44 },
    blocks: [motorSpeed('E', 20), turnSeconds('E', 0.5), motorSpeed('E', 40), turn('E', 45), speed(30), move(41), motorSpeed('E', 25), turn('E', 70), wait(1),
      motorSpeed('E', 75), speed(50), move(-41)] },
  // the robot's own back (the ball caster beam) pushes the red marker east: the bars fold up and lift the drone.
  // From the left launch area facing west; backing 35 to 45 cm works. Then back home
  { name: 'Arm robot: M01 Drone Survey', robot: 'guided-mission', launch: { x: -70, y: 46, heading: 180 },
    blocks: [speed(30), move(-40), speed(50), move(40)] },
  // with the back pusher: from the right launch area, north, a gyro turn to face west, across, a gyro turn to face
  // south-west, then backing slowly into the ant rack (27 to 28 cm works; 26 is short, 29 launches leaves)
  { name: 'Arm robot: M06 Leafcutter Frenzy (back pusher)', robot: 'guided-mission-pusher', launch: { x: 68, y: 50.2, heading: -90 },
    blocks: [resetYaw(), speed(40), move(68.5), ...gyroTurn(-89), speed(40), move(45), ...gyroTurn(-134), speed(20), move(-27.5), wait(1), speed(50), move(10)] },
];

/** The demo robot: the Advanced Driving Base with a front tool (the Rake, or LEGO's Lift Arm) and LEGO's Dozer Blade. */
export function demoBuild(front = 'rake', robot = 'advanced') {
  if (robot === 'guided-mission') return normalizeBuild({ ...PRESETS['guided-mission'], preset: 'guided-mission' });
  if (robot === 'guided-mission-pusher') {
    const pusher = TOOL_PRESETS['driving-base'].find((t) => t.id === 'back-pusher').ldr;
    return normalizeBuild({ ...PRESETS['guided-mission'], preset: null, name: 'Driving Base with LEGO\'s arm and the back pusher', attachment: { module: 'custom', mount: 'front', ldr: EXAMPLE_ARM + '\n' + pusher } });
  }
  const pick = (id) => TOOL_PRESETS.advanced.find((t) => t.id === id).ldr;
  const label = front === 'rake' ? 'the Rake' : 'LEGO\'s Lift Arm';
  return normalizeBuild({ ...PRESETS.advanced, preset: null, name: `Advanced Driving Base with ${label} and the Dozer Blade`,
    attachment: { module: 'custom', ldr: `0 ${label} and Dozer Blade\n` + pick(front) + pick('dozer'), stops: { D: front === 'rake' ? [-328, 45] : [-264, 32], C: [-328, 58] } } });
}

export const demoProgram = (demo) => program(demo.blocks, /^guided-mission/.test(demo.robot || '') ? 'CD' : 'AE');
