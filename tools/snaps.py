#!/usr/bin/env python3
"""Pack the LEGO parts the attachment builder offers: their connectors, geometry and collision boxes.

Connectors come from the LDCad shadow library (https://github.com/RolandMelkert/LDCadShadowLibrary, CC BY-SA 4.0 by
Roland Melkert and contributors): `0 !LDCAD SNAP_*` meta lines that sit in shadow files mirroring the LDraw library.
A part's connectors are its own shadow lines plus everything its LDraw geometry inherits from the files it references
(a beam references connhole.dat once per hole, an axle hole references axlehole.dat ...), each moved by that
reference's matrix. SNAP_CLEAR drops what was inherited so far (all of it, or the connectors with a given id),
SNAP_INCL pulls in another file's connectors at a position, and `grid=` repeats a connector or an include.

Output (all in the part's own LDraw frame, LDU):
  models/lego/snaps.json   {"parts": {"3673": {"d": description, "s": [connector, ...]}}}  (CC BY-SA 4.0, derived)
     connector "cyl":  {"k": "cyl", "g": "M"|"F", "o": start [x,y,z], "d": unit direction the sections run,
                        "x": unit vector across it, "s": [[shape, radius, length], ...] (shape R round, A axle,
                        S square, L_ / _L a flange or lip), "sl": slides, "cp": caps ("none", "one" = closed at
                        the start, "two", "A"/"B"), "id"/"gp": the shadow id and group when given}
     connector "clp" / "fgr" / "gen": the shadow's clip, finger and generic connectors, with "o", "d", "x" and
                        their own attributes as given ("r", "len", "seq", "bnd", "g")
  models/lego/parts.mpd    every part's geometry (LDraw CC BY 4.0), main model = the parts in order, 400 LDU apart along x
  models/lego/parts.json   the palette: categories, the part list with description and colour, and per-part
                           collision boxes measured like tools/part-boxes.py (sim frame: x = X, y = -Y, z = -Z, cm)

Also writes models/lego/base.json: the connectors of the Driving Base (models/src/driving-base.ldr) and of the arm
bracket (models/src/arm-fixed.ldr), placed in the Driving Base's frame, so attachments can pin onto the robot.

Usage: tools/snaps.py <ldraw library dir> <shadow library dir>      (needs numpy + scipy for the boxes)
"""
import importlib.util, json, math, os, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'models', 'lego')

# The palette: every Technic part (and the bricks and tiles) of SPIKE Prime (45678) and its expansion set (45681), by
# builder category, from LEGO's parts lists (via Brickset; LEGO's design numbers matched to LDraw's by name and picture).
# Each part has the colours the two sets have it in, with how many: [(LDraw colour, count), ...], the most common
# first (the colour a new part takes). LDraw colours: 0 black, 1 blue, 4 red, 14 yellow, 15 white, 19 tan, 26 magenta,
# 43 trans light blue, 47 trans clear, 70 reddish brown, 71 light grey, 72 dark grey, 288 dark green, 322 medium azure.
# Same-shape newer moulds count as the part LDraw has (42924 as 6558, 65304 as 32054, 44874 as 87082).
PALETTE = [
    ('Sensors', [('37308', [(15, 2)]), ('37316', [(15, 1)]), ('37312', [(15, 1)])]),
    ('Beams', [('60483', [(322, 4)]), ('32523', [(14, 14), (15, 4)]), ('32316', [(26, 13)]), ('32524', [(322, 13)]),
               ('40490', [(0, 13)]), ('32525', [(26, 11)]), ('41239', [(322, 10)]), ('32278', [(0, 12)]),
               ('18654', [(0, 4)])]),
    ('Bent beams and frames', [('32140', [(14, 13)]), ('32526', [(322, 9), (15, 6)]), ('14720', [(71, 10)]),
                                ('60484', [(0, 5), (14, 4)]), ('32348', [(0, 9)]), ('32271', [(14, 8)]), ('6629', [(15, 2)]),
                                ('32009', [(0, 9)]), ('3167', [(0, 2)]), ('99773', [(14, 4)]), ('39793', [(26, 12), (0, 6)]),
                                ('64179', [(0, 10)]), ('39794', [(26, 6)]), ('39790', [(322, 4)]), ('39370', [(322, 2)])]),
    ('Pins', [('61332', [(0, 172)]), ('3673', [(71, 12)]), ('6558', [(1, 64)]), ('32054', [(71, 26), (4, 6)]),
              ('43093', [(1, 24)]), ('3749', [(19, 30)]), ('11214', [(4, 8)]), ('18651', [(0, 15)]), ('4274', [(1, 16)]),
              ('39888', [(19, 8)]), ('6628', [(0, 6)])]),
    ('Axles', [('32062', [(4, 20)]), ('4519', [(14, 24)]), ('3705', [(0, 8)]), ('32073', [(71, 10)]), ('3706', [(4, 4)]),
               ('44294', [(14, 6)]), ('3707', [(0, 6)]), ('60485', [(71, 6)]), ('23948', [(14, 3)]), ('3708', [(4, 2)]),
               ('50450', [(0, 2)]), ('87083', [(72, 4)]), ('15462', [(70, 2)]), ('55013', [(72, 2)])]),
    ('Connectors', [('6536', [(0, 16)]), ('32184', [(15, 8)]), ('42003', [(4, 12)]), ('32291', [(0, 4)]),
                    ('63869', [(71, 8)]), ('69819', [(4, 4)]), ('59443', [(15, 7), (4, 4)]), ('42135', [(0, 6)]),
                    ('6553', [(71, 6)]), ('62462', [(14, 8)]), ('65489', [(71, 22)]), ('55615', [(71, 10)]),
                    ('22961', [(15, 4)]), ('87082', [(71, 2)]), ('31511', [(0, 4)]), ('45590', [(0, 6)]),
                    ('32013', [(71, 5)]), ('32034', [(0, 5)]), ('32016', [(322, 4)]), ('32192', [(15, 5)]),
                    ('32015', [(0, 4)]), ('32014', [(14, 17)]),
                    ('49283', [(4, 5), (14, 5), (322, 4), (1, 3), (26, 3), (288, 3)])]),
    ('Bushes', [('3713', [(71, 22)]), ('32123b', [(14, 16)])]),
    ('Gears and racks', [('32270', [(0, 5)]), ('18575', [(19, 5)]), ('46372', [(71, 5)]), ('32498', [(0, 5)]),
                         ('6589', [(19, 4)]), ('32198a', [(19, 2)]), ('35185', [(1, 2)]), ('87761', [(0, 2)]),
                         ('64781', [(0, 2)]), ('24121', [(0, 8)])]),
    ('Turntables', [('18939', [(71, 2)]), ('18938', [(0, 4)]), ('99009', [(71, 2)]), ('99010', [(0, 2)])]),   # base, then the top that turns on it
    ('Wheels and pulleys', [('39367p01', [(0, 8)]), ('49295p01', [(322, 4)]), ('56903', [(15, 3)]), ('4185a', [(0, 2)])]),
    ('Panels and plates', [('15458', [(0, 2)]), ('11954', [(322, 2)]), ('24119', [(0, 4)]), ('39369', [(14, 2)]),
                           ('65817', [(26, 1)]), ('3738', [(0, 4)]), ('4282', [(26, 2)]), ('4032a', [(322, 6)]),
                           ('18674', [(322, 4), (15, 2)])]),
    ('Bricks and tiles', [('39789', [(14, 5), (1, 5), (4, 5), (26, 5), (288, 5)]), ('3003', [(0, 2), (322, 2), (15, 2)]),
                          ('6143', [(15, 6), (14, 4), (43, 2)]), ('44126', [(0, 4)]), ('42022', [(14, 4)]),
                          ('24309', [(14, 4)]), ('85984', [(14, 4)]), ('41750', [(322, 1)]), ('41749', [(322, 1)]),
                          ('11215', [(15, 2)]), ('15535', [(0, 8), (4, 2)]), ('14769', [(15, 2)]),
                          ('98138', [(0, 4), (15, 4)]), ('35327', [(47, 4)])]),
    # not in the kits, kept so builds saved before the parts box matched them still load (not shown in the parts box)
    ('_hidden', [('41678', [(72, 0)]), ('48989', [(71, 0)]), ('3941', [(0, 0)]), ('2780', [(0, 0)])]),
]

LDCAD = re.compile(r'^0\s+!LDCAD\s+(SNAP_\w+)\s*(.*)$', re.I)
ATTR = re.compile(r'\[(\w+)=([^\]]*)\]')


def norm(n):
    return n.replace('\\', '/').lower().strip()


class Library:
    """An LDraw library folder plus the shadow library that annotates it."""

    def __init__(self, ldraw, shadow):
        self.ldraw, self.shadow = ldraw, shadow
        self.cache, self.text = {}, {}

    def find(self, root, name):
        n = norm(name)
        for pre in ('parts/', 'p/', ''):
            p = os.path.join(root, pre + n)
            if os.path.isfile(p):
                return p, pre + n
        return None, None

    def lines(self, name):
        if name not in self.text:
            path, _ = self.find(self.ldraw, name)
            self.text[name] = open(path, encoding='utf-8', errors='replace').read().splitlines() if path else None
        return self.text[name]

    def shadow_lines(self, name):
        path, _ = self.find(self.shadow, name)
        return open(path, encoding='utf-8', errors='replace').read().splitlines() if path else []

    def description(self, name):
        ls = self.lines(name) or ['0 ?']
        return ls[0][2:].strip() if ls else '?'

    def snaps(self, name, depth=0):
        """Connectors of a file in its own frame: a list of (kind, attrs, pos, rot) with rot a 3x3 matrix (may scale)."""
        key = norm(name)
        if key in self.cache:
            return self.cache[key]
        self.cache[key] = []                     # guards against loops
        out = []
        for line in self.lines(key) or []:      # inherited through the geometry
            t = line.split()
            if len(t) >= 15 and t[0] == '1' and depth < 12:
                sub = self.snaps(' '.join(t[14:]), depth + 1)
                if sub:
                    pos = np.array([float(v) for v in t[2:5]])
                    m = np.array([float(v) for v in t[5:14]]).reshape(3, 3)
                    out += [moved(s, pos, m) for s in sub]
        for line in self.shadow_lines(key):
            mm = LDCAD.match(line.strip())
            if not mm:
                continue
            kind, attrs = mm.group(1).upper(), {k.lower(): v.strip() for k, v in ATTR.findall(mm.group(2))}
            if kind == 'SNAP_CLEAR':
                cid = attrs.get('id')
                out = [s for s in out if cid is not None and (s[1].get('id') or '').lower() != cid.lower()]
                continue
            pos = vec(attrs.get('pos'), [0, 0, 0])
            ori = np.array(vec(attrs.get('ori'), [1, 0, 0, 0, 1, 0, 0, 0, 1])).reshape(3, 3)
            for g in grid(attrs.get('grid')):
                at = pos + ori @ g
                if kind == 'SNAP_INCL':
                    out += [moved(s, at, ori) for s in self.snaps(attrs.get('ref', ''), depth + 1)]
                elif kind in ('SNAP_CYL', 'SNAP_CLP', 'SNAP_FGR', 'SNAP_GEN'):
                    out.append((kind, attrs, at, ori.copy()))
        self.cache[key] = out
        return out


def vec(s, default):
    if not s:
        return np.array(default, dtype=float)
    return np.array([float(v) for v in s.split()], dtype=float)


def grid(spec):
    """Offsets (in the connector's own x/z plane) for a `grid=` attribute: [C] nx [C] nz stepx stepz."""
    if not spec:
        return [np.zeros(3)]
    t = spec.split()
    vals, centred, i = [], [], 0
    while len(vals) < 4 and i < len(t):
        if t[i].upper() == 'C':
            centred.append(len(vals)); i += 1; continue
        vals.append(float(t[i])); i += 1
    nx, nz, sx, sz = (vals + [1, 1, 0, 0])[:4]
    nx, nz = int(nx), int(nz)
    ox = -(nx - 1) * sx / 2 if 0 in centred else 0
    oz = -(nz - 1) * sz / 2 if 1 in centred else 0
    return [np.array([ox + ix * sx, 0, oz + iz * sz]) for ix in range(nx) for iz in range(nz)]


def moved(s, pos, m):
    kind, attrs, p, r = s
    return (kind, attrs, m @ p + pos, m @ r)


def pack_connector(s):
    """A connector as JSON: start point, running direction, a cross direction, and its scaled sections."""
    kind, attrs, p, r = s
    ycol, xcol = r[:, 1], r[:, 0]
    ly, lx, lz = np.linalg.norm(ycol), np.linalg.norm(xcol), np.linalg.norm(r[:, 2])
    if ly < 1e-6 or lx < 1e-6:
        return None
    scale = (attrs.get('scale') or 'YandR').lower()
    if abs(lx - lz) > 1e-3 and scale not in ('yonly', 'none'):
        return None                              # a squashed reference: no round connector survives that
    if scale == 'none' and (abs(ly - 1) > 1e-3 or abs(lx - 1) > 1e-3):
        return None
    sy = ly if scale in ('yonly', 'yandr', 'full') else 1.0
    sr = lx if scale in ('ronly', 'yandr', 'full') else 1.0
    d = -ycol / ly                               # sections run along the connector's -Y
    x = xcol / lx
    out = {'k': kind[5:].lower(), 'g': (attrs.get('gender') or 'M').upper()[0]}
    if kind == 'SNAP_CYL':
        secs = []
        t = (attrs.get('secs') or '').split()
        for i in range(0, len(t) - 2, 3):
            secs.append([t[i], round(float(t[i + 1]) * sr, 3), round(float(t[i + 2]) * sy, 3)])
        if not secs:
            return None
        total = sum(sc[2] for sc in secs)
        start = p - d * total / 2 if (attrs.get('center') or '').lower() == 'true' else p
        out.update({'o': start, 's': secs, 'sl': (attrs.get('slide') or '').lower() == 'true', 'cp': attrs.get('caps') or 'one'})
    else:
        centre = (attrs.get('center') or '').lower() == 'true'
        length = float(attrs.get('length', 0) or 0) * sy
        out['o'] = p - d * length / 2 if centre and length else p
        for k, short in (('radius', 'r'), ('length', 'len'), ('seq', 'seq'), ('bounding', 'bnd'), ('slide', 'sl')):
            if k in attrs:
                out[short] = attrs[k]
        if 'r' in out:
            out['r'] = round(float(out['r']) * sr, 3)
        if 'len' in out:
            out['len'] = round(length, 3)
    for k, short in (('id', 'id'), ('group', 'gp')):
        if attrs.get(k):
            out[short] = attrs[k]
    out['o'] = [round(float(v), 2) for v in out['o']]
    out['d'] = [round(float(v), 5) + 0.0 for v in d]
    out['x'] = [round(float(v), 5) + 0.0 for v in x]
    return out


def span(c):
    """A cylinder connector as a line (point closest to the origin, unit direction) and an interval along it."""
    o, d = np.array(c['o']), np.array(c['d'])
    if d[np.argmax(np.abs(d))] < 0:
        d = -d
    foot = o - d * (o @ d)
    t0 = o @ d
    t1 = t0 + (np.array(c['d']) @ d) * sum(sc[2] for sc in c['s'])
    return foot, d, min(t0, t1), max(t0, t1)


def dedupe(conns):
    """Drop repeats, and cylinders lying inside another of the same gender on the same line: a part that both
    includes a pin's connectors and inherits its primitives' (2780 includes 3673) would otherwise list them twice."""
    seen, out = set(), []
    for c in conns:
        key = json.dumps(c, sort_keys=True)
        if key not in seen:
            seen.add(key); out.append(c)
    cyl = [(c, span(c)) for c in out if c['k'] == 'cyl']
    drop = set()
    for i, (a, (fa, da, a0, a1)) in enumerate(cyl):
        for j, (b, (fb, db, b0, b1)) in enumerate(cyl):
            if i == j or j in drop or a['g'] != b['g'] or a.get('gp') != b.get('gp'):
                continue
            if abs(abs(da @ db) - 1) > 1e-4 or np.linalg.norm(fa - fb) > 0.5:
                continue
            if b0 - 0.01 <= a0 and a1 <= b1 + 0.01 and (b1 - b0 > a1 - a0 + 0.01 or i > j):
                drop.add(i); break
    gone = {id(cyl[i][0]) for i in drop}
    return [c for c in out if id(c) not in gone]


def part_connectors(lib, name):
    return dedupe([c for c in (pack_connector(s) for s in lib.snaps(name)) if c])


# ---------------- geometry pack (as tools/pack-ldraw.py does it, from the LDraw library itself) ----------------

def pack_geometry(lib, names, out_path, title):
    """One .mpd: a main model with every part at the origin, then every file the parts need (low-res primitives)."""
    order, seen = [], set()

    def resolve(ref):
        n = norm(ref)
        cands = []
        if n.startswith('s/'):
            cands = ['parts/' + n]
        elif n.startswith('48/') or n.startswith('8/'):
            cands = ['p/' + n]
        else:
            cands = ['parts/' + n, 'p/8/' + n, 'p/' + n]   # prefer the low-resolution primitive
        for c in cands:
            if os.path.isfile(os.path.join(lib.ldraw, c)):
                return c, n
        return None, n

    def visit(ref):
        path, n = resolve(ref)
        if path is None or n in seen:
            return
        seen.add(n)
        body = open(os.path.join(lib.ldraw, path), encoding='utf-8', errors='replace').read().splitlines()
        order.append((path, n, body))
        for l in body:
            t = l.split()
            if len(t) >= 15 and t[0] == '1':
                visit(' '.join(t[14:]))

    main = [f'0 {title}', f'0 Name: {os.path.basename(out_path)}']
    for i, (name, colour) in enumerate(names):   # spread out: the loader drops parts stacked at one spot
        main.append(f'1 {colour} {i * 400} 0 0 1 0 0 0 1 0 0 0 1 {name}.dat')
        visit(name + '.dat')

    def published(path, n):
        if path.startswith('parts/s/'):
            return 'parts/s/' + path[8:]
        if path.startswith('parts/'):
            return path[6:]
        if path.startswith('p/48/'):
            return 'p/48/' + path[5:]
        if path.startswith('p/8/'):
            return n                              # '8/x.dat' as referenced, or the plain name it stands in for
        return path[2:]

    lines = [f'0 FILE {os.path.basename(out_path)}'] + main
    for path, n, body in order:
        lines.append(f'0 FILE {published(path, n)}')
        lines += [l for l in body if not l.startswith('0 FILE')]
    open(out_path, 'w').write('\n'.join(lines) + '\n')
    return len(order)


def placed_connectors(lib, ldr_path):
    """Connectors of every part placed in an .ldr, in that model's frame, tagged with the part's line number."""
    out, i = [], 0
    for line in open(ldr_path, encoding='utf-8'):
        t = line.split()
        if len(t) < 15 or t[0] != '1':
            continue
        i += 1
        pos = np.array([float(v) for v in t[2:5]])
        m = np.array([float(v) for v in t[5:14]]).reshape(3, 3)
        for s in lib.snaps(' '.join(t[14:])):
            c = pack_connector(moved(s, pos, m))
            if c:
                c['i'] = i
                c['f'] = norm(' '.join(t[14:]))
                out.append(c)
    return dedupe(out)


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    lib = Library(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))
    os.makedirs(OUT, exist_ok=True)
    names = [(p, cs[0][0]) for _, ps in PALETTE for p, cs in ps if lib.lines(p + '.dat')]
    missing = [p for _, ps in PALETTE for p, _ in ps if not lib.lines(p + '.dat')]
    # parts already used by our models get connectors too (the robot, the attachments, the mission models)
    extra = set()
    for d in ('models/src',):
        for f in os.listdir(os.path.join(ROOT, d)):
            for line in open(os.path.join(ROOT, d, f), encoding='utf-8', errors='replace'):
                t = line.split()
                if len(t) >= 15 and t[0] == '1':
                    extra.add(norm(t[14])[:-4])
    for f in os.listdir(os.path.join(ROOT, 'models')):
        if f.endswith('.mpd'):
            first = True
            for line in open(os.path.join(ROOT, 'models', f), encoding='utf-8', errors='replace'):
                if line.startswith('0 FILE'):
                    if not first:
                        break
                    first = False
                t = line.split()
                if len(t) >= 15 and t[0] == '1':
                    extra.add(norm(t[14])[:-4])
    snaps = {}
    for p in sorted(set(n for n, _ in names) | {e for e in extra if lib.lines(e + '.dat')}):
        snaps[p] = {'d': lib.description(p + '.dat'), 's': part_connectors(lib, p + '.dat')}
    with open(os.path.join(OUT, 'snaps.json'), 'w') as f:
        f.write('{"license": "CC BY-SA 4.0: connector data derived from the LDCad shadow library (Roland Melkert and '
                'contributors, https://github.com/RolandMelkert/LDCadShadowLibrary) and the LDraw parts library (CC BY 4.0)",\n"parts": {\n')
        f.write(',\n'.join(f'{json.dumps(k)}: {json.dumps(v, separators=(",", ":"))}' for k, v in snaps.items()))
        f.write('\n}}\n')

    base = {'license': 'CC BY-SA 4.0 (LDCad shadow library connectors, see snaps.json)',
            'frame': 'models/src/driving-base.ldr (LDU: origin at the axle midpoint on the mat, forward -z, left +x, y down)',
            'base': placed_connectors(lib, os.path.join(ROOT, 'models/src/driving-base.ldr')),
            'bracket': placed_connectors(lib, os.path.join(ROOT, 'models/src/arm-fixed.ldr'))}
    with open(os.path.join(OUT, 'base.json'), 'w') as f:
        json.dump(base, f, separators=(',', ':'))

    n = pack_geometry(lib, names, os.path.join(OUT, 'parts.mpd'), 'Attachment builder parts (LDraw parts library, CC BY 4.0)')

    spec = importlib.util.spec_from_file_location('part_boxes', os.path.join(HERE, 'part-boxes.py'))
    pb = importlib.util.module_from_spec(spec); spec.loader.exec_module(pb)
    # measure with every part at the origin (a temporary copy of the pack)
    tmp = os.path.join(OUT, '.parts-origin.mpd')
    with open(tmp, 'w') as f:
        for line in open(os.path.join(OUT, 'parts.mpd')):
            t = line.split()
            if len(t) == 15 and t[0] == '1' and t[14][:-4] in dict(names):
                line = f'1 {t[1]} 0 0 0 1 0 0 0 1 0 0 0 1 {t[14]}\n'
            f.write(line)
    measured = {b['f'][:-4]: b for b in pb.measure(tmp)}
    os.remove(tmp)

    def ldraw_boxes(entry):
        """A part-boxes entry (upright frame, cm) as boxes in the LDraw frame (LDU): [cx,cy,cz, hx,hy,hz, qx,qy,qz,qw]."""
        q = entry['q']
        ql = [q[0], -q[1], -q[2], q[3]]          # conjugated by the 180-degree turn about x between the frames
        boxes = entry.get('b') or [[*entry['p'], *entry['h']]]
        return [[round(b[0] / pb.LDU, 1), round(-b[1] / pb.LDU, 1), round(-b[2] / pb.LDU, 1),
                 round(b[3] / pb.LDU, 1), round(b[4] / pb.LDU, 1), round(b[5] / pb.LDU, 1), *ql] for b in boxes]

    base['boxes'] = [bx for f in ('models/driving-base.mpd', 'models/attach/wheels.mpd', 'models/attach/arm-fixed.mpd')
                     for e in pb.measure(os.path.join(ROOT, f)) for bx in ldraw_boxes(e)]
    # the other chassis the robot builder offers: its connectors and boxes in its own LDraw frame
    base['chassis'] = {'advanced': {
        'base': placed_connectors(lib, os.path.join(ROOT, 'models/src/advanced-driving-base.ldr')),
        'boxes': [bx for f in ('models/advanced-driving-base.mpd', 'models/attach/advanced-wheels.mpd')
                  for e in pb.measure(os.path.join(ROOT, f)) for bx in ldraw_boxes(e)]}}
    with open(os.path.join(OUT, 'base.json'), 'w') as f:
        json.dump(base, f, separators=(',', ':'))
    catalog = {'categories': [], 'parts': {}}
    for cat, ps in PALETTE:
        catalog['categories'].append({'name': cat, 'parts': [p for p, _ in ps if lib.lines(p + '.dat')]})
        for p, cs in ps:
            c = cs[0][0]
            if not lib.lines(p + '.dat'):
                continue
            b = measured.get(p)
            # boxes in the part's own LDraw frame (LDU), axis-aligned there: [cx, cy, cz, hx, hy, hz]
            boxes = [bx[:6] for bx in ldraw_boxes(b)] if b else []
            friction = 'friction' in lib.description(p + '.dat').lower() and 'without' not in lib.description(p + '.dat').lower()
            catalog['parts'][p] = {'d': lib.description(p + '.dat'), 'c': c, 'cs': [list(x) for x in cs], 'b': boxes, 'fr': friction}
    with open(os.path.join(OUT, 'parts.json'), 'w') as f:
        f.write('{"categories": ' + json.dumps(catalog['categories']) + ',\n"parts": {\n')
        f.write(',\n'.join(f'{json.dumps(k)}: {json.dumps(v, separators=(",", ":"))}' for k, v in catalog['parts'].items()))
        f.write('\n}}\n')
    print(f'{len(snaps)} parts with connectors, {len(names)} in the palette, {n} files packed; missing: {missing or "none"}')
    for p, _ in names:
        cs = snaps[p]['s']
        kinds = {}
        for c in cs:
            k = c['k'] + c['g'] + ''.join(sorted(set(s[0] for s in c.get('s', []))))
            kinds[k] = kinds.get(k, 0) + 1
        print(f'  {p:8s} {snaps[p]["d"][:48]:48s} {kinds}')


if __name__ == '__main__':
    main()
