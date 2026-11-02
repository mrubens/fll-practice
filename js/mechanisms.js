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
// damp (viscous resistance so a lever stays where it was pushed), planar (stays flat on the mat), mass (kg),
// spring ({ target, k, d }: driven towards an extension or angle once free). Base boxes and shapes take `rot` (Euler deg).

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

// M06: a leaf launches when the rack is pushed in faster than about 15 cm/s while the gears are engaged.

export const MECHANISMS = {
  // ---- Training camp objects (boards.js): loose LEGO bricks the robot can push, lift or knock over ----
  'Training marker': { pieces: { marker: { kind: 'loose', anchor: [0, 4.8, 0], whole: true, mass: 0.03, friction: 0.8, shape: [{ box: [3.2, 9.6, 3.2], at: [0, 0, 0] }], parts: () => true } } },
  // the cube is an open Technic frame (two rings of 5-long beams on 7-long posts): the arm's fork slides in
  // between the rings and lifts it by the top ring
  'Training cube': { pieces: { cube: { kind: 'loose', anchor: [0, 2.8, 0], whole: true, mass: 0.02, friction: 0.9, shape: [{ box: [0.8, 0.8, 4], at: [-1.6, -2.4, 0] }, { box: [0.8, 0.8, 4], at: [1.6, -2.4, 0] }, { box: [4, 0.8, 0.8], at: [0, -2.4, -1.6] }, { box: [4, 0.8, 0.8], at: [0, -2.4, 1.6] }, { box: [0.8, 0.8, 4], at: [-1.6, 2.4, 0] }, { box: [0.8, 0.8, 4], at: [1.6, 2.4, 0] }, { box: [4, 0.8, 0.8], at: [0, 2.4, -1.6] }, { box: [4, 0.8, 0.8], at: [0, 2.4, 1.6] }, { box: [0.8, 5.6, 0.8], at: [-1.6, 0, -1.6] }, { box: [0.8, 5.6, 0.8], at: [1.6, 0, -1.6] }, { box: [0.8, 5.6, 0.8], at: [-1.6, 0, 1.6] }, { box: [0.8, 5.6, 0.8], at: [1.6, 0, 1.6] }], parts: () => true } } },
  'Training cube 2': { pieces: { cube: { kind: 'loose', anchor: [0, 2.8, 0], whole: true, mass: 0.02, friction: 0.9, shape: [{ box: [0.8, 0.8, 4], at: [-1.6, -2.4, 0] }, { box: [0.8, 0.8, 4], at: [1.6, -2.4, 0] }, { box: [4, 0.8, 0.8], at: [0, -2.4, -1.6] }, { box: [4, 0.8, 0.8], at: [0, -2.4, 1.6] }, { box: [0.8, 0.8, 4], at: [-1.6, 2.4, 0] }, { box: [0.8, 0.8, 4], at: [1.6, 2.4, 0] }, { box: [4, 0.8, 0.8], at: [0, 2.4, -1.6] }, { box: [4, 0.8, 0.8], at: [0, 2.4, 1.6] }, { box: [0.8, 5.6, 0.8], at: [-1.6, 0, -1.6] }, { box: [0.8, 5.6, 0.8], at: [1.6, 0, -1.6] }, { box: [0.8, 5.6, 0.8], at: [-1.6, 0, 1.6] }, { box: [0.8, 5.6, 0.8], at: [1.6, 0, 1.6] }], parts: () => true } } },
  // ---- M01 (build book 1, field setup, missions video 107-121 s): the rig lies flat along the south wall. Every pin
  // in it spins freely and all of them run across the rig, so it folds in one upright plane, and that plane turns on
  // the pilot's turntable. The pilot's base is Dual-Locked; the chair turns on it, bar B is pinned to the chair, the
  // drone hangs from the pin at the far end of bar B (where bar A is pinned too), and bar A ends at the red scan
  // marker, which is free on the mat. Push the marker toward the pilot and the bars fold up into an A, lifting the
  // drone. Both bars are 26.4 cm pin to pin.
  'M01 Drone Survey': {
    pieces: {
      chair: { kind: 'hinge', axis: [0, 1, 0], anchor: [25.92, 0.8, 8.8], range: [-170, 170], mass: 0.02, damp: 0.05,
        parts: (p) => (p.i >= 51 && p.i <= 67) || (p.i >= 70 && p.i <= 81) },
      barB: { kind: 'hinge', parent: 'chair', axis: [0, 0, 1], anchor: [25.92, 1.52, 8.8], range: [-100, 100], mass: 0.012, damp: 0.02,
        parts: (p) => [48, 49, 50, 82, 83, 84].includes(p.i) },
      drone: { kind: 'hinge', parent: 'barB', axis: [0, 0, 1], anchor: [-0.41, 3.44, 8.8], range: [-170, 170], mass: 0.03, damp: 0.02,
        parts: (p) => p.i >= 20 && p.i <= 44 },
      barA: { kind: 'hinge', parent: 'barB', axis: [0, 0, 1], anchor: [-0.41, 3.44, 8.8], range: [-170, 170], mass: 0.012, damp: 0.02,
        parts: (p) => [17, 18, 19, 45, 46, 47].includes(p.i) },
      marker: { kind: 'hinge', parent: 'barA', axis: [0, 0, 1], anchor: [-26.72, 1.2, 8.8], range: [-170, 170], mass: 0.015, damp: 0.02, friction: 0.35, outline: true,
        parts: (p) => p.i >= 1 && p.i <= 16 },
    },
  },
  // the LiDAR map's stand turns on the pin ends of two tan axle-pins in the back holes of the grey U base. It starts
  // tipped forward, map face down over the survey area; pushed up past upright it falls back onto the base, map up.
  'M01 Drone stand': {
    pieces: {
      map: { kind: 'hinge', axis: [-0.9781, 0, 0.2079], anchor: [15.2, 1.2, -8.83], range: [-5, 144], mass: 0.03, damp: 0.1,
        parts: (p) => p.i <= 21 || p.i === 44 },
    },
  },
  // ---- M02 (build book 2, field setup, missions video 134-137 s): the stalk is one rigid, Dual-Locked body with no
  // hinges. The three seeds hang by their gold rings on the green 6L bar that rises 30.6 degrees out of the stem.
  // A ring only comes off over the bar's free end, so a seed is a slide along the bar until it drops off the end;
  // pulling the innermost seed (1) out shoves the other two off ahead of it. Seeds 2 and 3 stay tied to the top
  // of the stalk by their springy hoses, which swing them out once they are free.
  'M02 Exploding Seeds': {
    hidden: (p) => (p.i >= 60 && p.i <= 116) || p.i >= 124,      // the hoses: drawn as live hoses (tethers)
    pieces: {
      seed1: { kind: 'slider', axis: [0, 0.5088, 0.8609], anchor: [0.8, 11.699, 2.166], range: [0, 3.6], freeAt: 3.39, mass: 0.006, damp: 0.2, contact: true,
        parts: (p) => p.i >= 43 && p.i <= 52 },
      seed2: { kind: 'slider', axis: [0, 0.5088, 0.8609], anchor: [0.8, 12.147, 2.924], range: [0, 2.7], freeAt: 2.51, pushedBy: 'seed1', mass: 0.006, damp: 0.2, contact: true,
        kick: [-20, 10, 0], tether: { from: [0.38, 15.27, -5.22], to: [-4.2, -0.45, 0.28], length: 15.2, hose: true, radius: 0.28, rest: [-6.5, 6, 0.5], k: 12, d: 0.3 },
        parts: (p) => p.i >= 53 && p.i <= 59 },
      seed3: { kind: 'slider', axis: [0, 0.5088, 0.8609], anchor: [0.8, 12.635, 3.75], range: [0, 1.75], freeAt: 1.55, pushedBy: 'seed2', mass: 0.006, damp: 0.2, contact: true,
        kick: [20, 10, 0], tether: { from: [1.22, 14.79, -4.58], to: [4.2, -0.435, 0.25], length: 15.2, hose: true, radius: 0.28, rest: [8, 6, 0.5], k: 12, d: 0.3 },
        parts: (p) => p.i >= 117 && p.i <= 123 },
    },
  },
  // ---- M03 (build book 3, missions video): the rock is a platform with a scene on each face. Pushing the red levers
  // back stands it up and over so the brown underside shows; pushing its top forward flips it back. The research flag
  // (the lime L at the front right) starts raised and drops flat once the rock goes over. The real platform swings on
  // two links; here it turns about one axis through its middle, which lands it back on the base like the real one,
  // and it rests on either face (its weight sits off the axis).
  'M03 Flip the Rock': {
    pieces: {
      rock: { kind: 'hinge', axis: [-1, 0, 0], anchor: [0, 4.15, -0.6], range: [0, 178], mass: 0.15, com: [0, 4.15, 1.4], damp: 0.3, friction: 0.6,
        parts: (p) => (p.i >= 21 && p.i <= 44) || p.i >= 66 },
      levers: { kind: 'hinge', axis: [-1, 0, 0], anchor: [0, 4.4, -2.4], range: [-5, 85], mass: 0.03, gravity: false,
        couple: { piece: 'rock', map: (th) => 80 * Math.sin(th * DEG) },
        parts: (p) => [46, 47, 48, 59, 60, 61].includes(p.i) },
      flag: { kind: 'hinge', axis: [-1, 0, 0], anchor: [4.8, 0.6, 1.6], start: 50, range: [0, 50], mass: 0.02, damp: 0.2,
        locked: true, releaseWhen: (s) => s.rock.angle > 60,
        parts: (p) => [11, 12, 13, 14].includes(p.i) },
    },
  },
  // ---- M04 (build book 4, field setup, missions video 183-190 s): the nest is three base leaves, Dual-Locked in a
  // chevron around the leaf habitat's cut corner. Two plain leaves and the katydid just sit in the recesses (book
  // 11.6: "These do not actually connect to anything"); lift one by its loop or body and it is free. In our model
  // the katydid is in the right (+x) recess. The pieces sit a hair higher so they do not start sunk into the nest.
  'M04 Lucky Leaves': {
    pieces: {
      leafL: { kind: 'loose', anchor: [-6.7, 1.0, -1.7], shift: [0, 0.06, 0], mass: 0.008, friction: 0.8, contact: true, outline: true,
        parts: (p) => p.i >= 48 && p.i <= 67 },
      leafM: { kind: 'loose', anchor: [0, 1.0, 1.0], shift: [0, 0.06, 0], mass: 0.008, friction: 0.8, contact: true, outline: true,
        parts: (p) => p.i >= 68 && p.i <= 87 },
      katydid: { kind: 'loose', anchor: [6.7, 0.81, -1.7], shift: [0, 0.06, 0], mass: 0.009, friction: 0.8, contact: true, outline: true,
        parts: (p) => p.i >= 88 && p.i <= 110 },
    },
  },
  // ---- M05 (build book 5, field setup p7, missions video 227-236 s): the model is Dual-Locked against the north wall.
  // The trunk extension (brown, with the coral flower) starts folded forward and down; it turns on the white axle-pin
  // at the top of the trunk. Lift its red ball (on the 4L axle at its end) up and back and it swings over to lean back
  // on the trunk's 3L axle joiner: partly extended. The root arm (two green 7L liftarms) hangs on that 4L axle, with
  // the lever and claw on a free tan pin in it; flip the arm over the top so it points back across the wall: fully
  // extended. Free pins everywhere, gravity holds every end state.
  'M05 Reaching Roots': {
    pieces: {
      extension: { kind: 'hinge', axis: [-1, 0, 0], anchor: [0, 8.4, 1.6], range: [0, 170], mass: 0.02, damp: 0.05,
        parts: (p) => [18, 19, 20, 21, 22, 23, 24, 74, 75, 76, 77].includes(p.i) },
      // the lever and claw ride on the arm (their own swing on the tan pin does not matter for the mission)
      arm: { kind: 'hinge', parent: 'extension', axis: [-1, 0, 0], anchor: [0, 4.645, 6.151], start: 3.5, range: [-175, 3.5], mass: 0.02, damp: 0.05, noGround: true,
        parts: (p) => (p.i >= 54 && p.i <= 73) },
    },
  },
  // ---- M06 (official build book 6 and the missions video): the ant rides on a white gear rack that starts pulled out
  // of the nest's front wall; push it in until it stops. Its last few centimetres turn the gears and cams under the
  // four upright leaves: push too fast and a leaf launches ("too fast, or you might launch a leaf!", step 69).
  // The LDraw model has the rack pushed in, so the piece starts shifted out.
  // M07 (same book, steps 70-91, and the missions video): the web trap stands on its own tower at the nest's right,
  // turned 45 degrees. It is folded over towards the field, hanging from a tan pin at the top of a white 15L liftarm
  // that runs steeply down through the tower to a red handle on the mat. Pull the handle outward and the trap flips
  // up and back over the wall (towards the other table's M05 root), where it stays. The trap and the handle are the
  // m07-trap / m07-handle subassemblies of the model; everything moves in the tower's plane (s = (-x + z) / sqrt 2).
  'M06-07 Leafcutter Frenzy / Humongous Fungus': {
    base: [{ box: [11, 9, 8], at: [1.5, 4.5, -5.5] }, { box: [4, 12.4, 3.2], at: [5.47, 6.2, 0.41], rot: [0, -45, 0] }],
    pieces: {
      // the rack (with the ant on its platform) slides in the slot of the nest's front wall; pulled out 6.5 cm at the start
      ant: { kind: 'slider', axis: [1, 0, 0], anchor: [-6.06, 0.56, -4.59], shift: [-6.5, 0, 0], range: [-8, 0], damp: 1.2, gravity: false, mass: 0.05, friction: 0.5,
        parts: (p) => (p.i >= 39 && p.i <= 53) || (p.i >= 89 && p.i <= 107) },
      // the rack turns the 20T gear (1 cm pitch radius) and, through the 28T-12T bevel pair, the camshaft under the leaves
      gear: { kind: 'gear', axis: [0, 0, 1], anchor: [-3.26, 2.48, -4.6], drivenBy: { piece: 'ant', ratio: 1.0 },
        parts: (p) => p.i >= 84 && p.i <= 87 },
      camshaft: { kind: 'gear', axis: [1, 0, 0], anchor: [1.5, 2.48, -6.59], drivenBy: { piece: 'ant', ratio: -2.333 },
        parts: (p) => p.i >= 63 && p.i <= 76 },
      // the handle: the 15L liftarm with the red bar at its foot; it slides outward (away from the tower) along the mat
      handle: { kind: 'slider', axis: [-0.7071, 0, 0.7071], anchor: [2.98, 0.64, 2.9], range: [0, 1.2], damp: 1.2, gravity: false, mass: 0.03, friction: 0.6,
        shape: [{ box: [5.6, 1.2, 1.2], at: [0, 0, 0], rot: [0, -45, 0] }, { box: [0.8, 12, 0.8], at: [1.48, 5.19, -1.48], rot: [-29.74, -40.97, -20.54] }],
        parts: (p) => p.file === 'm07-handle.ldr' },
      // the web trap: pivots on the tan pin at the bar's top; released by the pull, it swings 175 degrees over the top
      // and latches out (completely extended)
      mycelium: { kind: 'hinge', axis: [-0.7071, 0, -0.7071], anchor: [5.95, 11.03, -0.06], range: [0, 175], locked: true, releaseWhen: (s) => s.handle.ext > 0.8,
        spring: { target: 175, k: 150, d: 18 }, latch: true, gravity: false, mass: 0.05, friction: 0.5,
        shape: [{ box: [7.2, 1.4, 5.4], at: [-5.97, -4.78, 5.97], rot: [0, -45, 0] }, { box: [4, 8, 1], at: [-2.07, -2.73, 2.07], rot: [123.4, 28.83, 36.18] }],
        parts: (p) => p.file === 'm07-trap.ldr' },
      // the four leaf fragments stand in their slots in the roof, each foot resting on a cam: the slot lets a leaf only go
      // up and down, and one thrown up past the top of its slot (push the ant in too fast) flies out
      frag1: { kind: 'slider', axis: [0, 1, 0], anchor: [-0.86, 6.0, -6.59], range: [-1.5, 3.6], freeAt: 3.3, mass: 0.004, damp: 6, collidesWith: ['camshaft'], parts: (p) => p.i >= 154 && p.i <= 157 },
      frag2: { kind: 'slider', axis: [0, 1, 0], anchor: [0.74, 6.0, -6.59], range: [-1.5, 3.6], freeAt: 3.3, mass: 0.004, damp: 6, collidesWith: ['camshaft'], parts: (p) => p.i >= 158 && p.i <= 161 },
      frag3: { kind: 'slider', axis: [0, 1, 0], anchor: [3.14, 6.0, -6.59], range: [-1.5, 3.6], freeAt: 3.3, mass: 0.004, damp: 6, collidesWith: ['camshaft'], parts: (p) => p.i >= 162 && p.i <= 165 },
      frag4: { kind: 'slider', axis: [0, 1, 0], anchor: [4.74, 6.0, -6.59], range: [-1.5, 3.6], freeAt: 3.3, mass: 0.004, damp: 6, collidesWith: ['camshaft'], parts: (p) => p.i >= 166 && p.i <= 169 },
    },
  },
  // ---- M08/M09: the vine drops when touched, the platform lifts, the camera trap flips out, the seed falls ----
  'M08-09 Tangled / Research Platform': {
    pieces: {
      // M08 (build book 7, missions video 308-311 s): the vine hangs from two free tan pins at the front-right root (the
      // lime vine arm, then the vine itself) and is hooked over the little angled branch with the flower. Lift it off
      // the branch and it swings forward onto the mat. Held on the branch until something touches it.
      vineArm: { kind: 'hinge', axis: [-1, 0, 0], anchor: [4.0, 0.4, -0.8], range: [-170, 170], mass: 0.004, drag: 3,
        locked: true, releaseWhen: (s) => s.vine.touched || s.vineArm.touched, parts: (p) => p.i === 362 },
      vine: { kind: 'hinge', parent: 'vineArm', axis: [-1, 0, 0], anchor: [4.0, 2.904, 1.192], range: [-170, 170], mass: 0.02,
        locked: true, releaseWhen: (s) => s.vine.touched || s.vineArm.touched, parts: (p) => p.i >= 363 && p.i <= 402 },
      // M09 (build book 7, missions video 332-341 s): the research platform is a collar round the trunk that slides up;
      // its back bar ratchets over pairs of red stud pins on the trunk, so it stays at the height it was lifted to.
      // Its left extension holds the camera trap upright (a red L-liftarm on a free pin): raise the platform 3 cm and the
      // trap falls out. Its right extension lifts the red latch lever (after 4.5 cm), whose short end stops propping the
      // seed branch, which tips over and lets the pinecone slide off its axle.
      platform: { kind: 'slider', axis: [0, 1, 0], anchor: [0, 8.36, -3.51], range: [0, 8.1], ratchet: [4.87, 6.47, 8.07], mass: 0.06, gravity: true,
        collidesWith: ['camera', 'latch'], parts: (p) => p.i >= 225 && p.i <= 360 },
      camera: { kind: 'hinge', axis: [0, 0, 1], anchor: [-2.4, 2.8, 0], range: [-5, 100], mass: 0.008, drag: 2, locked: true, releaseWhen: (s) => s.platform.ext > 3, kickSpin: 0.6, parts: (p) => p.i >= 11 && p.i <= 19 },
      latch: { kind: 'hinge', axis: [0, 0, 1], anchor: [0.8, 14.0, 0], start: -22, range: [-22, 45], mass: 0.004, collidesWith: ['branch'],
        parts: (p) => p.i === 147 || p.i === 148 },
      branch: { kind: 'hinge', axis: [0, 0, 1], anchor: [-0.8, 15.6, 0], range: [0, 70], mass: 0.006, drag: 1, locked: true, releaseWhen: (s) => s.platform.ext > 4.5, kickSpin: 0.6, parts: (p) => p.i >= 149 && p.i <= 155 },
      // the pinecone hangs on the branch's yellow axle and slides off once the branch has tipped far enough
      seed: { kind: 'hinge', parent: 'branch', axis: [0, 0, 1], anchor: [-6.0, 21.5, -1.9], range: [-1, 1], freeWhen: (s) => s.branch.angle > 40, mass: 0.004, contact: true,
        parts: (p) => p.i >= 456 && p.i <= 464 },
    },
  },
  // ---- M10 (build book 8, field setup p10, missions video 355-372 s): both habitats are Dual-Locked to the mat, so
  // their frames never move; what a robot can spoil is the mechanism on each.
  // Snail habitat: the lime neck turns on two tan pins at its foot and leans toward +x on the brown arm. Push its
  // head about 40 degrees toward -x and it goes over the top and falls head-down on the mat (125.7 degrees).
  'M10 Fragile Microhabitat A': {
    pieces: {
      neck: { kind: 'hinge', axis: [0, 0, 1], anchor: [4.37, 1.94, 0], range: [0, 125.7], mass: 0.02, damp: 0.05,
        parts: (p) => p.i >= 11 && p.i <= 29 },
    },
  },
  // Spider habitat: the web is six white beams joined by free-spinning pins, a parallelogram pinned at its foot.
  // The three uprights turn together and the two cross beams ride along level; pushed toward +x it collapses
  // into a stack lying on the bottom beam (77 degrees). The little brown liftarm hanging in its top corner leans
  // on the first upright and is the only thing holding the web up against a light bump.
  'M10 Fragile Microhabitat B': {
    pieces: {
      webB: { kind: 'hinge', axis: [0, 0, -1], anchor: [-7.79, 0.36, 0], range: [-7, 77], mass: 0.0023, noGround: true,
        stiction: { pieces: ['webB', 'webE', 'webF', 'webC', 'webD'] },
        parts: (p) => p.i === 20 },
      webF: { kind: 'hinge', axis: [0, 0, -1], anchor: [-1.39, 0.36, 0], range: [-7, 77], mass: 0.0023, noGround: true,
        parts: (p) => p.i === 32 },
      // the cross beams and the middle upright hang on pins only, so the loop is closed without a pin too many
      webC: { kind: 'link', axis: [0, 0, -1], anchor: [-4.59, 3.56, -0.8], mass: 0.0025,
        links: [{ piece: 'webB', at: [-7.79, 3.56, 0] }, { piece: 'webF', at: [-1.39, 3.56, 0] }],
        parts: (p) => [23, 24, 25, 26].includes(p.i) },
      webE: { kind: 'link', axis: [0, 0, -1], anchor: [-4.59, 0.36, 0], mass: 0.004, noGround: true,
        links: [{ piece: 'webC', at: [-4.59, 3.56, 0] }],
        parts: (p) => [31, 33, 34].includes(p.i) },
      webD: { kind: 'link', axis: [0, 0, -1], anchor: [-4.59, 6.76, -0.8], mass: 0.0025,
        links: [{ piece: 'webB', at: [-7.79, 6.76, 0] }, { piece: 'webE', at: [-4.59, 6.76, 0] }],
        parts: (p) => [27, 28, 29, 30].includes(p.i) },
      // drawn swung 38 degrees; it really hangs about 17 degrees out, leaning on the first upright: that small weight is
      // what keeps the web standing
      pendulum: { kind: 'hinge', axis: [0, 0, 1], anchor: [-7.34, 7.5, 0], start: -21, range: [-38, 90], mass: 0.001, damp: 0.05,
        collidesWith: ['webB'], parts: (p) => p.i === 17 },
    },
  },
  // ---- M11 (build book 9, field setup p11, missions video 388-393 s): the model is Dual-Locked. The root cover stands
  // in front of the window on two free-spinning pins at its foot, leaning 7 degrees back on the box; its red top
  // edge sticks out 3.2 cm past the box's -z side as a handle. Tip it forward past upright and it falls open flat on
  // the mat (101 degrees). The seed hangs by its red connector on the tip of the brown curved bar (pointing up):
  // lift it about a centimetre and it comes off. +x is the front.
  'M11 Window to the Past': {
    soft: (p) => p.c[1] > 6.5 && p.c[2] < 5,   // the plants above the green platform bend out of the way
    pieces: {
      cover: { kind: 'hinge', axis: [0, 0, -1], anchor: [4.23, 0.88, -2.38], range: [0, 101.2], mass: 0.04, friction: 1.0, damp: 0.1,
        parts: (p) => p.i >= 1 && p.i <= 14 },
      seed: { kind: 'slider', axis: [0, 0.924, 0.383], anchor: [-1.37, 10.86, 5.11], range: [0, 1.2], freeAt: 1.0, mass: 0.003, damp: 0.1, contact: true,
        parts: (p) => p.i >= 101 && p.i <= 110 },
    },
  },
  // ---- M12 (build book 10, field setup p12, missions video 408-417 s): tree and post are Dual-Locked. The cane turns
  // on the red axle at the tree's foot; it starts lying on the mat along the tree's -z (north), propped half a
  // centimetre up by its green knob. Lift its far end up and over (past 88 degrees) and it falls onto the trunk.
  // The red support tie stands in the slot between the red wall panels on the tree's +z side, tied to the trunk
  // by an 11.7 cm chain: lift it out (0.7 cm frees it), carry it to the post and drop it around the upright.
  'M12 Forest Elder': {
    hidden: (p) => p.i >= 87 && p.i <= 109,      // the chain: drawn as a live chain (tether)
    pieces: {
      cane: { kind: 'hinge', axis: [-1, 0, 0], anchor: [1.2, 0.88, -4.0], start: 111.6, range: [0, 111.6], mass: 0.012, damp: 0.1, friction: 0.6,
        parts: (p) => p.i >= 59 && p.i <= 70 },
      tie: { kind: 'loose', anchor: [0, 4.64, 2.4], mass: 0.012, friction: 0.6, contact: true,
        tether: { from: [0, 7.0, 1.2], to: [0, 4.4, 0.24], length: 11.7 },
        parts: (p) => p.i >= 71 && p.i <= 86 },
    },
  },
  'M12 Forest Elder post': { base: [{ box: [7, 4, 2.6], at: [6, 2, 8.8] }], pieces: {} },
  // ---- M13 (official build book 11 and the missions video): the restoration platform rides in two slots inside a
  // frame of liftarms; the four young trees are pinned to it and, while it is up, lean in across it toward the far end (book step 36). Set the
  // keystone species on the platform (or press it down) and it sinks, standing the trees up. The LDraw model is
  // built with the platform down and the trees up, so the pieces start shifted up and turned out.
  'Dock city (M13-15)': {
    pieces: {
      // the restoration platform rides up and down in the guides; it starts 1.1 cm up, held there by the leaning trees
      // pressing on their stops (a cam). Weight on it (the keystone) or a push sinks it and stands the trees up.
      platform: { kind: 'slider', axis: [0, 1, 0], anchor: [0, 4.4, 0], shift: [0, 1.1, 0], range: [0, 1.69], spring: { target: 1.1, k: 12, d: 0.6 }, gravity: false, mass: 0.017, friction: 0.8,
        parts: (p) => (p.i >= 77 && p.i <= 98) || (p.i >= 127 && p.i <= 130) },
      // the four young trees pivot on free pins of the platform and all lean the same way (toward +x) while it is up
      tree1: { kind: 'follow', drivenBy: { piece: 'platform', travel: 1.1 }, axis: [0, 0, -1], angle: 45, anchor: [3.2, 4.4, 3.2], shift: [0, 1.1, 0], mass: 0.004,
        parts: (p) => [99, 100, 101, 111, 112, 113, 114].includes(p.i) },
      tree2: { kind: 'follow', drivenBy: { piece: 'platform', travel: 1.1 }, axis: [0, 0, -1], angle: 45, anchor: [3.2, 4.4, -2.8], shift: [0, 1.1, 0], mass: 0.004,
        parts: (p) => [102, 103, 104, 115, 116, 117, 118].includes(p.i) },
      tree3: { kind: 'follow', drivenBy: { piece: 'platform', travel: 1.1 }, axis: [0, 0, -1], angle: 45, anchor: [-3.2, 4.4, 2.8], shift: [0, 1.1, 0], mass: 0.004,
        parts: (p) => [105, 106, 107, 119, 120, 121, 122].includes(p.i) },
      tree4: { kind: 'follow', drivenBy: { piece: 'platform', travel: 1.1 }, axis: [0, 0, -1], angle: 45, anchor: [-3.2, 4.4, -3.2], shift: [0, 1.1, 0], mass: 0.004,
        parts: (p) => [108, 109, 110, 123, 124, 125, 126].includes(p.i) },
    },
  },
  // ---- M14: seeds carried from home must end up inside the replantation station ----
  // ---- M14 (build book 12, field setup p14, missions video 462-475 s): the replantation station has no floor; inside it
  // hang eight swings on free-spinning pins, six short ones across and two long ones along, crossing like a grid with
  // gaps of about a centimetre. A seed sitting on one rod stays up; one wedged between rods pushes them apart and
  // drops to the mat (the bonus). Every swing hangs straight down by itself and can push its neighbours.
  'Dock mine (M13-15)': {
    pieces: {
      swing1: { kind: 'hinge', axis: [0, 0, 1], anchor: [-4.0, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, collidesWith: ['swing2', 'swing3', 'swing4', 'swing5', 'swing6', 'long1', 'long2'], parts: (p) => p.i >= 73 && p.i <= 77 },
      swing2: { kind: 'hinge', axis: [0, 0, 1], anchor: [-2.4, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, parts: (p) => p.i >= 78 && p.i <= 82 },
      swing3: { kind: 'hinge', axis: [0, 0, 1], anchor: [-0.8, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, parts: (p) => p.i >= 83 && p.i <= 87 },
      swing4: { kind: 'hinge', axis: [0, 0, 1], anchor: [0.8, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, parts: (p) => p.i >= 88 && p.i <= 92 },
      swing5: { kind: 'hinge', axis: [0, 0, 1], anchor: [2.4, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, parts: (p) => p.i >= 93 && p.i <= 97 },
      swing6: { kind: 'hinge', axis: [0, 0, 1], anchor: [4.0, 5.28, 0], range: [-60, 60], mass: 0.003, drag: 4, friction: 0.5, parts: (p) => p.i >= 98 && p.i <= 102 },
      long1: { kind: 'hinge', axis: [1, 0, 0], anchor: [0, 6.08, 0.8], range: [-85, 85], mass: 0.004, drag: 4, friction: 0.5, parts: (p) => p.i >= 103 && p.i <= 111 },
      long2: { kind: 'hinge', axis: [1, 0, 0], anchor: [0, 6.08, -0.8], range: [-85, 85], mass: 0.004, drag: 4, friction: 0.5, parts: (p) => p.i >= 112 && p.i <= 120 },
    },
  },
  // ---- M15: the building (from the official build book 13 and the missions video) ----
  // Model frame: +z is the front (the open wall with the crank), +x is the left as you face the front.
  //  - nesting canopy: the black 4x10 plate with the blue bird, hinged along the back edge of the roof's left half,
  //    with a red rod and ball sticking out to the left; raised by lifting its front edge (or the rod) up
  //  - garden skylight: the black 6x6 tile with the red tile frame, on rails under the right half of the roof;
  //    it starts pulled out behind the building and is pushed in by its red frame
  //  - compost hatch: the black 3-beam panel low on the front, on the crank with the red ball; pushing the ball
  //    down swings the panel out and down until it lies on the mat
  'Dock farm (M13-15)': {
    pieces: {
      // M15 (build book 13, field setup p15, missions video 488-519 s). The nesting canopy turns on two free pins at
      // the back of the roof and lies on the nest. Its grey L-liftarm prop hangs on a free pin near the front edge: lift
      // the canopy past about 98 degrees and the prop swings under, so lowered again it rests propped up about 20 degrees.
      canopy: { kind: 'hinge', axis: [-1, 0, 0], anchor: [-2.26, 6.96, -5.44], range: [0, 160], prop: { after: 98, rest: 20 }, mass: 0.008, drag: 4,
        parts: (p) => [177, 178, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194].includes(p.i) },
      // the garden skylight slides in its rails; it starts pulled out 4 cm behind the back wall
      skylight: { kind: 'slider', axis: [0, 0, 1], anchor: [3.34, 6.24, 1.76], shift: [0, 0, -4.0], range: [-4.0, 0], damp: 1.5, gravity: false, mass: 0.012,
        parts: (p) => p.i >= 118 && p.i <= 132 },
      // the compost hatch: a crank on two free axle-pins low in the front wall; its weight keeps it shut until the ball is
      // pushed about 22 degrees forward, then it falls open until the ball lands on the mat
      hatch: { kind: 'hinge', axis: [1, 0, 0], anchor: [-1.0, 1.84, 3.76], range: [0, 150], mass: 0.012, drag: 4,
        parts: (p) => p.i >= 52 && p.i <= 77 },
    },
  },
};

/** Equipment the team brings: loose pieces that start in home and get carried to the docks. */
// The team's own equipment on the field: only the keystone species (bag 20). The seeds for M14 are collected
// from the field itself: three from the seed pod (M02), one from the research platform (M09), one from M11.
export const EQUIPMENT_PIECES = [
  { id: 'keystone', label: 'Keystone species', color: 0xE34A9A, box: [3.2, 6, 1.6], mass: 0.02 },   // a bag-20 brick stack, about 2x4 studs and 6 cm tall
];
export const FIELD_SEEDS = [['M02 Exploding Seeds', 'seed1'], ['M02 Exploding Seeds', 'seed2'], ['M02 Exploding Seeds', 'seed3'], ['M08-09 Tangled / Research Platform', 'seed'], ['M11 Window to the Past', 'seed']];

/** A measured part (models/parts/*.json entry) as the part predicates see it: { i, color, c, s, file }. */
export function partInfo(e) { return { i: e.i, color: String(e.c), c: e.a, s: e.s, file: e.f }; }
/** Which piece of a model a part belongs to: a piece name, 'base', or null when it is not drawn (def.hidden). */
export function pieceOfPart(def, info) {
  if (def.hidden && def.hidden(info)) return null;
  for (const [n, pd] of Object.entries(def.pieces || {})) { try { if (pd.parts(info)) return n; } catch { /* a predicate that does not apply */ } }
  return 'base';
}

export { DEG, near };
