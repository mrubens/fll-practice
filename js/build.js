// Robot build: a small set of parameters (no free-form bricks) from which the robot's geometry,
// ports and attachment are derived. Saved with the project and inside exported .llsp3 files.

export const WHEELS = { '5.6': { diameter: 5.6, calibration: 17.5, label: 'Small (5.6 cm)' }, '8.8': { diameter: 8.8, calibration: 27.6, label: 'Large (8.8 cm)' } };
export const MOUNTS = ['front', 'left', 'right', 'back'];
export const COLOR_MOUNTS = { front: 'front center', 'front-left': 'front left', 'front-right': 'front right', center: 'under the middle', back: 'back' };
export const MODULES = {
  none: { label: 'none', motor: false },
  arm: { label: 'arm (lifts up and down)', motor: true },
  sweeper: { label: 'sweeper (swings sideways)', motor: true },
  lift: { label: 'forklift (slides up)', motor: true },
  plow: { label: 'plow blade (no motor)', motor: false },
  basket: { label: 'basket (carries pieces, tips to dump)', motor: true },
};

export const PRESETS = {
  'guided-mission': {
    name: 'Guided Mission robot (Driving Base, color sensor on B, attachment motor on E)',
    wheel: '5.6', track: 11.2, hub: 'flat',
    ports: { left: 'C', right: 'D', color: 'B', distance: 'F', attachment: 'E' },
    colorMount: 'front', distanceMount: 'front',
    attachment: { module: 'arm', mount: 'front' },
  },
  'training-camp': {
    name: 'Training Camp Driving Base',
    wheel: '5.6', track: 11.2, hub: 'flat',
    ports: { left: 'C', right: 'D', color: 'E', distance: 'F', attachment: null },
    colorMount: 'front', distanceMount: 'front',
    attachment: { module: 'none', mount: 'front' },
  },
};

export function defaultBuild() { return normalizeBuild({ ...PRESETS['training-camp'], preset: 'training-camp' }); }

export function normalizeBuild(b) {
  const src = b || {};
  const base = PRESETS['training-camp'];
  const ports = Object.assign({}, base.ports, src.ports || {});
  const attachment = Object.assign({}, base.attachment, src.attachment || {});
  if (!MODULES[attachment.module]) attachment.module = 'none';
  // Attachments always go on the front and their motor is always on port E, like the Guided Mission robot:
  // one less thing for kids to decide. Whatever else was on E moves to its usual port.
  attachment.mount = 'front';
  ports.attachment = MODULES[attachment.module].motor ? 'E' : null;
  if (ports.attachment) {
    if (ports.color === 'E') ports.color = 'B';
    if (ports.distance === 'E') ports.distance = 'F';
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
    colorMount: 'front-right',   // the Driving Base carries its colour sensor at the front right
    distanceMount: MOUNTS.includes(src.distanceMount) ? src.distanceMount : 'front',
    attachment,
  };
}

/** Geometry (cm) derived from a build; x forward, lat positive = robot's right. */
export function geometryFor(build) {
  const wheel = WHEELS[build.wheel];
  const r = wheel.diameter / 2;
  const lift = r - 2.8; // everything rides higher on big wheels
  const colorMounts = { front: [7.5, 0], 'front-left': [7.5, -4], 'front-right': [6.4, 4], center: [0, 0], back: [-8, 0] };   // front-right: where Driving Base 3 hangs it
  const sensorMounts = { front: [9.5, 0, 0], right: [0, 7.5, 90], back: [-9.5, 0, 180], left: [0, -7.5, -90] };
  const mountPoints = { front: [8, 0, 0], right: [1, 7.5, 90], back: [-8, 0, 180], left: [1, -7.5, -90] };
  const [cf, cl] = colorMounts[build.colorMount];
  const [df, dl, da] = sensorMounts[build.distanceMount];
  const [af, al, aa] = mountPoints[build.attachment.mount];
  // The LEGO Driving Base (small wheels, 11.2 cm track, flat hub) has a known footprint, measured from its model:
  // 5.2 cm behind the axle (the caster) to 7.6 ahead (the motor and colour sensor), 16.8 wide. Other builds are a circle.
  const drivingBase = build.wheel === '5.6' && Math.abs(build.track - 11.2) < 0.05 && build.hub !== 'upright';
  return {
    wheelDiameter: wheel.diameter, wheelRadius: r, calibration: wheel.calibration, track: build.track,
    lift, radius: Math.max(9, build.track / 2 + 2.5),
    footprint: drivingBase ? { x0: -5.2, x1: 7.6, z0: -8.4, z1: 8.4 } : null,
    color: { fwd: cf, lat: cl }, distance: { fwd: df, lat: dl, angle: da, height: 5 + lift },
    // The arm is the Driving Base 2 arm from the FIRST robot guide: its axle is 6.4 cm ahead of the wheels and
    // 5.2 cm up, geared off the motor E gear; the cross bar at its tip is 7.15 cm from the axle, 23.5 degrees below
    // horizontal at rest. Other modules still hang from a mount 8 cm ahead.
    attachment: build.attachment.module === 'arm'
      ? { module: 'arm', mount: 'front', fwd: 6.4, lat: 0, angle: 0, length: 7.15, tipAngle: -23.5, height: 5.2 + lift, drop: 0 }
      : { module: build.attachment.module, mount: build.attachment.mount, fwd: af, lat: al, angle: aa, length: 12, height: 6 + lift, drop: 0 },
  };
}

export function portsOf(build) {
  const p = build.ports;
  return { left: p.left, right: p.right, color: p.color, distance: p.distance, attachment: MODULES[build.attachment.module].motor ? p.attachment : null };
}

/** Problems a build has (duplicate ports etc.), as kid-readable sentences. */
export function validateBuild(build) {
  const issues = [];
  const used = [build.ports.left, build.ports.right, build.ports.color, build.ports.distance];
  if (MODULES[build.attachment.module].motor) {
    if (!build.ports.attachment) issues.push('The attachment needs a motor port.');
    else used.push(build.ports.attachment);
  }
  if (new Set(used).size < used.length) issues.push('Each hub port can only be used once.');
  if (build.attachment.module !== 'none' && build.attachment.mount === build.distanceMount && build.attachment.mount !== 'front') issues.push('The attachment and the distance sensor are on the same side.');
  return issues;
}
