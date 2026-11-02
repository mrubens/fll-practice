// LEGO connections for the attachment builder: where parts can snap together, and what a finished build is made of.
//
// Connector data comes from tools/snaps.py (models/lego/snaps.json, derived from the LDCad shadow library, CC BY-SA
// 4.0). A connector is a cylinder along a line: a start point, the direction its sections run, and the sections
// themselves (R round, A axle, S square, L a lip) with radius and length, all in LDraw units. Two connectors join when
// they are coaxial, of opposite gender, and the male's sections fit the female's where they overlap: an axle in an
// axle hole locks rotation, anything round turns. Everything here works in one frame, the Driving Base's own LDraw
// frame (models/src/driving-base.ldr: origin at the axle midpoint on the mat, forward -z, left +x, y down; LDU).
//
// No three.js here: plain arrays, so the same code runs in the builder, the physics and tests.

export const LDU = 0.04;           // cm

// ---------------- data ----------------

let data = null, ready = null;
/** Load the parts, connectors and Driving Base context (cached). */
export function loadLego(base = '') {
  if (!data) {
    const get = (f) => fetch(base + 'models/lego/' + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
    data = Promise.all([get('parts.json'), get('snaps.json'), get('base.json')]).then(([parts, snaps, ctx]) => (ready = { parts, snaps: snaps.parts, ctx }));
    data.catch((err) => { console.warn('LEGO parts failed to load', err); data = null; });
  }
  return data;
}
/** The loaded data, or null while it is still loading. */
export function legoReady() { return ready; }
/** Use already-fetched data (tests). */
export function setLegoData(D) { ready = D; data = Promise.resolve(D); }

const builds = new Map();
/** A build's Scene and analysis from its .ldr text (cached: the physics and the drawing both ask). */
export function buildOf(D, ldr) {
  if (!builds.has(ldr)) {
    const scene = new Scene(D, parseLdr(ldr).filter((q) => D.parts.parts[q.f]));
    builds.set(ldr, { scene, an: scene.analyze() });
    if (builds.size > 20) builds.delete(builds.keys().next().value);
  }
  return builds.get(ldr);
}

// The drive: the 7-long axle through the arm bracket and its 12-tooth bevel gear, which meshes with motor E's gear.
// Positions from models/src/arm-moving.ldr (whose origin is the arm axle, at (0, -130, -160) in the Driving Base frame).
export const DRIVE_AXLE = { at: [0, -130, -160], axis: [1, 0, 0] };
export const DRIVE_PARTS = [
  { f: '44294', c: 71, p: [0, -130, -160], r: [-1, 0, 0, 0, -1, 0, 0, 0, 1] },
  { f: '32270', c: 0, p: [60, -130, -160], r: [0, 0, 1, 1, 0, 0, 0, 1, 0] },
];

// ---------------- small 3D math (row-major 3x3, like LDraw's a..i) ----------------

export const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mul = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8]];
export const app = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
export const tr = (M) => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const snap = (v) => { const r = Math.round(v); return Math.abs(v - r) < 1e-6 ? r : Math.abs(v) < 1e-9 ? 0 : v; };
const clean = (M) => M.map(snap);

/** Rotation by `ang` radians about unit axis `a` (exact for quarter turns). */
export function rotAxis(a, ang) {
  const c = Math.abs(Math.cos(ang)) < 1e-12 ? 0 : Math.cos(ang), s = Math.abs(Math.sin(ang)) < 1e-12 ? 0 : Math.sin(ang), t = 1 - c;
  const [x, y, z] = a;
  return clean([t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c]);
}
/** A rotation taking unit vector u onto unit vector v. */
export function align(u, v) {
  const c = dot(u, v);
  if (c > 1 - 1e-9) return I3.slice();
  if (c < -1 + 1e-9) {
    const p = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return rotAxis(unit(cross(u, p)), Math.PI);
  }
  return rotAxis(unit(cross(u, v)), Math.acos(Math.max(-1, Math.min(1, c))));
}
/** Signed angle (radians) from a to b about unit axis n (a, b perpendicular to n). */
const angleAbout = (a, b, n) => Math.atan2(dot(cross(a, b), n), dot(a, b));

// ---------------- builds as .ldr ----------------

/** Parse the type-1 lines of an .ldr into placements {f, c, p, r}. */
export function parseLdr(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] !== '1' || t.length < 15) continue;
    const n = t.slice(2, 14).map(Number);
    if (n.some((v) => !Number.isFinite(v))) continue;
    out.push({ f: t.slice(14).join(' ').replace(/\.dat$/i, '').toLowerCase(), c: Number(t[1]) || 0, p: n.slice(0, 3), r: n.slice(3, 12) });
  }
  return out;
}
const fmt = (v) => String(Math.round(v * 1000) / 1000);
export function toLdr(parts, name = 'My attachment') {
  return [`0 ${name}`, `0 Name: attachment.ldr`, '0 Author: FLL Practice attachment builder',
    '0 // Placed in the frame of the LEGO Driving Base (models/src/driving-base.ldr); it mounts on the arm bracket axle.',
    ...parts.map((q) => `1 ${q.c} ${q.p.map(fmt).join(' ')} ${q.r.map(fmt).join(' ')} ${q.f}.dat`)].join('\n') + '\n';
}

// ---------------- connectors ----------------

const secLen = (s) => s.reduce((a, x) => a + x[2], 0);

/** A connector moved to a part's placement (position p, rotation r). */
function placeConnector(c, p, r, part) {
  return { g: c.g, k: c.k, o: add(app(r, c.o), p), d: unit(app(r, c.d)), x: unit(app(r, c.x)), s: c.s, sl: c.sl, cp: c.cp, gp: c.gp, len: c.s ? secLen(c.s) : 0, part };
}

/** Every usable connector of a placed part (cylinders without a special-purpose group), in the build frame. */
export function partConnectors(D, q, part) {
  const e = D.snaps[q.f];
  if (!e) return [];
  return e.s.filter((c) => c.k === 'cyl' && !c.gp).map((c) => placeConnector(c, q.p, q.r, part));
}

/** The section of a connector at distance u along it, or null outside it. */
function secAt(s, u) {
  let a = 0;
  for (const x of s) { if (u >= a && u <= a + x[2]) return x; a += x[2]; }
  return null;
}
// LDCad's caps: 'one' closes the far end (a hole's bottom, a stud's top), 'two' both ends; A and B one end each
const capStart = (c) => c.cp === 'two' || c.cp === 'A';
const capEnd = (c) => c.cp === 'one' || c.cp === 'two' || c.cp === 'B';

/**
 * How two connectors meet: null when they don't (not coaxial, same gender, no overlap); {collide: true} when the
 * male cannot be there (too fat for the hole, a round pin in an axle hole, through a closed end); otherwise
 * {len, rigid, from, to}: how much engages, whether rotation is locked, and the engaged stretch along the female.
 */
export function fit(a, b) {
  if (a.g === b.g) return null;
  const m = a.g === 'M' ? a : b, f = a.g === 'M' ? b : a;
  const c = dot(m.d, f.d);
  if (Math.abs(c) < 0.999) return null;
  const rel = sub(m.o, f.o);
  const along = dot(rel, f.d);
  const off = sub(rel, scl(f.d, along));
  if (len(off) > 0.8) return null;
  const s = c > 0 ? 1 : -1;
  const m0 = along, m1 = along + s * m.len;          // the male's span along the female (t = 0 at its start)
  const lo = Math.max(0, Math.min(m0, m1)), hi = Math.min(f.len, Math.max(m0, m1));
  if (hi - lo < 0.5) return null;
  // a hole's closed end: nothing goes through it (a male's closed end, a stud's top, stops nothing)
  if (capStart(f) && Math.min(m0, m1) < -0.5) return { collide: true };
  if (capEnd(f) && Math.max(m0, m1) > f.len + 0.5) return { collide: true };
  const uOf = (t) => (t - m0) * s;                    // female t -> distance along the male
  // walk the overlap piece by piece between section boundaries
  const cuts = [lo, hi];
  let acc = 0;
  for (const x of f.s) { acc += x[2]; if (acc > lo && acc < hi) cuts.push(acc); }
  acc = 0;
  for (const x of m.s) { acc += x[2]; const t = m0 + s * acc; if (t > lo && t < hi) cuts.push(t); }
  cuts.sort((p, q) => p - q);
  let engaged = 0, rigid = 0, from = Infinity, to = -Infinity;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const w = cuts[i + 1] - cuts[i];
    if (w < 1e-6) continue;
    const t = (cuts[i] + cuts[i + 1]) / 2;
    const fs = secAt(f.s, t), ms = secAt(m.s, uOf(t));
    if (!fs || !ms) continue;
    const msh = ms[0], rm = ms[1], fsh = fs[0].replace(/_/g, '').replace('L', 'R'), rf = fs[1];
    if (msh.includes('L')) continue;                  // a pin's lip squeezes through
    let hit = false;
    if (fsh === 'A') {
      if (msh === 'A' && Math.abs(rm - rf) < 0.5) { engaged += w; rigid += w; hit = true; } else if (rm > 4.5) return { collide: true };
    } else if (fsh === 'S') {
      if (msh === 'S' && Math.abs(rm - rf) < 0.5) { engaged += w; rigid += w; hit = true; } else if (rm > rf + 0.5) return { collide: true };
    } else {
      if (rm > rf + 0.5) return { collide: true };
      if (rm >= rf - 0.5) { engaged += w; hit = true; }
    }
    if (hit) { from = Math.min(from, cuts[i]); to = Math.max(to, cuts[i + 1]); }
  }
  if (engaged < 2) return null;
  return { len: engaged, rigid: rigid >= 2, from, to, male: m, female: f };
}

// ---------------- boxes (for overlaps) ----------------

/** A part's collision boxes in the build frame: {c, h, R} with R the box axes as columns of a rotation. */
export function partBoxes(D, q) {
  const e = D.parts.parts[q.f];
  if (!e) return [];
  return e.b.map((b) => ({ c: add(app(q.r, [b[0], b[1], b[2]]), q.p), h: [b[3], b[4], b[5]], R: q.r }));
}
const quatToM = (x, y, z, w) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
let baseBoxCache = null;
export function baseBoxes(D) {
  if (!baseBoxCache) baseBoxCache = D.ctx.boxes.map((b) => ({ c: [b[0], b[1], b[2]], h: [b[3], b[4], b[5]], R: quatToM(b[6], b[7], b[8], b[9]) }));
  return baseBoxCache;
}

/** Do two oriented boxes overlap by more than `margin` (LDU) on every axis? (separating axis test) */
export function boxesOverlap(A, B, margin = 2) {
  const ax = [0, 1, 2].map((i) => [A.R[i], A.R[3 + i], A.R[6 + i]]);
  const bx = [0, 1, 2].map((i) => [B.R[i], B.R[3 + i], B.R[6 + i]]);
  const ha = A.h.map((v) => Math.max(0.1, v - margin)), hb = B.h.map((v) => Math.max(0.1, v - margin));
  const T = sub(B.c, A.c);
  const axes = [...ax, ...bx];
  for (const p of ax) for (const q of bx) { const c = cross(p, q); if (len(c) > 1e-6) axes.push(unit(c)); }
  for (const n of axes) {
    const ra = ha[0] * Math.abs(dot(ax[0], n)) + ha[1] * Math.abs(dot(ax[1], n)) + ha[2] * Math.abs(dot(ax[2], n));
    const rb = hb[0] * Math.abs(dot(bx[0], n)) + hb[1] * Math.abs(dot(bx[1], n)) + hb[2] * Math.abs(dot(bx[2], n));
    if (Math.abs(dot(T, n)) > ra + rb) return false;
  }
  return true;
}
function aabbOf(boxes) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let i = 0; i < 3; i++) {
    const ext = b.h[0] * Math.abs(b.R[i * 3]) + b.h[1] * Math.abs(b.R[i * 3 + 1]) + b.h[2] * Math.abs(b.R[i * 3 + 2]);
    lo[i] = Math.min(lo[i], b.c[i] - ext); hi[i] = Math.max(hi[i], b.c[i] + ext);
  }
  return { lo, hi };
}
const aabbNear = (a, b, pad) => a.lo.every((v, i) => v - pad <= b.hi[i] && b.lo[i] - pad <= a.hi[i]);

// ---------------- the scene: base context + drive + the kid's parts ----------------

/**
 * Everything the builder and the physics need about a build: each part's connectors and boxes, with the Driving
 * Base (and its arm bracket) as fixed context and the drive axle as the motor's part.
 * parts: the kid's placements. Returns a Scene with methods for snapping and for analysis.
 */
export class Scene {
  constructor(D, parts = []) {
    this.D = D;
    this.items = [];             // {q, role: 'base'|'drive'|'part', conns, boxes, aabb}
    const baseConns = [...D.ctx.base, ...D.ctx.bracket].filter((c) => c.k === 'cyl' && !c.gp).map((c) => ({ ...c, d: unit(c.d), x: unit(c.x), len: secLen(c.s) }));
    const bb = baseBoxes(D);
    this.base = { q: null, role: 'base', conns: baseConns, boxes: bb, aabb: aabbOf(bb) };
    this.base.conns.forEach((c) => { c.part = this.base; });
    for (const q of DRIVE_PARTS) this._add(q, 'drive');
    for (const q of parts) this._add(q, 'part');
  }
  _add(q, role) {
    const it = { q, role, conns: [], boxes: partBoxes(this.D, q) };
    it.conns = partConnectors(this.D, q, it);
    it.aabb = aabbOf(it.boxes.length ? it.boxes : [{ c: q.p, h: [5, 5, 5], R: I3 }]);
    this.items.push(it);
    return it;
  }
  get parts() { return this.items.filter((it) => it.role === 'part'); }
  all() { return [this.base, ...this.items]; }
  addPart(q) { return this._add(q, 'part'); }
  removePart(it) { this.items = this.items.filter((x) => x !== it); }

  /** Connections and problems a candidate placement would have: {ok, conns: [{other, fit}], why}. */
  check(q) {
    const it = { q, role: 'ghost', boxes: partBoxes(this.D, q) };
    it.conns = partConnectors(this.D, q, it);
    it.aabb = aabbOf(it.boxes.length ? it.boxes : [{ c: q.p, h: [5, 5, 5], R: I3 }]);
    const conns = [];
    const touching = new Set();
    for (const other of this.all()) {
      if (!aabbNear(it.aabb, other.aabb, 4)) continue;
      for (const a of it.conns) for (const b of other.conns) {
        const r = fit(a, b);
        if (!r) continue;
        if (r.collide) return { ok: false, conns, why: 'does not fit there' };
        conns.push({ other, a, b, fit: r });
        touching.add(other);
      }
    }
    if (!conns.length) return { ok: false, conns, why: 'not connected' };
    // anything it would overlap without being connected to
    for (const other of this.all()) {
      if (touching.has(other) || !aabbNear(it.aabb, other.aabb, 0)) continue;
      for (const A of it.boxes) for (const B of other.boxes) if (boxesOverlap(A, B, other.role === 'base' ? 3 : 2)) return { ok: false, conns, why: 'bumps into another part' };
    }
    return { ok: true, conns };
  }

  /**
   * Placements of part `f` that put its connector number `k` onto connector `T` of a placed part: flipped end for end
   * or not, turned by `roll` quarter turns about the axis, at every half-stud position along it where it fits.
   * Returned best first (most engagement), each with its check() result.
   */
  placementsOnto(f, k, T, flip, roll) {
    const own = (this.D.snaps[f] ? this.D.snaps[f].s : []).filter((c) => c.k === 'cyl' && !c.gp);
    const G = own[k];
    if (!G || G.g === T.g) return [];
    const Gd = unit(G.d), Gx = unit(G.x), Gl = secLen(G.s);
    const want = flip ? scl(T.d, -1) : T.d;
    let R = align(Gd, want);
    const x1 = app(R, Gx);
    const Tx = sub(T.x, scl(T.d, dot(T.x, T.d)));
    R = mul(rotAxis(T.d, angleAbout(x1, unit(Tx), T.d) + roll * Math.PI / 2), R);
    R = clean(R);
    const Go = app(R, G.o);
    const out = [];
    const lo = -Gl - 10, hi = T.len + Gl + 10;
    for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) {
      const p = sub(add(T.o, scl(T.d, t)), Go).map((v) => Math.round(v * 1000) / 1000);
      const q = { f, c: this.D.parts.parts[f] ? this.D.parts.parts[f].c : 16, p, r: R };
      const g = placeConnector(G, p, R, null);
      const r = fit(g, T);
      if (!r || r.collide) continue;
      out.push({ q, t, mid: t + (flip ? -1 : 1) * Gl / 2, eng: r.len });
    }
    out.sort((a, b) => b.eng - a.eng || Math.abs(a.t) - Math.abs(b.t));
    return out;
  }

  // ---------------- what the build is made of ----------------

  /**
   * Bodies and joints: parts locked together (axle in axle hole, two pins side by side, studs) are one body; the body
   * holding the drive axle turns with motor E; bodies joined on one line are hinged, with friction from the pins.
   * Returns {bodies: [{role: 'base'|'drive'|'free', items}], joints: [{a, b, at, axis, friction}], loose: [items], jammed}.
   */
  analyze() {
    const all = this.all();
    const idx = new Map(all.map((it, i) => [it, i]));
    const parent = all.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); return a !== b; };
    const drives = all.filter((it) => it.role === 'drive').map((it) => idx.get(it));
    drives.forEach((d) => union(drives[0], d));
    // every connection between two different parts
    const links = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j];
      if (A.role === B.role && A.role !== 'part') continue;
      if (!aabbNear(A.aabb, B.aabb, 4)) continue;
      for (const a of A.conns) for (const b of B.conns) {
        const r = fit(a, b);
        if (!r || r.collide) continue;
        links.push({ i, j, fit: r });
      }
    }
    // the drive axle turns in the bracket: that link is the motor, not a joint
    const isDriveInBracket = (l) => (all[l.i].role === 'base' && all[l.j].role === 'drive') || (all[l.j].role === 'base' && all[l.i].role === 'drive');
    for (const l of links) if (l.fit.rigid && !isDriveInBracket(l)) union(l.i, l.j);
    const lineKey = (m) => ({ p: sub(m.o, scl(m.d, dot(m.o, m.d))), d: m.d });
    const sameLine = (u, v) => Math.abs(Math.abs(dot(u.d, v.d)) - 1) < 1e-3 && len(sub(u.p, v.p)) < 1;
    // two hinges between the same pair of bodies on different lines lock them together
    for (let changed = true; changed;) {
      changed = false;
      const pairs = new Map();
      for (const l of links) {
        if (l.fit.rigid || isDriveInBracket(l)) continue;
        const a = find(l.i), b = find(l.j);
        if (a === b) continue;
        const key = a < b ? a + ',' + b : b + ',' + a;
        const lk = lineKey(l.fit.female);
        const list = pairs.get(key) || [];
        if (!list.some((x) => sameLine(x, lk))) list.push(lk);
        pairs.set(key, list);
        if (list.length >= 2) { union(a, b); changed = true; break; }
      }
    }
    // collect the sets
    const sets = new Map();
    all.forEach((it, i) => { const r = find(i); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(it); });
    const baseRoot = find(0), driveRoot = drives.length ? find(drives[0]) : -1;
    // hinges between sets, merged per line
    let joints = [];
    for (const l of links) {
      if (l.fit.rigid || isDriveInBracket(l)) continue;
      const a = find(l.i), b = find(l.j);
      if (a === b) continue;
      const m = l.fit.male;
      const fr = m.part && m.part.q && this.D.parts.parts[m.part.q.f] ? this.D.parts.parts[m.part.q.f].fr : false;
      const isAxle = m.s.every((x) => x[0] === 'A');
      const at = add(l.fit.female.o, scl(l.fit.female.d, (l.fit.from + l.fit.to) / 2));
      const lk = lineKey(l.fit.female);
      const j = joints.find((x) => ((x.a === a && x.b === b) || (x.a === b && x.b === a)) && sameLine(x.line, lk));
      const torque = fr && !isAxle ? FRICTION_PIN : FREE_PIN;
      if (j) { j.friction += torque; j.points.push(at); } else joints.push({ a, b, line: lk, axis: l.fit.female.d, points: [at], friction: torque, frictionPins: fr && !isAxle });
    }
    // a lone pin, axle or bush joining bodies along its own line is not a body of its own: the bodies it joins are
    // hinged to each other through it (and a lone one that joins nothing just stays where it is)
    const small = (items) => items.every((it) => it.role === 'part' && SMALL.has(categoryOf(this.D, it.q.f)));
    for (const [root, items] of sets) {
      if (root === baseRoot || root === driveRoot || !small(items)) continue;
      const mine = joints.filter((j) => j.a === root || j.b === root);
      const others = [...new Set(mine.map((j) => (j.a === root ? j.b : j.a)))];
      if (!mine.length || !mine.every((j) => sameLine(j.line, mine[0].line))) continue;
      joints = joints.filter((j) => !mine.includes(j));
      if (others.length === 1) { union(others[0], root); continue; }
      const hub = others.includes(baseRoot) ? baseRoot : others.includes(driveRoot) ? driveRoot : others[0];
      for (const o of others) {
        if (o === hub) continue;
        const js = mine.filter((j) => j.a === o || j.b === o || j.a === hub || j.b === hub);
        const friction = js.reduce((s, j) => s + j.friction, 0) / 2;
        joints.push({ a: hub, b: o, line: mine[0].line, axis: mine[0].axis, points: js.flatMap((j) => j.points), friction, frictionPins: js.some((j) => j.frictionPins) });
      }
      union(hub, root);         // the pin itself rides with the body it is pushed into first
      joints = joints.map((j) => ({ ...j, a: find(j.a), b: find(j.b) })).filter((j) => j.a !== j.b);
    }
    // a body now hinged to the same neighbour on two lines (through pins merged above) is locked to it
    for (let changed = true; changed;) {
      changed = false;
      joints = joints.map((j) => ({ ...j, a: find(j.a), b: find(j.b) })).filter((j) => j.a !== j.b);
      const lines = new Map();
      for (const j of joints) {
        const key = Math.min(j.a, j.b) + ',' + Math.max(j.a, j.b);
        const list = lines.get(key) || [];
        if (!list.some((l) => sameLine(l, j.line))) list.push(j.line);
        lines.set(key, list);
        if (list.length >= 2) { union(j.a, j.b); changed = true; break; }
      }
    }
    const roots = new Map();
    all.forEach((it, i) => { const r = find(i); if (!roots.has(r)) roots.set(r, []); roots.get(r).push(it); });
    // bodies that hang on nothing (a part left behind when its neighbour was deleted)
    const reach = new Set([find(0)]);
    if (drives.length) reach.add(find(drives[0]));
    for (let grew = true; grew;) {
      grew = false;
      for (const j of joints) {
        const ra = find(j.a), rb = find(j.b);
        if (reach.has(ra) !== reach.has(rb)) { reach.add(ra); reach.add(rb); grew = true; }
      }
    }
    const bodies = [], ofRoot = new Map(), loose = [];
    for (const [r, items] of roots) {
      if (!reach.has(r)) { loose.push(...items); continue; }
      const role = r === find(0) ? 'base' : drives.length && r === find(drives[0]) ? 'drive' : 'free';
      ofRoot.set(r, bodies.length);
      bodies.push({ role, items });
    }
    const outJoints = [];
    for (const j of joints) {
      const a = ofRoot.get(find(j.a)), b = ofRoot.get(find(j.b));
      if (a === undefined || b === undefined || a === b) continue;
      const at = scl(j.points.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / j.points.length);
      const prev = outJoints.find((x) => ((x.a === a && x.b === b) || (x.a === b && x.b === a)) && sameLine(x.line, j.line));
      if (prev) { prev.friction += j.friction; continue; }
      outJoints.push({ a, b, at, axis: j.axis, line: j.line, friction: j.friction, frictionPins: j.frictionPins });
    }
    const jammed = drives.length > 0 && find(0) === find(drives[0]);
    return { bodies, joints: outJoints, loose: loose.filter((it) => it.role === 'part'), jammed };
  }
}

// Holding torque of a hinge (N m): a friction pin holds a beam up, a free pin or an axle in a round hole barely drags.
export const FRICTION_PIN = 0.005;
export const FREE_PIN = 0.00005;
const SMALL = new Set(['Pins', 'Axles', 'Bushes']);
let catOf = null;
export function categoryOf(D, f) {
  if (!catOf) { catOf = new Map(); for (const c of D.parts.categories) for (const p of c.parts) catOf.set(p, c.name); }
  return catOf.get(f) || '';
}
