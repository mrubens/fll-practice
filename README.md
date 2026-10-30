# SPIKE Sim

A browser-based simulator for LEGO® Education SPIKE™ Prime. Kids write programs with the same
Word Blocks as the SPIKE App, run them on a simulated Driving Base in 3D, and save the result as a
`.llsp3` file that opens directly in the real SPIKE App 3 (desktop, tablet or web).

**Use it here: <https://mrubens.github.io/spike-sim/>** (works on any tablet or laptop; nothing to install).

Not affiliated with the LEGO Group. LEGO and SPIKE are trademarks of the LEGO Group.

## What's in it

- **Block editor** (Blockly, Scratch-style renderer) with the SPIKE categories: Movement, Motors, Light,
  Sound, Events, Control, Sensors, Operators, Variables. Block names, inputs, dropdowns and defaults
  match the SPIKE App.
- **3D simulator** (three.js): an FLL-sized table (236 x 114 cm) with walls, a black line loop, color tiles
  and obstacles. The robot is a standard Driving Base: 5.6 cm wheels, 11.2 cm track, color sensor
  in front pointing down, distance sensor in front. Drag the robot to place it; orbit/zoom the camera.
- **Hub panel**: 5x5 LED matrix, left/right buttons (click, or arrow keys), center button light,
  yaw/timer readouts, live sensor and motor values per port. Beeps play through the speakers.
- **Programs behave like Scratch/SPIKE**: every hat block is its own thread, `when ... button pressed`
  and `when <condition>` hats fire while the program runs, loops yield once per iteration, running stacks glow.
- **Save / Open `.llsp3`**: files written here open in the SPIKE App; the LEGO lesson files
  (Training Camp etc.) open here. Projects also autosave in the browser (My projects).
- **Robot builder**: a snap-together robot from a few parameters, previewed live in the 3D view: wheel size
  (5.6 or 8.8 cm), track width, hub flat or upright, hub ports, color-sensor and distance-sensor mount points,
  and an attachment module (arm, sweeper, forklift or plow blade) on a front/left/right/back mount. The
  geometry, sensor positions, cm-per-rotation default and attachment physics all derive from it. The build is
  saved with the project and inside exported `.llsp3` files (as an extra `spikesim-build.json` entry the SPIKE
  App ignores). The Training Camp Driving Base is a preset so the LEGO lessons still match.
- **FLL season field**: `mat/season.json` loads the BIOGLOW (2026-27) mat image (200 x 114 cm, centered on the
  236 cm table), the launch area and the mission models as real LEGO geometry: LDraw models of all 15 missions
  (plus the drone stand and the Forest Elder post) placed where the FIRST wireframe puts them, and the SPIKE
  Prime Driving Base itself built from real parts (hub, motors, sensors, frame). See `models/ATTRIBUTION.md`
  for sources and how to add models.
  **Launch** puts the robot in the launch area, resets the models and runs the program with a 2:30 match clock.
  The mat image comes from the public Robot Game Rulebook; replace `mat/season.png` (4 px/cm covering the
  whole 236 x 114 cm table) and edit `mat/season.json` for another season. Delete the file to get the plain
  practice mat back.
- **Missions and scoring**: click a mission model in the 3D view and the camera flies to it with a card:
  the mission's rulebook points, its tasks and how the simulator detects each one. Interactions are scripted,
  not physics: each task has a zone on the table and a required robot action (drive through it, lower the
  attachment onto it, lower then lift, or stay out of it). When it happens the model pulses green (some also
  move), the task ticks off and the score chip updates. "Practice this" puts the robot in the launch area,
  marks the first target with a green ring, draws the path, and reports how far from the target the robot
  stopped. Zones are approximate (built from the model positions); tune them in `js/missions.js`.
- **My Blocks**: "Make a Block" with number/text and true/false inputs. Definitions, calls and argument
  reporters are stored exactly as the SPIKE App stores them, so they round-trip through `.llsp3` files, run in
  the simulator and compile to Python functions.

## Run it

The hosted copy at <https://mrubens.github.io/spike-sim/> is published from the `main` branch by GitHub Pages,
so every push updates it. To run it locally, it is a static site and any web server works, for example:

```bash
python3 serve.py 8794
```

then open <http://localhost:8794>. It needs internet for the three CDN libraries (Blockly, three.js, JSZip)
and the Nunito font.

## Getting a program onto the real robot

Two ways:

1. **Save `.llsp3`** here, then in the SPIKE App use **Open Project** (web/desktop) or share the file to the
   iPad app. Connect the hub and press Run in the SPIKE App.
2. **Send to hub** over Bluetooth, no SPIKE App needed. Press **Connect hub** (the hub must be on and not
   connected to anything else), pick it in the browser dialog, then **Send to hub**: the program is compiled to
   SPIKE Python, uploaded to slot 0 and started. **Stop hub** stops it. This uses LEGO's published hub protocol
   (https://lego.github.io/spike-prime-docs/, firmware 3.x) via Web Bluetooth, which works in Chrome and Edge on
   laptops, Chromebooks and Android. It does not work in Safari or on iPad, and may not work inside the claude.ai
   artifact frame; use the hosted site there. **Python** shows the generated code so it can also be pasted into a
   SPIKE Python project.

The Bluetooth upload path was written against LEGO's protocol spec and example (COBS framing and CRC32 checked
against the reference implementation) but has not yet been exercised with a physical hub.

## Files

| File | Purpose |
|---|---|
| `js/spec.js` | The block catalogue: opcodes, inputs, fields and selector menus exactly as the SPIKE App stores them |
| `js/blocks.js` | Blockly setup: block definitions, custom fields (steering, LED image), theme, toolbox, dialogs |
| `js/interpreter.js` | Runs the workspace: threads, event hats, every block's behavior |
| `js/robot.js` | Robot and hub model: motors, differential-drive kinematics, sensors, matrix, sound |
| `js/world.js` | The table: mat drawing (also the color-sensor lookup), obstacles, ray casts, collisions |
| `js/sim3d.js` | three.js scene, robot mesh, camera, drag-to-place |
| `js/hub.js` | Hub panel UI and audio |
| `js/llsp3.js` | `.llsp3` export/import (project.json <-> Blockly) |
| `js/myblocks.js` | My Blocks (Scratch procedures): block shapes, Make-a-Block dialog, mutations |
| `js/build.js` | Robot build parameters, presets, derived geometry and validation |
| `js/missions.js`, `js/scoring.js`, `js/missionsui.js` | Mission definitions and points, scripted trigger engine, the click-on-model card |
| `mat/season.json`, `mat/season.png` | Season field: mat image, mission models (collision boxes + LDraw files), launch pose |
| `models/*.mpd` | Self-contained LDraw models: the 15 BIOGLOW missions and the SPIKE driving bases |
| `js/python.js` | Compiles the blocks to SPIKE Python 3 (one async task per hat block) |
| `js/ble.js` | Web Bluetooth client for the hub: COBS/XOR framing, CRC32 chunked upload, program start/stop |
| `js/app.js` | Toolbar, project storage, main loop |
| `artifact.html` | Same page with the stylesheet inlined, for publishing as a claude.ai artifact |
| `serve.py` | Tiny no-cache dev server |

## Not simulated (yet)

Force sensor, pitch/roll (the table is flat), sound files, broadcasts, and the light-matrix
pixel/brightness blocks. Mission models are rigid (their collision shapes are boxes); they do not move or score. Those blocks still exist in the SPIKE App; they are just not in this palette.
