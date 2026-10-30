# Plan: simulated mission-model interactions

Goal: kids can practise real missions in SPIKE Sim. The robot and its attachment push, flip, lift and
carry mission-model parts the way the real models move, and a scoresheet shows what they scored.

Status today: the drive is a kinematic model (wheel speeds → pose), models are fixed boxes that light up
when touched, the attachment is a tip that pushes movable boxes. LDraw visuals for the robot and the
BIOGLOW models are being wired in (`models/*.mpd`, `mat/season.json`).

## Principles

1. **The drive stays kinematic.** "Move 20 cm" must stay exactly 20 cm and turns must stay repeatable.
   Physics never moves the robot; the robot moves physics.
2. **Models are articulated, not free-form.** Each model is a dual-locked base plus 1–3 moving parts
   with real joint limits. No stacks of loose bricks.
3. **Deterministic.** Fixed timestep (the sim already steps at 200 Hz), seeded nothing, same program
   gives the same result every run.
4. **Degrades cleanly.** If the physics module fails to load (old tablet, offline), the current
   box behaviour stays.

## Engine

Rapier 3D (`@dimforge/rapier3d-compat` from cdnjs/jsdelivr, WASM, ~2 MB gzipped). Reasons: fixed-step
determinism, revolute/prismatic/fixed joints with limits and motors, convex-hull colliders, kinematic
bodies, works in a plain `<script type="module">` page. cannon-es was rejected for weak joints and
stacking; Ammo for size and API.

Runs in the main thread inside the existing `robot.update(dt)` loop at the same 5 ms step
(`world.timestep = 0.005`, `world.step()` once per sub-step). If profiling on an iPad shows it is too
slow, move it to a Web Worker and interpolate.

## Architecture

```
js/physics.js      Rapier world, unit conversion (cm ↔ m), body/joint factories, step(), queries
js/robot.js        unchanged kinematics; after computing the pose, sets the robot's kinematic body
js/mechanisms.js   per-model mechanism definitions (joints, limits, loose pieces, score rules)
js/world.js        obstacles become "fixtures": base collider + mechanism; keeps box fallback
js/sim3d.js        LDraw part groups are attached to physics bodies (moving parts follow their body)
js/scoring.js      evaluates score rules from body states; hub panel shows a scoresheet
mat/season.json    per model: mechanism id, pose; unchanged otherwise
```

Coordinate convention: physics in metres, Y up, same axes as three.js (x east, z south). One helper
converts the sim's cm/heading pose both ways.

### Robot

- One kinematic rigid body for the chassis (box collider from `build.js` geometry: track, wheel radius,
  footprint). Each step: `body.setNextKinematicTranslation/Rotation(pose)`.
- Attachment: a second kinematic body parented by pose math (not a joint), following the motor angle.
  Collider per module (arm beam + paddle, sweeper beam, forklift fork plate, plow blade).
- Keep the existing wall/fixed-base clamp in `world.resolveCircle` so the robot cannot drive through
  dual-locked bases (kinematic bodies are not stopped by physics). Movable pieces no longer use the
  box push; physics handles them.

### Mission models

Each `mechanisms.js` entry:

```js
'm03': {                               // Flip the Rock
  base: { hull: 'base' },              // fixed body from the model's static parts
  parts: [
    { id: 'rock', hull: 'rock', joint: { type: 'revolute', axis: [...], anchor: [...], limits: [0, 150] } },
  ],
  score: [{ when: 'rock.angle > 120', points: 30, text: 'Rock flipped' }],
}
```

- Hulls come from the LDraw part groups of the `.mpd` (LDrawLoader keeps a Group per subfile when
  `separateObjects` is on); group names are listed in the mechanism entry so each three.js group is
  attached to its body. Convex hulls are computed once at load (three.js ConvexGeometry) and cached.
- Joint axes/anchors: fll-sim's model build scripts (`tools/model-build/models/*.ts`) place every
  hinge and slider explicitly; read them from there first, measure from the LDraw file only when
  missing.
- Loose game pieces (seeds, leaves, tokens) are small dynamic bodies with a sleep threshold so they
  settle fast.

### Scoring

`scoring.js` evaluates each mission's rules every 100 ms while a match clock is running and at match
end. Rules are expressions over body state: joint angle, piece position inside a mat region, piece
touching a body. The hub panel gets a "Score" readout and a per-mission list; **Launch** resets all
bodies to their start poses.

## Order of work

1. **Rapier skeleton** (1 day): load the module, create the world, kinematic robot + attachment,
   walls, one dynamic test cube. Confirm determinism (same program, same final positions) and
   frame time on an iPad.
2. **Flip the Rock (M03)** end to end: base + hinged rock from the LDraw groups, score rule,
   visual follows the body. This proves hull extraction, joints and scoring.
3. **Pushing/lifting missions next**: Drone Survey (M01 lift off the pad), Lucky Leaves (M04),
   Reaching Roots (M05), Forest Elder (M12 post), the three docks (M13–15).
4. **Loose pieces**: Exploding Seeds (M02), Fragile Microhabitats (M10), Leafcutter Frenzy (M06–07),
   Tangled / Research Platform (M08–09), Window to the Past (M11), precision tokens.
5. **Scoresheet UI** in the hub panel, match-end summary, and a `.llsp3`-friendly "mission run" preset.
6. Optional: Web Worker physics, a "slow motion" button for debugging runs.

Estimate: steps 1–2 about two days; each further model half a day to a day depending on mechanism
count; roughly two to three weeks of focused work for the full set.

## Risks and how to handle them

- **Model files are reconstructions.** fll-sim's LDraw models were scripted from the official
  instructions; a mechanism may not match the real part exactly. Treat joint limits as tunable per
  model and check each against the real model on the team's table.
- **Kinematic vs fixed collisions.** A kinematic robot passes through fixed bodies. Keep the
  2D clamp for bases; make bases that are *meant* to be pushed (none this season) dynamic.
- **Performance on tablets.** Convex hulls per part can get expensive (M08–09 has 89 distinct
  parts). Merge static parts into one hull per base, and cap dynamic bodies per model.
- **Licence of the model files.** fll-sim has no licence file; its LDraw part geometry is CC BY
  (library) but the model arrangements are the author's. Ask the author or get the FIRST print
  files before publishing them beyond the team.
- **Determinism across devices.** Rapier is deterministic for the same WASM build and step; use the
  pinned CDN version and never step with a variable dt.

## Not in scope

Wheel slip, tipping, cable snags, battery sag, robot-to-robot contact. These make the sim less
predictable for beginners without teaching anything the real table does not teach faster.
