// BIOGLOW (2026-27) missions: what scores, how many points, and how the simulator detects it.
// Points follow the Robot Game Rulebook. Triggers are scripted: a zone on the table plus a required
// robot action (push through it, lower the arm into it, lift something out of it, or stay out of it).
//
// trigger kinds:
//   push   - the robot front (or attachment tip when it has one) drives forward through the zone (travel cm)
//   arm    - the attachment tip is lowered inside the zone (no attachment: push instead)
//   lift   - the attachment tip is lowered inside the zone and then raised (no attachment: push instead)
//   visit  - the robot front stops inside the zone for a moment
//   avoid  - points are held from the start and lost if the robot or its attachment enters the zone
// `at` names the model whose pose anchors the zone (from mat/season.json); `dx`/`dy` shift it in cm
// (east / south), `r` is the zone radius in cm.

export const MISSIONS = [
  { id: 'M01', name: 'Drone Survey', models: ['M01 Drone Survey', 'M01 Drone stand'],
    text: 'Launch the drone so it is no longer touching the mat; flip the LiDAR map for a bonus.',
    actions: [
      { id: 'drone', label: 'Drone no longer touching the mat', points: 20, trigger: { kind: 'lift', at: 'M01 Drone Survey', r: 12 }, animate: { kind: 'rise', cm: 6 } },
      { id: 'map', label: 'LiDAR map flipped, marker in survey area', points: 10, bonusOf: 'drone', trigger: { kind: 'push', at: 'M01 Drone stand', r: 12, travel: 4 } },
    ] },
  { id: 'M02', name: 'Exploding Seeds', models: ['M02 Exploding Seeds'],
    text: 'Release the seeds from the seed pod so they fly off the stalk (10 points per seed).',
    actions: [
      { id: 'pod', label: 'Seeds released from the stalk (3 seeds)', points: 30, trigger: { kind: 'push', at: 'M02 Exploding Seeds', r: 11, travel: 5 }, animate: { kind: 'wobble' } },
    ] },
  { id: 'M03', name: 'Flip the Rock', models: ['M03 Flip the Rock'],
    text: 'Flip the rock so the research flag drops; put the rock back for a bonus.',
    actions: [
      { id: 'flag', label: 'Research flag is down', points: 20, trigger: { kind: 'lift', at: 'M03 Flip the Rock', r: 13 }, animate: { kind: 'tilt', degrees: 25 } },
      { id: 'back', label: 'Rock returned to its starting position', points: 10, bonusOf: 'flag', trigger: { kind: 'lift', at: 'M03 Flip the Rock', r: 13, after: 'flag' }, animate: { kind: 'tilt', degrees: 0 } },
    ] },
  { id: 'M04', name: 'Lucky Leaves', models: ['M04 Lucky Leaves'],
    text: 'Take leaves out of the nest without disturbing the katydid.',
    actions: [
      { id: 'leaf1', label: 'One leaf removed from the nest', points: 10, trigger: { kind: 'lift', at: 'M04 Lucky Leaves', r: 13 } },
      { id: 'leaf2', label: 'Second leaf removed, katydid untouched', points: 20, bonusOf: 'leaf1', trigger: { kind: 'lift', at: 'M04 Lucky Leaves', r: 13, after: 'leaf1' } },
    ] },
  { id: 'M05', name: 'Reaching Roots', models: ['M05 Reaching Roots'],
    text: 'Push the plant root across the forest boundary (partly 10, completely 20).',
    actions: [
      { id: 'root', label: 'Plant root completely extended', points: 20, trigger: { kind: 'push', at: 'M05 Reaching Roots', r: 12, travel: 8 }, animate: { kind: 'slide', cm: 4, dir: 'east' } },
    ] },
  { id: 'M06', name: 'Leafcutter Frenzy', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'],
    text: 'Guide the ant back to its nest with its leaf fragments (10 per fragment).',
    actions: [
      { id: 'ant', label: 'Ant at the nest with its fragments (3)', points: 30, trigger: { kind: 'push', at: 'M06-07 Leafcutter Frenzy / Humongous Fungus', dx: -6, dy: 0, r: 12, travel: 6 } },
    ] },
  { id: 'M07', name: 'Humongous Fungus', models: ['M06-07 Leafcutter Frenzy / Humongous Fungus'],
    text: 'Extend the mycelium completely.',
    actions: [
      { id: 'mycelium', label: 'Mycelium completely extended', points: 20, trigger: { kind: 'push', at: 'M06-07 Leafcutter Frenzy / Humongous Fungus', dx: 6, dy: 0, r: 12, travel: 6 } },
    ] },
  { id: 'M08', name: 'Tangled', models: ['M08-09 Tangled / Research Platform'],
    text: 'Untangle the vine from the tree so it touches the mat.',
    actions: [
      { id: 'vine', label: 'Vine is touching the mat', points: 30, trigger: { kind: 'lift', at: 'M08-09 Tangled / Research Platform', dx: -6, r: 13 } },
    ] },
  { id: 'M09', name: 'Research Platform', models: ['M08-09 Tangled / Research Platform'],
    text: 'Raise the research platform and deploy the camera trap.',
    actions: [
      { id: 'platform', label: 'Research platform raised', points: 10, trigger: { kind: 'lift', at: 'M08-09 Tangled / Research Platform', dx: 6, r: 13 } },
      { id: 'camera', label: 'Camera trap deployed', points: 10, trigger: { kind: 'push', at: 'M08-09 Tangled / Research Platform', dx: 6, dy: 6, r: 12, travel: 4 } },
    ] },
  { id: 'M10', name: 'Fragile Microhabitats', models: ['M10 Fragile Microhabitat A', 'M10 Fragile Microhabitat B'],
    text: 'Move through the area without touching the spider and snail habitats (points are kept, not earned).',
    actions: [
      { id: 'spider', label: 'Spider habitat undisturbed', points: 10, trigger: { kind: 'avoid', at: 'M10 Fragile Microhabitat A', r: 7 } },
      { id: 'snail', label: 'Snail habitat undisturbed', points: 10, trigger: { kind: 'avoid', at: 'M10 Fragile Microhabitat B', r: 7 } },
    ] },
  { id: 'M11', name: 'Window to the Past', models: ['M11 Window to the Past'],
    text: 'Knock the seed off the tree and open the root window so the cover touches the mat.',
    actions: [
      { id: 'seed', label: 'Seed no longer touching the tree', points: 10, trigger: { kind: 'push', at: 'M11 Window to the Past', r: 12, travel: 4 } },
      { id: 'cover', label: 'Root cover down, touching the mat', points: 20, trigger: { kind: 'lift', at: 'M11 Window to the Past', r: 12 }, animate: { kind: 'tilt', degrees: -20 } },
    ] },
  { id: 'M12', name: 'Forest Elder', models: ['M12 Forest Elder', 'M12 Forest Elder post'],
    text: 'Raise the cane against the tree and loop the support tie around the post.',
    actions: [
      { id: 'cane', label: 'Cane completely raised, touching the tree', points: 20, trigger: { kind: 'lift', at: 'M12 Forest Elder', r: 12 } },
      { id: 'tie', label: 'Support tie around the post', points: 10, trigger: { kind: 'push', at: 'M12 Forest Elder post', r: 10, travel: 4 } },
    ] },
  { id: 'M13', name: 'Keystone Species', models: ['Dock farm (M13-15)'],
    text: 'Deliver your keystone species to the restoration platform and raise the young trees.',
    actions: [
      { id: 'keystone', label: 'Keystone species delivered, young trees raised', points: 30, trigger: { kind: 'lift', at: 'Dock farm (M13-15)', r: 13 } },
    ] },
  { id: 'M14', name: 'Seeds of Renewal', models: ['Dock city (M13-15)'],
    text: 'Place seeds in the replantation station (5 each, +5 each touching the mat).',
    actions: [
      { id: 'seeds', label: 'Seeds in the replantation station (3)', points: 15, trigger: { kind: 'lift', at: 'Dock city (M13-15)', r: 13 } },
      { id: 'seedsMat', label: 'Seeds touching the mat', points: 15, bonusOf: 'seeds', trigger: { kind: 'push', at: 'Dock city (M13-15)', r: 12, travel: 3, after: 'seeds' } },
    ] },
  { id: 'M15', name: 'Biocentric Architecture', models: ['Dock mine (M13-15)'],
    text: 'Raise the nesting canopy (the mine dock\'s environmental bonus), push the skylight in, open the compost hatch.',
    actions: [
      { id: 'canopy', label: 'Nesting canopy raised', points: 10, trigger: { kind: 'lift', at: 'Dock mine (M13-15)', r: 13 } },
      { id: 'canopyBonus', label: 'Environmental bonus (mine dock)', points: 10, bonusOf: 'canopy', trigger: { kind: 'auto', after: 'canopy' } },
      { id: 'skylight', label: 'Garden skylight completely in', points: 10, trigger: { kind: 'push', at: 'Dock mine (M13-15)', r: 12, travel: 4 } },
      { id: 'hatch', label: 'Compost hatch opened, touching the mat', points: 10, trigger: { kind: 'push', at: 'Dock mine (M13-15)', dx: 0, dy: 6, r: 12, travel: 4, after: 'skylight' } },
    ] },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
export const MAX_SCORE = MISSIONS.reduce((s, m) => s + m.actions.reduce((a, x) => a + x.points, 0), 0);
