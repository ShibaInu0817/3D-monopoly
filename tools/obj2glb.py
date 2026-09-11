#!/usr/bin/env python3
"""Turn a Models Resource character rip into one self-contained, riggable GLB.

The rips arrive as .obj/.mtl/.fbx/.dae plus a texture, carry no skeleton, and are a
single mesh -- but the mesh falls apart into disconnected islands that line up with
anatomy, some of them mirrored into left and right halves which are rejoined first.
This splits those islands into named nodes (body, head, ears, arms, feet),
parents them, and writes a GLB whose texture is embedded, so one file drops straight
into `loadPiece()` and `makeCharacterToken` has real parts to animate.

    python3 tools/obj2glb.py temp/Kuromi/Kuromi.obj assets/sanrio/cast/kuromi.glb

Pass --flat to skip the split and emit a single mesh, for a model whose islands do
not classify cleanly. --report prints the island table without writing anything.
"""

import argparse, base64, json, os, struct, sys
from collections import defaultdict

# ---------------------------------------------------------------- obj parsing

def read_obj(path):
    V, VT, VN, tris = [], [], [], []
    mtllib = None
    for line in open(path, errors='ignore'):
        p = line.split()
        if not p:
            continue
        if   p[0] == 'v':  V.append((float(p[1]), float(p[2]), float(p[3])))
        elif p[0] == 'vt': VT.append((float(p[1]), float(p[2])))
        elif p[0] == 'vn': VN.append((float(p[1]), float(p[2]), float(p[3])))
        elif p[0] == 'mtllib': mtllib = p[1]
        elif p[0] == 'f':
            corners = []
            for tok in p[1:]:
                a = (tok.split('/') + ['', ''])[:3]
                corners.append((
                    int(a[0]) - 1,
                    int(a[1]) - 1 if a[1] else -1,
                    int(a[2]) - 1 if a[2] else -1,
                ))
            # fan-triangulate; these rips are already triangles or quads
            for k in range(1, len(corners) - 1):
                tris.append((corners[0], corners[k], corners[k + 1]))
    return V, VT, VN, tris, mtllib


def read_texture(obj_path, mtllib):
    """Find map_Kd in the .mtl, else fall back to the only PNG beside the OBJ."""
    folder = os.path.dirname(obj_path)
    if mtllib:
        mtl = os.path.join(folder, mtllib)
        if os.path.exists(mtl):
            for line in open(mtl, errors='ignore'):
                p = line.split()
                if p and p[0] == 'map_Kd':
                    cand = os.path.join(folder, ' '.join(p[1:]).strip())
                    if os.path.exists(cand):
                        return cand
    pngs = [f for f in sorted(os.listdir(folder)) if f.lower().endswith('.png')]
    return os.path.join(folder, pngs[0]) if pngs else None


# ------------------------------------------------------------------ islands

def islands(V, tris):
    """Connected components over vertex positions."""
    parent = list(range(len(V)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for t in tris:
        union(t[0][0], t[1][0])
        union(t[0][0], t[2][0])

    groups = defaultdict(list)
    for i in range(len(V)):
        groups[find(i)].append(i)
    return groups, find


def merge_mirror_halves(V, groups, eps=1e-4):
    """Some rips are modelled as a mirrored left and right half, so a single part
    arrives as two islands meeting on the x=0 seam. Kuromi's islands are whole
    parts; Cinnamoroll's head, body and tail are each cut down the middle.

    Pair two islands only when every one of these holds: equal vertex counts,
    both touching the midline, exactly mirrored X ranges, and matching Y and Z.
    That strictness is the whole point -- testing "touches the midline" alone
    would swallow Kuromi's eight central detail islands, and testing "mirrored"
    alone would fuse her left and right ears into one part.

    Returns the merged groups plus a remap from every original island root to the
    root that now represents it."""
    box = {}
    for r, vs in groups.items():
        gx = [V[i][0] for i in vs]; gy = [V[i][1] for i in vs]; gz = [V[i][2] for i in vs]
        box[r] = (len(vs), min(gx), max(gx), min(gy), max(gy), min(gz), max(gz))

    remap = {r: r for r in groups}
    merged = {r: list(vs) for r, vs in groups.items()}
    taken = set()
    order = sorted(groups, key=lambda r: -box[r][0])
    on_seam = lambda x0, x1: abs(x0) < eps or abs(x1) < eps

    for i, a in enumerate(order):
        if a in taken:
            continue
        na, ax0, ax1, ay0, ay1, az0, az1 = box[a]
        if not on_seam(ax0, ax1):
            continue
        for b in order[i + 1:]:
            if b in taken:
                continue
            nb, bx0, bx1, by0, by1, bz0, bz1 = box[b]
            if nb != na or not on_seam(bx0, bx1):
                continue
            if (abs(ax0 + bx1) < 1e-3 and abs(ax1 + bx0) < 1e-3
                    and abs(ay0 - by0) < 1e-3 and abs(ay1 - by1) < 1e-3
                    and abs(az0 - bz0) < 1e-3 and abs(az1 - bz1) < 1e-3):
                merged[a].extend(merged.pop(b))
                remap[b] = a
                taken.add(a); taken.add(b)
                break
    return merged, remap


def classify(V, groups):
    """Map islands onto body parts using proportions, not absolute coordinates, so
    the same rules survive a differently-scaled character.

    Order matters: the head is claimed before the ear rule runs, or a tall head
    island gets taken for an ear."""
    ys = [v[1] for v in V]; xs = [v[0] for v in V]
    H = max(ys) - min(ys) or 1.0
    W = max(xs) - min(xs) or 1.0
    y0 = min(ys)

    info = {}
    for root, verts in groups.items():
        gx = [V[i][0] for i in verts]; gy = [V[i][1] for i in verts]
        info[root] = dict(n=len(verts),
                          cx=(min(gx) + max(gx)) / 2,
                          cy=((min(gy) + max(gy)) / 2 - y0) / H,
                          bot=(min(gy) - y0) / H,
                          top=(max(gy) - y0) / H,
                          ax=abs((min(gx) + max(gx)) / 2) / W)

    order = sorted(info, key=lambda r: -info[r]['n'])
    part = {}

    # An island running most of the model's height is trunk, whatever else it
    # looks like. Pompompurin arrives as a front half and a back half that each
    # run floor to crown and are not mirror images of each other, so neither the
    # seam merge nor the rules below can pair them -- without this they read as a
    # body and a head stacked in the same place.
    trunk = [r for r in order if (info[r]['top'] - info[r]['bot']) > 0.70]
    if trunk:
        for r in trunk:
            part[r] = 'body'
    else:
        # Otherwise the body is whatever stands on the ground. Taking the largest
        # low island instead breaks on Cinnamoroll, whose tail outweighs his body
        # and sits just clear of the floor -- that hands the tail the body role.
        standing = [r for r in order if info[r]['bot'] < 0.02]
        body = standing[0] if standing else next((r for r in order if info[r]['cy'] < 0.36), order[0])
        part[body] = 'body'
    # The head is the highest thing sitting over the middle, not the biggest.
    # Cinnamoroll's tail outweighs his head and is just as centred, so picking by
    # size puts the tail on his shoulders. The size floor keeps a stray speck of
    # ear trim near the top of the model from winning instead.
    floor_n = 0.05 * sum(info[r]['n'] for r in info)
    centred = [r for r in order
               if r not in part and info[r]['ax'] < 0.20 and info[r]['n'] >= floor_n]
    head = max(centred, key=lambda r: info[r]['cy']) if centred else None
    if head is not None:
        part[head] = 'head'
    for r in order:
        if r in part: continue
        # high *and* off to one side. Height alone made ears of Pompompurin's
        # beret, which sits dead centre on top of him.
        if info[r]['top'] > 0.62 and info[r]['ax'] > 0.12:
            part[r] = 'ear-r' if info[r]['cx'] > 0 else 'ear-l'
    for r in order:
        if r in part: continue
        if info[r]['top'] < 0.08:
            part[r] = 'foot-r' if info[r]['cx'] > 0 else 'foot-l'
    for r in order:
        if r in part: continue
        if 0.14 < info[r]['cy'] < 0.44 and info[r]['ax'] > 0.08:
            part[r] = 'arm-r' if info[r]['cx'] > 0 else 'arm-l'
    for r in order:
        if r not in part:
            # with no head identified there is nothing for a high leftover to
            # belong to, so it rides the body -- which is how a beret on a dog
            # with no neck should behave anyway
            part[r] = 'head' if (head is not None and info[r]['cy'] > 0.55) else 'body'
    return part, info


ORDER = ['body', 'head', 'ear-l', 'ear-r', 'arm-l', 'arm-r', 'foot-l', 'foot-r']
# who hangs off whom, and where each part's hinge sits inside its own bounds
PARENT = {'head': 'body', 'ear-l': 'head', 'ear-r': 'head',
          'arm-l': 'body', 'arm-r': 'body', 'foot-l': 'body', 'foot-r': 'body'}
HINGE = {                       # (x rule, y rule) within the part's bounding box
    'body':   ('centre', 'floor'),
    'head':   ('centre', 'min'),      # neck
    'ear-l':  ('inner',  'min'),      # base, nearest the skull
    'ear-r':  ('inner',  'min'),
    'arm-l':  ('inner',  'max'),      # shoulder
    'arm-r':  ('inner',  'max'),
    'foot-l': ('centre', 'floor'),
    'foot-r': ('centre', 'floor'),
}


def hinge_for(name, pts, floor):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    rx, ry = HINGE[name]
    if   rx == 'centre': x = (min(xs) + max(xs)) / 2
    else:                x = min(xs) if (min(xs) + max(xs)) / 2 > 0 else max(xs)
    if   ry == 'floor':  y = floor
    elif ry == 'min':    y = min(ys)
    else:                y = max(ys)
    return (x, y, (min(zs) + max(zs)) / 2)


# --------------------------------------------------------------- glb writing

class Bin:
    """Accumulates the binary chunk and hands back bufferView indices."""
    def __init__(self):
        self.buf = bytearray()
        self.views = []

    def add(self, raw, target=None, stride=None):
        while len(self.buf) % 4:            # every view starts 4-byte aligned
            self.buf.append(0)
        off = len(self.buf)
        self.buf.extend(raw)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        self.views.append(v)
        return len(self.views) - 1


def build_glb(parts, tex_path, name):
    """parts: ordered {part_name: (positions, normals, uvs, indices, hinge)}"""
    gltf = {
        'asset': {'version': '2.0', 'generator': 'obj2glb.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [], 'meshes': [], 'accessors': [], 'bufferViews': [],
        'materials': [{
            'name': 'skin',
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': 0},
                'metallicFactor': 0.0, 'roughnessFactor': 0.85,
            },
            # the rips use alpha for cutout detail, never for blending
            'alphaMode': 'MASK', 'alphaCutoff': 0.5,
            'doubleSided': True,
        }],
    }
    b = Bin()

    def accessor(view, ctype, count, atype, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': ctype, 'count': count, 'type': atype}
        if mn is not None: a['min'] = mn; a['max'] = mx
        gltf['accessors'].append(a)
        return len(gltf['accessors']) - 1

    node_of = {}
    # node 0 is the character root so the whole thing can be moved as one
    gltf['nodes'].append({'name': name, 'children': []})

    for part in [p for p in ORDER if p in parts]:
        pos, nor, uv, idx, hinge = parts[part]

        vpos = b.add(struct.pack('<%df' % len(pos), *pos), target=34962, stride=12)
        vnor = b.add(struct.pack('<%df' % len(nor), *nor), target=34962, stride=12)
        vuv  = b.add(struct.pack('<%df' % len(uv),  *uv),  target=34962, stride=8)
        big  = max(idx) > 65535
        vidx = b.add(struct.pack('<%d%s' % (len(idx), 'I' if big else 'H'), *idx), target=34963)

        n = len(pos) // 3
        mn = [min(pos[i::3]) for i in range(3)]
        mx = [max(pos[i::3]) for i in range(3)]
        aPos = accessor(vpos, 5126, n, 'VEC3', mn, mx)   # POSITION needs min/max
        aNor = accessor(vnor, 5126, n, 'VEC3')
        aUv  = accessor(vuv,  5126, n, 'VEC2')
        aIdx = accessor(vidx, 5125 if big else 5123, len(idx), 'SCALAR')

        gltf['meshes'].append({'name': part, 'primitives': [{
            'attributes': {'POSITION': aPos, 'NORMAL': aNor, 'TEXCOORD_0': aUv},
            'indices': aIdx, 'material': 0,
        }]})
        gltf['nodes'].append({'name': part, 'mesh': len(gltf['meshes']) - 1})
        node_of[part] = len(gltf['nodes']) - 1

    def parent_for(part):
        """Nearest ancestor this model actually has. Pompompurin has ears but no
        head -- his beret and muzzle are welded into one trunk -- and without
        walking the chain his ears would hang off the root and sit perfectly
        still while his body swayed underneath them."""
        p = PARENT.get(part)
        while p is not None and p not in node_of:
            p = PARENT.get(p)
        return p

    # hierarchy, and each node sits at its hinge relative to its parent's hinge
    for part, ni in node_of.items():
        parent = parent_for(part)
        hinge = parts[part][4]
        if parent in node_of:
            ph = parts[parent][4]
            t = [hinge[i] - ph[i] for i in range(3)]
            gltf['nodes'][node_of[parent]].setdefault('children', []).append(ni)
        else:
            t = list(hinge)
            gltf['nodes'][0]['children'].append(ni)
        if any(abs(c) > 1e-9 for c in t):
            gltf['nodes'][ni]['translation'] = t

    if tex_path:
        raw = open(tex_path, 'rb').read()
        vimg = b.add(raw)
        gltf['images'] = [{'name': os.path.basename(tex_path),
                           'bufferView': vimg, 'mimeType': 'image/png'}]
        gltf['samplers'] = [{'magFilter': 9728,   # NEAREST — a 256px atlas stays crisp
                             'minFilter': 9987,   # LINEAR_MIPMAP_LINEAR
                             'wrapS': 10497, 'wrapT': 10497}]
        gltf['textures'] = [{'sampler': 0, 'source': 0}]
    else:
        del gltf['materials'][0]['pbrMetallicRoughness']['baseColorTexture']

    gltf['bufferViews'] = b.views
    gltf['buffers'] = [{'byteLength': len(b.buf)}]

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)          # JSON chunk pads with spaces
    bn = bytes(b.buf) + b'\x00' * ((4 - len(b.buf) % 4) % 4)

    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(bn), 0x004E4942) + bn
    return bytes(out)


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('obj')
    ap.add_argument('out', nargs='?')
    ap.add_argument('--name', help='root node name (default: from the filename)')
    ap.add_argument('--flat', action='store_true', help='one mesh, no island split')
    ap.add_argument('--report', action='store_true', help='print the island table only')
    args = ap.parse_args()

    V, VT, VN, tris, mtllib = read_obj(args.obj)
    if not tris:
        sys.exit('no faces in %s' % args.obj)
    tex = read_texture(args.obj, mtllib)
    name = args.name or os.path.splitext(os.path.basename(args.obj))[0]

    groups, find = islands(V, tris)
    remap = {r: r for r in groups}
    if args.flat:
        part_of = {r: 'body' for r in groups}
        info = {}
    else:
        groups, remap = merge_mirror_halves(V, groups)
        part_of, info = classify(V, groups)

    vert_part = {i: part_of[remap[find(i)]] for i in range(len(V))}
    by_part = defaultdict(list)
    for t in tris:
        by_part[vert_part[t[0][0]]].append(t)

    floor = min(v[1] for v in V)
    pts_of = defaultdict(list)
    for i, p in vert_part.items():
        pts_of[p].append(V[i])

    parts = {}
    for part, ts in by_part.items():
        hx, hy, hz = hinge_for(part, pts_of[part], floor)
        seen, pos, nor, uv, idx = {}, [], [], [], []
        for t in ts:
            for key in t:
                if key not in seen:
                    seen[key] = len(pos) // 3
                    vi, ti, ni = key
                    pos.extend([V[vi][0] - hx, V[vi][1] - hy, V[vi][2] - hz])
                    nor.extend(VN[ni] if ni >= 0 else (0.0, 1.0, 0.0))
                    u, v = VT[ti] if ti >= 0 else (0.0, 0.0)
                    uv.extend([u, 1.0 - v])          # glTF UVs run top-down
                idx.append(seen[key])
        parts[part] = (pos, nor, uv, idx, (hx, hy, hz))

    print('%-9s %6s %6s   %s' % ('PART', 'VERTS', 'TRIS', 'HINGE'))
    for p in [q for q in ORDER if q in parts]:
        d = parts[p]
        print('  %-7s %6d %6d   %s' % (
            p, len(d[0]) // 3, len(d[3]) // 3,
            '(%.3f, %.3f, %.3f)' % d[4]))
    print('  %-7s %6s %6d' % ('total', '', sum(len(d[3]) for d in parts.values()) // 3))
    if args.report:
        return

    out = args.out or os.path.splitext(args.obj)[0] + '.glb'
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    blob = build_glb(parts, tex, name)
    open(out, 'wb').write(blob)
    print('\nwrote %s  (%.0f KB, texture %s)' % (
        out, len(blob) / 1024, os.path.basename(tex) if tex else 'none'))


if __name__ == '__main__':
    main()
