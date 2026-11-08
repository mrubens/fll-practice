#!/usr/bin/env python3
"""Split models/lego/parts.mpd (every palette part, packed together) into one self-contained file per part,
models/lego/parts/<part>.mpd, so the app parses only the parts it draws: a robot needs its sensors and tools, not
all 120-odd. Run after tools/snaps.py rewrites parts.mpd. Part names follow the palette order in parts.json."""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'models/lego/parts.mpd'), encoding='utf-8').read().splitlines()
pj = json.load(open(os.path.join(ROOT, 'models/lego/parts.json')))
names = [p for c in pj['categories'] for p in c['parts']]

sections, cur = {}, None
order = []
for line in src:
    if line.startswith('0 FILE '):
        cur = line[7:].strip(); sections[cur] = []; order.append(cur); continue
    sections[cur].append(line)
main = sections[order[0]]
lower = {k.lower(): k for k in sections}

def ref_of(line):
    t = line.split()
    return ' '.join(t[14:]) if len(t) >= 15 and t[0] == '1' else None

def closure(name):
    out, stack = [], [name]
    seen = set()
    while stack:
        n = stack.pop()
        r = n.lower().replace('\\', '/')
        k = next((lower[c] for c in (r, 'parts/' + r, 'p/' + r) if c in lower), None)   # s\x.dat is packed as parts/s/x.dat
        if not k or k in seen: continue
        seen.add(k); out.append(k)
        for l in sections[k]:
            r = ref_of(l)
            if r: stack.append(r)
    return out

outdir = os.path.join(ROOT, 'models/lego/parts')
os.makedirs(outdir, exist_ok=True)
for f in os.listdir(outdir):
    if f.endswith('.mpd'): os.remove(os.path.join(outdir, f))
i = 0
for line in main:
    r = ref_of(line)
    if not r: continue
    from_file = re.sub(r'\.dat$', '', r.lower())
    name = from_file if from_file in names else names[i]
    t = line.split()
    body = [f'0 FILE {name}.ldr', f'0 {name} (from the attachment builder parts, LDraw parts library CC BY 4.0)',
            ' '.join(['1', t[1], '0', '0', '0', '1', '0', '0', '0', '1', '0', '0', '0', '1', r])]
    for k in closure(r):
        body.append(f'0 FILE {k}'); body += sections[k]
    open(os.path.join(outdir, f'{name}.mpd'), 'w', encoding='utf-8').write('\n'.join(body) + '\n')
    i += 1
print(i, 'parts written to models/lego/parts/')
