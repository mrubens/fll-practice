// Physical mission mechanisms: for each season model, which LEGO parts move, how (hinge, slider, loose piece,
// coupled lift), the collision shapes, and the rulebook tasks scored from the physical state.
//
// Coordinates are the model's own frame as the LDraw file renders it (cm, x right, y up, z towards the viewer),
// before the model is placed on the mat with its modelPose. `parts` predicates pick LEGO parts by LDraw color code
// and bounding-box center [x, y, z] (see the inspector in the dev notes); anything not picked belongs to the base.
//
// Piece kinds:
//   hinge   rotates about `axis` through `anchor`, angle in degrees within `range` (starts at 0)
//   slider  moves along `axis` from `anchor`, extension in cm within `range`
//   loose   a free body (gravity, friction) that can be lifted, pushed or carried
//   lift    a vertical slider whose height is driven by another piece (`drivenBy`, `ratio`), e.g. the drone on its string
// Options: locked (fixed until `releaseWhen(state)` is true), latch (locks when it reaches the end of its range),
// damp (viscous resistance so a lever stays where it was pushed), planar (stays flat on the mat), mass (kg).

const DEG = Math.PI / 180;
const near = (p, x, y, z, r) => Math.hypot(p.c[0] - x, p.c[1] - y, p.c[2] - z) < r;

export const FIELD = {
  // Launch areas: quarter circles at the mat's bottom corners (sim coords: x east, y south, mat spans x ±100, y ±57).
  launch: [
    { id: 'left', cx: -100, cy: 57, r: 49 },
    { id: 'right', cx: 100, cy: 57, r: 49 },
  ],
  homeStripX: 100,   // past the mat edge (|x| > 100) is also home (the table strip beside the mat)
  tokens: { start: 6, points: [0, 10, 15, 25, 35, 50, 50] },
  inspectionBonus: 20,
  matchSeconds: 150,
};

export function inLaunchArea(x, y, margin = 0) {
  return FIELD.launch.find((a) => Math.hypot(x - a.cx, y - a.cy) + margin <= a.r && y <= a.cy + 0.01) || null;
}
export function inHome(x, y) {
  return !!inLaunchArea(x, y) || Math.abs(x) > FIELD.homeStripX;
}

export const MECHANISMS = {
  // ---- M01: the drone rig (lying along the south wall) + the pilot stand with the LiDAR map ----
  'M01 Drone Survey': {
    base: [{ box: [56, 0.8, 6], at: [0, -0.2, 8.5] }],   // the strings lie flat; the robot drives over them
    pieces: {
      drone: { kind: 'lift', anchor: [-0.4, 0, 8.8], drivenBy: { model: 'M01 Drone stand', piece: 'lever', ratio: 10 / 55 },
        shape: [{ box: [4, 3, 4], at: [0, 1.6, 0] }], parts: (p) => Math.abs(p.c[0]) < 2.6 && p.c[2] > 5 },
    },
  },
  'M01 Drone stand': {
    base: [{ box: [10, 2.4, 5.4], at: [15.5, 1.2, -9.3] }, { box: [10, 0.3, 2.6], at: [15.5, 0.15, -5.3] }],
    pieces: {
      lever: { kind: 'hinge', axis: [0, 0, -1], anchor: [10.8, 3.3, -7.5], range: [0, 55], damp: 2, gravity: false, mass: 0.03,
        shape: [{ box: [3.4, 1.4, 1.4], at: [-1.8, 0, 0] }], parts: (p) => p.c[0] < 10.6 },
      map: { kind: 'hinge', axis: [-1, 0, 0], anchor: [15.8, 3.8, -6.6], range: [0, 180], mass: 0.05,
        shape: [{ box: [1.2, 1.2, 1.2], at: [0, 0.3, 0.35] }, { box: [5, 1.2, 2.6], at: [0, 0, 1.4] }], parts: (p) => p.c[0] > 10.6 && p.c[2] > -6.7 && p.c[1] > 0.7 },
    },
  },
  // ---- M02: push the stalk, seeds fly off the pod ----
  'M02 Exploding Seeds': {
    base: [{ box: [6, 1, 6], at: [0, 0.5, 0] }, { box: [2, 15, 2], at: [0.4, 7.5, -0.5] }, { box: [15, 1.6, 2], at: [0.5, 15.2, -3.5] }],
    pieces: {
      stalk: { kind: 'hinge', axis: [1, 0, 0], anchor: [0.8, 9.6, -3.2], range: [0, 45], damp: 1.5, gravity: false, mass: 0.03,
        shape: [{ box: [2.4, 6, 2.4], at: [0, 3.2, 0] }], parts: (p) => p.c[1] > 9.6 && ['14', '10', '5', '4', '85'].includes(p.color) },
      seed1: { kind: 'loose', anchor: [-2.2, 9.6, 3.2], locked: true, releaseWhen: (s) => s.stalk.angle > 25, kick: [-1.2, 0.3, 0.6], mass: 0.02,
        shape: [{ box: [2.2, 2.2, 2.2], at: [0, 0, 0] }], parts: (p) => ['70', '19', '297'].includes(p.color) && p.c[0] < -1 },
      seed2: { kind: 'loose', anchor: [0.8, 11.0, 3.2], locked: true, releaseWhen: (s) => s.stalk.angle > 25, kick: [0, 0.3, 1.4], mass: 0.02,
        shape: [{ box: [2.2, 2.2, 2.2], at: [0, 0, 0] }], parts: (p) => ['70', '19', '297'].includes(p.color) && p.c[0] >= -1 && p.c[0] < 2.3 },
      seed3: { kind: 'loose', anchor: [3.6, 9.4, 3.2], locked: true, releaseWhen: (s) => s.stalk.angle > 25, kick: [1.2, 0.3, 0.6], mass: 0.02,
        shape: [{ box: [2.2, 2.2, 2.2], at: [0, 0, 0] }], parts: (p) => ['70', '19', '297'].includes(p.color) && p.c[0] >= 2.3 },
    },
  },
  // ---- M03: the rock is a lid hinged at the back; flipping it lets the research flag fall ----
  'M03 Flip the Rock': {
    base: [{ box: [13.6, 2.6, 8.4], at: [0, 1.3, 0.2] }],
    pieces: {
      rock: { kind: 'hinge', axis: [-1, 0, 0], anchor: [0, 2.7, -3.2], range: [0, 175], mass: 0.15, damp: 0.3,
        shape: [{ box: [8.5, 2.8, 6.2], at: [0, 1.5, 3.2] }], parts: (p) => p.c[1] > 2.6 && p.color !== '4' && p.color !== '27' },
      flag: { kind: 'hinge', axis: [-1, 0, 0], anchor: [0, 3.0, -2.5], range: [0, 90], mass: 0.04, locked: true, releaseWhen: (s) => s.rock.angle > 80,
        shape: [{ box: [11.6, 5.6, 1.4], at: [0, 3.0, -0.4] }], parts: (p) => p.color === '4' && p.c[1] > 3.5 },
    },
  },
  // ---- M04: two leaves and the katydid sit in the nest, each with a loop to lift it by ----
  'M04 Lucky Leaves': {
    base: [{ box: [15, 1.3, 7], at: [0, 0.65, -1.2] }],
    pieces: {
      leafL: { kind: 'loose', anchor: [-4.6, 1.3, -2.4], mass: 0.04, friction: 0.9,
        shape: [{ box: [4.4, 2.4, 5], at: [0, 1.2, 0.6] }, { box: [4, 0.8, 2.4], at: [0, 9.0, -1.6] }, { box: [0.8, 6, 0.8], at: [-1.9, 6, -1.6] }, { box: [0.8, 6, 0.8], at: [1.9, 6, -1.6] }],
        parts: (p) => p.c[1] > 1.25 && p.c[0] < -2.0 },
      katydid: { kind: 'loose', anchor: [0, 1.3, -2.4], mass: 0.03, friction: 0.9,
        shape: [{ box: [3.6, 2.4, 5], at: [0, 1.2, 0.6] }, { box: [4, 0.8, 2.4], at: [0, 9.0, -1.6] }, { box: [0.8, 6, 0.8], at: [-1.9, 6, -1.6] }, { box: [0.8, 6, 0.8], at: [1.9, 6, -1.6] }],
        parts: (p) => p.c[1] > 1.25 && p.c[0] >= -2.0 && p.c[0] <= 2.0 },
      leafR: { kind: 'loose', anchor: [4.6, 1.3, -2.4], mass: 0.04, friction: 0.9,
        shape: [{ box: [4.4, 2.4, 5], at: [0, 1.2, 0.6] }, { box: [4, 0.8, 2.4], at: [0, 9.0, -1.6] }, { box: [0.8, 6, 0.8], at: [-1.9, 6, -1.6] }, { box: [0.8, 6, 0.8], at: [1.9, 6, -1.6] }],
        parts: (p) => p.c[1] > 1.25 && p.c[0] > 2.0 },
    },
  },
  // ---- M05: the plant root slides through the frame when its red ball end is pushed ----
  'M05 Reaching Roots': {
    base: [{ box: [4, 8.8, 5], at: [0, 4.4, 1.5] }, { box: [4, 2, 6], at: [0, 1, 4.8] }],
    pieces: {
      root: { kind: 'slider', axis: [0, 0, 1], anchor: [0, 10.3, 3.5], range: [0, 7.5], damp: 1.2, gravity: false, mass: 0.05,
        shape: [{ box: [9, 2.4, 5], at: [-1.2, 0, 0] }], parts: (p) => p.c[1] > 5.2 && (p.color === '4' || (p.c[0] < -1.2) || ['14', '10', '353', '15', '84'].includes(p.color)) },
    },
  },
  // ---- M06/M07: the ant cart rolls to the nest; the mycelium lattice slides out ----
  'M06-07 Leafcutter Frenzy / Humongous Fungus': {
    base: [{ box: [14, 9, 8], at: [0, 4.5, -5.5] }],
    pieces: {
      ant: { kind: 'loose', anchor: [6.0, 0, 7.8], planar: true, mass: 0.05, friction: 0.3, impactor: true,
        shape: [{ box: [4, 3, 4], at: [0, 1.5, 0] }], parts: (p) => p.c[2] > 5.0 && p.c[1] < 4 },
      mycelium: { kind: 'slider', axis: [1, 0, 0], anchor: [2, 13, 2], range: [0, 8], damp: 1.2, gravity: false, mass: 0.05,
        shape: [{ box: [12, 2.4, 4], at: [0, 0, 0] }], parts: (p) => p.c[1] > 9.8 && p.color === '15' },
      frag1: { kind: 'loose', anchor: [-0.8, 9.0, -6.6], locked: true, releaseWhen: (s) => s._impact > 45, kick: [0.5, 1.2, -1.4], mass: 0.01,
        shape: [{ box: [1.6, 4, 0.8], at: [0, 0, 0] }], parts: (p) => p.c[2] < -5.5 && p.c[1] > 5 && p.c[0] < 0.4 },
      frag2: { kind: 'loose', anchor: [1.4, 8.8, -6.6], locked: true, releaseWhen: (s) => s._impact > 45, kick: [0, 1.2, -1.6], mass: 0.01,
        shape: [{ box: [1.6, 4, 0.8], at: [0, 0, 0] }], parts: (p) => p.c[2] < -5.5 && p.c[1] > 5 && p.c[0] >= 0.4 && p.c[0] < 2.2 },
      frag3: { kind: 'loose', anchor: [3.4, 8.6, -6.6], locked: true, releaseWhen: (s) => s._impact > 45, kick: [-0.5, 1.2, -1.4], mass: 0.01,
        shape: [{ box: [1.6, 4, 0.8], at: [0, 0, 0] }], parts: (p) => p.c[2] < -5.5 && p.c[1] > 5 && p.c[0] >= 2.2 },
    },
  },
  // ---- M08/M09: the vine drops when touched, the platform lifts, the camera trap flips out, the seed falls ----
  'M08-09 Tangled / Research Platform': {
    base: [{ box: [12, 28, 7], at: [0, 14, 0] }, { box: [3, 2.4, 3], at: [-9.6, 1.2, -1.5] }],
    pieces: {
      vine: { kind: 'loose', anchor: [0, 14.5, 9.5], mass: 0.04, locked: true, releaseWhen: (s) => s.vine.touched, friction: 0.6,
        shape: [{ box: [4, 12, 3], at: [0, -6.5, 1.5] }], parts: (p) => p.c[2] > 7.6 && p.c[1] < 14.2 },
      platform: { kind: 'slider', axis: [0, 1, 0], anchor: [-6.5, 5.5, 0], range: [0, 5], latch: true, mass: 0.06,
        shape: [{ box: [8, 2.6, 8], at: [0, 1.3, 0] }], parts: (p) => p.c[0] < -3 && p.c[1] > 4 && p.c[1] < 10.5 && p.c[2] > -3 && p.c[2] < 5 },
      camera: { kind: 'hinge', axis: [0, 0, 1], anchor: [8.6, 6.5, 1.2], range: [0, 75], damp: 0.6, latch: true, mass: 0.02,
        shape: [{ box: [4.5, 2, 2.4], at: [2.3, 0, 0] }], parts: (p) => p.c[0] > 8.4 && p.c[1] < 9 && p.c[1] > 4.4 },
      seed: { kind: 'loose', anchor: [-9.6, 2.4, -1.5], mass: 0.01, friction: 0.6,
        shape: [{ box: [2.2, 1.6, 2.2], at: [0, 0.8, 0] }], parts: (p) => p.c[0] < -8 && p.c[1] < 4.5 },
    },
  },
  // ---- M10: the two habitats must not move; they are free-standing ----
  'M10 Fragile Microhabitat A': {
    pieces: { habitat: { kind: 'loose', anchor: [6.4, 0, 0], planar: true, mass: 0.08, friction: 0.9, whole: true, shape: [{ box: [10, 8.5, 4], at: [0, 4.3, 0] }], parts: () => true } },
  },
  'M10 Fragile Microhabitat B': {
    pieces: { habitat: { kind: 'loose', anchor: [-6.2, 0, 0], planar: true, mass: 0.08, friction: 0.9, whole: true, shape: [{ box: [10.3, 8.4, 4], at: [0, 4.2, 0] }], parts: () => true } },
  },
  // ---- M11: knock the seed off its stalk; drop the root cover onto the mat ----
  'M11 Window to the Past': {
    base: [{ box: [8, 10, 8], at: [0.4, 5, -2.2] }],
    pieces: {
      // the seed hangs off the red stalk on the model's front (+z); knock it and it drops to the mat
      seed: { kind: 'loose', anchor: [-1.4, 9.0, 8.2], locked: true, releaseWhen: (s) => s.seed.touched, mass: 0.01, kick: [0, 0.2, 0.8],
        shape: [{ box: [2.4, 2.4, 2.6], at: [0, 0.6, 0.3] }], parts: (p) => p.c[2] > 5 && p.c[1] > 8.5 },
      // the button on the model's left side (-x): push it in and the root cover is released
      trigger: { kind: 'slider', axis: [1, 0, 0], anchor: [-3.4, 6.8, -1.6], range: [0, 2], damp: 1.5, gravity: false, mass: 0.02,
        shape: [{ box: [1.6, 3, 7], at: [0, 0, 0] }], parts: (p) => p.c[0] < -2.4 && p.c[1] > 5.4 },
      // the root cover: a long plate on top of the right side, hinged at its outer end, that swings down to the mat
      cover: { kind: 'hinge', axis: [1, 0, 0], anchor: [3.3, 6.8, -8.8], range: [0, 110], mass: 0.04, locked: true, releaseWhen: (s) => s.trigger.ext > 1.2,
        shape: [{ box: [1.2, 1.2, 10.4], at: [0, 0, 5.2] }], parts: (p) => p.c[0] > 2.8 && p.c[1] > 5.3 && p.c[1] < 7.2 && p.c[2] < 2 },
    },
  },
  // ---- M12: raise the cane against the tree; carry the support tie to the post ----
  'M12 Forest Elder': {
    base: [{ box: [5, 16, 5], at: [-0.5, 8, 0] }],
    pieces: {
      cane: { kind: 'hinge', axis: [0, 0, -1], anchor: [-1.2, 2.6, -0.6], range: [0, 78], latch: true, mass: 0.03, damp: 0.6,
        shape: [{ box: [9.4, 1.4, 1.4], at: [-5.2, 0, 0] }], parts: (p) => p.c[0] < -3.2 && p.c[1] < 1.6 && p.c[2] > -3.2 && p.c[2] < 2 },
      tie: { kind: 'loose', anchor: [-6.2, 0, -5.2], planar: true, mass: 0.04, friction: 0.5,
        shape: [{ box: [6, 2.4, 6], at: [0, 1.2, 0] }], parts: (p) => p.color === '4' && p.c[0] < -2.8 && p.c[1] < 9 },
    },
  },
  'M12 Forest Elder post': { base: [{ box: [7, 4, 2.6], at: [6, 2, 8.8] }], pieces: {} },
  // ---- M13: push the front bar in and the young trees rise; the keystone species must be on the platform ----
  'Dock farm (M13-15)': {
    base: [{ box: [14, 6, 6], at: [0, 3, 0] }],
    pieces: {
      bar: { kind: 'slider', axis: [0, 0, -1], anchor: [0, 3.2, 5.8], range: [0, 2.6], damp: 1.5, gravity: false, mass: 0.05,
        shape: [{ box: [13, 6, 1.6], at: [0, 1, 0] }], parts: (p) => p.c[2] > 4.3 && p.c[1] > 1.8 && p.c[1] < 4.6 },
      trees: { kind: 'lift', anchor: [0, 0, 0], drivenBy: { piece: 'bar', ratio: 1.3 },
        shape: [], parts: (p) => p.c[1] > 4.2 && ['2', '4', '10', '14', '27', '70'].includes(p.color) },
    },
    platformZone: { x: [-5, 5], z: [-4, 3], y: 5 },
  },
  // ---- M14: seeds carried from home must end up inside the replantation station ----
  'Dock city (M13-15)': {
    base: [{ box: [1.6, 7.6, 11], at: [-6, 3.8, 0] }, { box: [1.6, 3, 11], at: [6, 1.5, 0] }, { box: [14, 7.6, 1.6], at: [0, 3.8, -4.4] }, { box: [14, 7.6, 1.6], at: [0, 3.8, 4.4] }],
    pieces: {},
    stationZone: { x: [-5.2, 5.2], z: [-3.6, 3.6] },
  },
  // ---- M15: the canopy flap lifts, the skylight slides in, the compost hatch drops ----
  'Dock mine (M13-15)': {
    base: [{ box: [15, 7.4, 10], at: [0, 3.7, 0] }],
    pieces: {
      canopy: { kind: 'hinge', axis: [0, 0, 1], anchor: [1.0, 7.6, 0], range: [0, 58], latch: true, mass: 0.03, damp: 0.5,
        shape: [{ box: [10, 1.2, 9], at: [5, 0.4, 0] }], parts: (p) => p.c[1] > 7.3 && p.c[0] > 1.2 && !['0', '4', '71'].includes(p.color) },
      skylight: { kind: 'slider', axis: [-1, 0, 0], anchor: [4.5, 8, -1.6], range: [0, 5], damp: 1.5, gravity: false, mass: 0.03,
        shape: [{ box: [8, 1.2, 5], at: [0, 0, 0] }], parts: (p) => p.c[1] > 7.3 && p.c[0] >= -1.2 && (p.color === '0' || p.color === '4' || p.color === '71') },
      hatch: { kind: 'hinge', axis: [0, 0, -1], anchor: [7.5, 2.4, 0], range: [0, 95], mass: 0.03, damp: 0.4, gravity: false,
        shape: [{ box: [1.2, 3, 5], at: [0, 1.6, 0] }, { box: [1.8, 1.2, 3], at: [1.3, 2.6, 0] }], parts: (p) => p.c[0] > 6.8 && p.c[1] < 5.6 && Math.abs(p.c[2]) < 3 },
    },
  },
};

/** Equipment the team brings: loose pieces that start in home and get carried to the docks. */
export const EQUIPMENT_PIECES = [
  { id: 'keystone', label: 'Keystone species', color: 0xE34A9A, box: [4, 4, 4], mass: 0.05 },
  { id: 'seed1', label: 'Seed', color: 0x8B5A2B, box: [2, 2, 2], mass: 0.01 },
  { id: 'seed2', label: 'Seed', color: 0x8B5A2B, box: [2, 2, 2], mass: 0.01 },
  { id: 'seed3', label: 'Seed', color: 0x8B5A2B, box: [2, 2, 2], mass: 0.01 },
  { id: 'seed4', label: 'Seed', color: 0x8B5A2B, box: [2, 2, 2], mass: 0.01 },
];

export { DEG, near };
