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
export const MISSIONS = [
  { id: 'M01', name: 'Drone Survey', models: ['M01 Drone Survey', 'M01 Drone stand'], noEquipment: true,
    text: 'Help the pilot launch the drone to create a LiDAR map of the rainforest.',
    tasks: [
      { id: 'drone', label: 'Drone is no longer touching the mat', points: 20,
        met: (c) => { const p = c.p('M01 Drone Survey').pilot; return !!p && p.bottom > 0.5; } },
      // the survey area is the patch of mat around the pilot's stand and the LiDAR map
      { id: 'map', label: 'Bonus: the LiDAR map is completely flipped over, scan marker in the survey area', points: 10, bonusOf: 'drone',
        met: (c) => { const m = c.p('M01 Drone stand').map, k = c.p('M01 Drone Survey').marker; if (!m || !k) return false; const b = pointOf(k, [-26, -1.9, 0]); return Math.abs(m.angle) > 150 && Math.hypot(b[0] - m.x, b[2] - m.y) < 16; } },
    ] },
  { id: 'M02', name: 'Exploding Seeds', models: ['M02 Exploding Seeds'],
    text: 'Release the seeds from the seed pod, propelling them to new ground.',
    tasks: [
      { id: 'seed1', label: 'Seed no longer touching the stalk', points: 10,
        met: (c) => { const s = c.p('M02 Exploding Seeds').seed1; return s.released && s.moved > 2; } },
      { id: 'seed2', label: 'Seed no longer touching the stalk', points: 10, met: (c) => { const s = c.p('M02 Exploding Seeds').seed2; return s.released && s.moved > 2; } },
      { id: 'seed3', label: 'Seed no longer touching the stalk', points: 10, met: (c) => { const s = c.p('M02 Exploding Seeds').seed3; return s.released && s.moved > 2; } },
    ] },
  { id: 'M03', name: 'Flip the Rock', models: ['M03 Flip the Rock'],
    text: 'Flip the rock to discover what lives underneath, then put it back the way you found it.',
    tasks: [
      { id: 'flag', label: 'The research flag is down', points: 20,
        met: (c) => c.p('M03 Flip the Rock').flag.angle > 60 },
      { id: 'back', label: 'Bonus: the rock has been returned to its original starting position', points: 10, bonusOf: 'flag',
        met: (c) => c.p('M03 Flip the Rock').rock.angle < 15 },
    ] },
  { id: 'M04', name: 'Lucky Leaves', models: ['M04 Lucky Leaves'], noEquipment: true,
    text: 'Collect as many leaves as you can without disturbing the katydid.',
    tasks: [
      { id: 'leaf1', label: 'One leaf is completely removed, no longer touching the nest', points: 10,
        met: (c) => { const s = c.p('M04 Lucky Leaves'); return (s.leafL.moved > 9) || (s.leafR.moved > 9); } },
      { id: 'leaf2', label: 'Bonus: the second leaf is removed too, with the katydid in its starting position', points: 20, bonusOf: 'leaf1',
        met: (c) => { const s = c.p('M04 Lucky Leaves'); return s.leafL.moved > 9 && s.leafR.moved > 9 && s.katydid.moved < 1.5 && s.katydid.rotated < 12 && !c.flag('M04.katydidOut'); } },
    ],
    // the katydid outside the leaf habitat at the end: zero for the mission
    zeroIf: (c) => c.p('M04 Lucky Leaves').katydid.moved > 12,
    watch: (c) => { if (c.p('M04 Lucky Leaves').katydid.moved > 9) c.setFlag('M04.katydidOut'); } },
  { id: 'M05', name: 'Reaching Roots', models: ['M05 Reaching Roots'], noEquipment: true,
    text: 'Help this plant cross the forest boundary in search of symbiosis.',
    tasks: [
      { id: 'partial', label: 'The plant root is partially extended', points: 10,
        met: (c) => { const e = c.p('M05 Reaching Roots').root.ext; return e > 1.5 && e <= 7; } },
      { id: 'full', label: 'OR the plant root is completely extended', points: 20,
        met: (c) => c.p('M05 Reaching Roots').root.ext > 7 },
    ] },
  { id: 'M06', name: 'Leafcutter Frenzy', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'],
    text: 'Guide the ant back to its nest, but move too quickly and you may scatter the leaves it collected.',
    tasks: [
      { id: 'frag1', label: 'Ant touching the nest, leaf fragment contained within the nest', points: 10,
        met: (c) => antHome(c) && fragIn(c, 'frag1') },
      { id: 'frag2', label: 'Second leaf fragment contained', points: 10, met: (c) => antHome(c) && fragIn(c, 'frag2') },
      { id: 'frag3', label: 'Third leaf fragment contained', points: 10, met: (c) => antHome(c) && fragIn(c, 'frag3') },
    ] },
  { id: 'M07', name: 'Humongous Fungus', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'], noEquipment: true,
    text: 'Form a new connection between the mycelium and a neighboring tree root.',
    tasks: [
      { id: 'mycelium', label: 'The mycelium is completely extended', points: 20,
        met: (c) => c.p('M06-07 Leafcutter Frenzy / Humongous Fungus').mycelium.ext > 7 },
      { id: 'bonus', label: 'Bonus: connection with the opposing team’s plant root (not possible here: no opposing team)', points: 0, met: () => false },
    ] },
  { id: 'M08', name: 'Tangled', models: ['M08-09 Tangled / Research Platform'],
    text: 'Gently untangle the vines so the tree has space and sunlight to grow again.',
    tasks: [
      { id: 'vine', label: 'The vine is touching the mat', points: 30,
        met: (c) => { const v = c.p('M08-09 Tangled / Research Platform').vine; return v.released && v.bottom < 1.5; } },
    ] },
  { id: 'M09', name: 'Research Platform', models: ['M08-09 Tangled / Research Platform'], noEquipment: true,
    text: 'Help the team deploy equipment to monitor activity high above the forest floor.',
    tasks: [
      { id: 'platform', label: 'The research platform is raised', points: 10,
        met: (c) => c.p('M08-09 Tangled / Research Platform').platform.ext > 4 },
      { id: 'camera', label: 'The camera trap is deployed', points: 10,
        met: (c) => { const k = c.p('M08-09 Tangled / Research Platform').camera; return k.released && (k.moved > 1 || k.height < -1.5); } },
      { id: 'seed', label: 'The seed is no longer touching the tree', points: 10,
        met: (c) => { const s = c.p('M08-09 Tangled / Research Platform').seed; return s.released && (s.moved > 2 || s.height < -1.5); } },
    ] },
  { id: 'M10', name: 'Fragile Microhabitats', models: ['M10 Fragile Microhabitat A', 'M10 Fragile Microhabitat B'], noEquipment: true,
    text: 'Move through the area without damaging these tiny creatures’ homes.',
    tasks: [
      { id: 'spider', label: 'The spider habitat is in its original starting position', points: 10,
        met: (c) => { const h = c.p('M10 Fragile Microhabitat B').habitat; return h.moved < 1 && h.rotated < 6; } },
      { id: 'snail', label: 'The snail habitat is in its original starting position', points: 10,
        met: (c) => { const h = c.p('M10 Fragile Microhabitat A').habitat; return h.moved < 1 && h.rotated < 6; } },
    ] },
  { id: 'M11', name: 'Window to the Past', models: ['M11 Window to the Past'],
    text: 'Open the root window and document what you see.',
    tasks: [
      { id: 'cover', label: 'The root cover is down, touching the mat', points: 20,
        met: (c) => { const v = c.p('M11 Window to the Past').cover; return v.angle > 70 && v.bottom < 1.5; } },
    ] },
  { id: 'M12', name: 'Forest Elder', models: ['M12 Forest Elder', 'M12 Forest Elder post'], noEquipment: true,
    text: 'Add a support to stabilize the aging tree.',
    tasks: [
      { id: 'cane', label: 'The cane is completely raised, touching the tree', points: 20,
        met: (c) => c.p('M12 Forest Elder').cane.angle > 68 },
      { id: 'tie', label: 'The support tie is around the post', points: 10,
        met: (c) => { const t = c.p('M12 Forest Elder').tie; const post = c.obstacle('M12 Forest Elder post'); return !!post && Math.hypot(t.x - post.x, t.y - post.y) < 10; } },
    ] },
  { id: 'M13', name: 'Keystone Species', models: ['Dock farm (M13-15)'],
    text: 'Build and deliver a keystone species to this newly protected habitat.',
    tasks: [
      { id: 'keystone', label: 'Your keystone species is on the restoration platform, and the young trees are raised', points: 30,
        met: (c) => { const k = c.eq('keystone'); const d = c.p('Dock farm (M13-15)'); if (!k || !d.bar) return false; const l = c.local('Dock farm (M13-15)', k.pos); return d.bar.ext > 1.7 && l[0] > -5.5 && l[0] < 5.5 && l[2] > -6 && l[2] < 4 && l[1] > 4.5; } },
    ] },
  { id: 'M14', name: 'Seeds of Renewal', models: ['Dock city (M13-15)'],
    text: 'Place the seeds your team has collected in the soil and watch them take root.',
    tasks: [
      { id: 'seeds', label: 'Seeds are contained within the replantation station (5 each)', points: 25, each: 5,
        count: (c) => seedsIn(c).length },
      { id: 'seedsMat', label: 'Bonus: and are touching the mat (5 added each)', points: 25, each: 5,
        count: (c) => seedsIn(c).filter((s) => s.bottom < 0.6).length },
    ] },
  { id: 'M15', name: 'Biocentric Architecture', models: ['Dock mine (M13-15)'], noEquipment: true,
    text: 'Modify the building to create homes for wildlife, restore soil health and bring in natural light.',
    tasks: [
      { id: 'canopy', label: 'The nesting canopy is raised', points: 10,
        met: (c) => { const p = c.p('Dock mine (M13-15)').canopy; return !!p && p.angle > 30; } },
      { id: 'skylight', label: 'The garden skylight is completely in', points: 10,
        met: (c) => { const p = c.p('Dock mine (M13-15)').skylight; return !!p && p.ext > -0.4; } },
      { id: 'hatch', label: 'The compost hatch is completely opened, touching the mat', points: 10,
        met: (c) => { const p = c.p('Dock mine (M13-15)').hatch; return !!p && p.angle > 60 && p.bottom < 0.8; } },
      { id: 'env', label: 'Environmental bonus: the building is on the mine dock, so the nesting canopy counts', points: 10, bonusOf: 'canopy', met: (c) => { const p = c.p('Dock mine (M13-15)').canopy; return !!p && p.angle > 30; } },
    ] },
];

function antHome(c) {
  const m = 'M06-07 Leafcutter Frenzy / Humongous Fungus';
  const a = c.p(m).ant;
  const l = c.local(m, a.pos);
  return l[2] < -8.3 && l[0] > -10 && l[0] < -3;    // the cart has been pushed back along the nest's left side to the entrance
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
    const l = c.local('Dock city (M13-15)', s.pos);
    if (l[0] > -5.4 && l[0] < 5.4 && l[2] > -3.8 && l[2] < 3.8 && l[1] < 9) out.push(s);
  }
  return out;
}

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const MAX_SCORE = MISSIONS.reduce((s, m) => s + m.tasks.reduce((a, x) => a + x.points, 0), 0);
