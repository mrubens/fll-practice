# Model attribution

The `.mpd` files in this folder are self-contained LDraw models (each one embeds every part it uses).

- **Part geometry**: the [LDraw Parts Library](https://library.ldraw.org), licensed CC BY 4.0 (older parts
  CC BY 2.0) by the LDraw contributors. Packed with low-resolution primitives to keep the simulator fast.
- **Mission models (`m01` … `m15`, `m01-stand`, `m12-post`) and the driving bases**: reconstructed part by part
  from the official FIRST LEGO League BIOGLOW building instructions by the
  [fll-sim](https://github.com/martijas/fll-sim) project (`apps/desktop/resources/missions` and
  `resources/robots`), whose model files carry the note "Model data for simulation use". Model placement on the
  mat also comes from fll-sim's measurements of the FIRST wireframe PDF.
- `LDConfig.ldr`: LDraw colour definitions (LDraw library, CC BY 4.0).

LEGO® and SPIKE™ are trademarks of the LEGO Group; FIRST® LEGO® League is a trademark of FIRST. Neither
sponsors or endorses this project.

## Adding or replacing a model

1. Build the model in BrickLink Studio (or any LDraw editor) and export it as LDraw (`.ldr`).
2. Pack it with every part it uses into one `.mpd` (a small script that walks the LDraw library and appends each
   referenced file as a `0 FILE` section; name subparts `parts/s/<file>` and hi-res primitives `p/48/<file>`
   the way three.js's LDrawLoader looks them up). Low-resolution `8\` primitives keep the triangle count down.
3. Reference it from `mat/season.json`: `"model": "models/<name>.mpd"` and `"modelPose": {x, y, heading}` on
   the mission-model entry (cm from the table centre, y positive towards the south wall; heading 0 = facing
   north, positive = counter-clockwise from above). The entry's box stays as the collision shape.
4. The robot body for the Training Camp preset is `models/driving-base.mpd` (origin at the axle midpoint on the
   mat, forward −z, left +x, y down, as in LDraw); the simulator keeps its own spinning wheels.
