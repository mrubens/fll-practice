// Wires the editor, the simulator, the hub panel, project storage and file import/export together.
import { createWorkspace, installDialogs } from './blocks.js';
import { World, MATCH_SECONDS } from './world.js';
import { Robot, PORT_LETTERS } from './robot.js';
import { Sim3D } from './sim3d.js';
import { HubPanel } from './hub.js';
import { Runtime } from './interpreter.js';
import { exportLlsp3, importLlsp3 } from './llsp3.js';
import { SAMPLE_STATE, SAMPLE_NAME, emptyState } from './sample.js';
import { compile as compilePython } from './python.js';
import { SpikeHub, isSupported as bleSupported } from './ble.js';

const B = window.Blockly;
const $ = (sel) => document.querySelector(sel);

// ---------- storage ----------
const STORE_KEY = 'spikesim.v1';
function loadStore() {
  try { return Object.assign({ projects: {}, current: null, config: null }, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
  catch { return { projects: {}, current: null, config: null }; }
}
function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } }
const store = loadStore();
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- toasts ----------
const toasts = $('#toasts');
const recent = new Map();
export function toast(msg, kind = 'info') {
  const now = Date.now();
  if (recent.get(msg) > now - 4000) return;
  recent.set(msg, now);
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 7000 : 4000);
}

// ---------- editor + sim ----------
const modal = installDialogs();
const workspace = createWorkspace($('#blocklyDiv'));
const world = new World();
const robot = new Robot(world);
if (store.config) Object.assign(robot.config, store.config);
const sim = new Sim3D($('#view3d'), world, robot);
const hub = new HubPanel($('#hubPanel'), robot);
const runtime = new Runtime({
  workspace, robot,
  onChange: () => updateRunState(),
  onLog: (m) => toast(m, 'warn'),
});
robot.on('hint', (m) => toast(m, 'warn'));

const btnRun = $('#btnRun'), btnStop = $('#btnStop');
function updateRunState() {
  document.body.classList.toggle('running', runtime.running);
  sim.locked = runtime.running;
  btnRun.disabled = runtime.running;
  btnStop.disabled = !runtime.running;
}
btnRun.addEventListener('click', () => { hub.ensureAudio(); runtime.start(); });
btnStop.addEventListener('click', () => runtime.stop());
updateRunState();

// ---------- projects ----------
const nameInput = $('#projectName');
let saveTimer = null;

function currentProject() { return store.projects[store.current]; }

function loadProject(id) {
  const p = store.projects[id];
  if (!p) return;
  runtime.stop();
  store.current = id;
  B.Events.disable();
  try {
    workspace.clear();
    B.serialization.workspaces.load(p.state, workspace);
  } finally { B.Events.enable(); }
  workspace.scroll(24, 16);
  nameInput.value = p.name;
  saveStore();
  document.title = `${p.name} · SPIKE Sim`;
}

function createProject(name, state) {
  const id = uid();
  store.projects[id] = { id, name, state, updated: Date.now() };
  loadProject(id);
  return id;
}

function persistWorkspace() {
  const p = currentProject();
  if (!p) return;
  p.state = B.serialization.workspaces.save(workspace);
  p.updated = Date.now();
  saveStore();
}

workspace.addChangeListener((e) => {
  if (e.isUiEvent || e.type === B.Events.FINISHED_LOADING) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistWorkspace, 400);
});

nameInput.addEventListener('change', () => {
  const p = currentProject();
  if (!p) return;
  p.name = nameInput.value.trim() || 'Untitled';
  nameInput.value = p.name;
  document.title = `${p.name} · SPIKE Sim`;
  saveStore();
});

$('#btnNew').addEventListener('click', async () => {
  const name = await modal({ message: 'Name for the new project', defaultValue: `Project ${Object.keys(store.projects).length + 1}`, input: true, cancel: true });
  if (name === null) return;
  createProject(name.trim() || 'Untitled', emptyState());
});

// Projects list popover.
const panel = $('#projectsPanel');
$('#btnProjects').addEventListener('click', (e) => { e.stopPropagation(); renderProjects(); panel.hidden = !panel.hidden; });
document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
function renderProjects() {
  const list = Object.values(store.projects).sort((a, b) => b.updated - a.updated);
  panel.innerHTML = '<h3>My projects</h3>' + list.map((p) => `
    <div class="proj${p.id === store.current ? ' current' : ''}" data-id="${p.id}">
      <button type="button" class="open"><span class="pn"></span><span class="pd">${new Date(p.updated).toLocaleString()}</span></button>
      <button type="button" class="del" aria-label="Delete project">&times;</button>
    </div>`).join('');
  panel.querySelectorAll('.proj').forEach((row, i) => {
    row.querySelector('.pn').textContent = list[i].name;
    row.querySelector('.open').addEventListener('click', () => { loadProject(row.dataset.id); panel.hidden = true; });
    row.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await modal({ message: `Delete "${list[i].name}"? This cannot be undone.`, cancel: true });
      if (!ok) return;
      delete store.projects[row.dataset.id];
      if (store.current === row.dataset.id) {
        const next = Object.values(store.projects).sort((a, b) => b.updated - a.updated)[0];
        if (next) loadProject(next.id); else createProject('Project 1', emptyState());
      }
      saveStore();
      renderProjects();
    });
  });
}

// ---------- files ----------
$('#btnSave').addEventListener('click', async () => {
  const p = currentProject();
  persistWorkspace();
  try {
    const blob = await exportLlsp3(workspace, p.name);
    const base = p.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Project';
    const downloads = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
    if (downloads) {
      // Published (claude.ai) version: the viewer confirms the save. ".llsp3" may not be an allowed extension there.
      try {
        await downloads.save({ filename: `${base}.llsp3`, data: blob });
        toast(`Saved ${base}.llsp3. Open it in the SPIKE App with Open Project.`);
      } catch (err) {
        if (err && err.code === 'rejected_extension') {
          await downloads.save({ filename: `${base}.llsp3.zip`, data: blob });
          toast(`Saved ${base}.llsp3.zip. Rename it to "${base}.llsp3" (remove .zip), then open it in the SPIKE App.`, 'warn');
        } else if (!err || err.code !== 'declined') throw err;
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${base}.llsp3`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(`Saved ${a.download}. Open it in the SPIKE App with Open Project.`);
  } catch (err) {
    console.error(err);
    toast('Could not save: ' + err.message, 'error');
  }
});

const fileInput = $('#fileOpen');
$('#btnOpen').addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) openFile(fileInput.files[0]); });
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

async function openFile(file) {
  try {
    const { name, state, warnings } = await importLlsp3(await file.arrayBuffer());
    createProject(name || file.name.replace(/\.llsp3$/i, ''), state);
    if (warnings.length) toast(warnings.slice(0, 3).join(' '), 'warn');
    else toast(`Opened ${file.name}`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not open that file.', 'error');
  }
}

// ---------- robot setup ----------
$('#btnRobot').addEventListener('click', async () => {
  const cfg = { ...robot.config };
  const back = document.createElement('div');
  back.className = 'spike-modal-back';
  const opts = (sel) => PORT_LETTERS.map((p) => `<option value="${p}"${p === sel ? ' selected' : ''}>${p}</option>`).join('');
  back.innerHTML = `<div class="spike-modal" role="dialog" aria-modal="true">
    <h3>Robot setup</h3>
    <p class="hint">Which hub ports your real robot uses. The Driving Base from the lessons uses motors C + D.</p>
    <div class="form">
      <label>Left wheel motor <select id="cfgLeft">${opts(cfg.left)}</select></label>
      <label>Right wheel motor <select id="cfgRight">${opts(cfg.right)}</select></label>
      <label>Color sensor <select id="cfgColor">${opts(cfg.color)}</select></label>
      <label>Distance sensor <select id="cfgDist">${opts(cfg.distance)}</select></label>
      <label>Attachment motor <select id="cfgArm"><option value="">none</option>${opts(cfg.attachment)}</select></label>
      <label>Attachment mount <select id="cfgMount"><option value="front"${cfg.attachmentMount !== 'side' ? ' selected' : ''}>front arm (lifts)</option><option value="side"${cfg.attachmentMount === 'side' ? ' selected' : ''}>side arm (sweeps)</option></select></label>
    </div>
    <p class="hint"><button type="button" class="tb" id="cfgPreset">Training Camp preset</button> motors C+D, color E, distance F, no attachment.</p>
    <div class="btns"><button type="button" class="cancel">Cancel</button><button type="button" class="ok">Save</button></div>
  </div>`;
  document.body.appendChild(back);
  back.querySelector('.cancel').addEventListener('click', () => back.remove());
  back.querySelector('#cfgPreset').addEventListener('click', () => {
    $('#cfgLeft').value = 'C'; $('#cfgRight').value = 'D'; $('#cfgColor').value = 'E'; $('#cfgDist').value = 'F'; $('#cfgArm').value = ''; $('#cfgMount').value = 'front';
  });
  back.querySelector('.ok').addEventListener('click', () => {
    const next = { left: $('#cfgLeft').value, right: $('#cfgRight').value, color: $('#cfgColor').value, distance: $('#cfgDist').value, attachment: $('#cfgArm').value || null, attachmentMount: $('#cfgMount').value };
    const used = [next.left, next.right, next.color, next.distance].concat(next.attachment ? [next.attachment] : []);
    if (new Set(used).size < used.length) { toast('Each port can only be used once.', 'error'); return; }
    Object.assign(robot.config, next);
    store.config = next;
    saveStore();
    hub.updatePortTypes();
    back.remove();
    toast(`Robot: wheels ${next.left}+${next.right}, color ${next.color}, distance ${next.distance}${next.attachment ? ', arm ' + next.attachment : ''}`);
  });
});

// ---------- workspace tools ----------
$('#btnFit').addEventListener('click', () => workspace.zoomToFit());
$('#btnZoomIn').addEventListener('click', () => workspace.zoomCenter(1));
$('#btnZoomOut').addEventListener('click', () => workspace.zoomCenter(-1));
$('#btnUndo').addEventListener('click', () => workspace.undo(false));
$('#btnRedo').addEventListener('click', () => workspace.undo(true));

// ---------- sim view tools ----------
$('#btnResetPos').addEventListener('click', () => { robot.resetPose(); world.resetObstacles(); });
$('#btnLaunch').addEventListener('click', () => {
  runtime.stop();
  world.resetObstacles();
  robot.resetPose();
  hub.matchLeft = MATCH_SECONDS;
  hub.ensureAudio();
  runtime.start();
});
world.loadSeason().then((ok) => { if (ok) toast('Season mat loaded.'); });
$('#btnTurnL').addEventListener('click', () => robot.setPose(robot.x, robot.y, robot.heading - 15));
$('#btnTurnR').addEventListener('click', () => robot.setPose(robot.x, robot.y, robot.heading + 15));
$('#btnFollow').addEventListener('click', (e) => { sim.follow = !sim.follow; e.currentTarget.classList.toggle('active', sim.follow); });
$('#btnCamera').addEventListener('click', () => { sim.follow = false; $('#btnFollow').classList.remove('active'); sim.camera.position.set(-40, 210, 150); sim.controls.target.set(0, 0, 0); });

// ---------- Python view ----------
function currentPython() {
  const res = compilePython(workspace, robot.config);
  if (res.warnings.length) toast(res.warnings.slice(0, 2).join(' '), 'warn');
  return res.code;
}
$('#btnPython').addEventListener('click', () => {
  const code = currentPython();
  const back = document.createElement('div');
  back.className = 'spike-modal-back';
  back.innerHTML = `<div class="spike-modal wide" role="dialog" aria-modal="true">
    <h3>Python for the SPIKE App</h3>
    <p class="hint">Paste this into a Python project in the SPIKE App, or use "Send to hub" to upload it over Bluetooth.</p>
    <textarea class="code" readonly spellcheck="false"></textarea>
    <div class="btns"><button type="button" class="cancel">Close</button><button type="button" class="ok">Copy</button></div>
  </div>`;
  back.querySelector('.code').value = code;
  document.body.appendChild(back);
  back.querySelector('.cancel').addEventListener('click', () => back.remove());
  back.querySelector('.ok').addEventListener('click', async () => {
    const ta = back.querySelector('.code');
    try { await navigator.clipboard.writeText(code); toast('Python copied to the clipboard.'); }
    catch { ta.focus(); ta.select(); toast('Press Ctrl/Cmd+C to copy.', 'warn'); }
  });
});

// ---------- hub over Web Bluetooth ----------
const hubBtn = $('#btnHub'), sendBtn = $('#btnSendHub'), stopHubBtn = $('#btnStopHub');
let hubLink = null;
function hubUi() {
  const on = !!(hubLink && hubLink.connected);
  hubBtn.textContent = on ? hubLink.name : 'Connect hub';
  hubBtn.classList.toggle('connected', on);
  sendBtn.hidden = !on;
  stopHubBtn.hidden = !on;
}
if (!bleSupported()) {
  hubBtn.addEventListener('click', () => toast('This browser cannot talk to the hub over Bluetooth. Use Chrome or Edge on a laptop or Android, or save the .llsp3 and open it in the SPIKE App.', 'warn'));
} else {
  hubBtn.addEventListener('click', async () => {
    if (hubLink && hubLink.connected) { hubLink.disconnect(); return; }
    hubLink = new SpikeHub();
    hubLink.on('status', (s) => toast(s));
    hubLink.on('console', (t) => toast('Hub: ' + t));
    hubLink.on('disconnect', () => { toast('Hub disconnected.', 'warn'); hubUi(); });
    try { await hubLink.connect(); } catch (err) {
      if (err && err.name === 'NotFoundError') toast('No hub chosen. Turn the hub on and make sure Bluetooth is enabled, then try again.', 'warn');
      else toast('Could not connect: ' + (err.message || err), 'error');
    }
    hubUi();
  });
}
sendBtn.addEventListener('click', async () => {
  if (!hubLink || !hubLink.connected) return;
  const code = currentPython();
  sendBtn.disabled = true;
  try {
    await hubLink.uploadProgram(code, 0, { start: true, onProgress: (p) => { sendBtn.textContent = `Sending ${Math.round(p * 100)}%`; } });
  } catch (err) {
    toast('Sending failed: ' + (err.message || err), 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send to hub';
  }
});
stopHubBtn.addEventListener('click', async () => {
  if (!hubLink || !hubLink.connected) return;
  try { await hubLink.stopProgram(0); } catch (err) { toast('Could not stop: ' + (err.message || err), 'error'); }
});
hubUi();

// ---------- draggable divider between the blocks and the simulator ----------
(() => {
  const splitter = $('#splitter'), pane = $('.simpane'), layout = $('.layout');
  const isColumn = () => getComputedStyle(layout).flexDirection.startsWith('column');
  const apply = (size) => {
    if (isColumn()) pane.style.flex = `0 0 ${size}px`; else pane.style.flex = `0 0 ${size}px`;
  };
  const saved = (() => { try { return JSON.parse(localStorage.getItem('spikesim.split') || 'null'); } catch { return null; } })();
  if (saved) { if (!isColumn() && saved.w) pane.style.flex = `0 0 ${saved.w}px`; if (isColumn() && saved.h) pane.style.flex = `0 0 ${saved.h}px`; }
  let drag = null;
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = pane.getBoundingClientRect();
    drag = { column: isColumn(), startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('active');
    document.body.classList.add('resizing');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const total = layout.getBoundingClientRect();
    let size;
    if (drag.column) size = Math.min(total.height - 160, Math.max(180, drag.startH + (e.clientY - drag.startY)));
    else size = Math.min(total.width - 420, Math.max(280, drag.startW - (e.clientX - drag.startX)));
    apply(size);
    B.svgResize(workspace);
  });
  const end = () => {
    if (!drag) return;
    const rect = pane.getBoundingClientRect();
    const next = Object.assign({}, saved || {}, drag.column ? { h: Math.round(rect.height) } : { w: Math.round(rect.width) });
    try { localStorage.setItem('spikesim.split', JSON.stringify(next)); } catch { /* ignore */ }
    drag = null;
    splitter.classList.remove('active');
    document.body.classList.remove('resizing');
    B.svgResize(workspace);
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 80 : 20;
    const rect = pane.getBoundingClientRect();
    if (isColumn() ? (e.key === 'ArrowUp' || e.key === 'ArrowDown') : (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const grow = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
      apply((isColumn() ? rect.height : rect.width) + (grow ? step : -step));
      B.svgResize(workspace);
    }
  });
  window.addEventListener('resize', () => { pane.style.flex = ''; });
})();

// ---------- main loop ----------
let last = performance.now();
let acc = 0;
const STEP = 1 / 200;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (runtime.running) {
    acc += dt;
    while (acc >= STEP) { robot.update(STEP); acc -= STEP; }
    runtime.tick();
    if (hub.matchLeft !== null && hub.matchLeft > 0) {
      hub.matchLeft -= dt;
      if (hub.matchLeft <= 0) { hub.matchLeft = 0; toast('Match over: 2:30 is up.', 'warn'); }
    }
  } else {
    acc = 0;
  }
  hub.update(now);
  sim.render();
  requestAnimationFrame(frame);
}

// ---------- start ----------
if (store.current && store.projects[store.current]) loadProject(store.current);
else createProject(SAMPLE_NAME, SAMPLE_STATE);
requestAnimationFrame(frame);
window.addEventListener('resize', () => B.svgResize(workspace));

window.spikeApp = { workspace, robot, world, runtime, sim, hub, store, compilePython: () => compilePython(workspace, robot.config), exportLlsp3: (name) => exportLlsp3(workspace, name || currentProject().name), importLlsp3, loadProject, createProject };
