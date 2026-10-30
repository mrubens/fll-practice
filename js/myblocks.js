// "My Blocks": Scratch procedures (procedures_definition / procedures_prototype / procedures_call and
// argument reporters) with the same proccode / argumentids / argumentnames / argumentdefaults / warp
// mutations the SPIKE App writes, so they round-trip through .llsp3 files.
const B = window.Blockly;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const argId = () => Array.from({ length: 20 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');

/** Split a proccode like "Mission 1 %s %b" into label and argument tokens. */
export function parseProccode(proccode) {
  const tokens = [];
  let label = '';
  const parts = String(proccode || '').split(/(%[sbn])/);
  for (const part of parts) {
    if (part === '%s' || part === '%n' || part === '%b') {
      if (label.trim()) tokens.push({ type: 'label', text: label.trim() });
      label = '';
      tokens.push({ type: 'arg', kind: part === '%b' ? 'b' : 's' });
    } else label += part;
  }
  if (label.trim()) tokens.push({ type: 'label', text: label.trim() });
  return tokens;
}

export function argKinds(proccode) {
  return parseProccode(proccode).filter((t) => t.type === 'arg').map((t) => t.kind);
}

export function normalizeProc(s) {
  const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim().startsWith('[') ? JSON.parse(v) : []);
  return {
    proccode: String(s && s.proccode || ''),
    argumentids: asList(s && s.argumentids).map(String),
    argumentnames: asList(s && s.argumentnames).map(String),
    argumentdefaults: asList(s && s.argumentdefaults).map(String),
    warp: s && (s.warp === true || s.warp === 'true') ? 'true' : 'false',
  };
}

/** The mutation object as it appears in project.json. */
export function mutationFor(block) {
  const p = block.proc_ || normalizeProc(null);
  const m = { tagName: 'mutation', children: [], proccode: p.proccode, argumentids: JSON.stringify(p.argumentids), warp: p.warp };
  if (block.type === 'procedures_prototype') {
    m.argumentnames = JSON.stringify(p.argumentnames);
    m.argumentdefaults = JSON.stringify(p.argumentdefaults);
  }
  return m;
}

function clearInputs(block) {
  for (const input of [...block.inputList]) block.removeInput(input.name, true);
}

function buildShape(block, { shadows }) {
  clearInputs(block);
  const p = block.proc_;
  const tokens = parseProccode(p.proccode);
  let argIndex = 0;
  if (!tokens.length) block.appendDummyInput('LABEL0').appendField('My Block');
  tokens.forEach((t, i) => {
    if (t.type === 'label') { block.appendDummyInput('LABEL' + i).appendField(t.text); return; }
    const id = p.argumentids[argIndex] || ('arg' + argIndex);
    const name = p.argumentnames[argIndex] || ('input ' + (argIndex + 1));
    const def = p.argumentdefaults[argIndex] ?? (t.kind === 'b' ? 'false' : '');
    const input = block.appendValueInput(id);
    if (t.kind === 'b') input.setCheck('Boolean');
    if (shadows === 'reporters') {
      input.connection.setShadowState({ type: t.kind === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number', fields: { VALUE: name } });
    } else if (shadows === 'defaults' && t.kind !== 'b') {
      input.connection.setShadowState({ type: 'text', fields: { TEXT: def } });
    }
    argIndex++;
  });
}

export function defineMyBlocks() {
  B.Blocks['procedures_definition'] = {
    init() {
      this.jsonInit({ message0: 'define %1', args0: [{ type: 'input_value', name: 'custom_block' }], nextStatement: null, style: 'myblocks_blocks', hat: 'cap', inputsInline: true, tooltip: 'Define a My Block' });
    },
  };
  B.Blocks['procedures_prototype'] = {
    init() {
      this.jsonInit({ output: null, style: 'myblocks_blocks', inputsInline: true });
      this.proc_ = normalizeProc(null);
      buildShape(this, { shadows: 'reporters' });
    },
    saveExtraState() { return { ...this.proc_ }; },
    loadExtraState(s) { this.proc_ = normalizeProc(s); buildShape(this, { shadows: 'reporters' }); },
  };
  B.Blocks['procedures_call'] = {
    init() {
      this.jsonInit({ previousStatement: null, nextStatement: null, style: 'myblocks_blocks', inputsInline: true, tooltip: 'Run a My Block' });
      this.proc_ = normalizeProc(null);
      buildShape(this, { shadows: 'defaults' });
    },
    saveExtraState() { return { proccode: this.proc_.proccode, argumentids: this.proc_.argumentids, warp: this.proc_.warp }; },
    loadExtraState(s) { this.proc_ = normalizeProc(s); buildShape(this, { shadows: 'defaults' }); },
  };
  B.defineBlocksWithJsonArray([
    { type: 'argument_reporter_string_number', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'VALUE', text: 'input' }], output: null, style: 'myblocks_blocks' },
    { type: 'argument_reporter_boolean', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'VALUE', text: 'input' }], output: 'Boolean', style: 'myblocks_blocks' },
  ]);
}

/** All My Block definitions in a workspace: [{block, proto, proc}]. */
export function definitions(workspace) {
  return workspace.getBlocksByType('procedures_definition', false).map((block) => {
    const proto = block.getInputTargetBlock('custom_block');
    return proto && proto.proc_ ? { block, proto, proc: proto.proc_ } : null;
  }).filter(Boolean);
}

export function findDefinition(workspace, proccode) {
  return definitions(workspace).find((d) => d.proc.proccode === proccode) || null;
}

function callState(proc) {
  const kinds = argKinds(proc.proccode);
  const inputs = {};
  proc.argumentids.forEach((id, i) => { if (kinds[i] !== 'b') inputs[id] = { shadow: { type: 'text', fields: { TEXT: proc.argumentdefaults[i] ?? '' } } }; });
  return { kind: 'block', type: 'procedures_call', extraState: { proccode: proc.proccode, argumentids: proc.argumentids, warp: proc.warp }, inputs };
}

export function registerMyBlocksCategory(workspace, openDialog) {
  workspace.registerToolboxCategoryCallback('SPIKE_MYBLOCKS', (ws) => {
    const items = [{ kind: 'button', text: 'Make a Block', callbackkey: 'SPIKE_MAKE_BLOCK' }];
    for (const d of definitions(ws)) {
      items.push(callState(d.proc));
      const kinds = argKinds(d.proc.proccode);
      d.proc.argumentnames.forEach((name, i) => items.push({ kind: 'block', type: kinds[i] === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number', fields: { VALUE: name } }));
    }
    return items;
  });
  workspace.registerButtonCallback('SPIKE_MAKE_BLOCK', (button) => openDialog(button.getTargetWorkspace()));
}

/** Create a definition in the workspace from a name and a parameter list [{name, kind:'s'|'b'}]. */
export function createDefinition(workspace, name, params) {
  const existing = new Set(definitions(workspace).map((d) => d.proc.proccode.split(' %')[0]));
  let base = name.trim().replace(/%/g, '') || 'My Block';
  let unique = base, n = 2;
  while (existing.has(unique)) unique = `${base} ${n++}`;
  const proc = {
    proccode: [unique, ...params.map((p) => (p.kind === 'b' ? '%b' : '%s'))].join(' '),
    argumentids: params.map(() => argId()),
    argumentnames: params.map((p) => p.name),
    argumentdefaults: params.map((p) => (p.kind === 'b' ? 'false' : '')),
    warp: 'false',
  };
  const protoInputs = {};
  proc.argumentids.forEach((id, i) => { protoInputs[id] = { shadow: { type: params[i].kind === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number', fields: { VALUE: proc.argumentnames[i] } } }; });
  // Place the new definition below everything that is already on the workspace.
  let bottom = 40, left = 40;
  for (const b of workspace.getTopBlocks(false)) {
    const xy = b.getRelativeToSurfaceXY();
    bottom = Math.max(bottom, xy.y + b.getHeightWidth().height + 40);
    left = Math.min(left, xy.x);
  }
  const state = {
    type: 'procedures_definition',
    x: left, y: bottom,
    inputs: { custom_block: { shadow: { type: 'procedures_prototype', extraState: proc, inputs: protoInputs } } },
  };
  const block = B.serialization.blocks.append(state, workspace);
  workspace.refreshToolboxSelection();
  return block;
}

/** The "Make a Block" dialog. Resolves to the created definition block, or null. */
export function makeBlockDialog(workspace) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'spike-modal-back';
    back.innerHTML = `<div class="spike-modal" role="dialog" aria-modal="true">
      <h3>Make a Block</h3>
      <input class="in" id="mbName" type="text" maxlength="40" placeholder="block name" autocomplete="off">
      <div class="mb-params"></div>
      <div class="mb-add"><button type="button" data-kind="s">+ number or text input</button><button type="button" data-kind="b">+ true/false input</button></div>
      <div class="btns"><button type="button" class="cancel">Cancel</button><button type="button" class="ok">OK</button></div>
    </div>`;
    const list = back.querySelector('.mb-params');
    const params = [];
    const render = () => {
      list.innerHTML = '';
      params.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'mb-param';
        row.innerHTML = `<span class="kind">${p.kind === 'b' ? 'true/false' : 'number/text'}</span><input type="text" maxlength="30" value=""><button type="button" class="del" aria-label="Remove input">&times;</button>`;
        const inp = row.querySelector('input');
        inp.value = p.name;
        inp.addEventListener('input', () => { p.name = inp.value; });
        row.querySelector('.del').addEventListener('click', () => { params.splice(i, 1); render(); });
        list.appendChild(row);
      });
    };
    back.querySelectorAll('.mb-add button').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.kind;
      params.push({ kind, name: kind === 'b' ? `condition ${params.filter((p) => p.kind === 'b').length + 1}` : `number ${params.filter((p) => p.kind === 's').length + 1}` });
      render();
      list.querySelector('.mb-param:last-child input').select();
    }));
    const done = (ok) => {
      const name = back.querySelector('#mbName').value.trim();
      back.remove();
      if (!ok || !name) return resolve(null);
      const clean = params.map((p, i) => ({ kind: p.kind, name: (p.name || '').trim() || `input ${i + 1}` }));
      resolve(createDefinition(workspace, name, clean));
    };
    back.querySelector('.ok').addEventListener('click', () => done(true));
    back.querySelector('.cancel').addEventListener('click', () => done(false));
    back.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'mbName') done(true); if (e.key === 'Escape') done(false); });
    document.body.appendChild(back);
    back.querySelector('#mbName').focus();
  });
}
