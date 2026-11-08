// BIOGLOW (2026-27) missions, scored the way a referee does: from the physical state of the mission models
// (see mechanisms.js) with the Robot Game Rulebook's wording and points. Each task's `met(ctx)` looks at the
// pieces of its models; `noEquipment` marks missions with the
// "no equipment constraint": they score nothing if the model is touching the robot at the end of the match.
//
// ctx helpers: ctx.p(modelId) -> piece states {angle, ext, height, moved, rotated, bottom, x, y, pos, touched, released}
//              ctx.local(modelId, pos) -> a table position in that model's own frame (cm)
//              ctx.eq(id) -> an equipment piece's state (keystone species, seeds), or null before launch
//              ctx.touching(modelId) -> the robot is touching that model right now

import { FIELD_SEEDS } from './mechanisms.js';
/** A point given in a piece's own frame, on the table (cm): the piece's pose applied to it. */
function pointOf(state, local) {
  const [qx, qy, qz, qw] = state.q, [x, y, z] = local;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw - iw * qx - iy * qz + iz * qy + state.pos[0], iy * qw - iw * qy - iz * qx + ix * qz + state.pos[1], iz * qw - iw * qz - ix * qy + iy * qx + state.pos[2]];
}
/** The M01 survey area (sim cm), measured on the mat. */
const SURVEY_AREA = [[1.75, 34.09], [7.13, 31.09], [9.94, 35.72], [4.41, 38.84]];
function inPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** A piece's outline (points on the table) at least partly over a printed area. */
function overlaps(outline, poly) {
  if (!outline || !outline.length) return false;
  if (outline.some((p) => inPoly(p, poly))) return true;
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  return poly.some(([x, y]) => x >= Math.min(...xs) && x <= Math.max(...xs) && y >= Math.min(...ys) && y <= Math.max(...ys));
}
/** The M04 leaf habitat's marked square (sim cm), measured on the mat; the nest itself counts too. */
const LEAF_HABITAT = [[-90.31, -44.0], [-86.88, -47.44], [-82.34, -47.44], [-82.34, -39.31], [-90.31, -39.31]];
const inNest = (c, pt) => { const l = c.local('M04 Lucky Leaves', [pt[0], 0, pt[1]]); return Math.abs(l[0]) < 9.1 && l[2] > -6.5 && l[2] < 2.7; };
const leafOut = (s) => !!s && !s.touchesBase && s.moved > 2;
/** The katydid completely outside the leaf habitat: no part of it over the marked area or the nest. */
function katydidGone(c) {
  const k = c.p('M04 Lucky Leaves').katydid;
  if (!k || !k.outline || !k.outline.length) return false;
  return !k.outline.some((pt) => inPoly(pt, LEAF_HABITAT) || inNest(c, pt)) && !overlaps(k.outline, LEAF_HABITAT);
}
/** M05: the root arm's far end (its hole-7 crossbar) is back across the boundary wall: past its far face and above it. */
function rootAcross(c) {
  const a = c.p('M05 Reaching Roots').arm;
  if (!a) return false;
  const l = c.local('M05 Reaching Roots', pointOf(a, [0, -1.563, -4.538]));
  return l[2] < -4.5 && l[1] > 9;
}
export const MISSIONS = [
  { id: 'M01', name: 'Drone Survey', models: ['M01 Drone Survey', 'M01 Drone stand'], noEquipment: true,
    text: 'Help the pilot launch the drone to create a LiDAR map of the rainforest.',
    tasks: [
      { id: 'drone', label: 'Drone is no longer touching the mat', points: 20,
        met: (c) => { const d = c.p('M01 Drone Survey').drone; return !!d && d.bottom > 0.3; } },
      // the survey area is the thick black square printed by the LiDAR map's stand
      { id: 'map', label: 'Bonus: the LiDAR map is completely flipped over, scan marker in the survey area', points: 10, bonusOf: 'drone',
        met: (c) => { const m = c.p('M01 Drone stand').map, k = c.p('M01 Drone Survey').marker; return !!m && !!k && m.angle > 120 && overlaps(k.outline, SURVEY_AREA); } },
    ] },
  { id: 'M02', name: 'Exploding Seeds', models: ['M02 Exploding Seeds'],
    text: 'Release the seeds from the seed pod, propelling them to new ground.',
    tasks: [
      { id: 'seed1', label: 'Seed no longer touching the stalk', points: 10,
        met: (c) => { const s = c.p('M02 Exploding Seeds').seed1; return !!s && s.freed && !s.touchesBase; } },
      { id: 'seed2', label: 'Seed no longer touching the stalk', points: 10, met: (c) => { const s = c.p('M02 Exploding Seeds').seed2; return !!s && s.freed && !s.touchesBase; } },
      { id: 'seed3', label: 'Seed no longer touching the stalk', points: 10, met: (c) => { const s = c.p('M02 Exploding Seeds').seed3; return !!s && s.freed && !s.touchesBase; } },
    ] },
  { id: 'M03', name: 'Flip the Rock', models: ['M03 Flip the Rock'],
    text: 'Flip the rock to discover what lives underneath, then put it back the way you found it.',
    tasks: [
      { id: 'flag', label: 'The research flag is down', points: 20,
        met: (c) => { const f = c.p('M03 Flip the Rock').flag; return f.released && f.angle < 12; } },
      { id: 'back', label: 'Bonus: the rock has been returned to its original starting position', points: 10, bonusOf: 'flag',
        met: (c) => c.p('M03 Flip the Rock').rock.angle < 15 },
    ] },
  { id: 'M04', name: 'Lucky Leaves', models: ['M04 Lucky Leaves'], noEquipment: true, setup: 'nest',
    text: 'Collect as many leaves as you can without disturbing the katydid.',
    tasks: [
      { id: 'leaf1', label: 'One leaf is completely removed, no longer touching the nest', points: 10,
        met: (c) => { const s = c.p('M04 Lucky Leaves'); return leafOut(s.leafL) || leafOut(s.leafM); } },
      { id: 'leaf2', label: 'Bonus: the second leaf is removed too, with the katydid in its original position and in the leaf habitat throughout', points: 20, bonusOf: 'leaf1',
        met: (c) => { const s = c.p('M04 Lucky Leaves'), k = s.katydid; return leafOut(s.leafL) && leafOut(s.leafM) && k.touchesBase && k.moved < 0.5 && k.rotated < 5 && !c.flag('M04.katydidOut'); } },
    ],
    // FIRST's update 01 (September 2, 2026) replaced the constraints: the katydid completely outside the leaf habitat
    // (the nest and the marked area around it) at the end scores zero for the mission, and at any time loses the bonus
    zeroIf: (c) => katydidGone(c),
    watch: (c) => { if (katydidGone(c)) c.setFlag('M04.katydidOut'); } },
  { id: 'M05', name: 'Reaching Roots', models: ['M05 Reaching Roots'], noEquipment: true,
    text: 'Help this plant cross the forest boundary in search of symbiosis.',
    tasks: [
      { id: 'partial', label: 'The plant root is partially extended', points: 10,
        met: (c) => { const s = c.p('M05 Reaching Roots'); return !!s.extension && s.extension.angle > 110 && !rootAcross(c); } },
      { id: 'full', label: 'OR the plant root is completely extended', points: 20, or: 'partial',
        met: (c) => { const s = c.p('M05 Reaching Roots'); return !!s.extension && s.extension.angle > 110 && rootAcross(c); } },
    ] },
  { id: 'M06', name: 'Leafcutter Frenzy', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'],
    text: 'Guide the ant back to its nest, but move too quickly and you may scatter the leaves it collected.',
    tasks: [
      { id: 'frag1', label: 'Ant touching the nest, green leaf fragment contained within the nest', points: 10,
        met: (c) => antHome(c) && fragIn(c, 'frag1') },
      { id: 'frag2', label: 'Ant touching the nest, orange leaf fragment contained', points: 10, met: (c) => antHome(c) && fragIn(c, 'frag2') },
      { id: 'frag3', label: 'Ant touching the nest, yellow leaf fragment contained', points: 10, met: (c) => antHome(c) && fragIn(c, 'frag3') },
      { id: 'frag4', label: 'Ant touching the nest, white leaf fragment contained', points: 10, met: (c) => antHome(c) && fragIn(c, 'frag4') },
    ] },
  { id: 'M07', name: 'Humongous Fungus', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'], noEquipment: true,
    text: 'Form a new connection between the mycelium and a neighboring tree root.',
    tasks: [
      { id: 'mycelium', label: 'The mycelium is completely extended', points: 20,
        met: (c) => { const p = c.p('M06-07 Leafcutter Frenzy / Humongous Fungus').mycelium; return !!p && p.angle > 165; } },
      { id: 'bonus', label: 'Bonus: connection with the opposing team’s plant root (not possible here: no opposing team)', points: 0, met: () => false },
    ] },
  { id: 'M08', name: 'Tangled', models: ['M08-09 Tangled / Research Platform'],
    text: 'Gently untangle the vines so the tree has space and sunlight to grow again.',
    tasks: [
      { id: 'vine', label: 'The vine is touching the mat', points: 30,
        met: (c) => { const v = c.p('M08-09 Tangled / Research Platform').vine; return !!v && v.bottom < 0.3; } },
    ] },
  { id: 'M09', name: 'Research Platform', models: ['M08-09 Tangled / Research Platform'], noEquipment: true,
    text: 'Help the team deploy equipment to monitor activity high above the forest floor.',
    tasks: [
      { id: 'platform', label: 'The research platform is raised', points: 10,
        met: (c) => c.p('M08-09 Tangled / Research Platform').platform.ext > 4.8 },
      { id: 'camera', label: 'The camera trap is deployed', points: 10,
        met: (c) => c.p('M08-09 Tangled / Research Platform').camera.angle > 45 },
      { id: 'seed', label: 'The seed is no longer touching the tree', points: 10,
        met: (c) => { const s = c.p('M08-09 Tangled / Research Platform').seed; return s.released && !s.touchesBase && s.moved > 2; } },
    ] },
  { id: 'M10', name: 'Fragile Microhabitats', models: ['M10 Fragile Microhabitat A', 'M10 Fragile Microhabitat B'], noEquipment: true,
    text: 'Move through the area without damaging these tiny creatures’ homes.',
    tasks: [
      { id: 'spider', label: 'The spider habitat is in its original starting position', points: 10, model: 'M10 Fragile Microhabitat B', guard: true,
        met: (c) => { const w = c.p('M10 Fragile Microhabitat B').webB; return !!w && w.angle < 5; } },
      { id: 'snail', label: 'The snail habitat is in its original starting position', points: 10, model: 'M10 Fragile Microhabitat A', guard: true,
        met: (c) => { const n = c.p('M10 Fragile Microhabitat A').neck; return !!n && n.angle < 5; } },
    ] },
  { id: 'M11', name: 'Window to the Past', models: ['M11 Window to the Past'],
    text: 'Open the root window and document what you see.',
    tasks: [
      { id: 'cover', label: 'The root cover is down, touching the mat', points: 20,
        met: (c) => { const v = c.p('M11 Window to the Past').cover; return v.angle > 95; } },
    ] },
  { id: 'M12', name: 'Forest Elder', models: ['M12 Forest Elder', 'M12 Forest Elder post'], noEquipment: true,
    text: 'Add a support to stabilize the aging tree.',
    tasks: [
      { id: 'cane', label: 'The cane is completely raised, touching the tree', points: 20,
        met: (c) => { const p = c.p('M12 Forest Elder').cane; return !!p && p.angle < 3; } },
      { id: 'tie', label: 'The support tie is around the post', points: 10,
        // the ring lies around the post's red top (at 9, 3.6, 8.8 in the post's own frame)
        met: (c) => { const t = c.p('M12 Forest Elder').tie; if (!t || !t.released) return false; const l = c.local('M12 Forest Elder post', t.pos); return Math.hypot(l[0] - 9.2, l[2] - 8.8) < 3.2 && t.bottom < 2.5; } },
    ] },
  { id: 'M13', name: 'Keystone Species', models: ['Dock city (M13-15)'],
    text: 'Build and deliver a keystone species to this newly protected habitat.',
    tasks: [
      { id: 'keystone', label: 'Your keystone species is on the restoration platform, and the young trees are raised', points: 30,
        met: (c) => { const k = c.eq('keystone'); const d = c.p('Dock city (M13-15)'); if (!k || !d.platform) return false; const l = c.local('Dock city (M13-15)', k.pos); return d.platform.ext < 0.3 && Math.abs(l[0]) < 4.4 && Math.abs(l[2]) < 2.8 && l[1] > 2; } },
    ] },
  { id: 'M14', name: 'Seeds of Renewal', models: ['Dock mine (M13-15)'],
    text: 'Place the seeds your team has collected in the soil and watch them take root.',
    tasks: [
      // the official software scoresheet counts 0-4 seeds on each line (six are on the field)
      { id: 'seeds', label: 'Seeds are contained within the replantation station (5 each, up to 4)', points: 20, each: 5,
        count: (c) => Math.min(4, seedsIn(c).length) },
      { id: 'seedsMat', label: 'Bonus: and are touching the mat (5 added each, up to 4)', points: 20, each: 5,
        count: (c) => Math.min(4, seedsIn(c).filter((s) => s.bottom < 0.6).length) },
    ] },
  { id: 'M15', name: 'Biocentric Architecture', models: ['Dock farm (M13-15)'], noEquipment: true,
    text: 'Modify the building to create homes for wildlife, restore soil health and bring in natural light.',
    tasks: [
      { id: 'canopy', label: 'The nesting canopy is raised', points: 10,
        met: (c) => { const p = c.p('Dock farm (M13-15)').canopy; return !!p && p.angle > 10; } },
      { id: 'skylight', label: 'The garden skylight is completely in', points: 10,
        met: (c) => { const p = c.p('Dock farm (M13-15)').skylight; return !!p && p.ext > -0.2; } },
      { id: 'hatch', label: 'The compost hatch is completely opened, touching the mat', points: 10,
        met: (c) => { const p = c.p('Dock farm (M13-15)').hatch; return !!p && p.angle > 70 && p.bottom < 0.3; } },
      { id: 'env', label: 'Environmental bonus: the building is on the farm dock, so the compost hatch counts', points: 10, bonusOf: 'hatch', met: (c) => { const p = c.p('Dock farm (M13-15)').hatch; return !!p && p.angle > 70 && p.bottom < 0.3; } },
    ] },
];

function antHome(c) {
  const m = 'M06-07 Leafcutter Frenzy / Humongous Fungus';
  const a = c.p(m).ant;
  return !!a && a.ext > -0.4;    // the rack is pushed all the way in, so the ant touches the nest
}
function fragIn(c, name) {
  const m = 'M06-07 Leafcutter Frenzy / Humongous Fungus';
  const f = c.p(m)[name];
  const l = c.local(m, f.pos);
  return l[2] > -9.5 && l[2] < -3 && Math.abs(l[0]) < 7 && l[1] > 4;
}
/** The seeds collected from the field (M02, M09, M11) that sit inside the replantation station. */
function seedsIn(c) {
  const out = [];
  for (const [model, name] of FIELD_SEEDS) {
    const s = c.p(model)[name];
    if (!s || !s.pos) continue;
    const l = c.local('Dock mine (M13-15)', s.pos);
    if (l[0] > -5.4 && l[0] < 5.4 && l[2] > -3.8 && l[2] < 3.8 && l[1] < 9) out.push(s);
  }
  return out;
}

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const MAX_SCORE = MISSIONS.reduce((s, m) => s + m.tasks.reduce((a, x) => a + x.points, 0), 0);
