// The Training Camp 1 program (from the SPIKE lesson) as a Blockly workspace state. Loaded on first visit.
const num = (type, v) => ({ shadow: { type, fields: { NUM: v } } });
const sel = (type, value) => ({ shadow: { type, fields: { ['field_' + type]: value } } });
function chain(list) {
  for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] };
  return list[0];
}

const stack1 = chain([
  { type: 'flipperevents_whenProgramStarts', x: 40, y: 40 },
  { type: 'flippermove_setMovementPair', inputs: { PAIR: sel('flippermove_movement-port-selector', 'CD') } },
  { type: 'flippermove_movementSpeed', inputs: { SPEED: num('math_number', 50) } },
  { type: 'flippermove_setDistance', fields: { UNIT: 'cm' }, inputs: { DISTANCE: sel('flippermove_custom-set-move-distance-number', 17.5) } },
]);

const stack2 = chain([
  { type: 'flipperevents_whenProgramStarts', x: 40, y: 300 },
  { type: 'control_wait', inputs: { DURATION: num('math_positive_number', 1) } },
  { type: 'flippersensors_resetYaw' },
  { type: 'flippermove_startSteer', inputs: { STEERING: sel('flippermove_rotation-wheel', 100) } },
  { type: 'control_wait_until', inputs: { CONDITION: { block: {
    type: 'operator_gt',
    inputs: {
      OPERAND1: { shadow: { type: 'text', fields: { TEXT: '' } }, block: { type: 'flippersensors_orientationAxis', fields: { AXIS: 'yaw' } } },
      OPERAND2: { shadow: { type: 'text', fields: { TEXT: '89' } } },
    },
  } } } },
  { type: 'flippermove_stopMove' },
]);

const stack3 = chain([
  { type: 'flipperevents_whenButton', x: 40, y: 640, fields: { BUTTON: 'left', EVENT: 'pressed' } },
  { type: 'control_wait', inputs: { DURATION: num('math_positive_number', 1) } },
  { type: 'flippermove_move', fields: { UNIT: 'cm' }, inputs: { DIRECTION: sel('flippermove_custom-icon-direction', 'forward'), VALUE: num('math_number', 20) } },
  { type: 'flippermove_move', fields: { UNIT: 'cm' }, inputs: { DIRECTION: sel('flippermove_custom-icon-direction', 'back'), VALUE: num('math_number', 20) } },
]);

const stack4 = chain([
  { type: 'flipperevents_whenButton', x: 40, y: 900, fields: { BUTTON: 'right', EVENT: 'pressed' } },
  { type: 'control_wait', inputs: { DURATION: num('math_positive_number', 1) } },
  { type: 'flippermove_steer', fields: { UNIT: 'rotations' }, inputs: { STEERING: sel('flippermove_rotation-wheel', -40), VALUE: num('math_number', 20) } },
]);

export const SAMPLE_NAME = 'Training Camp 1';
export const SAMPLE_STATE = { blocks: { languageVersion: 0, blocks: [stack1, stack2, stack3, stack4] } };

export function emptyState() {
  return { blocks: { languageVersion: 0, blocks: [{ type: 'flipperevents_whenProgramStarts', x: 40, y: 40 }] } };
}
