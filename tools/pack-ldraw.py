# pack-ldraw.py <model.ldr> <out.mpd> [name]: pack an .ldr with every part it uses into a self-contained .mpd.
# The part library is fll-sim's LDraw pack (https://github.com/martijas/fll-sim, apps/desktop/resources/ldraw/pack.json.gz,
# LDraw CC BY 4.0 + LDCad shadow CC BY-SA 4.0); point LDRAW_PACK at it. Sources for our models live in models/src.
# (apps/desktop/resources/ldraw/pack.json.gz). Low-res "8\" primitives are preferred where the pack has them.
import sys, gzip, json, re, os
PACK = os.environ.get("LDRAW_PACK", os.path.expanduser("~/Downloads/pack.json.gz"))   # fll-sim: apps/desktop/resources/ldraw/pack.json.gz
files = json.load(gzip.open(PACK))['files']
lower = {k.lower(): k for k in files}
def lookup(ref):
    r = ref.lower().replace('\\', '/')
    for cand in ('parts/' + r, 'p/' + r, r, 'parts/s/' + r.split('/')[-1] if r.startswith('s/') else None):
        if cand and cand in lower: return lower[cand]
    return None
def published(key):   # the name the section gets inside the mpd (what the loader asks for)
    k = key
    if k.startswith('parts/s/'): return 'parts/s/' + k[8:]
    if k.startswith('parts/'): return k[6:]
    if k.startswith('p/48/'): return 'p/48/' + k[5:]
    if k.startswith('p/'): return k[2:]
    return k
src, out = sys.argv[1], sys.argv[2]
name = sys.argv[3] if len(sys.argv) > 3 else os.path.splitext(os.path.basename(out))[0]
main = open(src, encoding='utf-8', errors='replace').read().splitlines()
order, seen, missing = [], set(), set()
def refs(lines):
    for l in lines:
        t = l.split()
        if len(t) >= 15 and t[0] == '1': yield t[14]
def visit(ref):
    key = lookup(ref)
    if key is None:
        if ref.lower() != 'fllsim-mount.dat': missing.add(ref)
        return
    if key in seen: return
    seen.add(key); order.append(key)
    for r in refs(files[key].splitlines()): visit(r)
for r in refs(main): visit(r)
body = [f'0 FILE {name}.ldr'] + [l for l in main if not l.lower().endswith('fllsim-mount.dat')]
for key in order:
    body.append(f'0 FILE {published(key)}')
    body += [l for l in files[key].splitlines() if not l.startswith('0 FILE')]
open(out, 'w').write('\n'.join(body) + '\n')
print(f'{out}: {len(order)} sections; missing: {sorted(missing) or "none"}')
