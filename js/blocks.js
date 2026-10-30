// Blockly setup: SPIKE-style blocks (Zelos renderer), custom fields, theme, toolbox and dialogs.
import { BLOCKS, SELECTORS, CATEGORIES, ICONS, KIND_SHADOW } from './spec.js';
import { defineMyBlocks, registerMyBlocksCategory, makeBlockDialog } from './myblocks.js';

const B = window.Blockly;

// ---------- custom fields ----------

/** Steering value (-100..100) displayed as "left: 30" / "straight" / "right: 30" like the SPIKE wheel widget. */
class FieldSteering extends B.FieldNumber {
  constructor(value, validator) {
    super(value ?? 0, -100, 100, 1, validator);
  }
  static fromJson(options) {
    return new FieldSteering(options.value);
  }
  getText() {
    const v = Number(this.getValue()) || 0;
    if (v > 0) return `right: ${v}`;
    if (v < 0) return `left: ${v}`;
    return 'straight';
  }
}
B.fieldRegistry.register('field_steering', FieldSteering);

/** 5x5 LED image stored as a 25-character brightness string ("9" = on, "0" = off), as the SPIKE app stores it. */
class FieldMatrix extends B.Field {
  static CELL = 7;
  static GAP = 1.5;
  static PAD = 4;
  constructor(value, validator) {
    super(value ?? '0'.repeat(25), validator);
    this.SERIALIZABLE = true;
    this.CURSOR = 'pointer';
    this.cells_ = [];
  }
  static fromJson(options) {
    return new FieldMatrix(options.value);
  }
  doClassValidation_(v) {
    if (v === null || v === undefined) return null;
    let s = String(v).replace(/[^0-9]/g, '');
    return s.padEnd(25, '0').slice(0, 25);
  }
  initView() {
    this.createBorderRect_();
    const { CELL, GAP, PAD } = FieldMatrix;
    for (let i = 0; i < 25; i++) {
      const r = Math.floor(i / 5), c = i % 5;
      const rect = B.utils.dom.createSvgElement(B.utils.Svg.RECT, {
        x: PAD + c * (CELL + GAP), y: PAD + r * (CELL + GAP), width: CELL, height: CELL, rx: 1.5, ry: 1.5,
      }, this.fieldGroup_);
      this.cells_.push(rect);
    }
    this.updateCells_();
  }
  updateSize_() {
    const { CELL, GAP, PAD } = FieldMatrix;
    const w = PAD * 2 + 5 * CELL + 4 * GAP;
    this.size_.width = w;
    this.size_.height = w;
    if (this.borderRect_) {
      this.borderRect_.setAttribute('width', String(w));
      this.borderRect_.setAttribute('height', String(w));
    }
  }
  render_() {
    this.updateCells_();
    this.updateSize_();
  }
  updateCells_() {
    const v = this.getValue() || '';
    this.cells_.forEach((rect, i) => {
      const b = Number(v[i] || 0);
      rect.setAttribute('fill', b ? `rgba(255,255,255,${(0.4 + 0.6 * b / 9).toFixed(2)})` : 'rgba(0,0,0,0.28)');
    });
  }
  getText() {
    return 'image';
  }
  showEditor_() {
    const div = B.DropDownDiv.getContentDiv();
    div.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'spike-matrix-editor';
    const grid = document.createElement('div');
    grid.className = 'grid';
    const v = (this.getValue() || '0'.repeat(25)).split('');
    const cells = [];
    const paint = () => cells.forEach((cell, i) => cell.classList.toggle('on', v[i] !== '0'));
    for (let i = 0; i < 25; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.setAttribute('aria-label', `pixel ${i + 1}`);
      cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        v[i] = v[i] !== '0' ? '0' : '9';
        paint();
        this.setValue(v.join(''));
      });
      cells.push(cell);
      grid.appendChild(cell);
    }
    paint();
    const tools = document.createElement('div');
    tools.className = 'tools';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); paint(); this.setValue(v.join('')); });
      tools.appendChild(b);
    };
    mk('Clear', () => v.fill('0'));
    mk('Fill', () => v.fill('9'));
    mk('Smile', () => '9909999099000009000909990'.split('').forEach((c, i) => (v[i] = c)));
    mk('Heart', () => '0909099999999990999000900'.split('').forEach((c, i) => (v[i] = c)));
    wrap.appendChild(grid);
    wrap.appendChild(tools);
    div.appendChild(wrap);
    const block = this.getSourceBlock();
    B.DropDownDiv.setColour(block.getColour(), block.getColourTertiary ? block.getColourTertiary() : block.getColour());
    B.DropDownDiv.showPositionedByField(this);
  }
}
B.fieldRegistry.register('field_matrix', FieldMatrix);

// ---------- block definitions ----------

function argDef(arg) {
  switch (arg.k) {
    case 'num': case 'posnum': case 'whole': case 'text': case 'sel':
      return { type: 'input_value', name: arg.n };
    case 'bool':
      return { type: 'input_value', name: arg.n, check: 'Boolean' };
    case 'field':
      return { type: 'field_dropdown', name: arg.n, options: arg.options };
    case 'var':
      return { type: 'field_variable', name: arg.n, variable: 'my variable', variableTypes: [''], defaultType: '' };
    default:
      throw new Error('unknown arg kind ' + arg.k);
  }
}

function blockDef(spec) {
  const cat = CATEGORIES[spec.cat];
  const def = { type: spec.op, inputsInline: true, style: `${spec.cat}_blocks`, tooltip: spec.msg.replace(/%(\w+)/g, '…') };
  const messages = [];
  let msg = [], args = [];
  const flush = () => { if (msg.length || args.length) messages.push({ msg: msg.join(' '), args }); msg = []; args = []; };
  if (cat.icon && spec.kind !== 'reporter' && spec.kind !== 'boolean') {
    args.push({ type: 'field_image', src: ICONS[cat.icon], width: 24, height: 24, alt: '' });
    msg.push('%1');
  }
  for (const token of spec.msg.split(' ')) {
    if (token.startsWith('%') && token !== '%%') {
      const arg = spec.args.find((a) => a.n === token.slice(1));
      if (!arg) throw new Error(`missing arg ${token} in ${spec.op}`);
      if (arg.k === 'stack') {
        flush();
        messages.push({ msg: '%1', args: [{ type: 'input_statement', name: arg.n }] });
      } else {
        args.push(argDef(arg));
        msg.push('%' + args.length);
      }
    } else {
      msg.push(token);
    }
  }
  flush();
  messages.forEach((m, i) => { def['message' + i] = m.msg; def['args' + i] = m.args; });
  switch (spec.kind) {
    case 'stack': def.previousStatement = null; def.nextStatement = null; break;
    case 'cap': def.previousStatement = null; break;
    case 'hat': def.nextStatement = null; def.hat = 'cap'; break;
    case 'reporter': def.output = null; break;
    case 'boolean': def.output = 'Boolean'; break;
  }
  return def;
}

function selectorDef(type, s) {
  const field = 'field_' + type;
  let arg;
  if (s.field === 'steering') arg = { type: 'field_steering', name: field, value: 0 };
  else if (s.field === 'matrix') arg = { type: 'field_matrix', name: field, value: '0'.repeat(25) };
  else if (s.field === 'number') arg = { type: 'field_number', name: field, value: s.min ?? 0, min: s.min, max: s.max, precision: s.precision };
  else arg = { type: 'field_dropdown', name: field, options: s.options };
  return { type, message0: '%1', args0: [arg], output: 'String', style: `${s.cat}_blocks` };
}

export function defineBlocks() {
  const defs = [];
  for (const spec of BLOCKS) defs.push(blockDef(spec));
  for (const [type, s] of Object.entries(SELECTORS)) defs.push(selectorDef(type, s));
  // Scratch-style numeric shadows used by wait / repeat.
  defs.push({ type: 'math_positive_number', message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 1, min: 0 }], output: 'Number', style: 'math_blocks' });
  defs.push({ type: 'math_whole_number', message0: '%1', args0: [{ type: 'field_number', name: 'NUM', value: 10, min: 0, precision: 1 }], output: 'Number', style: 'math_blocks' });
  B.defineBlocksWithJsonArray(defs);
  defineMyBlocks();
}

// ---------- theme ----------

export function defineTheme() {
  const blockStyles = {}, categoryStyles = {};
  for (const [key, c] of Object.entries(CATEGORIES)) {
    blockStyles[`${key}_blocks`] = { colourPrimary: c.colour, colourSecondary: c.secondary, colourTertiary: c.tertiary };
    categoryStyles[`${key}_category`] = { colour: c.colour };
  }
  blockStyles.math_blocks = { colourPrimary: '#FFFFFF', colourSecondary: '#FFFFFF', colourTertiary: '#C8CDD6' };
  blockStyles.text_blocks = { colourPrimary: '#FFFFFF', colourSecondary: '#FFFFFF', colourTertiary: '#C8CDD6' };
  return B.Theme.defineTheme('spike', {
    base: B.Themes.Zelos,
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: '#F6F7FA',
      toolboxBackgroundColour: '#FFFFFF',
      toolboxForegroundColour: '#424A57',
      flyoutBackgroundColour: '#EEF1F6',
      flyoutForegroundColour: '#424A57',
      flyoutOpacity: 1,
      scrollbarColour: '#AEB5C2',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#1E2430',
      insertionMarkerOpacity: 0.25,
      cursorColour: '#1E2430',
    },
    fontStyle: { family: '"Nunito", "Helvetica Neue", Arial, sans-serif', weight: '700', size: 12 },
    startHats: true,
  });
}

// ---------- toolbox ----------

function shadowFor(arg) {
  if (arg.k === 'sel') {
    const s = SELECTORS[arg.sel];
    const value = s.field === 'number' || s.field === 'steering' ? Number(arg.d) : String(arg.d);
    return { type: arg.sel, fields: { ['field_' + arg.sel]: value } };
  }
  const type = KIND_SHADOW[arg.k];
  if (!type) return null;
  const fieldName = type === 'text' ? 'TEXT' : 'NUM';
  const value = type === 'text' ? String(arg.d ?? '') : (arg.d === '' ? 0 : Number(arg.d));
  return { type, fields: { [fieldName]: value } };
}

export function toolboxBlock(spec, overrides = {}) {
  const entry = { kind: 'block', type: spec.op, inputs: {}, fields: {} };
  for (const arg of spec.args) {
    if (arg.k === 'field') entry.fields[arg.n] = overrides.fields?.[arg.n] ?? arg.d;
    const shadow = shadowFor(arg);
    if (shadow) entry.inputs[arg.n] = { shadow };
  }
  Object.assign(entry.inputs, overrides.inputs || {});
  return entry;
}

const CATEGORY_ORDER = ['movement', 'motors', 'light', 'sound', 'events', 'control', 'sensors', 'operators', 'variables', 'myblocks'];

export function buildToolbox() {
  const contents = [];
  for (const key of CATEGORY_ORDER) {
    const cat = CATEGORIES[key];
    const category = { kind: 'category', name: cat.name, categorystyle: `${key}_category` };
    if (key === 'variables') {
      category.custom = 'SPIKE_VARIABLES';
    } else if (key === 'myblocks') {
      category.custom = 'SPIKE_MYBLOCKS';
    } else {
      category.contents = BLOCKS.filter((b) => b.cat === key).map((b) => toolboxBlock(b));
    }
    contents.push(category);
  }
  return { kind: 'categoryToolbox', contents };
}

/** Toolbox category rendered as a coloured dot with a label, like the SPIKE palette. */
class SpikeCategory extends B.ToolboxCategory {
  createIconDom_() {
    const dot = document.createElement('span');
    dot.className = 'spikeCatDot';
    return dot;
  }
  addColourBorder_(colour) {
    this.rowDiv_.style.borderLeft = 'none';
    const dot = this.rowDiv_.querySelector('.spikeCatDot');
    if (dot) dot.style.backgroundColor = colour;
  }
  setSelected(isSelected) {
    this.rowDiv_.classList.toggle('spikeSelected', !!isSelected);
    B.utils.aria.setState(this.htmlDiv_, B.utils.aria.State.SELECTED, !!isSelected);
  }
}
B.registry.register(B.registry.Type.TOOLBOX_ITEM, B.ToolboxCategory.registrationName, SpikeCategory, true);

function variableState(v) {
  return { id: v.getId(), name: typeof v.getName === 'function' ? v.getName() : v.name, type: '' };
}

function registerVariablesCategory(ws) {
  ws.registerToolboxCategoryCallback('SPIKE_VARIABLES', (workspace) => {
    const items = [{ kind: 'button', text: 'Make a Variable', callbackkey: 'SPIKE_CREATE_VARIABLE' }];
    const vars = workspace.getVariablesOfType('').map(variableState).sort((a, b) => a.name.localeCompare(b.name));
    for (const v of vars) items.push({ kind: 'block', type: 'data_variable', fields: { VARIABLE: v } });
    if (vars.length) {
      const v = vars[0];
      items.push({ kind: 'block', type: 'data_setvariableto', fields: { VARIABLE: v }, inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: '0' } } } } });
      items.push({ kind: 'block', type: 'data_changevariableby', fields: { VARIABLE: v }, inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } });
    }
    return items;
  });
  ws.registerButtonCallback('SPIKE_CREATE_VARIABLE', (button) => {
    B.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, '');
  });
}

// ---------- dialogs (Blockly prompt/confirm/alert replaced with an in-page modal) ----------

export function installDialogs() {
  const modal = (opts) => new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'spike-modal-back';
    back.innerHTML = `<div class="spike-modal" role="dialog" aria-modal="true">
      <p class="msg"></p>
      ${opts.input ? '<input class="in" type="text" autocomplete="off" maxlength="40">' : ''}
      <div class="btns">${opts.cancel ? '<button type="button" class="cancel">Cancel</button>' : ''}<button type="button" class="ok">OK</button></div>
    </div>`;
    back.querySelector('.msg').textContent = opts.message;
    const input = back.querySelector('.in');
    if (input) input.value = opts.defaultValue ?? '';
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector('.ok').addEventListener('click', () => done(input ? input.value : true));
    back.querySelector('.cancel')?.addEventListener('click', () => done(input ? null : false));
    back.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input ? input.value : true); if (e.key === 'Escape') done(input ? null : false); });
    document.body.appendChild(back);
    (input || back.querySelector('.ok')).focus();
    if (input) input.select();
  });
  B.dialog.setPrompt((message, defaultValue, callback) => modal({ message, defaultValue, input: true, cancel: true }).then(callback));
  B.dialog.setConfirm((message, callback) => modal({ message, cancel: true }).then(callback));
  B.dialog.setAlert((message, callback) => modal({ message }).then(() => callback && callback()));
  return modal;
}

// ---------- workspace ----------

export function createWorkspace(div, options = {}) {
  defineBlocks();
  const theme = defineTheme();
  const ws = B.inject(div, {
    toolbox: buildToolbox(),
    renderer: 'zelos',
    theme,
    media: options.media ?? 'media/',
    zoom: { controls: false, wheel: true, pinch: true, startScale: 0.7, maxScale: 1.4, minScale: 0.35, scaleSpeed: 1.15 },
    grid: { spacing: 28, length: 2, colour: '#DCE1EA', snap: false },
    trashcan: false,
    sounds: false,
    move: { scrollbars: { horizontal: true, vertical: true }, drag: true, wheel: false },
  });
  registerVariablesCategory(ws);
  registerMyBlocksCategory(ws, (w) => makeBlockDialog(w));
  return ws;
}

export { FieldSteering, FieldMatrix };
