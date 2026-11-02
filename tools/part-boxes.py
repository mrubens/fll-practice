#!/usr/bin/env python3
"""Measure every part of a packed LDraw model for the physics: boxes per top-level part, in the sim's model frame.

The physics gives each mission piece (and each model's fixed base) colliders made from these boxes, so what the
robot touches matches what is drawn. Most parts are one oriented box. A part whose silhouette fills its box badly
(an L-shaped or bent liftarm, a curved liftarm, a ring) is split into several boxes that follow its outline, so a
ring keeps its opening and an L keeps its inside corner.

Output: models/parts/<name>.json, a list of
  {"i": line number of the part in the main model (1-based, counting type-1 lines, as js/sim3d.js numbers them),
   "f": file, "c": colour code,
   "p": box centre [x, y, z] cm, "h": half extents [x, y, z] cm (in the part's own axes), "q": rotation [x, y, z, w],
   "a": axis-aligned centre, "s": axis-aligned size (for the part predicates in js/mechanisms.js),
   "b": optional list of [cx, cy, cz, hx, hy, hz] boxes (centre in the model frame, half extents in the part's axes,
        same rotation q) replacing the single box}
The model frame is LDraw turned upright: x = X, y = -Y, z = -Z, in cm (1 LDU = 0.04 cm).

Needs numpy and scipy. Usage: tools/part-boxes.py [models/m03.mpd ...]     (default: every models/m*.mpd)
"""
import glob, json, math, os, sys

import numpy as np
from scipy import ndimage

LDU = 0.04
VOX = 4.0           # LDU per cell when judging a part's silhouette (1.6 mm)
FILL_OK = 0.8       # a silhouette at least this full is one box
MAX_BOXES = 12


def norm_name(n):
    return n.replace('\\', '/').lower()


def parse_mpd(path):
    files, order, cur = {}, [], None
    for raw in open(path, encoding='utf-8', errors='replace'):
        line = raw.strip()
        if line.startswith('0 FILE '):
            cur = norm_name(line[7:].strip())
            for pre in ('parts/', 'p/'):          # packed files may keep their library folder
                if cur.startswith(pre):
                    cur = cur[len(pre):]
            files[cur] = []
            order.append(cur)
        elif line.startswith('0 NOFILE'):
            cur = None
        elif cur is not None and line and line[0] in '1234':
            files[cur].append(line.split())
    return files, order


class Geometry:
    """Triangles of each file in its own frame (LDU), resolved through sub-files."""

    def __init__(self, files):
        self.files = files
        self.cache = {}

    def lookup(self, name):
        name = norm_name(name)
        for key in (name, 's/' + name, 'p/' + name, '48/' + name, '8/' + name):
            if key in self.files:
                return key
        return None

    def tris(self, name):
        key = self.lookup(name)
        if key is None:
            return np.zeros((0, 3, 3))
        if key in self.cache:
            return self.cache[key]
        self.cache[key] = np.zeros((0, 3, 3))     # guards against loops
        own, subs = [], []
        for t in self.files[key]:
            kind = t[0]
            if kind == '1' and len(t) >= 15:
                sub = self.tris(' '.join(t[14:]))
                if len(sub):
                    pos = np.array([float(x) for x in t[2:5]])
                    m = np.array([float(x) for x in t[5:14]]).reshape(3, 3)
                    subs.append(sub @ m.T + pos)
            elif kind == '3' and len(t) >= 11:
                own.append(np.array([float(x) for x in t[2:11]]).reshape(3, 3))
            elif kind == '4' and len(t) >= 14:
                q = np.array([float(x) for x in t[2:14]]).reshape(4, 3)
                own.append(q[[0, 1, 2]]); own.append(q[[0, 2, 3]])
        parts = ([np.array(own)] if own else []) + subs
        out = np.concatenate(parts) if parts else np.zeros((0, 3, 3))
        self.cache[key] = out
        return out


HOLE_PRIMS = ('connhole', 'beamhole', 'peghole', 'axlehole', 'axlehol', 'npeghol', 'beamhol')


def hole_list(geo, name, cache={}):
    """Technic holes of a file in its own frame (LDU): (centre, axis) pairs, from the hole primitives it is built from."""
    key = geo.lookup(name)
    if key is None:
        return []
    if (id(geo), key) in cache:
        return cache[(id(geo), key)]
    cache[(id(geo), key)] = []
    out = []
    for t in geo.files[key]:
        if t[0] != '1' or len(t) < 15:
            continue
        sub = norm_name(' '.join(t[14:]))
        pos = np.array([float(x) for x in t[2:5]])
        m = np.array([float(x) for x in t[5:14]]).reshape(3, 3)
        if os.path.basename(sub).startswith(HOLE_PRIMS):
            a = m @ np.array([0.0, 1.0, 0.0])
            n = np.linalg.norm(a)
            if n > 0:
                out.append((pos, a / n))
        else:
            for c, a in hole_list(geo, sub):
                b = m @ a
                nb = np.linalg.norm(b)
                if nb > 0:
                    out.append((m @ c + pos, b / nb))
    cache[(id(geo), key)] = out
    return out


def hole_chain_boxes(tris, holes):
    """A liftarm as boxes from each hole to the next (and a square at a lone hole), each turned along its own leg, so a
    bent or angled liftarm is covered exactly, round its bends. Returns [(centre, half, axes)] or None."""
    if len(holes) < 3:
        return None
    axes = np.array([a for _, a in holes])
    # the direction most holes run along
    n0 = max(axes, key=lambda a: np.sum(np.abs(axes @ a) > 0.9))
    sel = [(c, a) for c, a in holes if abs(a @ n0) > 0.9]
    if len(sel) < 3:
        return None
    pts = []
    for c, _ in sel:
        q = c - (c @ n0) * n0
        if all(np.linalg.norm(q - r) > 6 for r in pts):
            pts.append(q)
    if len(pts) < 3:
        return None
    t = tris.reshape(-1, 3) @ n0
    tmin, tmax = t.min(), t.max()
    if tmax - tmin > 24:            # not a beam (thicker than a liftarm)
        return None
    tc, th = (tmin + tmax) / 2, (tmax - tmin) / 2
    # join the holes along the part: a minimum spanning tree (a bend's holes can sit far apart) plus every short gap
    # (so a frame keeps its closed outline)
    n = len(pts)
    dist = np.array([[np.linalg.norm(pts[i] - pts[j]) for j in range(n)] for i in range(n)])
    edges, seen = set(), {0}
    while len(seen) < n:
        i, j = min(((i, j) for i in seen for j in range(n) if j not in seen), key=lambda e: dist[e])
        if dist[i, j] > 60:
            return None                 # holes in separate clusters: not a single liftarm
        edges.add((min(i, j), max(i, j))); seen.add(j)
    edges |= {(i, j) for i in range(n) for j in range(i + 1, n) if dist[i, j] <= 22}
    boxes = []
    for i, j in sorted(edges):
        d = dist[i, j]
        u = (pts[j] - pts[i]) / d
        w = np.cross(n0, u)
        boxes.append(((pts[i] + pts[j]) / 2 + tc * n0, np.array([d / 2 + 10, 10, th]), np.column_stack([u, w, n0])))
    return boxes if 1 < len(boxes) <= 30 else None


def sample_points(tris, step):
    """Points spread over every triangle no more than `step` apart."""
    if not len(tris):
        return np.zeros((0, 3))
    e = np.maximum(np.linalg.norm(tris[:, 1] - tris[:, 0], axis=1), np.linalg.norm(tris[:, 2] - tris[:, 0], axis=1))
    e = np.maximum(e, np.linalg.norm(tris[:, 2] - tris[:, 1], axis=1))
    ks = np.clip(np.ceil(e / step).astype(int), 1, 64)
    pts = [tris.reshape(-1, 3)]
    for k in np.unique(ks):
        sel = tris[ks == k]
        u, v = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
        keep = (u + v) <= k
        a, b = (u[keep] / k), (v[keep] / k)
        w = 1 - a - b
        p = sel[:, 0, None, :] * w[None, :, None] + sel[:, 1, None, :] * a[None, :, None] + sel[:, 2, None, :] * b[None, :, None]
        pts.append(p.reshape(-1, 3))
    return np.concatenate(pts)


def max_rectangle(mask):
    """Largest all-true rectangle in a 2D mask: (area, r0, r1, c0, c1) with r1/c1 exclusive."""
    rows, cols = mask.shape
    heights = np.zeros(cols, dtype=int)
    best = (0, 0, 0, 0, 0)
    for r in range(rows):
        heights = np.where(mask[r], heights + 1, 0)
        stack = []
        for c in range(cols + 1):
            h = heights[c] if c < cols else 0
            start = c
            while stack and stack[-1][1] >= h:
                s, sh = stack.pop()
                area = sh * (c - s)
                if area > best[0]:
                    best = (area, r - sh + 1, r + 1, s, c)
                start = s
            stack.append((start, h))
    return best


def part_boxes(tris):
    """Boxes (centre, half) in the part's frame (LDU): one box, or several following its silhouette."""
    pts = tris.reshape(-1, 3)
    lo, hi = pts.min(0), pts.max(0)
    one = [((lo + hi) / 2, (hi - lo) / 2)]
    size = hi - lo
    if (size < VOX * 3).sum() >= 2:       # thin in two directions (a pin, an axle): a box is fine
        return one, 1.0
    p = sample_points(tris, VOX / 2)
    idx = np.floor((p - lo) / VOX).astype(int)
    dims = np.maximum(np.ceil(size / VOX).astype(int), 1)
    idx = np.minimum(idx, dims - 1)
    worst, worst_axis, worst_mask = 2.0, None, None
    for ax in range(3):
        a, b = [k for k in range(3) if k != ax]
        m = np.zeros((dims[a], dims[b]), dtype=bool)
        m[idx[:, a], idx[:, b]] = True
        m = ndimage.binary_closing(np.pad(m, 2), structure=np.ones((3, 3)), iterations=2)[2:-2, 2:-2]   # pin holes and stud gaps
        fill = m.sum() / m.size
        if dims[a] > 2 and dims[b] > 2 and fill < worst:
            worst, worst_axis, worst_mask = fill, ax, m
    if worst_axis is None or worst >= FILL_OK:
        return one, worst
    a, b = [k for k in range(3) if k != worst_axis]
    left = worst_mask.copy()
    total = left.sum()
    rects = []
    while left.sum() > 0.04 * total and len(rects) < MAX_BOXES:
        area, r0, r1, c0, c1 = max_rectangle(left)
        if area < 2:
            break
        rects.append((r0, r1, c0, c1))
        left[r0:r1, c0:c1] = False
    boxes = []
    for r0, r1, c0, c1 in rects:
        bl, bh = lo.copy(), hi.copy()
        bl[a], bh[a] = lo[a] + r0 * VOX, min(hi[a], lo[a] + r1 * VOX)
        bl[b], bh[b] = lo[b] + c0 * VOX, min(hi[b], lo[b] + c1 * VOX)
        boxes.append(((bl + bh) / 2, (bh - bl) / 2))
    return (boxes or one), worst


def quat_from_matrix(r):
    tr = r[0][0] + r[1][1] + r[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        return [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, 0.25 * s]
    if r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1.0 + r[0][0] - r[1][1] - r[2][2]) * 2
        return [0.25 * s, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    if r[1][1] > r[2][2]:
        s = math.sqrt(1.0 + r[1][1] - r[0][0] - r[2][2]) * 2
        return [(r[0][1] + r[1][0]) / s, 0.25 * s, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    s = math.sqrt(1.0 + r[2][2] - r[0][0] - r[1][1]) * 2
    return [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, 0.25 * s, (r[1][0] - r[0][1]) / s]


F = np.diag([1.0, -1.0, -1.0])     # LDraw y down / z back -> upright


def measure(path):
    files, order = parse_mpd(path)
    geo = Geometry(files)
    shapes = {}
    out = []
    i = 0
    for t in files[order[0]]:
        if t[0] != '1' or len(t) < 15:
            continue
        i += 1
        name = norm_name(' '.join(t[14:]))
        key = geo.lookup(name)
        if key is None:
            continue
        if key not in shapes:
            tr = geo.tris(name)
            if not len(tr):
                shapes[key] = None
            else:
                plain, fill = part_boxes(tr)
                chain = hole_chain_boxes(tr, hole_list(geo, name)) if len(plain) > 1 else None
                eye = np.eye(3)
                shapes[key] = chain or [(c, h, eye) for c, h in plain]
        boxes = shapes[key]
        if not boxes:
            continue
        pos = np.array([float(x) for x in t[2:5]])
        m = np.array([float(x) for x in t[5:14]]).reshape(3, 3)
        scale = np.linalg.norm(m, axis=0)
        scale[scale == 0] = 1
        rot = F @ (m / scale) @ F        # the box axes in the upright frame (the part frame is flipped the same way)
        if np.linalg.det(rot) < 0:
            rot[:, 2] *= -1               # a mirrored part: a box is symmetric, so flip one axis back
        q = quat_from_matrix(rot.tolist())

        def place(c, h, A):
            centre = F @ (m @ c + pos) * LDU
            cols = m @ A
            sc = np.linalg.norm(cols, axis=0); sc[sc == 0] = 1
            W = F @ (cols / sc)                 # the box axes in the upright frame
            if np.linalg.det(W) < 0:
                W[:, 2] *= -1
            return centre, np.abs(h * sc) * LDU, W

        placed = [place(c, h, A) for c, h, A in boxes]
        own_axes = any(not np.allclose(A, np.eye(3)) for _, _, A in boxes)
        # the whole part's box and its axis-aligned extent
        allc = np.array([c for c, _, _ in placed])
        corners = []
        for c, h, W in placed:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        corners.append(c + W @ (h * [sx, sy, sz]))
        corners = np.array(corners)
        alo, ahi = corners.min(0), corners.max(0)
        # one box around everything, in the part's axes
        local = (corners - allc.mean(0)) @ rot
        llo, lhi = local.min(0), local.max(0)
        pc = allc.mean(0) + rot @ ((llo + lhi) / 2)
        entry = {'i': i, 'f': os.path.basename(name), 'c': t[1],
                 'p': [round(float(v), 3) for v in pc], 'h': [round(float(v), 3) for v in (lhi - llo) / 2], 'q': [round(v, 5) for v in q],
                 'a': [round(float(v), 3) for v in (alo + ahi) / 2], 's': [round(float(v), 3) for v in (ahi - alo)]}
        if len(placed) > 1:
            # [cx, cy, cz, hx, hy, hz] in the part's axes, or with its own rotation [.., qx, qy, qz, qw] (a hole-chain box)
            entry['b'] = [[round(float(v), 3) for v in list(c) + list(h)] + ([round(v, 5) for v in quat_from_matrix(W.tolist())] if own_axes else [])
                          for c, h, W in placed]
        out.append(entry)
    return out


def main():
    paths = sys.argv[1:] or sorted(glob.glob('models/m*.mpd'))
    os.makedirs('models/parts', exist_ok=True)
    for path in paths:
        boxes = measure(path)
        name = os.path.splitext(os.path.basename(path))[0]
        with open(os.path.join('models/parts', name + '.json'), 'w') as f:
            f.write('[\n' + ',\n'.join(json.dumps(b, separators=(',', ':')) for b in boxes) + '\n]\n')
        split = sum(1 for b in boxes if 'b' in b)
        print(name, len(boxes), 'parts,', split, 'split into several boxes')


if __name__ == '__main__':
    main()
