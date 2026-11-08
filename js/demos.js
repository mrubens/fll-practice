// Tool demos: one project per mission move in tools.html, each starting the robot at its spot (a launch override) with
// the Advanced Driving Base carrying the Rake in front and LEGO's Dozer Blade behind. Open one, press Run and watch it
// score; then put the real robot on the same spot (measured from the walls) and run the same program.
import { TOOL_PRESETS } from './tools.js';
import { PRESETS, normalizeBuild } from './build.js';

const num = (type, v) => ({ shadow: { type, fields: { NUM: v } } });
const sel = (type, value) => ({ shadow: { type, fields: { ['field_' + type]: value } } });
const chain = (list) => { for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] }; return list[0]; };

const pair = () => ({ type: 'flippermove_setMovementPair', inputs: { PAIR: sel('flippermove_movement-port-selector', 'AE') } });
const speed = (pct) => ({ type: 'flippermove_movementSpeed', inputs: { SPEED: num('math_number', pct) } });
const move = (cm) => ({ type: 'flippermove_move', fields: { UNIT: 'cm' }, inputs: { DIRECTION: sel('flippermove_custom-icon-direction', cm >= 0 ? 'forward' : 'back'), VALUE: num('math_number', Math.abs(cm)) } });
/** A tool motor turn: positive is clockwise (a front tool goes down), negative counterclockwise. */
const turn = (port, deg) => ({ type: 'flippermotor_motorTurnForDirection', fields: { UNIT: 'degrees' },
  inputs: { PORT: sel('flippermotor_multiple-port-selector', port), DIRECTION: sel('flippermotor_custom-icon-direction', deg >= 0 ? 'clockwise' : 'counterclockwise'), VALUE: num('math_number', Math.abs(deg)) } });
const motorSpeed = (port, pct) => ({ type: 'flippermotor_motorSetSpeed', inputs: { PORT: sel('flippermotor_multiple-port-selector', port), SPEED: num('math_number', pct) } });

const wait = (sec) => ({ type: 'control_wait', inputs: { DURATION: num('math_positive_number', sec) } });

const program = (blocks) => ({ blocks: { languageVersion: 0, blocks: [chain([{ type: 'flipperevents_whenProgramStarts', x: 40, y: 40 }, pair(), ...blocks])] } });

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

/** The demo robot: the Advanced Driving Base with a front tool (the Rake, or LEGO's Lift Arm) and LEGO's Dozer Blade. */
export function demoBuild(front = 'rake') {
  const pick = (id) => TOOL_PRESETS.advanced.find((t) => t.id === id).ldr;
  const label = front === 'rake' ? 'the Rake' : 'LEGO\'s Lift Arm';
  return normalizeBuild({ ...PRESETS.advanced, preset: null, name: `Advanced Driving Base with ${label} and the Dozer Blade`,
    attachment: { module: 'custom', ldr: `0 ${label} and Dozer Blade\n` + pick(front) + pick('dozer'), stops: { D: front === 'rake' ? [-328, 45] : [-264, 32], C: [-328, 58] } } });
}

export const demoProgram = (demo) => program(demo.blocks);
