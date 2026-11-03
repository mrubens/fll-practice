// Robot build: the Driving Base, its ports, the sensors placed on it (LEGO parts) and its attachment, from which the
// robot's geometry is derived. Saved with the project and inside exported .llsp3 files.

export const WHEELS = { '5.6': { diameter: 5.6, calibration: 17.5, label: 'Small (5.6 cm)' }, '8.8': { diameter: 8.8, calibration: 27.6, label: 'Large (8.8 cm)' } };
export const MOUNTS = ['front', 'left', 'right', 'back'];
export const MODULES = {
  none: { label: 'none', motor: false },
  arm: { label: 'arm (the robot guide\'s Driving Base 2 arm: lifts up and down)', motor: true },
  plow: { label: 'dozer blade (tilts up and down)', motor: true },
  basket: { label: 'basket (carries pieces, tips to dump)', motor: true },
  sweeper: { label: 'sweeper (swings sideways on the motor\'s axle)', motor: true },
  custom: { label: 'my own attachment (built from LEGO parts in the attachment builder)', motor: true },
  scoop: { label: 'side scoop (a long plate out to the left that slides under things and lifts them)', motor: true },
  // Hidden from the builder until it is rebuilt as a real, pinned-together LEGO assembly like the others.
  lift: { label: 'forklift (slides up)', motor: true, hidden: true },
};

// Sensors are LEGO parts placed on the robot in the robot builder (an .ldr in the Driving Base's LDraw frame, like
// a custom attachment), each with a hub port. Per sensor part: what it is, and where its lens (or eyes) are and which
// way it looks, in the part's own LDraw frame (LDU; both sensors look along their -z).
export const SENSOR_PARTS = {
  '37308': { type: 'color', label: 'Color sensor', lens: [0, 0, -49], dir: [0, 0, -1] },
  '37316': { type: 'distance', label: 'Distance sensor', lens: [0, 0, -69], dir: [0, 0, -1] },
};
// The Driving Base's color sensor, at the front right where Driving Base 3 hangs it, looking down 1.6 cm above the mat.
const COLOR_AT_FRONT_RIGHT = '1 15 -100 -90 -160 0 -1 0 0 0 -1 1 0 0 37308.dat';
// A distance sensor low at the front, between the wheels, looking forward 2 cm above the mat.
const DISTANCE_AT_FRONT = '1 15 0 -50 -92 1 0 0 0 1 0 0 0 1 37316.dat';
/** A robot body with the usual sensors: the color sensor and the distance sensor, on these ports. */
export function standardBody(colorPort = 'B', distancePort = 'F') {
  const lines = [], ports = {};
  if (colorPort) { ports[lines.length] = colorPort; lines.push(COLOR_AT_FRONT_RIGHT); }
  if (distancePort) { ports[lines.length] = distancePort; lines.push(DISTANCE_AT_FRONT); }
  return { ldr: lines.join('\n') + '\n', ports };
}
const isPort = (p) => typeof p === 'string' && /^[A-F]$/.test(p);

/** The type-1 lines of an .ldr as {f, p, r} (without loading the parts). */
function ldrParts(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] !== '1' || t.length < 15) continue;
    const n = t.slice(2, 14).map(Number);
    if (n.some((v) => !Number.isFinite(v))) continue;
    out.push({ f: t.slice(14).join(' ').replace(/\.dat$/i, '').toLowerCase(), p: n.slice(0, 3), r: n.slice(3, 12) });
  }
  return out;
}

/** The sensors on a build's body: [{i, type, label, port, q}] (i: the part's index in the body .ldr). */
export function sensorsOf(build) {
  const body = build.body || { ldr: '', ports: {} };
  return ldrParts(body.ldr).map((q, i) => (SENSOR_PARTS[q.f] ? { i, ...SENSOR_PARTS[q.f], port: body.ports[i] || null, q } : null)).filter(Boolean);
}

export const PRESETS = {
  'guided-mission': {
    name: 'Guided Mission robot (Driving Base, color sensor on B, attachment motor on E)',
    wheel: '5.6', track: 11.2, hub: 'flat',
    ports: { left: 'C', right: 'D', attachment: 'E' },
    body: standardBody('B', 'F'),
    attachment: { module: 'arm', mount: 'front' },
  },
  'training-camp': {
    name: 'Training Camp Driving Base',
    wheel: '5.6', track: 11.2, hub: 'flat',
    ports: { left: 'C', right: 'D', attachment: null },
    body: standardBody('E', 'F'),
    attachment: { module: 'none', mount: 'front' },
  },
};

export function defaultBuild() { return normalizeBuild({ ...PRESETS['training-camp'], preset: 'training-camp' }); }

export function normalizeBuild(b) {
  const src = b || {};
  const base = PRESETS['training-camp'];
  const ports = Object.assign({}, base.ports, src.ports || {});
  // the robot's own parts: its sensors (with their ports) and what holds them. Saves from before sensors were parts
  // had a color sensor and a distance sensor at fixed places, on the ports they named.
  let body;
  if (src.body && typeof src.body.ldr === 'string') {
    body = { ldr: src.body.ldr.slice(0, 300000), ports: {} };
    for (const [k, v] of Object.entries(src.body.ports || {})) if (/^\d+$/.test(k) && isPort(v)) body.ports[k] = v;
  } else body = standardBody(isPort(ports.color) ? ports.color : 'B', isPort(ports.distance) ? ports.distance : 'F');
  delete ports.color; delete ports.distance;
  const attachment = Object.assign({}, base.attachment, src.attachment || {});
  // a custom attachment keeps its parts (an .ldr in the Driving Base's frame) and what the builder measured of it
  if (attachment.module === 'custom') {
    attachment.ldr = String(attachment.ldr || '').slice(0, 300000);
    attachment.length = Number(attachment.length) || 0; attachment.tipAngle = Number(attachment.tipAngle) || 0;
    attachment.stops = Array.isArray(attachment.stops) && attachment.stops.length === 2 ? attachment.stops.map(Number) : [-180, 180];
  } else { delete attachment.ldr; delete attachment.length; delete attachment.tipAngle; delete attachment.stops; }
  if (!MODULES[attachment.module] || MODULES[attachment.module].hidden) attachment.module = 'none';
  // Attachments always go on the front and their motor is always on port E, like the Guided Mission robot:
  // one less thing for kids to decide. Whatever else was on E moves to its usual port.
  attachment.mount = 'front';
  ports.attachment = MODULES[attachment.module].motor ? 'E' : null;
  if (ports.attachment) {
    // a sensor that was on E moves to a free port
    const taken = new Set([ports.left, ports.right, 'E', ...Object.values(body.ports)]);
    for (const [k, v] of Object.entries(body.ports)) {
      if (v !== 'E') continue;
      const free = ['B', 'F', 'A', 'C', 'D'].find((p) => !taken.has(p));
      if (free) { body.ports[k] = free; taken.add(free); } else delete body.ports[k];
    }
  }
  return {
    preset: src.preset || null,
    name: String(src.name || base.name),
    // Every robot is the Training Camp Driving Base (small wheels, 11.2 cm track, hub flat): older saves with
    // other wheels or an upright hub fold back onto it.
    wheel: base.wheel,
    track: base.track,
    hub: 'flat',
    ports,
    body,
    attachment,
  };
}

/** Geometry (cm) derived from a build; x forward, lat positive = robot's right. */
export function geometryFor(build) {
  const wheel = WHEELS[build.wheel];
  const r = wheel.diameter / 2;
  const lift = r - 2.8; // everything rides higher on big wheels
  const mountPoints = { front: [8, 0, 0], right: [1, 7.5, 90], back: [-8, 0, 180], left: [1, -7.5, -90] };
  const [af, al, aa] = mountPoints[build.attachment.mount];
  // LDraw (x left, y down, z back; LDU) -> robot (fwd, up, right; cm)
  const toRobot = (v) => [-v[2] * 0.04, -v[1] * 0.04 + lift, -v[0] * 0.04];
  const turn = (r, v) => [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
  const sensors = sensorsOf(build).filter((x) => x.port).map((x) => {
    const lens = toRobot(turn(x.q.r, x.lens).map((v, k) => v + x.q.p[k]));
    const d = turn(x.q.r, x.dir), dir = [-d[2], -d[1], -d[0]];
    return { port: x.port, type: x.type, pos: lens, dir };
  });
  const bodyLdr = build.body && ldrParts(build.body.ldr).length ? build.body.ldr : '';
  // The LEGO Driving Base (small wheels, 11.2 cm track, flat hub) has a known footprint, measured from its model:
  // 5.2 cm behind the axle (the caster) to 7.6 ahead (the motor and color sensor), 16.8 wide. Other builds are a circle.
  const drivingBase = build.wheel === '5.6' && Math.abs(build.track - 11.2) < 0.05 && build.hub !== 'upright';
  return {
    wheelDiameter: wheel.diameter, wheelRadius: r, calibration: wheel.calibration, track: build.track,
    lift, radius: Math.max(9, build.track / 2 + 2.5),
    footprint: drivingBase ? { x0: -5.2, x1: 7.6, z0: -8.4, z1: 8.4 } : null,
    // each sensor's lens (fwd, up, right; cm) and the way it looks (a unit vector in the same axes)
    sensors,
    // the robot's own LEGO parts (sensors and their mounts), and everything built from parts the physics and the
    // drawing put on the robot: those plus a custom attachment
    bodyLdr,
    partsLdr: bodyLdr + (build.attachment.module === 'custom' ? (build.attachment.ldr || '') : ''),
    // The arm is the Driving Base 2 arm from the FIRST robot guide: its axle is 6.4 cm ahead of the wheels and
    // 5.2 cm up, geared off the motor E gear; the cross bar at its tip is 7.15 cm from the axle, 23.5 degrees below
    // horizontal at rest. Other modules still hang from a mount 8 cm ahead.
    // The dozer blade and basket hang from the same bracket and axle. The sweeper is a beam on motor E's own
    // axle, which stands at the front left, so it swings about a vertical axis there.
    attachment: (() => {
      const m = build.attachment.module;
      if (m === 'arm') return { module: m, mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: 7.15, tipAngle: -23.5, height: 5.2 + lift, drop: 0 };
      if (m === 'plow') return { module: m, mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: 4.5, tipAngle: -30, height: 5.2 + lift, drop: 0 };
      if (m === 'basket') return { module: m, mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: 6.4, height: 5.2 + lift, drop: 0 };
      if (m === 'custom') return { module: m, mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: build.attachment.length || 1, tipAngle: build.attachment.tipAngle || 0, height: 5.2 + lift, drop: 0, ldr: build.attachment.ldr || '', stops: build.attachment.stops };
      if (m === 'scoop') return { module: m, mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: 18.0, tipAngle: -15.5, height: 5.2 + lift, drop: 0 };
      if (m === 'sweeper') return { module: m, mount: 'front', fwd: 6.4, lat: -3.2, angle: 0, length: 12.8, height: 5.6 + lift, drop: 0 };
      return { module: m, mount: build.attachment.mount, fwd: af, lat: al, angle: aa, length: 12, height: 6 + lift, drop: 0 };
    })(),
  };
}

/**
 * The side scoop's parts as boxes in the frame of the arm axle at rest (x forward, y up, z right; cm), with `pitch` in
 * degrees nose up (models/attach/scoop-moving.mpd): two 4 x 6 bent liftarms on the motor E axle, forward and down
 * to an axle across their tips; two cross blocks hanging from it hold a 15-long beam that reaches out to the left;
 * at its end a Technic brick on a 2x2 plate sits on a 2x14 plate lying on the mat, the scoop. The physics and the
 * placeholder drawing both use these.
 */
export const SCOOP_PARTS = [
  ...[-1.6, 1.6].flatMap((z) => [{ size: [4.8, 0.8, 0.8], at: [1.2, -1.6, z], pitch: -53.13 }, { size: [3.2, 0.8, 0.8], at: [3.6, -3.2, z] }]),
  { size: [0.5, 0.5, 4], at: [4.8, -3.2, 0] },              // the axle across the liftarm tips
  { size: [0.8, 1.6, 2.4], at: [4.8, -3.6, 0] },            // two cross blocks hanging from it
  { size: [0.8, 0.8, 12], at: [5.6, -4.0, -4.8] },          // the 15-long beam, holes facing forward, out to the left
  { size: [0.8, 1.13, 1.6], at: [6.4, -3.995, -10.0] },     // Technic brick 1x2 pinned to its end
  { size: [1.6, 0.32, 1.6], at: [6.8, -4.72, -10.0] },      // the 2x2 plate under it
  { size: [11.2, 0.45, 1.6], at: [11.6, -4.95, -10.0] },    // the 2x14 plate: the scoop
];

/** What is on each port: the wheel motors, the attachment motor, and sensors ({port: 'color'|'distance'}). */
export function portsOf(build) {
  const p = build.ports;
  const sensors = {};
  for (const x of sensorsOf(build)) if (x.port && !sensors[x.port]) sensors[x.port] = x.type;
  return { left: p.left, right: p.right, attachment: MODULES[build.attachment.module].motor ? p.attachment : null, sensors };
}

/** Problems a build has (duplicate ports etc.), as kid-readable sentences. */
export function validateBuild(build) {
  const issues = [];
  const sensors = sensorsOf(build);
  const used = [build.ports.left, build.ports.right, ...sensors.filter((x) => x.port).map((x) => x.port)];
  const unplugged = sensors.filter((x) => !x.port).length;
  if (unplugged) issues.push(`${unplugged === 1 ? 'A sensor is' : `${unplugged} sensors are`} not plugged into a port.`);
  if (MODULES[build.attachment.module].motor) {
    if (!build.ports.attachment) issues.push('The attachment needs a motor port.');
    else used.push(build.ports.attachment);
  }
  if (new Set(used).size < used.length) issues.push('Each hub port can only be used once.');
  return issues;
}
