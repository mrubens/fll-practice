# FLL Practice

BIOGLOW practice simulator for SPIKE Prime teams.

A browser simulator for FIRST® LEGO® League Challenge teams using LEGO® Education SPIKE™ Prime. The team
writes programs with the same Word Blocks as the SPIKE App, runs them on a to-scale BIOGLOW (2026-27) field
with the real mission models, sees what scores, and then takes the exact same program to the real robot.

**Use it here: <https://mrubens.github.io/fll-practice/>** (any laptop or tablet, nothing to install).

Not affiliated with FIRST or the LEGO Group. LEGO, SPIKE, FIRST and FIRST LEGO League are their trademarks.

## For the team

- **Code it like the SPIKE App.** The block palette (Movement, Motors, Light, Sound, Events, Control, Sensors,
  Operators, Variables, My Blocks) has the same blocks, names, dropdowns and defaults as SPIKE App 3, so nothing
  has to be relearned on the real tablet.
- **Run it on the BIOGLOW field.** The table is 236 x 114 cm with the 200 cm season mat, the launch areas and
  all 15 mission models as real LEGO geometry, placed where the field setup guide puts them. Drag the robot to
  position it, orbit and zoom the camera, or press **Follow** to ride along.
- **Launch like a match.** **Launch** puts the robot in the left launch area, resets the field and runs the
  program with the 2:30 match clock in the hub strip.
- **See what scores.** Click a mission model and the camera flies to it with a card: the mission's rulebook
  points, its tasks, and how the simulator detects each one (drive into it, lower the attachment onto it, lower
  then lift, or keep away). When the robot does it the model pulses green, the task ticks off and the points
  chip in the view updates. The models are physical: every mission has real moving parts (hinges, sliders,
  loose pieces, things that drop when touched) built on Rapier physics, and points come from where those parts
  end up, worded like the Robot Game Rulebook. The rock flips over on its hinge and drops the flag; the seeds
  pop off the pod when the stalk is pushed; the leaves lift out of the nest by their loops; the vine falls when
  touched; the root and mycelium slide; the platform, cane, canopy and camera trap latch when raised; the
  hatch and root cover swing down; the ant cart rolls to the nest (ram it and the leaf fragments fly out); the
  habitats are only standing on the mat, so bumping them costs the points. Collisions are real too: the robot
  and its attachment stop at walls and models, a motor pressing the arm into something stalls (its "run for"
  block gives up after a moment, like the hub), and the whole thing runs at 200 Hz with substeps.
- **Start from FIRST's own Guided Mission.** On first visit the app loads the official 2026-27 Guided Mission program
  (`samples/guided-mission-bioglow-11.llsp3`, from the FIRST season resources) with the robot it was written for:
  Driving Base, color sensor on B, attachment motor on E. Press Launch and it drives from the left launch area along
  the black line to Mission 11, knocks the seed off and backs into the right launch area, exactly like the SPIKE App
  lesson. The Guided Mission robot is also a preset in the robot builder.
- **Play a match like a referee scores it.** Launch starts a 2:30 match: the robot must be completely inside a
  launch area (the quarter circles in home), the equipment inspection bonus (20) is awarded if it fits there, and
  the team's loose equipment (the keystone species and four seeds) is loaded into the robot's basket attachment,
  or left in home when there is none. Stop while the robot is outside home and a precision token is lost (six
  tokens are worth 50, then 50/35/25/15/10). Relaunching needs the robot back in a launch area. When time is up
  the sheet freezes, and missions marked with the no-equipment constraint score nothing if their model is
  touching the robot. Run (the play button) is free practice with no match rules.
- **Carry things.** The robot builder has a basket attachment that tips forward over its front lip, so the
  keystone species can be dumped onto the restoration platform and the seeds into the replantation station.
- **Practice one mission.** "Practice this" on a mission card resets the robot to the launch area, marks the
  first target with a green ring and draws the robot's path; when the program stops it reports how far from the
  target the robot ended and how far it was turned. That is the loop kids actually iterate on.
- **Build your robot.** **Robot builder** sets wheel size (5.6 or 8.8 cm), track width, hub orientation, hub
  ports, color and distance sensor mounts, and an attachment (arm, sweeper, forklift, plow) on a front, left,
  right or back mount. Everything in the simulation (geometry, sensor positions, cm per rotation, attachment
  reach) follows from it. The Training Camp Driving Base is a preset so the LEGO lessons still match.
- **Save for the real robot.** Projects autosave in the browser (My projects). **Save .llsp3** writes a file
  the SPIKE App opens unchanged (verified against the SPIKE web app, including My Blocks). The robot build
  travels inside the file.

## Getting a program onto the real robot

1. **Save .llsp3** here, then **Open Project** in the SPIKE App (web/desktop) or share the file to the iPad app,
   connect the hub and run it there. This is the reliable path.
2. **Send to hub** over Bluetooth: **Connect hub** (hub on, not connected to anything else), pick it in the
   browser dialog, then **Send to hub** compiles the program to SPIKE Python, uploads it to slot 0 and starts it.
   Works in Chrome and Edge on laptops, Chromebooks and Android; not in Safari or on iPad. Written against
   LEGO's published hub protocol (https://lego.github.io/spike-prime-docs/) but not yet tried on a physical hub.
   **Python** shows the generated code for pasting into a SPIKE Python project.

## How accurate is it

- The drive uses the SPIKE math exactly: 5.6 cm wheels (17.59 cm per rotation), 11.2 cm track, the same
  17.5 cm/rotation calibration the hub uses, the same steering rule. There is no wheel slip, acceleration
  overshoot or battery sag, so real runs drift a few percent and a few degrees; expect to retune numbers on the
  real table.
- Mission-model positions and footprints come from the FIRST wireframe PDF (measured by the fll-sim project);
  the mat image is the Robot Game Rulebook's render, since FIRST does not publish the print file. Scoring zones
  are built from the model positions and are approximate; adjust them in `js/missions.js`.
- Not simulated: force sensor, pitch/roll (the table is flat), sound files, broadcasts, light-matrix pixel
  blocks, precision tokens and inspection points. Mission models do not articulate.

## Run or host it yourself

It is a static site. The hosted copy is published from `main` by GitHub Pages. Locally:

```bash
python3 serve.py 8794
```

then open <http://localhost:8794>. It needs internet for the CDN libraries (Blockly, three.js, Rapier, JSZip) and the
Nunito font. For another season: replace `mat/season.jpg` (16 px/cm covering the whole table), edit
`mat/season.json` (model boxes, poses, launch pose) and add packed LDraw models to `models/` (see
`models/ATTRIBUTION.md`); without a season file the simulator falls back to a plain practice mat.

## Files

| File | Purpose |
|---|---|
| `js/spec.js` | The block catalog: opcodes, inputs, fields and selector menus exactly as the SPIKE App stores them |
| `js/blocks.js`, `js/myblocks.js` | Blockly setup, custom fields, theme, toolbox; My Blocks (Scratch procedures) |
| `js/interpreter.js` | Runs the workspace: threads, event hats, every block's behavior |
| `js/robot.js`, `js/build.js` | Robot and hub model (motors, kinematics, sensors, matrix, sound) and the build it derives from |
| `js/world.js`, `js/physics.js`, `js/mechanisms.js` | The table: mat (also the color-sensor lookup), season loading, obstacles; Rapier layer (kinematic robot, collide-and-slide, arm stall) and the per-model mechanisms (pieces, joints, which LEGO parts move) |
| `js/sim3d.js` | three.js scene, LDraw models, robot mesh, camera, drag-to-place, click-to-inspect |
| `js/missions.js`, `js/scoring.js`, `js/missionsui.js` | Missions with rulebook wording and points read from the physical state, the referee (match rules, tokens, end-of-match freeze), mission card |
| `js/hub.js` | Hub strip UI and audio |
| `js/llsp3.js` | `.llsp3` export/import (project.json <-> Blockly) |
| `js/python.js`, `js/ble.js` | SPIKE Python compiler and the Web Bluetooth hub client |
| `js/app.js` | Toolbar, project storage, builder UI, main loop |
| `mat/season.json`, `mat/season.jpg` | Season field: mat image, mission models (collision boxes + model files), launch pose |
| `models/*.mpd` | Self-contained LDraw models: the 15 BIOGLOW missions and the SPIKE driving bases |
| `artifact.html`, `serve.py` | Inlined-stylesheet copy for publishing as a claude.ai artifact; tiny no-cache dev server |

## Credits

Mission models and the driving bases are LDraw reconstructions from the official building instructions by
[fll-sim](https://github.com/martijas/fll-sim); part geometry is the [LDraw Parts Library](https://library.ldraw.org)
(CC BY). The `.llsp3` format and block shapes were verified against files written by the SPIKE App.
