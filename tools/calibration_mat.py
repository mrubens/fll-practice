#!/usr/bin/env python3
"""Make calibration-mat.pdf: the two US letter sheets of the calibration strip (landscape).

Sheet 1 is the start: a start line and a dashed middle line. Sheet 2 has a black line, red, green and blue strips and
a sideways scale. Nothing is cut or joined: a tape measure taped down along both sheets' right edges keeps them in
line and gives every distance. The layout must match LANE in js/boards.js.
Run: python3 tools/calibration_mat.py
"""
import math
import os

CM = 72 / 2.54                      # points per cm
PW, PH = 27.94, 21.59               # letter, landscape (cm)
MID = PW / 2                        # the lane's middle runs up the page; the robot drives from the bottom edge up
# along the lane, from the start line (cm)
S1_BACK = -9.0                      # sheet 1's bottom edge
S2_NEAR = 36.0                      # sheet 2's bottom edge
BLACK = 42.0                        # black line (middle)
BANDS = [('RED', 44.5, (0.890, 0.0, 0.043)), ('GREEN', 48, (0.0, 0.659, 0.271)), ('BLUE', 51.5, (0.043, 0.373, 0.769))]   # from, 2.5 cm deep
BAND = 2.5
HALF = 11.0                         # half the width of the lines and strips
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
    # sideways scale just before the black line: cm left and right of the middle
    ys = p.y(S2_NEAR + 2.8)
    p.line(MID - 12, ys, MID + 12, ys, 0.04, INK)
    for i in range(-12, 13):
        h = 1.0 if i % 5 == 0 else 0.5
        p.line(MID + i, ys - h, MID + i, ys, 0.05, INK)
        if i % 5 == 0:
            p.text(MID + i, ys + 0.6, str(abs(i)), 0.4, INK, anchor='middle')
    p.text(MID - 12, ys + 1.25, '< cm left of the middle', 0.32)
    p.text(MID + 6.2, ys + 1.25, 'cm right of the middle >', 0.32)
    p.rect(MID - HALF, p.y(BLACK + 0.6), MID + HALF, p.y(BLACK - 0.6), (0, 0, 0))   # black line
    for name, d, rgb in BANDS:
        p.rect(MID - HALF, p.y(d + BAND), MID + HALF, p.y(d), rgb)
        p.text(MID + HALF + 0.3, p.y(d + BAND / 2 - 0.15), name, 0.36, INK)
    p.text(MID + HALF + 0.3, p.y(BLACK - 0.15), 'BLACK', 0.36, INK)
    p.text(1.5, 1.95, 'CALIBRATION STRIP   Sheet 2 of 2: LINE AND COLORS', 0.45, INK)
    p.text(1.5, PH - 0.75, f'Put this edge at {S2_NEAR:.0f} cm on the tape measure, the right edge against it.', 0.34)
    p.tape_note(BLACK, f'black line: {BLACK:.0f} cm >')
    p.check_bar(1.5, 2.45)
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
