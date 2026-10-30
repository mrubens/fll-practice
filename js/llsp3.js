// Export/import of LEGO SPIKE App 3 Word Blocks project files (.llsp3).
// Container: zip { manifest.json, scratch.sb3, icon.svg }; scratch.sb3 is a zip { project.json, <empty>.svg }.
// Block shapes mirror files written by the SPIKE App itself.
import { BLOCK_BY_OP, SELECTORS, PRIMITIVES, PRIMITIVE_BY_CODE, PROCEDURE_OPS, extensionOf } from './spec.js';
import { mutationFor, normalizeProc } from './myblocks.js';

const B = window.Blockly;
const EMPTY_ASSET = 'd41d8cd98f00b204e9800998ecf8427e'; // md5 of an empty file, as the app uses
const VM_VERSION = '0.2.0-prerelease.20200512204241';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-!#$%()*+,.:;?[]^`{|}~';
const NANO_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const EXT_ORDER = ['flipperevents', 'flippermove', 'flippermotor', 'flippersensors', 'flipperlight', 'flippersound', 'flippermoremove', 'flippercontrol'];
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" rx="10" fill="#FFD500"/><rect x="14" y="10" width="32" height="40" rx="5" fill="#1E2430"/><g fill="#FFD500"><rect x="20" y="16" width="4" height="4"/><rect x="28" y="16" width="4" height="4"/><rect x="36" y="16" width="4" height="4"/><rect x="20" y="24" width="4" height="4"/><rect x="36" y="24" width="4" height="4"/><rect x="24" y="32" width="12" height="4"/></g><circle cx="30" cy="44" r="2.5" fill="#fff"/></svg>';

const randomId = (n, chars) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const sb3Id = () => randomId(20, ID_CHARS);
const nano = (n) => randomId(n, NANO_CHARS);

const varName = (v) => (typeof v.getName === 'function' ? v.getName() : v.name);

// ---------------- export ----------------

export function workspaceToProject(workspace) {
  const blocks = {};
  const variables = {};
  for (const v of workspace.getAllVariables()) variables[v.getId()] = [varName(v), 0];

  const fieldValue = (f) => {
    if (f instanceof B.FieldVariable) { const v = f.getVariable(); return [varName(v), v.getId()]; }
    return [String(f.getValue()), null];
  };

  const emitShadowState = (state, parentId) => {
    const prim = PRIMITIVES[state.type];
    const fields = state.fields || {};
    if (prim) return [prim.code, String(fields[prim.field] ?? '')];
    const id = sb3Id();
    const rec = { opcode: state.type, next: null, parent: parentId, inputs: {}, fields: {}, shadow: true, topLevel: false };
    for (const [name, value] of Object.entries(fields)) rec.fields[name] = [String(value), null];
    blocks[id] = rec;
    return id;
  };

  const emitValue = (block, parentId) => {
    const prim = PRIMITIVES[block.type];
    if (prim) return [prim.code, String(block.getFieldValue(prim.field) ?? '')];
    if (block.type === 'data_variable') { const v = block.getField('VARIABLE').getVariable(); return [12, varName(v), v.getId()]; }
    return emitBlock(block, parentId, false);
  };

  const emitBlock = (block, parentId, topLevel) => {
    const id = sb3Id();
    const rec = { opcode: block.type, next: null, parent: parentId, inputs: {}, fields: {}, shadow: block.isShadow(), topLevel };
    if (topLevel) { const xy = block.getRelativeToSurfaceXY(); rec.x = Math.round(xy.x); rec.y = Math.round(xy.y); }
    if (block.type === 'procedures_prototype' || block.type === 'procedures_call') rec.mutation = mutationFor(block);
    blocks[id] = rec;
    for (const input of block.inputList) {
      for (const f of input.fieldRow) {
        if (!f.name || f instanceof B.FieldImage || f instanceof B.FieldLabel) continue;
        rec.fields[f.name] = fieldValue(f);
      }
      if (!input.connection) continue;
      const target = input.connection.targetBlock();
      if (input.type === B.inputs.inputTypes.STATEMENT) {
        if (target) rec.inputs[input.name] = [2, emitBlock(target, id, false)];
      } else if (input.type === B.inputs.inputTypes.VALUE) {
        if (!target) continue;
        if (target.isShadow()) { rec.inputs[input.name] = [1, emitValue(target, id)]; continue; }
        const shadowState = input.connection.getShadowState ? input.connection.getShadowState() : null;
        const val = emitValue(target, id);
        rec.inputs[input.name] = shadowState ? [3, val, emitShadowState(shadowState, id)] : [2, val];
      }
    }
    const next = block.getNextBlock();
    if (next) rec.next = emitBlock(next, id, false);
    return id;
  };

  for (const top of workspace.getTopBlocks(true)) {
    if (top.isShadow()) continue;
    if (!BLOCK_BY_OP[top.type] && !PRIMITIVES[top.type] && !PROCEDURE_OPS.has(top.type)) continue;
    emitBlock(top, null, true);
  }

  const used = new Set();
  for (const rec of Object.values(blocks)) { const e = extensionOf(rec.opcode); if (e) used.add(e); }
  const extensions = EXT_ORDER.filter((e) => used.has(e)).concat([...used].filter((e) => !EXT_ORDER.includes(e)));

  const costume = (name, cx, cy) => ({ assetId: EMPTY_ASSET, name, bitmapResolution: 1, md5ext: EMPTY_ASSET + '.svg', dataFormat: 'svg', rotationCenterX: cx, rotationCenterY: cy });
  const project = {
    targets: [
      { isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
        costumes: [costume('backdrop1', 47, 55)], sounds: [], volume: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
      { isStage: false, name: nano(20), variables, lists: {}, broadcasts: {}, blocks, comments: {}, currentCostume: 0,
        costumes: [costume(nano(20), 240, 180)], sounds: [], volume: 100, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' },
    ],
    monitors: [],
    extensions,
    meta: { semver: '3.0.0', vm: VM_VERSION, agent: navigator.userAgent },
  };
  return { project, extensions };
}

export async function exportLlsp3(workspace, name) {
  const JSZip = window.JSZip;
  const { project, extensions } = workspaceToProject(workspace);
  const sb3 = new JSZip();
  sb3.file('project.json', JSON.stringify(project), { compression: 'DEFLATE' });
  sb3.file(EMPTY_ASSET + '.svg', '', { compression: 'STORE' });
  const sb3Data = await sb3.generateAsync({ type: 'uint8array' });
  const now = new Date().toISOString();
  const manifest = {
    type: 'word-blocks', autoDelete: false, created: now, id: nano(12), lastsaved: now, size: sb3Data.length,
    name: String(name || 'Project'), slotIndex: 0, workspaceX: 0, workspaceY: 0, zoomLevel: 0.675, showAllBlocks: false, version: 38,
    hardware: { [nano(20)]: { type: 'flipper' } },
    extensions,
    state: { playMode: 'download', canvasDrawerTab: 'monitorTab', canvasDrawerOpen: false, hasMonitors: false },
    extraFiles: [],
    lastConnectedHubType: 'flipper',
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest), { compression: 'DEFLATE' });
  zip.file('scratch.sb3', sb3Data, { compression: 'DEFLATE' });
  zip.file('icon.svg', ICON_SVG, { compression: 'DEFLATE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

// ---------------- import ----------------

export async function importLlsp3(data) {
  const JSZip = window.JSZip;
  const zip = await JSZip.loadAsync(data);
  const manifestFile = zip.file('manifest.json');
  const manifest = manifestFile ? JSON.parse(await manifestFile.async('string')) : {};
  const sb3File = zip.file('scratch.sb3');
  if (!sb3File) {
    if (manifest.type === 'python' || zip.file('projectbody.json')) throw new Error('This is a SPIKE Python project. Only Word Blocks projects can be opened here.');
    throw new Error('This file is not a SPIKE App 3 Word Blocks project.');
  }
  const sb3 = await JSZip.loadAsync(await sb3File.async('uint8array'));
  const project = JSON.parse(await sb3.file('project.json').async('string'));
  const warnings = [];
  const state = projectToState(project, warnings);
  return { name: manifest.name || 'Project', state, warnings };
}

export function projectToState(project, warnings = []) {
  const target = project.targets.find((t) => !t.isStage) || project.targets[0];
  const variables = [];
  for (const t of project.targets) for (const [id, v] of Object.entries(t.variables || {})) variables.push({ name: v[0], id, type: '' });
  const blocks = target.blocks || {};
  const seen = new Set();

  const dropped = (op) => { if (!seen.has(op)) { seen.add(op); warnings.push(`"${op}" is not supported here and was left out.`); } };

  const coerceField = (opcode, name, raw) => {
    const spec = BLOCK_BY_OP[opcode];
    const arg = spec && spec.args.find((a) => a.n === name && a.k === 'field');
    if (!arg) return String(raw);
    const s = String(raw);
    if (arg.options.some((o) => o[1] === s)) return s;
    const ci = arg.options.find((o) => String(o[1]).toLowerCase() === s.toLowerCase() || String(o[0]).toLowerCase() === s.toLowerCase());
    if (ci) return ci[1];
    warnings.push(`"${s}" is not an option for ${name} on ${opcode}; using "${arg.d}".`);
    return arg.d;
  };

  const steeringValue = (raw) => {
    const v = String(raw ?? '').trim().toLowerCase();
    if (v === '' || v === 'straight') return 0;
    const right = /^right:?\s*(-?\d+(?:\.\d+)?)/.exec(v);
    if (right) return Number(right[1]);
    const left = /^left:?\s*(\d+(?:\.\d+)?)/.exec(v);
    if (left) return -Number(left[1]);
    return Number(v) || 0;
  };

  const convertShadow = (b, id) => {
    if (PROCEDURE_OPS.has(b.opcode)) return convertBlock(id);
    const prim = PRIMITIVES[b.opcode];
    if (prim) {
      const raw = (b.fields && b.fields[prim.field] && b.fields[prim.field][0]) ?? '';
      return { type: b.opcode, fields: { [prim.field]: b.opcode === 'text' ? String(raw) : Number(raw) || 0 } };
    }
    const sel = SELECTORS[b.opcode];
    if (!sel) { dropped(b.opcode); return null; }
    const fname = 'field_' + b.opcode;
    const raw = (b.fields && b.fields[fname] && b.fields[fname][0]) ?? '';
    let value;
    if (sel.field === 'steering') value = steeringValue(raw);
    else if (sel.field === 'number') value = Number(raw) || 0;
    else if (sel.field === 'matrix') value = String(raw);
    else {
      value = String(raw);
      if (!sel.options.some((o) => o[1] === value)) { warnings.push(`"${value}" is not an option for ${b.opcode}; using the first option.`); value = sel.options[0][1]; }
    }
    return { type: b.opcode, fields: { [fname]: value } };
  };

  const convertRef = (ref) => {
    if (ref === null || ref === undefined) return null;
    if (Array.isArray(ref)) {
      const code = ref[0];
      if (code === 12) return { type: 'data_variable', fields: { VARIABLE: { id: ref[2], name: ref[1], type: '' } } };
      const type = PRIMITIVE_BY_CODE[code];
      if (!type) { dropped('primitive type ' + code); return null; }
      return { type, fields: { [type === 'text' ? 'TEXT' : 'NUM']: type === 'text' ? String(ref[1] ?? '') : Number(ref[1]) || 0 } };
    }
    const b = blocks[ref];
    if (!b) return null;
    return b.shadow ? convertShadow(b, ref) : convertBlock(ref);
  };

  const convertBlock = (id) => {
    const b = blocks[id];
    if (!b) return null;
    if (!BLOCK_BY_OP[b.opcode] && !PROCEDURE_OPS.has(b.opcode)) {
      dropped(b.opcode);
      return b.next ? convertBlock(b.next) : null;
    }
    const s = { type: b.opcode, id: B.utils.idGenerator.genUid(), fields: {}, inputs: {} };
    if (b.mutation && (b.opcode === 'procedures_prototype' || b.opcode === 'procedures_call')) s.extraState = normalizeProc(b.mutation);
    if (b.topLevel) { s.x = Number(b.x) || 0; s.y = Number(b.y) || 0; }
    for (const [name, val] of Object.entries(b.fields || {})) {
      if (name === 'VARIABLE') s.fields[name] = { id: val[1], name: val[0], type: '' };
      else s.fields[name] = coerceField(b.opcode, name, val[0]);
    }
    for (const [name, inp] of Object.entries(b.inputs || {})) {
      if (!Array.isArray(inp)) continue;
      const [kind, a, c] = inp;
      if (name.startsWith('SUBSTACK')) {
        if (typeof a === 'string') { const sub = convertBlock(a); if (sub) s.inputs[name] = { block: sub }; }
        continue;
      }
      const entry = {};
      if (kind === 1) { const sh = convertRef(a); if (sh) entry.shadow = sh; }
      else if (kind === 2) { const bl = convertRef(a); if (bl) entry.block = bl; }
      else { const bl = convertRef(a); const sh = convertRef(c); if (bl) entry.block = bl; if (sh) entry.shadow = sh; }
      if (entry.shadow && (entry.shadow.type === 'data_variable')) { entry.block = entry.block || entry.shadow; delete entry.shadow; }
      if (Object.keys(entry).length) s.inputs[name] = entry;
    }
    if (b.next) { const n = convertBlock(b.next); if (n) s.next = { block: n }; }
    return s;
  };

  const tops = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (!b.topLevel || b.shadow) continue;
    const s = convertBlock(id);
    if (s) tops.push(s);
  }
  return { variables, blocks: { languageVersion: 0, blocks: tops } };
}
