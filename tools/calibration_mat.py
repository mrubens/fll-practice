#!/usr/bin/env python3
"""Make calibration-mat.pdf: the two US letter sheets of the calibration strip (landscape).

Sheet 1 is the start: a start line and a dashed middle line. Sheet 2 is an angle fan: a line for every degree from
the robot's start point (the middle of its wheels on the start line), so after a turn and a short drive the line under
the robot's front says which way it really went. Nothing is cut or joined: a tape measure taped down along both
sheets' right edges keeps them in line and gives every distance. The layout must match LANE in js/boards.js.
Run: python3 tools/calibration_mat.py
"""
import math
import os

CM = 72 / 2.54                      # points per cm
PW, PH = 27.94, 21.59               # letter, landscape (cm)
MID = PW / 2                        # the lane's middle runs up the page; the robot drives from the bottom edge up
# along the lane, from the start line (cm)
S1_BACK = -9.0                      # sheet 1's bottom edge
S2_NEAR = 28.0                      # sheet 2's bottom edge
EDGE = 1.4                          # keep the fan this far inside the paper (printer margins)
GREY = (0.45, 0.48, 0.55)
INK = (0.12, 0.14, 0.19)


def esc(t):
    return t.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


class Page:
    """Drawing in cm from the page's top-left corner."""
    def __init__(self, back):
        self.back = back            # the distance along the lane at the page's bottom edge
        self.ops = []

    def y(self, d):                 # distance along the lane -> cm from the page's top
        return PH - (d - self.back)

    def pt(self, x, y):
        return x * CM, (PH - y) * CM

    def rect(self, x0, y0, x1, y1, rgb):
        a, b = self.pt(x0, y1)
        c, d = self.pt(x1, y0)
        self.ops.append(f'{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg {a:.2f} {b:.2f} {c - a:.2f} {d - b:.2f} re f')

    def line(self, x0, y0, x1, y1, w, rgb, dash=None):
        a, b = self.pt(x0, y0)
        c, d = self.pt(x1, y1)
        ds = f'[{dash[0] * CM:.1f} {dash[1] * CM:.1f}] 0 d ' if dash else '[] 0 d '
        self.ops.append(f'{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} RG {w * CM:.2f} w {ds}{a:.2f} {b:.2f} m {c:.2f} {d:.2f} l S')

    def text(self, x, y, s, size, rgb=GREY, rot=0, anchor='start'):
        if anchor == 'middle':
            x -= len(s) * size * 0.30 * math.cos(math.radians(rot))
            y += len(s) * size * 0.30 * math.sin(math.radians(rot))
        a, b = self.pt(x, y)
        c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        self.ops.append(f'BT {rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg /F1 {size * CM:.2f} Tf {c:.4f} {sn:.4f} {-sn:.4f} {c:.4f} {a:.2f} {b:.2f} Tm ({esc(s)}) Tj ET')

    def check_bar(self, x, y):
        self.rect(x, y, x + 10, y + 0.3, INK)
        self.text(x + 10.3, y + 0.3, '10 cm: check this bar with a ruler (print at 100% / Actual size)', 0.32)

    def tape_note(self, d, label):
        y = self.y(d)
        self.text(PW - 1.3 - len(label) * 0.36 * 0.62, y - 0.9, label, 0.36, INK)


def sheet1():
    p = Page(S1_BACK)
    y0 = p.y(0)
    p.line(MID, 1.4, MID, PH - 1.4, 0.06, GREY, dash=(0.6, 0.4))                     # the lane's middle
    p.rect(1.3, y0 - 0.6, PW - 1.3, y0 + 0.6, (0, 0, 0))                             # start line
    for k in (1, 2, 3):                                                               # arrows up the lane
        y = 2.0 + k * 0.5
        p.line(MID - 0.8, y + 0.8, MID, y, 0.08, GREY)
        p.line(MID + 0.8, y + 0.8, MID, y, 0.08, GREY)
    p.text(1.5, 2.2, 'CALIBRATION STRIP', 0.6, INK)
    p.text(1.5, 3.0, 'Sheet 1 of 2: START', 0.45, INK)
    p.text(1.5, 4.2, 'Put the middle of the wheels on', 0.34)
    p.text(1.5, 4.7, 'the black line and the middle of', 0.34)
    p.text(1.5, 5.2, 'the robot on the dashed line.', 0.34)
    p.text(1.5, 6.0, 'The robot drives up the page.', 0.34)
    p.text(PW - 8.6, 2.2, 'Tape the tape measure down', 0.34)
    p.text(PW - 8.6, 2.7, 'along this edge, with its', 0.34)
    p.text(PW - 8.6, 3.2, '0 at the start line.', 0.34)
    p.tape_note(0, 'tape measure 0 here >')
    p.check_bar(1.5, PH - 1.6)
    return p


def sheet2():
    p = Page(S2_NEAR)
    # a line for every degree from the start point (the lane's middle at the start line), right of the robot positive
    lo, hi = S2_NEAR + EDGE, S2_NEAR + PH - EDGE
    side = MID - EDGE
    for a in range(-30, 31):
        r = math.radians(a)
        r0 = lo / math.cos(r)
        r1 = min(hi / math.cos(r), side / abs(math.sin(r)) if a else 1e9)
        if r1 <= r0 + 0.5:
            continue
        w = 0.14 if a == 0 else 0.07 if a % 5 == 0 else 0.03
        p.line(MID + r0 * math.sin(r), p.y(r0 * math.cos(r)), MID + r1 * math.sin(r), p.y(r1 * math.cos(r)), w, INK)
        if a % 5 == 0:
            rl = r1 - 0.9
            lab = '0' if a == 0 else f'{abs(a)}'
            x, y = MID + rl * math.sin(r), p.y(rl * math.cos(r))
            if r1 < hi / math.cos(r) - 0.01:          # leaves by a side: put the number just inside it
                x = MID + math.copysign(side - 1.0, a)
            p.rect(x - 0.55, y - 0.45, x + 0.55, y + 0.25, (1, 1, 1))
            p.text(x, y + 0.12, lab, 0.42, INK, anchor='middle')
    for k in range(4):                                 # arcs every 5 cm from the start point, to help read along a line
        rr = 30 + 5 * k
        pts = [(MID + rr * math.sin(math.radians(t / 2)), p.y(rr * math.cos(math.radians(t / 2)))) for t in range(-60, 61)]
        pts = [q for q in pts if EDGE < q[0] < PW - EDGE and EDGE < q[1] < PH - EDGE]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            p.line(x0, y0, x1, y1, 0.02, GREY)
    p.rect(MID - 2.6, 2.75, MID + 2.6, 3.45, (1, 1, 1))
    p.text(MID - 2.45, 3.25, '< left', 0.36, INK)
    p.text(MID + 0.95, 3.25, 'right >', 0.36, INK)
    p.rect(1.3, PH - 1.95, PW - 1.3, PH - 0.5, (1, 1, 1))
    p.text(1.5, PH - 1.45, 'CALIBRATION STRIP   Sheet 2 of 2: ANGLES', 0.36, INK)
    p.text(1.5, PH - 0.8, f'Put this edge at {S2_NEAR:.0f} cm on the tape measure, the right edge against it. Read the line under the middle of the robot\'s front.', 0.3)
    return p


def build(path, sheets=None):
    pages = ['\n'.join(f().ops) for f in (sheets or (sheet1, sheet2))]
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']
    kids = []
    for content in pages:
        data = content.encode('latin-1')
        objs.append(f'<< /Length {len(data)} >>\nstream\n{content}\nendstream')
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PW * CM:.2f} {PH * CM:.2f}] /Resources << /Font << /F1 3 0 R >> >> /Contents {len(objs)} 0 R >>')
        kids.append(len(objs))
    objs[1] = f'<< /Type /Pages /Kids [{" ".join(f"{k} 0 R" for k in kids)}] /Count {len(kids)} >>'
    out, offs = bytearray(b'%PDF-1.4\n'), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f'{i} 0 obj\n{o}\nendobj\n'.encode('latin-1')
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offs:
        out += f'{o:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    with open(path, 'wb') as f:
        f.write(out)


if __name__ == '__main__':
    import sys
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build(os.path.join(here, 'calibration-mat.pdf'))
    if len(sys.argv) > 1:           # a folder: also each sheet on its own, for previews
        for i, f in enumerate((sheet1, sheet2), 1):
            build(os.path.join(sys.argv[1], f'sheet{i}.pdf'), [f])
    print('wrote calibration-mat.pdf')
