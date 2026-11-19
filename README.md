# FLL Practice

A browser simulator for FIRST® LEGO® League Challenge teams using LEGO® Education SPIKE™ Prime, set up for the
BIOGLOW (2026-27) season. Kids write programs with the same Word Blocks as the SPIKE App, run them on a to-scale
field with all fifteen mission models, see what scores, then take the same program to the real robot.

**Use it at <https://mrubens.github.io/fll-practice/>.** It runs on any laptop or tablet with nothing to install.

<img width="1080" height="648" alt="FLL Practice: the block editor beside the BIOGLOW field" src="https://github.com/user-attachments/assets/afcd0404-a1b2-4c84-a2f7-19342ca51e63" />

Not affiliated with FIRST or the LEGO Group.

## What it does

- **Same blocks as the SPIKE App.** The palette matches SPIKE App 3: same categories, blocks, dropdowns and
  defaults, including My Blocks.
- **The BIOGLOW field.** The table, mat, launch areas and all fifteen mission models, built from real LEGO parts.
  The models' moving parts have physics, and scoring follows the Robot Game Rulebook. Click a model to see its
  mission and how it scores.
- **Matches.** **Start match** runs a 2:30 match with referee rules: launch areas, equipment inspection,
  precision tokens, and swapping programs and attachments in home. **Run** is free practice.
- **Hands on the field.** In free practice, drag the robot to place it, or drag any moving part of a model to
  try its mechanism.
- **Robot builder.** Choose the Training Camp robot, the Guided Mission robot or the Advanced Driving Base, place
  sensors and set hub ports. Pick a ready-made attachment, or build your own from the SPIKE Prime kit's parts:
  parts only connect where real LEGO connects. **Instructions** shows LEGO-style building steps for whatever you
  built.
- **Debugging.** Step through a program one block at a time, step back, or drive by hand with W A S D (Q and E
  move the attachment). Hover the mat to measure distances and angles from the robot.
- **Practice tables.** Besides the season table: a line-following table, a Training Camp table, and a calibration
  strip ([calibration.html](calibration.html)) for checking distances and turns against the real robot.
- **To the real robot.** Projects save in the browser and as `.llsp3` files the SPIKE App opens.

## Getting a program onto the real robot

1. **Save .llsp3**, then open the file in the SPIKE App (web, desktop or iPad) and run it from there. This is the
   reliable way.
2. **Connect hub** and **Send to hub** compile the program to SPIKE Python and upload it over Bluetooth (Chrome
   or Edge; not Safari or iPad). This hasn't been tried on a physical hub yet. **Python** shows the generated code.

## How accurate it is

It's a practice tool: a program that works here is a good start, but distances and turns still need tuning on the
real table.

| | |
|---|---|
| Driving | SPIKE's own movement math (wheel size, track, steering). No wheel slip or battery sag, so real runs drift a few percent and a few degrees. |
| Pushing and lifting | Motors and wheels are as strong as needed. An attachment stalls on what it can't move, and the robot stops at walls and models. |
| Mission models | Real LEGO geometry with hinges, sliders and latches. A few mechanisms are simplified. |
| Scoring | The rulebook's tasks, bonuses and penalties, including FIRST's challenge updates. Zones are measured from the mat and are approximate. |
| Sensors | Ideal: no noise or lag. The color sensor reads the mat under it, the distance sensor casts one ray, the gyro is the true heading. |
| Not simulated | Tilting, sound files, broadcasts, light matrix pixels, sensor noise. |

## Running it yourself

It's a static site; GitHub Pages publishes `main`. To run it locally:

```bash
python3 serve.py 8794
```

Then open <http://localhost:8794>. It needs internet for the CDN libraries (Blockly, three.js, Rapier, JSZip).

For another season, replace `mat/season.jpg` (16 px/cm) and `mat/season.json` (model poses and collision boxes),
add LDraw models to `models/` (see `models/ATTRIBUTION.md`), and update `js/missions.js` and `js/mechanisms.js`.

## Code

| Files | What they do |
|---|---|
| `js/spec.js`, `js/blocks.js`, `js/myblocks.js` | The SPIKE block catalog and the Blockly editor |
| `js/interpreter.js` | Runs programs |
| `js/robot.js`, `js/build.js` | The robot, hub and motors |
| `js/world.js`, `js/physics.js`, `js/mechanisms.js` | The table, Rapier physics and each model's moving parts |
| `js/missions.js`, `js/scoring.js` | Missions, scoring and match rules |
| `js/sim3d.js` | The 3D view |
| `js/lego*.js`, `js/instructions.js` | The robot builder and building instructions |
| `js/llsp3.js`, `js/python.js`, `js/ble.js` | `.llsp3` files, Python export and Bluetooth |
| `js/app.js` | The app: toolbar, projects, main loop |

## Credits and license

The project's own code and documentation are under the [MIT License](LICENSE). Some files come from elsewhere and
keep their own terms (details in `models/ATTRIBUTION.md`):

- **LEGO part geometry:** the [LDraw Parts Library](https://library.ldraw.org) (CC BY 4.0).
- **Where parts connect** (`models/lego/snaps.json`, `models/lego/base.json`): derived from the
  [LDCad shadow library](https://github.com/RolandMelkert/LDCadShadowLibrary) (CC BY-SA 4.0), so these two files
  are CC BY-SA 4.0 too.
- **Mission models, driving bases and arm models:** from [fll-sim](https://github.com/martijas/fll-sim), with its
  measurements of where the models sit on the mat.
- **FIRST's material:** the BIOGLOW mat artwork (`mat/`), the Guided Mission program (`samples/`) and the
  rulebook wording in `js/missions.js`.
- **Blockly's media files** (`media/`): Apache License 2.0.

LEGO® and SPIKE™ are trademarks of the LEGO Group; FIRST® and FIRST® LEGO® League are trademarks of FIRST. Neither
sponsors or endorses this project.
