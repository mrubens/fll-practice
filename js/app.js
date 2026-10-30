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
import { WHEELS, MOUNTS, COLOR_MOUNTS, MODULES, PRESETS, defaultBuild, normalizeBuild, validateBuild } from './build.js';
import { Scoring, practiceResult } from './scoring.js';
import { EQUIPMENT_PIECES, inLaunchArea } from './mechanisms.js';
import { ModelCard } from './missionsui.js';

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
// Older saves kept just the ports; fold them into a build.
if (store.config && !store.lastBuild) { store.lastBuild = normalizeBuild({ ports: store.config }); delete store.config; }
robot.applyBuild(store.lastBuild || defaultBuild());
const sim = new Sim3D($('#view3d'), world, robot);
const hub = new HubPanel($('#hubPanel'), robot);
sim.onQualityChange = (q, reason) => { if (reason === 'slow') toast(q === 'low' ? 'Graphics turned down so the robot stays smooth on this device.' : 'Graphics turned down a notch to keep the robot smooth.'); };
const runtime = new Runtime({
  workspace, robot,
  onChange: () => { updateRunState(); if (!runtime.running && practicing) modelCard.setResult(practiceResult(scoring, practicing)); },
  onLog: (m) => toast(m, 'warn'),
});
robot.on('hint', (m) => toast(m, 'warn'));

// ---------- missions: scripted interactions, scoresheet, practice cards ----------
const scoring = new Scoring(robot, world);
let practicing = null;
scoring.on((ev) => {
  if (ev.type === 'done') { sim.celebrate(ev.obstacle); toast(`${ev.mission.id} ${ev.mission.name}: ${ev.task.label}`); }
  if (ev.type === 'token') toast(`Robot interrupted outside home: one precision token lost (${ev.tokens} left).`, 'warn');
  if (ev.type === 'end') toast(`Match over. Final score: ${ev.score} pts.`);
});
const modelCard = new ModelCard($('#modelCard'), $('#scoreChip'), {
  scoring,
  onPractice: (m) => {
    practicing = m;
    if (m) { runtime.stop(); world.resetObstacles(); robot.resetPose(); scoring.reset(); sim.resetEffects(); sim.clearTrail(); sim.showZone(scoring.zoneOf(m)); }
    else sim.showZone(null);
  },
  onClose: () => { sim.flyHome(); },
});
sim.onPick = (obstacle) => {
  if (!obstacle) { if (!modelCard.card.hidden) modelCard.close(); return; }
  modelCard.show(obstacle);
  sim.flyTo({ x: obstacle.x, y: obstacle.y });
};
/** Free run (no match rules): models and the sheet start fresh every time. During a launched match, Run is a relaunch. */
function startRun() {
  if (!world.matReady) { toast('The field is still loading. Try again in a moment.', 'warn'); return; }
  if (scoring.match.launched && !scoring.match.ended) { relaunch(); return; }
  hub.matchLeft = null;
  world.resetObstacles();
  scoring.reset();
  sim.resetEffects();
  sim.clearTrail();
  hub.ensureAudio();
  runtime.start();
}

/** The team's loose equipment starts in the left home area. */
function placeEquipment() {
  const a = robot.geom.attachment;
  const items = EQUIPMENT_PIECES.map((e, i) => {
    if (a.module === 'basket') {   // the technicians load the basket by hand before the launch
      const [x, y] = robot._point(a.fwd + 2.5 + (i % 2) * 4, -3 + Math.floor(i / 2) * 3);
      return { ...e, x, y, h: a.height + 0.4 + e.box[1] / 2 + 0.3 };
    }
    return { ...e, x: -97 + (i % 3) * 5, y: 46 + Math.floor(i / 3) * 6 };
  });
  if (world.physics) world.physics.spawnEquipment(items);
  sim.buildEquipment(items);
}

/** A launch under match rules: the robot must be completely inside a launch area. */
function relaunch() {
  const r = robot;
  if (!inLaunchArea(r.x, r.y, r.geom.radius)) { toast('To launch, the robot must be completely inside a launch area (the quarter circles in home).', 'warn'); return false; }
  const res = scoring.launch();
  hub.ensureAudio();
  runtime.start();
  return res;
}

/** Start a whole match: fresh field, equipment in home, inspection, 2:30 on the clock. */
function startMatch() {
  if (!world.matReady) { toast('The field is still loading. Try again in a moment.', 'warn'); return; }
  runtime.stop();
  world.resetObstacles();
  scoring.reset();
  sim.resetEffects();
  sim.clearTrail();
  robot.resetPose();
  placeEquipment();
  hub.matchLeft = MATCH_SECONDS;
  const res = relaunch();
  if (res) toast(res.inspection ? 'Match started. Equipment inspection passed: +20 pts, 6 precision tokens.' : 'Match started. Inspection failed (robot not in one launch area): no bonus.', res.inspection ? undefined : 'warn');
  else hub.matchLeft = null;
}

/** Stop during a match = the technicians interrupted the robot. */
function stopRun() {
  const wasRunning = runtime.running;
  runtime.stop();
  if (wasRunning && scoring.match.launched && !scoring.match.ended && hub.matchLeft > 0) {
    const outside = scoring.interrupt();
    if (outside === false) toast('Robot interrupted in home: no token lost. Drag it into a launch area and launch again.');
  }
}

const btnRun = $('#btnRun'), btnStop = $('#btnStop');
function updateRunState() {
  document.body.classList.toggle('running', runtime.running);
  sim.locked = runtime.running;
  btnRun.disabled = runtime.running;
  btnStop.disabled = !runtime.running;
}
btnRun.addEventListener('click', () => { if (practicing) robot.resetPose(); startRun(); });
btnStop.addEventListener('click', () => stopRun());
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
  robot.applyBuild(p.build || store.lastBuild || defaultBuild());
  if (hub.updatePortTypes) hub.updatePortTypes();
  if (!runtime.running) robot.resetPose();
  nameInput.value = p.name;
  saveStore();
  document.title = `${p.name} · FLL Practice`;
}

function createProject(name, state, build) {
  const id = uid();
  store.projects[id] = { id, name, state, updated: Date.now(), build: normalizeBuild(build || store.lastBuild || defaultBuild()) };
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
  document.title = `${p.name} · FLL Practice`;
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
    const blob = await exportLlsp3(workspace, p.name, { build: robot.build });
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
    const { name, state, warnings, build } = await importLlsp3(await file.arrayBuffer());
    createProject(name || file.name.replace(/\.llsp3$/i, ''), state, build);
    if (warnings.length) toast(warnings.slice(0, 3).join(' '), 'warn');
    else toast(`Opened ${file.name}`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not open that file.', 'error');
  }
}

// ---------- robot builder ----------
const builder = $('#builder');
const B$ = (id) => document.getElementById(id);
const portOptions = (sel, allowNone) => (allowNone ? '<option value="">none</option>' : '') + PORT_LETTERS.map((p) => `<option value="${p}"${p === sel ? ' selected' : ''}>${p}</option>`).join('');
let buildOpen = false;
function fillBuilder(b) {
  B$('bWheel').innerHTML = Object.entries(WHEELS).map(([k, w]) => `<option value="${k}"${k === b.wheel ? ' selected' : ''}>${w.label}</option>`).join('');
  B$('bTrack').value = b.track; B$('bTrackOut').value = `${b.track.toFixed(1)} cm`;
  B$('bHub').value = b.hub;
  B$('bLeft').innerHTML = portOptions(b.ports.left); B$('bRight').innerHTML = portOptions(b.ports.right);
  B$('bColorPort').innerHTML = portOptions(b.ports.color); B$('bDistPort').innerHTML = portOptions(b.ports.distance);
  B$('bColorMount').innerHTML = Object.entries(COLOR_MOUNTS).map(([k, l]) => `<option value="${k}"${k === b.colorMount ? ' selected' : ''}>${l}</option>`).join('');
  B$('bDistMount').innerHTML = MOUNTS.map((m) => `<option value="${m}"${m === b.distanceMount ? ' selected' : ''}>${m}</option>`).join('');
  B$('bModule').innerHTML = Object.entries(MODULES).map(([k, m]) => `<option value="${k}"${k === b.attachment.module ? ' selected' : ''}>${m.label}</option>`).join('');
  B$('bMount').innerHTML = MOUNTS.map((m) => `<option value="${m}"${m === b.attachment.mount ? ' selected' : ''}>${m}</option>`).join('');
  B$('bArmPort').innerHTML = portOptions(b.ports.attachment, true);
  const motor = MODULES[b.attachment.module].motor;
  B$('bArmPort').disabled = !motor; B$('bMount').disabled = b.attachment.module === 'none';
  B$('bIssues').textContent = validateBuild(b).join(' ');
}
function readBuilder() {
  return normalizeBuild({
    preset: null, name: 'Custom robot',
    wheel: B$('bWheel').value, track: Number(B$('bTrack').value), hub: B$('bHub').value,
    ports: { left: B$('bLeft').value, right: B$('bRight').value, color: B$('bColorPort').value, distance: B$('bDistPort').value, attachment: B$('bArmPort').value || null },
    colorMount: B$('bColorMount').value, distanceMount: B$('bDistMount').value,
    attachment: { module: B$('bModule').value, mount: B$('bMount').value },
  });
}
function applyBuildFromUi(b) {
  fillBuilder(b);
  robot.applyBuild(b);
  hub.updatePortTypes();
  if (!runtime.running) robot.setPose(robot.x, robot.y);
  const p = currentProject();
  if (p) { p.build = b; p.updated = Date.now(); }
  store.lastBuild = b;
  saveStore();
}
builder.addEventListener('input', () => applyBuildFromUi(readBuilder()));
builder.addEventListener('change', () => applyBuildFromUi(readBuilder()));
builder.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
  applyBuildFromUi(normalizeBuild({ ...PRESETS[btn.dataset.preset], preset: btn.dataset.preset }));
  toast(`${PRESETS[btn.dataset.preset].name} loaded.`);
}));
let cameraBefore = null;
function openBuilder() {
  runtime.stop();
  fillBuilder(robot.build);
  builder.hidden = false;
  document.body.classList.add('building');
  buildOpen = true;
  cameraBefore = { pos: sim.camera.position.clone(), target: sim.controls.target.clone(), follow: sim.follow };
  sim.follow = false;
  const r = robot;
  sim.controls.target.set(r.x, 4, r.y);
  sim.camera.position.set(r.x + 28, 26, r.y + 34);
}
function closeBuilder() {
  builder.hidden = true;
  document.body.classList.remove('building');
  buildOpen = false;
  if (cameraBefore) { sim.camera.position.copy(cameraBefore.pos); sim.controls.target.copy(cameraBefore.target); sim.follow = cameraBefore.follow; }
  const issues = validateBuild(robot.build);
  if (issues.length) toast(issues.join(' '), 'warn');
}
$('#btnRobot').addEventListener('click', () => (buildOpen ? closeBuilder() : openBuilder()));
$('#builderDone').addEventListener('click', closeBuilder);

// ---------- workspace tools ----------
$('#btnFit').addEventListener('click', () => workspace.zoomToFit());
$('#btnZoomIn').addEventListener('click', () => workspace.zoomCenter(1));
$('#btnZoomOut').addEventListener('click', () => workspace.zoomCenter(-1));
$('#btnUndo').addEventListener('click', () => workspace.undo(false));
$('#btnRedo').addEventListener('click', () => workspace.undo(true));

// ---------- sim view tools ----------
$('#btnResetPos').addEventListener('click', () => { robot.resetPose(); world.resetObstacles(); });
$('#btnLaunch').addEventListener('click', () => {
  if (scoring.match.launched && !scoring.match.ended && !runtime.running) { if (relaunch()) toast('Relaunched.'); return; }
  startMatch();
});
world.loadSeason().then((ok) => { if (ok) { if (!runtime.running) robot.resetPose(); toast('Season mat loaded.'); } });
$('#btnTurnL').addEventListener('click', () => robot.setPose(robot.x, robot.y, robot.heading - 15));
$('#btnTurnR').addEventListener('click', () => robot.setPose(robot.x, robot.y, robot.heading + 15));
$('#btnFollow').addEventListener('click', (e) => { sim.follow = !sim.follow; e.currentTarget.classList.toggle('active', sim.follow); });
$('#btnCamera').addEventListener('click', () => { sim.follow = false; $('#btnFollow').classList.remove('active'); sim.camera.position.set(-40, 210, 150); sim.controls.target.set(0, 0, 0); });

// ---------- Python view ----------
function currentPython() {
  const res = compilePython(workspace, { ...robot.config, calibration: robot.geom.calibration, hub: robot.build.hub });
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
    while (acc >= STEP) { robot.update(STEP); scoring.update(STEP); acc -= STEP; }
    runtime.tick();
    sim.addTrailPoint(robot.x, robot.y);
  } else {
    acc = 0;
    if (world.physics) world.physics.idleStep(Math.min(dt, 0.05));
  }
  if (hub.matchLeft !== null && hub.matchLeft > 0 && scoring.match.launched && !scoring.match.ended) {
    hub.matchLeft -= dt;
    if (hub.matchLeft <= 0) { hub.matchLeft = 0; runtime.stop(); scoring.endMatch(); }
  }
  hub.update(now);
  sim.update(dt);
  sim.render();
  requestAnimationFrame(frame);
}

// ---------- start ----------
if (store.current && store.projects[store.current]) loadProject(store.current);
else createProject(SAMPLE_NAME, SAMPLE_STATE);
// First visit: start from FIRST's official Guided Mission program (Mission 11) with the robot it was written for.
if (!store.guidedLoaded) {
  const GUIDED = 'samples/guided-mission-bioglow-11.llsp3';
  // Hosts that cannot serve a .llsp3 archive (the artifact copy) get the same file base64-encoded as text.
  const fromText = (res) => res.text().then((t) => Uint8Array.from(atob(t.replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)).buffer);
  fetch(GUIDED, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.arrayBuffer() : fetch(GUIDED.replace('.llsp3', '.b64.txt'), { cache: 'no-cache' }).then((r1) => (r1.ok ? fromText(r1) : fetch('https://mrubens.github.io/fll-practice/' + GUIDED).then((r2) => (r2.ok ? r2.arrayBuffer() : null))))))
    .then(async (buf) => {
    if (!buf) return;
    const { state } = await importLlsp3(buf);
    store.guidedLoaded = true;
    createProject('Guided Mission (M11)', state, normalizeBuild({ ...PRESETS['guided-mission'], preset: 'guided-mission' }));
    toast('Loaded the official FIRST Guided Mission for Mission 11. Press Launch to watch it run.');
  }).catch(() => {});
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => B.svgResize(workspace));

window.spikeApp = { workspace, robot, world, runtime, sim, hub, store, scoring, modelCard, compilePython: () => compilePython(workspace, { ...robot.config, calibration: robot.geom.calibration, hub: robot.build.hub }), exportLlsp3: (name) => exportLlsp3(workspace, name || currentProject().name, { build: robot.build }), importLlsp3, loadProject, createProject };
