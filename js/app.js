// Wires the editor, the simulator, the hub panel, project storage and file import/export together.
import { createWorkspace, installDialogs } from './blocks.js';
import { World, MATCH_SECONDS } from './world.js';
import { Robot, PORT_LETTERS, MAX_DEG_PER_S } from './robot.js';
import { Sim3D } from './sim3d.js';
import { HubPanel } from './hub.js';
import { Runtime } from './interpreter.js';
import { exportLlsp3, importLlsp3 } from './llsp3.js';
import { SAMPLE_STATE, SAMPLE_NAME, emptyState } from './sample.js';
import { compile as compilePython } from './python.js';
import { SpikeHub, isSupported as bleSupported } from './ble.js';
import { MOUNTS, MODULES, PRESETS, defaultBuild, normalizeBuild, validateBuild } from './build.js';
import { Scoring } from './scoring.js';
import { BOARDS, boardById } from './boards.js';
import { MISSIONS } from './missions.js';
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
  onChange: () => { updateRunState(); },
  onLog: (m) => toast(m, 'warn'),
});
robot.on('hint', (m) => toast(m, 'warn'));

// ---------- missions: scripted interactions, scoresheet, mission cards ----------
const scoring = new Scoring(robot, world);
const replay = { active: false, start: null, snaps: new Map() };   // stepping back: snapshots keyed by step count
/** Everything that a step back has to put back: the physics world, the robot, the referee, the clock, the program. */
function takeSnapshot() {
  if (!world.physics) return null;
  return {
    physics: world.physics.snapshot(),
    robot: structuredClone({ x: robot.x, y: robot.y, heading: robot.heading, time: robot.time, motors: robot.motors, movement: robot.movement, hub: robot.hub }),
    scoring: structuredClone({ state: scoring.state, flags: scoring.flags, missionPoints: scoring.missionPoints, match: scoring.match, score: scoring.score, missions: scoring.missions, primed: scoring.primed }),
    matchLeft: hub.matchLeft,
    threads: runtime.threadPaths(),
    vars: Object.fromEntries(runtime.vars), edge: Object.fromEntries(runtime.edge),
    stepMode: runtime.stepMode, stepsTaken: runtime.stepsTaken,
  };
}
function restoreSnapshot(s) {
  runtime.stop();
  world.physics.restore(s.physics);
  const r = structuredClone(s.robot);
  robot.x = r.x; robot.y = r.y; robot.heading = r.heading; robot.time = r.time; robot.motors = r.motors; robot.movement = r.movement; robot.hub = r.hub;
  robot.emit('pose');
  Object.assign(scoring, structuredClone(s.scoring));
  hub.matchLeft = s.matchLeft;
  runtime.stepMode = s.stepMode;
  runtime.restoreThreads(s.threads, s.vars, s.edge);
  runtime.stepsTaken = s.stepsTaken;
  scoring.emit({ type: 'score', score: scoring.score });
}
runtime.onPause = () => { setTimeout(() => { if (runtime.running && runtime.paused && !replay.active) { const snap = takeSnapshot(); if (snap) replay.snaps.set(runtime.stepsTaken, snap); } }, 0); };
scoring.on((ev) => {
  if (replay.active) return;
  if (ev.type === 'done') { sim.celebrate(ev.obstacle); toast(`${ev.mission.id} ${ev.mission.name}: ${ev.task.label}`); }
  if (ev.type === 'token') toast(`Robot interrupted outside home: one precision token lost (${ev.tokens} left).`, 'warn');
  if (ev.type === 'end') toast(`Match over. Final score: ${ev.score} pts.`);
});
const modelCard = new ModelCard($('#modelCard'), $('#scoreChip'), {
  scoring,
  onClose: () => { sim.flyHome(); },
});
// Where the cursor is on the mat, measured the way teams measure on the real table: from the left wall and
// from the near (south) wall, plus how far and which way from the robot. A shift-drag ruler shows its length.
const matReadout = $('#matReadout');
sim.onMatPoint = (p) => {
  sim.lastMatPoint = p;
  if (!p && !sim.ruler) { matReadout.hidden = true; return; }
  const parts = [];
  if (sim.ruler) {
    const r = sim.ruler, len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
    const ang = ((Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x) / DEG - robot.heading + 540) % 360) - 180;
    parts.push(`<b>Ruler ${len.toFixed(1)} cm</b><small>${Math.abs(ang) < 0.5 ? 'straight ahead of the robot' : `${Math.abs(ang).toFixed(0)}° ${ang > 0 ? 'right' : 'left'} of the robot's heading`}</small>`);
  }
  if (p) {
    const fromLeft = p.x + world.innerHalfW, fromNear = world.innerHalfH - p.y;
    const dist = Math.hypot(p.x - robot.x, p.y - robot.y);
    const bearing = ((Math.atan2(p.y - robot.y, p.x - robot.x) / DEG - robot.heading + 540) % 360) - 180;
    parts.push(`${fromLeft.toFixed(1)} cm from the left wall · ${fromNear.toFixed(1)} cm from the near wall<small>${dist.toFixed(1)} cm from the robot, ${Math.abs(bearing) < 0.5 ? 'straight ahead' : `${Math.abs(bearing).toFixed(0)}° to the ${bearing > 0 ? 'right' : 'left'}`}</small>`);
  }
  matReadout.innerHTML = parts.join('');
  matReadout.hidden = false;
};
sim.onPick = (obstacle) => {
  if (!obstacle) { if (!modelCard.card.hidden) modelCard.close(); return; }
  if (!world.season) return;                 // only the season table has mission cards
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
  replay.start = { kind: 'run', pose: { x: robot.x, y: robot.y, heading: robot.heading } };
  replay.snaps.clear();
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
  replay.start = { kind: 'match' };
  replay.snaps.clear();
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

const btnRun = $('#btnRun'), btnStop = $('#btnStop'), btnStep = $('#btnStep'), btnBack = $('#btnBack');
function updateRunState() {
  document.body.classList.toggle('running', runtime.running);
  document.body.classList.toggle('stepping', runtime.running && runtime.stepMode);
  sim.locked = runtime.running || replay.active;
  btnRun.disabled = (runtime.running && !runtime.paused) || replay.active;
  btnStop.disabled = !runtime.running || replay.active;
  btnStep.disabled = replay.active;
  btnStep.classList.toggle('active', runtime.running && runtime.stepMode);
  btnBack.disabled = replay.active || !replay.start || !runtime.stepMode || !(runtime.stepsTaken > 0) || !(runtime.paused || !runtime.running);
}
/**
 * Step back: the simulation is deterministic, so going back a step is a restart plus a replay of the steps
 * before it, run flat out with no drawing. Shift-click goes back to the start.
 */
async function stepBack(toStart) {
  if (replay.active || !replay.start) return;
  const target = toStart ? 0 : Math.max(0, runtime.stepsTaken - 1);
  const snap = replay.snaps.get(target);
  if (snap) {                                           // the usual case: put the whole state back as it was
    replay.active = true;
    restoreSnapshot(snap);
    for (const k of [...replay.snaps.keys()]) if (k > target) replay.snaps.delete(k);
    replay.active = false;
    sim.render();
    updateRunState();
    return;
  }
  const start = replay.start;
  replay.active = true;
  updateRunState();
  runtime.stop();
  world.resetObstacles(); scoring.reset(); sim.resetEffects(); sim.clearTrail();
  if (start.kind === 'match') { robot.resetPose(); placeEquipment(); hub.matchLeft = MATCH_SECONDS; scoring.launch(); }
  else { hub.matchLeft = null; robot.resetPose(start.pose); }
  runtime.setStepMode(true);
  runtime.start();
  await drain();
  const limit = 200 * 600;                              // at most ten simulated minutes, whatever the program does
  let steps = 0;
  if (target > 0) toast(toStart ? 'Back to the start.' : 'Rewinding one step…');
  for (let n = 0; n < target && runtime.running; n++) {
    runtime.step();
    await drain();
    while (runtime.running && !runtime.paused && steps < limit) { simStep(); steps++; if (steps % 8 === 0) sim.addTrailPoint(robot.x, robot.y); await drain(); }
  }
  replay.active = false;
  sim.render();
  updateRunState();
}
btnBack.addEventListener('click', (e) => stepBack(e.shiftKey));
// Run while paused at a step continues at full speed; otherwise it starts the program.
btnRun.addEventListener('click', () => { if (runtime.running && runtime.paused) runtime.setStepMode(false); else startRun(); });
btnStop.addEventListener('click', () => { stopRun(); runtime.setStepMode(false); });
// Step: start the program paused before its first block, or run the next block of a paused program.
btnStep.addEventListener('click', () => {
  if (!runtime.running) { runtime.setStepMode(true); startRun(); return; }
  if (runtime.paused) runtime.step();
  else runtime.setStepMode(true);                       // a running program pauses before its next block
});
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
  world.setLaunchOverride(p.launch || null);        // a sample written for a particular start keeps it
  if (hub.updatePortTypes) hub.updatePortTypes();
  if (!runtime.running) robot.resetPose();
  nameInput.value = p.name;
  saveStore();
  document.title = `${p.name} · FLL Practice`;
}

function createProject(name, state, build, launch) {
  const id = uid();
  store.projects[id] = { id, name, state, updated: Date.now(), build: normalizeBuild(build || store.lastBuild || defaultBuild()), launch: launch || null };
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
  B$('bLeft').innerHTML = portOptions(b.ports.left); B$('bRight').innerHTML = portOptions(b.ports.right);
  B$('bColorPort').innerHTML = portOptions(b.ports.color); B$('bDistPort').innerHTML = portOptions(b.ports.distance);
  B$('bDistMount').innerHTML = MOUNTS.map((m) => `<option value="${m}"${m === b.distanceMount ? ' selected' : ''}>${m}</option>`).join('');
  B$('bModule').innerHTML = Object.entries(MODULES).map(([k, m]) => `<option value="${k}"${k === b.attachment.module ? ' selected' : ''}>${m.label}</option>`).join('');
  const motor = MODULES[b.attachment.module].motor;
  B$('bAttachInfo').textContent = b.attachment.module === 'none' ? '' : motor ? 'Mounted on the front. Its motor is on port E. Press Q and E over the 3D view to try it.' : 'Mounted on the front. No motor.';
  B$('bIssues').textContent = validateBuild(b).join(' ');
}
function readBuilder() {
  return normalizeBuild({
    preset: null, name: 'Custom robot',
    ports: { left: B$('bLeft').value, right: B$('bRight').value, color: B$('bColorPort').value, distance: B$('bDistPort').value },
    distanceMount: B$('bDistMount').value,
    attachment: { module: B$('bModule').value },
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
// ---------- boards (tables) ----------
const DEG = Math.PI / 180;
const boardSelect = $('#boardSelect');
boardSelect.innerHTML = BOARDS.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
/** Match rules, scores and mission cards only make sense on the season table. */
function applyBoardUi() {
  const season = !!world.season;
  $('#btnLaunch').hidden = !season;
  $('#scoreChip').hidden = !season;
  $('#btnModels').hidden = !season;
  if (!season) { modelCard.closeSheet(); if (!modelCard.card.hidden) modelCard.close(); modelsPanel.hidden = true; }
  boardSelect.value = (world.board && world.board.id) || 'season';
}

// ---------- which mission models are on the table ----------
// Kids can practice one mission at a time: untick the others and their models leave the table (and the scoresheet).
const modelsPanel = $('#modelsPanel');
const hiddenMissions = new Set(store.hiddenMissions || []);
function applyHiddenMissions() {
  const ids = new Set();
  for (const m of MISSIONS) if (hiddenMissions.has(m.id)) m.models.forEach((id) => ids.add(id));
  world.setHiddenModels(ids);
  scoring.reset();
  modelCard.renderChip();
  store.hiddenMissions = [...hiddenMissions]; saveStore();
}
function renderModelsPanel() {
  modelsPanel.innerHTML = `<h4><span>Models on the table</span><button type="button" data-all="1">All</button><button type="button" data-all="0">None</button></h4>` +
    MISSIONS.map((m) => `<label class="${hiddenMissions.has(m.id) ? 'off' : ''}"><input type="checkbox" data-mission="${m.id}"${hiddenMissions.has(m.id) ? '' : ' checked'}><span class="m">${m.id}</span><span>${m.name}</span></label>`).join('');
  modelsPanel.querySelectorAll('[data-mission]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) hiddenMissions.delete(cb.dataset.mission); else hiddenMissions.add(cb.dataset.mission);
    applyHiddenMissions(); renderModelsPanel();
  }));
  modelsPanel.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
    hiddenMissions.clear();
    if (b.dataset.all === '0') MISSIONS.forEach((m) => hiddenMissions.add(m.id));
    applyHiddenMissions(); renderModelsPanel();
  }));
}
$('#btnModels').addEventListener('click', () => { modelsPanel.hidden = !modelsPanel.hidden; if (!modelsPanel.hidden) { modelCard.closeSheet(); if (!modelCard.card.hidden) modelCard.close(); renderModelsPanel(); } });
world.setHiddenModels(new Set(MISSIONS.filter((m) => hiddenMissions.has(m.id)).flatMap((m) => m.models)));
async function switchBoard(id, quiet) {
  const b = boardById(id);
  runtime.stop();
  hub.matchLeft = null;
  scoring.reset();
  sim.resetEffects();
  sim.clearTrail();
  const ok = await world.loadBoard(b);
  robot.resetPose();
  store.board = b.id; saveStore();
  applyBoardUi();
  if (!quiet) toast(ok ? `${b.name} loaded.` : `${b.name} could not be loaded; using the line practice table.`);
}
boardSelect.addEventListener('change', () => switchBoard(boardSelect.value));
switchBoard(store.board || 'season', true);
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

// ---------- keyboard driving (WASD, Q/E for the attachment) when no program is running ----------
const drive = { keys: new Set(), warned: false };
const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)); };
document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!'wasdqe'.includes(k) || k.length !== 1 || e.metaKey || e.ctrlKey || e.altKey || typing()) return;
  if (runtime.running) return;
  if (scoring.match.launched && !scoring.match.ended) { if (!drive.warned) { drive.warned = true; toast('Hands off during a match: the robot drives itself. Press Run for free driving.', 'warn'); } return; }
  drive.keys.add(k); e.preventDefault();
});
document.addEventListener('keyup', (e) => drive.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => drive.keys.clear());
scoring.on((ev) => { if (ev.type === 'reset' || ev.type === 'end') drive.warned = false; });
/** Set wheel and arm targets from the held keys; returns true while anything should keep moving. */
function driveFromKeys() {
  const k = drive.keys, cfg = robot.config;
  const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
  const turn = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);          // d turns right (clockwise)
  const v = MAX_DEG_PER_S * 0.5;
  let l = 0, r = 0;
  if (fwd) { l = r = fwd * v; if (turn) { if (turn > 0) r *= 0.3; else l *= 0.3; } }   // arcs while moving
  else if (turn) { l = turn * v * 0.6; r = -turn * v * 0.6; }                           // pivots in place
  robot.motors[cfg.left].target = l; robot.motors[cfg.right].target = r;
  const arm = cfg.attachment && robot.motors[cfg.attachment];
  if (arm) arm.target = ((k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0)) * MAX_DEG_PER_S * 0.2;
  const moving = [robot.motors[cfg.left], robot.motors[cfg.right], arm].some((m) => m && (m.target !== 0 || Math.abs(m.velocity) > 1));
  return moving;
}
// One simulated step (1/200 s): the robot, the referee, the program's tick, and the match clock. The live loop and
// the step-back replay both use it, with the same microtask drain after each step, so a replay reproduces a run.
function simStep() {
  robot.update(STEP); scoring.update(STEP); runtime.tick();
  if (hub.matchLeft !== null && hub.matchLeft > 0 && scoring.match.launched && !scoring.match.ended) {
    hub.matchLeft -= STEP;
    if (hub.matchLeft <= 0) { hub.matchLeft = 0; runtime.stop(); scoring.endMatch(); }
  }
}
// A full task boundary after every step (a MessageChannel hop: no timer clamping), so the program settles at its
// next yield before the next tick whatever the frame batching. That is what makes a replay match the live run.
const hop = new MessageChannel();
const drain = () => new Promise((resolve) => { hop.port1.onmessage = () => resolve(); hop.port2.postMessage(0); });
let frameBusy = false;
async function frame(now) {
  if (frameBusy) { requestAnimationFrame(frame); return; }
  frameBusy = true;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (replay.active || (runtime.running && runtime.paused)) {
    acc = 0;                                            // paused at a step (or replaying): the clock stands still
  } else if (runtime.running) {
    acc += dt;
    while (acc >= STEP && runtime.running && !runtime.paused) { simStep(); acc -= STEP; await drain(); }
    sim.addTrailPoint(robot.x, robot.y);
  } else if (drive.keys.size || driveFromKeys()) {
    driveFromKeys();                                   // hand driving: same fixed steps, scoring counts on free runs
    acc += dt;
    while (acc >= STEP) { robot.update(STEP); scoring.update(STEP); acc -= STEP; }
    sim.addTrailPoint(robot.x, robot.y);
  } else {
    acc = 0;
    if (world.physics) world.physics.idleStep(Math.min(dt, 0.05));
  }
  hub.update(now);
  if (!replay.active) { sim.update(dt); sim.render(); }   // a replay draws nothing until it is back where it should be
  frameBusy = false;
  requestAnimationFrame(frame);
}

// ---------- start ----------
if (store.current && store.projects[store.current]) loadProject(store.current);
else createProject(SAMPLE_NAME, SAMPLE_STATE);
// First visit: start from FIRST's official Guided Mission program (Mission 11) with the robot it was written for.
// First visit: open FIRST's published Guided Mission for Mission 11 with the robot it was written for.
// Hosts that cannot serve a .llsp3 archive (the artifact copy) get the same file base64-encoded as text.
const fromText = (res) => res.text().then((t) => Uint8Array.from(atob(t.replace(/\s+/g, '')), (ch) => ch.charCodeAt(0)).buffer);
const fetchSample = (path) => fetch(path, { cache: 'no-cache' })
  .then((res) => (res.ok ? res.arrayBuffer() : fetch(path.replace('.llsp3', '.b64.txt'), { cache: 'no-cache' }).then((r1) => (r1.ok ? fromText(r1) : fetch('https://mrubens.github.io/fll-practice/' + path).then((r2) => (r2.ok ? r2.arrayBuffer() : null))))))
  .catch(() => null);
// version 2: the turns use the standard steering blocks instead of the More Movement extension
if (store.guidedVersion !== 3) {
  fetchSample('samples/guided-mission-bioglow-11.llsp3').then(async (buf) => {
    if (!buf) return;
    const { state } = await importLlsp3(buf);
    store.guidedLoaded = true; store.guidedVersion = 3;
    createProject('Guided Mission (M11)', state, normalizeBuild({ ...PRESETS['guided-mission'], preset: 'guided-mission' }));
    toast('Loaded the official FIRST Guided Mission for Mission 11. Press Launch to watch it run.');
  });
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => B.svgResize(workspace));

/** Test hook: run the current program from the robot's pose flat out with no drawing; resolves with the score when it ends. */
async function fastRun(maxSeconds = 600) {
  if (runtime.running || replay.active) runtime.stop();
  startRun();
  if (!runtime.running) return null;
  replay.active = true; updateRunState();
  const limit = 200 * maxSeconds;
  let steps = 0;
  await drain();
  while (runtime.running && steps < limit) { simStep(); steps++; if (steps % 8 === 0) sim.addTrailPoint(robot.x, robot.y); await drain(); }
  if (runtime.running) runtime.stop();
  replay.active = false; sim.render(); updateRunState();
  return { steps, seconds: +(steps / 200).toFixed(1), score: scoring.score, met: Object.entries(scoring.state).filter(([, v]) => v.met).map(([k]) => k) };
}
window.spikeApp = { workspace, robot, world, runtime, sim, hub, store, scoring, modelCard, fastRun, compilePython: () => compilePython(workspace, { ...robot.config, calibration: robot.geom.calibration, hub: robot.build.hub }), exportLlsp3: (name) => exportLlsp3(workspace, name || currentProject().name, { build: robot.build }), importLlsp3, loadProject, createProject };
