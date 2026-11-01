// Block specification shared by the Blockly editor, the interpreter and the .llsp3 exporter/importer.
// Opcodes, input names, field names and selector (shadow menu) block types mirror the real
// LEGO Education SPIKE App 3 "Word Blocks" project.json exactly, so exported files open in the app.

const PORT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const PORTS = PORT_LETTERS.map((p) => [p, p]);
export const PAIRS = [];
for (const a of PORT_LETTERS) for (const b of PORT_LETTERS) if (a !== b) PAIRS.push([`${a}+${b}`, a + b]);

// SPIKE color codes (ColorFieldOption) as the app stores them.
export const COLORS = [
  { code: '9', name: 'red', hex: '#E3000B' },
  { code: '7', name: 'yellow', hex: '#FFD500' },
  { code: '6', name: 'green', hex: '#00A845' },
  { code: '4', name: 'azure', hex: '#2EB9E8' },
  { code: '3', name: 'blue', hex: '#0B5FC4' },
  { code: '1', name: 'magenta', hex: '#E6007E' },
  { code: '0', name: 'black', hex: '#1A1A1A' },
  { code: '10', name: 'white', hex: '#FFFFFF' },
  { code: '-1', name: 'none', hex: null },
];
export const COLOR_BY_CODE = Object.fromEntries(COLORS.map((c) => [c.code, c]));
export const COLOR_BY_NAME = Object.fromEntries(COLORS.map((c) => [c.name, c]));

function swatch(hex) {
  const body = hex
    ? `<circle cx="12" cy="12" r="9" fill="${hex}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>`
    : `<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"/>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`);
}
export const COLOR_OPTIONS = COLORS.map((c) => [{ src: swatch(c.hex), width: 22, height: 22, alt: c.name }, c.code]);

// Category badges at the left of each block, like the SPIKE app: a circle in the category's dark shade with a
// white glyph (motor face, hub, lens, speaker, play).
const GLYPHS = {
  movement: '<circle cx="12" cy="12" r="8.2" fill="#fff"/><circle cx="12" cy="12" r="2" fill="BADGE"/>' + [0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${(12 + 5.2 * Math.sin(a * Math.PI / 180)).toFixed(2)}" cy="${(12 - 5.2 * Math.cos(a * Math.PI / 180)).toFixed(2)}" r="1.5" fill="BADGE"/>`).join(''),
  light: '<rect x="6.5" y="4.5" width="11" height="15" rx="2.2" fill="#fff"/><g fill="BADGE"><rect x="8.5" y="6.5" width="2" height="2"/><rect x="11" y="6.5" width="2" height="2"/><rect x="13.5" y="6.5" width="2" height="2"/><rect x="8.5" y="9" width="2" height="2"/><rect x="11" y="9" width="2" height="2"/><rect x="13.5" y="9" width="2" height="2"/><rect x="8.5" y="11.5" width="2" height="2"/><rect x="11" y="11.5" width="2" height="2"/><rect x="13.5" y="11.5" width="2" height="2"/><circle cx="12" cy="16.6" r="1.3"/></g>',
  sound: '<path d="M6 9.5h3.5L14 6v12l-4.5-3.5H6z" fill="#fff"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M18.3 7.2a6.5 6.5 0 0 1 0 9.6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  sensor: '<circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="#fff"/>',
  play: '<path d="M9 7l8 5-8 5z" fill="#fff"/>',
};
GLYPHS.motor = GLYPHS.movement;
GLYPHS.hub = GLYPHS.light;
export function iconFor(name, color) {
  const glyph = (GLYPHS[name] || '').replace(/BADGE/g, color);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${color}"/>${glyph}</svg>`);
}
export const ICONS = Object.fromEntries(Object.keys(GLYPHS).map((k) => [k, iconFor(k, '#444')]));   // legacy lookup

export const CATEGORIES = {
  movement: { name: 'Movement', color: '#FF4FA8', secondary: '#E93A95', tertiary: '#C72A7E', icon: 'movement' },
  motors: { name: 'Motors', color: '#0A8DFF', secondary: '#0577DB', tertiary: '#0463B8', icon: 'motor' },
  light: { name: 'Light', color: '#A05CFF', secondary: '#8C45EE', tertiary: '#7536CC', icon: 'light' },
  sound: { name: 'Sound', color: '#D65CD6', secondary: '#C044C0', tertiary: '#A133A1', icon: 'sound' },
  events: { name: 'Events', color: '#FFBF00', secondary: '#E8AA00', tertiary: '#C99300', icon: 'hub' },
  control: { name: 'Control', color: '#FFA51F', secondary: '#EE9108', tertiary: '#CC7A00', icon: null },
  sensors: { name: 'Sensors', color: '#3DB7E8', secondary: '#2AA3D6', tertiary: '#1C89B8', icon: 'sensor' },
  operators: { name: 'Operators', color: '#2FC25B', secondary: '#26AC4E', tertiary: '#1E8F40', icon: null },
  variables: { name: 'Variables', color: '#FF8C1A', secondary: '#F07C08', tertiary: '#D06A00', icon: null },
  myblocks: { name: 'My Blocks', color: '#FF6680', secondary: '#F04F6C', tertiary: '#D03A58', icon: null },
};

// Selector shadow blocks ("menus"). Field name is always `field_<type>`, as in the SPIKE project files.
export const SELECTORS = {
  'flippermove_custom-icon-direction': { cat: 'movement', options: [['↑', 'forward'], ['↓', 'back']] },
  'flippermove_movement-port-selector': { cat: 'movement', options: PAIRS },
  'flippermove_rotation-wheel': { cat: 'movement', field: 'steering' },
  'flippermove_custom-set-move-distance-number': { cat: 'movement', field: 'number', min: 0.1 },
  'flippermotor_multiple-port-selector': { cat: 'motors', options: PORTS },
  'flippermotor_single-motor-selector': { cat: 'motors', options: PORTS },
  'flippermotor_custom-icon-direction': { cat: 'motors', options: [['↻', 'clockwise'], ['↺', 'counterclockwise']] },
  'flipperlight_matrix-5x5-brightness-image': { cat: 'light', field: 'matrix' },
  'flipperlight_color-selector-vertical': { cat: 'light', options: COLOR_OPTIONS.filter((o) => o[1] !== '-1') },
  'flippersound_custom-piano': { cat: 'sound', field: 'number', min: 24, max: 108 },
  'flipperevents_color-sensor-selector': { cat: 'events', options: PORTS },
  'flipperevents_distance-sensor-selector': { cat: 'events', options: PORTS },
  'flipperevents_color-selector': { cat: 'events', options: COLOR_OPTIONS },
  'flippersensors_color-sensor-selector': { cat: 'sensors', options: PORTS },
  'flippersensors_distance-sensor-selector': { cat: 'sensors', options: PORTS },
  'flippersensors_color-selector': { cat: 'sensors', options: COLOR_OPTIONS },
};

const MOVE_UNITS = [['rotations', 'rotations'], ['degrees', 'degrees'], ['seconds', 'seconds'], ['cm', 'cm'], ['in', 'inches']];
const MOTOR_UNITS = [['rotations', 'rotations'], ['degrees', 'degrees'], ['seconds', 'seconds']];
const DIST_UNITS = [['%', '%'], ['cm', 'cm'], ['in', 'inches']];
const DIST_CMP = [['closer than', '<'], ['exactly at', '='], ['further than', '>']];
const CMP = [['<', '<'], ['=', '='], ['>', '>']];
const SMILEY = '9909999099000009000909990';

// Argument kinds: num/posnum/whole/text (primitive shadows), bool (hexagonal input), stack (statement input),
// sel (selector shadow block), field (dropdown on the block itself), var (variable field).
const sel = (n, s, d) => ({ n, k: 'sel', sel: s, d });
const num = (n, d) => ({ n, k: 'num', d });
const field = (n, options, d) => ({ n, k: 'field', options, d: d ?? options[0][1] });

export const BLOCKS = [
  // ---- Movement ----
  { op: 'flippermove_move', cat: 'movement', kind: 'stack', msg: 'move %DIRECTION for %VALUE %UNIT',
    args: [sel('DIRECTION', 'flippermove_custom-icon-direction', 'forward'), num('VALUE', 10), field('UNIT', MOVE_UNITS, 'rotations')] },
  { op: 'flippermove_steer', cat: 'movement', kind: 'stack', msg: 'move %STEERING for %VALUE %UNIT',
    args: [sel('STEERING', 'flippermove_rotation-wheel', 30), num('VALUE', 10), field('UNIT', MOVE_UNITS, 'rotations')] },
  { op: 'flippermove_startMove', cat: 'movement', kind: 'stack', msg: 'start moving %DIRECTION',
    args: [sel('DIRECTION', 'flippermove_custom-icon-direction', 'forward')] },
  { op: 'flippermove_startSteer', cat: 'movement', kind: 'stack', msg: 'start moving %STEERING',
    args: [sel('STEERING', 'flippermove_rotation-wheel', 30)] },
  { op: 'flippermove_stopMove', cat: 'movement', kind: 'stack', msg: 'stop moving', args: [] },
  { op: 'flippermove_movementSpeed', cat: 'movement', kind: 'stack', msg: 'set movement speed to %SPEED %%', args: [num('SPEED', 50)] },
  { op: 'flippermove_setMovementPair', cat: 'movement', kind: 'stack', msg: 'set movement motors to %PAIR',
    args: [sel('PAIR', 'flippermove_movement-port-selector', 'AB')] },
  { op: 'flippermove_setDistance', cat: 'movement', kind: 'stack', msg: 'set 1 motor rotation to %DISTANCE %UNIT moved',
    args: [sel('DISTANCE', 'flippermove_custom-set-move-distance-number', 17.5), field('UNIT', [['cm', 'cm'], ['in', 'inches']], 'cm')] },
  { op: 'flippermoremove_startDualSpeed', cat: 'movement', kind: 'stack', msg: 'start moving at %LEFT %RIGHT %% speed',
    args: [num('LEFT', 50), num('RIGHT', 50)], ext: 'flippermoremove' },

  // ---- Motors ----
  { op: 'flippermotor_motorTurnForDirection', cat: 'motors', kind: 'stack', msg: '%PORT run %DIRECTION for %VALUE %UNIT',
    args: [sel('PORT', 'flippermotor_multiple-port-selector', 'A'), sel('DIRECTION', 'flippermotor_custom-icon-direction', 'clockwise'), num('VALUE', 1), field('UNIT', MOTOR_UNITS, 'rotations')] },
  { op: 'flippermotor_motorStartDirection', cat: 'motors', kind: 'stack', msg: '%PORT start motor %DIRECTION',
    args: [sel('PORT', 'flippermotor_multiple-port-selector', 'A'), sel('DIRECTION', 'flippermotor_custom-icon-direction', 'clockwise')] },
  { op: 'flippermotor_motorStop', cat: 'motors', kind: 'stack', msg: '%PORT stop motor', args: [sel('PORT', 'flippermotor_multiple-port-selector', 'A')] },
  { op: 'flippermotor_motorSetSpeed', cat: 'motors', kind: 'stack', msg: '%PORT set speed to %SPEED %%',
    args: [sel('PORT', 'flippermotor_multiple-port-selector', 'A'), num('SPEED', 75)] },
  { op: 'flippermotor_absolutePosition', cat: 'motors', kind: 'reporter', msg: '%PORT position', args: [sel('PORT', 'flippermotor_single-motor-selector', 'A')] },
  { op: 'flippermotor_speed', cat: 'motors', kind: 'reporter', msg: '%PORT speed', args: [sel('PORT', 'flippermotor_single-motor-selector', 'A')] },

  // ---- Light ----
  { op: 'flipperlight_lightDisplayImageOnForTime', cat: 'light', kind: 'stack', msg: 'turn on %MATRIX for %VALUE seconds',
    args: [sel('MATRIX', 'flipperlight_matrix-5x5-brightness-image', SMILEY), num('VALUE', 2)] },
  { op: 'flipperlight_lightDisplayImageOn', cat: 'light', kind: 'stack', msg: 'turn on %MATRIX',
    args: [sel('MATRIX', 'flipperlight_matrix-5x5-brightness-image', SMILEY)] },
  { op: 'flipperlight_lightDisplayText', cat: 'light', kind: 'stack', msg: 'write %TEXT', args: [{ n: 'TEXT', k: 'text', d: 'Hello' }] },
  { op: 'flipperlight_lightDisplayOff', cat: 'light', kind: 'stack', msg: 'turn off pixels', args: [] },
  { op: 'flipperlight_centerButtonLight', cat: 'light', kind: 'stack', msg: 'set center button light to %COLOR',
    args: [sel('COLOR', 'flipperlight_color-selector-vertical', '3')] },

  // ---- Sound ----
  { op: 'flippersound_beepForTime', cat: 'sound', kind: 'stack', msg: 'play beep %NOTE for %DURATION seconds',
    args: [sel('NOTE', 'flippersound_custom-piano', 60), num('DURATION', 0.2)] },
  { op: 'flippersound_beep', cat: 'sound', kind: 'stack', msg: 'start playing beep %NOTE', args: [sel('NOTE', 'flippersound_custom-piano', 60)] },
  { op: 'flippersound_stopSound', cat: 'sound', kind: 'stack', msg: 'stop all sounds', args: [] },

  // ---- Events ----
  { op: 'flipperevents_whenProgramStarts', cat: 'events', kind: 'hat', icon: 'play', msg: 'when program starts', args: [] },
  { op: 'flipperevents_whenButton', cat: 'events', kind: 'hat', msg: 'when %BUTTON button %EVENT',
    args: [field('BUTTON', [['left', 'left'], ['right', 'right']], 'left'), field('EVENT', [['pressed', 'pressed'], ['released', 'released']], 'pressed')] },
  { op: 'flipperevents_whenColor', cat: 'events', kind: 'hat', msg: '%PORT when color is %OPTION',
    args: [sel('PORT', 'flipperevents_color-sensor-selector', 'A'), sel('OPTION', 'flipperevents_color-selector', '9')] },
  { op: 'flipperevents_whenDistance', cat: 'events', kind: 'hat', msg: '%PORT when %COMPARATOR %VALUE %UNIT',
    args: [sel('PORT', 'flipperevents_distance-sensor-selector', 'A'), field('COMPARATOR', DIST_CMP, '<'), num('VALUE', 15), field('UNIT', DIST_UNITS, 'cm')] },
  { op: 'flipperevents_whenCondition', cat: 'events', kind: 'hat', msg: 'when %CONDITION', args: [{ n: 'CONDITION', k: 'bool' }] },
  { op: 'flipperevents_whenTimer', cat: 'events', kind: 'hat', msg: 'when timer > %VALUE', args: [num('VALUE', 5)] },

  // ---- Control ----
  { op: 'control_wait', cat: 'control', kind: 'stack', msg: 'wait %DURATION seconds', args: [{ n: 'DURATION', k: 'posnum', d: 1 }] },
  { op: 'control_repeat', cat: 'control', kind: 'stack', msg: 'repeat %TIMES %SUBSTACK', args: [{ n: 'TIMES', k: 'whole', d: 10 }, { n: 'SUBSTACK', k: 'stack' }] },
  { op: 'control_forever', cat: 'control', kind: 'cap', msg: 'forever %SUBSTACK', args: [{ n: 'SUBSTACK', k: 'stack' }] },
  { op: 'control_if', cat: 'control', kind: 'stack', msg: 'if %CONDITION then %SUBSTACK', args: [{ n: 'CONDITION', k: 'bool' }, { n: 'SUBSTACK', k: 'stack' }] },
  { op: 'control_if_else', cat: 'control', kind: 'stack', msg: 'if %CONDITION then %SUBSTACK else %SUBSTACK2',
    args: [{ n: 'CONDITION', k: 'bool' }, { n: 'SUBSTACK', k: 'stack' }, { n: 'SUBSTACK2', k: 'stack' }] },
  { op: 'control_wait_until', cat: 'control', kind: 'stack', msg: 'wait until %CONDITION', args: [{ n: 'CONDITION', k: 'bool' }] },
  { op: 'control_repeat_until', cat: 'control', kind: 'stack', msg: 'repeat until %CONDITION %SUBSTACK', args: [{ n: 'CONDITION', k: 'bool' }, { n: 'SUBSTACK', k: 'stack' }] },
  { op: 'flippercontrol_stop', cat: 'control', kind: 'cap', msg: 'stop %STOP_OPTION',
    args: [field('STOP_OPTION', [['all', 'all'], ['this stack', 'this stack'], ['other stacks', 'other stacks'], ['and exit program', 'program']], 'all')], ext: 'flippercontrol' },

  // ---- Sensors ----
  { op: 'flippersensors_isColor', cat: 'sensors', kind: 'boolean', msg: '%PORT is color %VALUE ?',
    args: [sel('PORT', 'flippersensors_color-sensor-selector', 'A'), sel('VALUE', 'flippersensors_color-selector', '9')] },
  { op: 'flippersensors_color', cat: 'sensors', kind: 'reporter', msg: '%PORT color', args: [sel('PORT', 'flippersensors_color-sensor-selector', 'A')] },
  { op: 'flippersensors_isReflectivity', cat: 'sensors', kind: 'boolean', msg: '%PORT reflection %COMPARATOR %VALUE %% ?',
    args: [sel('PORT', 'flippersensors_color-sensor-selector', 'A'), field('COMPARATOR', CMP, '<'), num('VALUE', 50)] },
  { op: 'flippersensors_reflectivity', cat: 'sensors', kind: 'reporter', msg: '%PORT reflected light', args: [sel('PORT', 'flippersensors_color-sensor-selector', 'A')] },
  { op: 'flippersensors_isDistance', cat: 'sensors', kind: 'boolean', msg: '%PORT is %COMPARATOR %VALUE %UNIT ?',
    args: [sel('PORT', 'flippersensors_distance-sensor-selector', 'A'), field('COMPARATOR', DIST_CMP, '<'), num('VALUE', 15), field('UNIT', DIST_UNITS, 'cm')] },
  { op: 'flippersensors_distance', cat: 'sensors', kind: 'reporter', msg: '%PORT distance in %UNIT',
    args: [sel('PORT', 'flippersensors_distance-sensor-selector', 'A'), field('UNIT', DIST_UNITS, 'cm')] },
  { op: 'flippersensors_buttonIsPressed', cat: 'sensors', kind: 'boolean', msg: 'is %BUTTON button %EVENT ?',
    args: [field('BUTTON', [['left', 'left'], ['right', 'right']], 'left'), field('EVENT', [['pressed', 'pressed'], ['released', 'released']], 'pressed')] },
  { op: 'flippersensors_orientationAxis', cat: 'sensors', kind: 'reporter', msg: '%AXIS angle',
    args: [field('AXIS', [['pitch', 'pitch'], ['roll', 'roll'], ['yaw', 'yaw']], 'pitch')] },
  { op: 'flippersensors_resetYaw', cat: 'sensors', kind: 'stack', msg: 'set yaw angle to 0', args: [] },
  { op: 'flippersensors_timer', cat: 'sensors', kind: 'reporter', msg: 'timer', args: [] },
  { op: 'flippersensors_resetTimer', cat: 'sensors', kind: 'stack', msg: 'reset timer', args: [] },

  // ---- Operators ----
  { op: 'operator_add', cat: 'operators', kind: 'reporter', msg: '%NUM1 + %NUM2', args: [num('NUM1', ''), num('NUM2', '')], noicon: true },
  { op: 'operator_subtract', cat: 'operators', kind: 'reporter', msg: '%NUM1 - %NUM2', args: [num('NUM1', ''), num('NUM2', '')] },
  { op: 'operator_multiply', cat: 'operators', kind: 'reporter', msg: '%NUM1 * %NUM2', args: [num('NUM1', ''), num('NUM2', '')] },
  { op: 'operator_divide', cat: 'operators', kind: 'reporter', msg: '%NUM1 / %NUM2', args: [num('NUM1', ''), num('NUM2', '')] },
  { op: 'operator_random', cat: 'operators', kind: 'reporter', msg: 'pick random %FROM to %TO', args: [num('FROM', 1), num('TO', 10)] },
  { op: 'operator_gt', cat: 'operators', kind: 'boolean', msg: '%OPERAND1 > %OPERAND2', args: [{ n: 'OPERAND1', k: 'text', d: '' }, { n: 'OPERAND2', k: 'text', d: '50' }] },
  { op: 'operator_lt', cat: 'operators', kind: 'boolean', msg: '%OPERAND1 < %OPERAND2', args: [{ n: 'OPERAND1', k: 'text', d: '' }, { n: 'OPERAND2', k: 'text', d: '50' }] },
  { op: 'operator_equals', cat: 'operators', kind: 'boolean', msg: '%OPERAND1 = %OPERAND2', args: [{ n: 'OPERAND1', k: 'text', d: '' }, { n: 'OPERAND2', k: 'text', d: '50' }] },
  { op: 'operator_and', cat: 'operators', kind: 'boolean', msg: '%OPERAND1 and %OPERAND2', args: [{ n: 'OPERAND1', k: 'bool' }, { n: 'OPERAND2', k: 'bool' }] },
  { op: 'operator_or', cat: 'operators', kind: 'boolean', msg: '%OPERAND1 or %OPERAND2', args: [{ n: 'OPERAND1', k: 'bool' }, { n: 'OPERAND2', k: 'bool' }] },
  { op: 'operator_not', cat: 'operators', kind: 'boolean', msg: 'not %OPERAND', args: [{ n: 'OPERAND', k: 'bool' }] },
  { op: 'operator_join', cat: 'operators', kind: 'reporter', msg: 'join %STRING1 %STRING2', args: [{ n: 'STRING1', k: 'text', d: 'apple ' }, { n: 'STRING2', k: 'text', d: 'banana' }] },
  { op: 'operator_mod', cat: 'operators', kind: 'reporter', msg: '%NUM1 mod %NUM2', args: [num('NUM1', ''), num('NUM2', '')] },
  { op: 'operator_round', cat: 'operators', kind: 'reporter', msg: 'round %NUM', args: [num('NUM', '')] },
  { op: 'operator_mathop', cat: 'operators', kind: 'reporter', msg: '%OPERATOR of %NUM',
    args: [field('OPERATOR', ['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^'].map((o) => [o, o]), 'abs'), num('NUM', '')] },

  // ---- Variables ----
  { op: 'data_setvariableto', cat: 'variables', kind: 'stack', msg: 'set %VARIABLE to %VALUE', args: [{ n: 'VARIABLE', k: 'var' }, { n: 'VALUE', k: 'text', d: '0' }] },
  { op: 'data_changevariableby', cat: 'variables', kind: 'stack', msg: 'change %VARIABLE by %VALUE', args: [{ n: 'VARIABLE', k: 'var' }, num('VALUE', 1)] },
  { op: 'data_variable', cat: 'variables', kind: 'reporter', msg: '%VARIABLE', args: [{ n: 'VARIABLE', k: 'var' }] },
];

export const BLOCK_BY_OP = Object.fromEntries(BLOCKS.map((b) => [b.op, b]));

// Primitive shadow block types <-> Scratch 3 inline primitive codes.
export const PRIMITIVES = {
  math_number: { code: 4, field: 'NUM' },
  math_positive_number: { code: 5, field: 'NUM' },
  math_whole_number: { code: 6, field: 'NUM' },
  text: { code: 10, field: 'TEXT' },
};
export const PRIMITIVE_BY_CODE = { 4: 'math_number', 5: 'math_positive_number', 6: 'math_whole_number', 7: 'math_number', 8: 'math_number', 10: 'text' };
export const KIND_SHADOW = { num: 'math_number', posnum: 'math_positive_number', whole: 'math_whole_number', text: 'text' };

// Extension ids as the app lists them in manifest.json / project.json.
export function extensionOf(opcode) {
  const spec = BLOCK_BY_OP[opcode];
  if (spec && spec.ext) return spec.ext;
  const ns = opcode.split('_')[0];
  return ns.startsWith('flipper') ? ns : null;
}

// Scratch procedure ("My Blocks") opcodes handled by js/myblocks.js rather than the BLOCKS table.
export const PROCEDURE_OPS = new Set(['procedures_definition', 'procedures_prototype', 'procedures_call', 'argument_reporter_string_number', 'argument_reporter_boolean']);
