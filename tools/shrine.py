#!/usr/bin/env python3
"""Build the Sanrio shrine diorama as one self-contained GLB.

    python3 tools/shrine.py assets/sanrio/shrine.glb

Nothing here is scanned or traced. The scene is hand-placed low-poly geometry —
a round grass plinth, a shrine with a hipped tile roof, a torii, cherry and
broadleaf trees, lanterns, rocks and scattered charms — built from a handful of
primitives and written straight out as glTF, the same way `obj2glb.py` writes
its characters, so the tool needs nothing but the standard library.

Colour is carried by materials rather than a texture, which keeps the file to
one part and keeps the palette editable here rather than in an image. Everything
is flat-shaded on purpose: the faceting IS the look.

The model is Y-up, sits on y=0 and fits a 1-unit-radius base, so `normalise()`
in board3d can size it like any other kit model. The cast is deliberately not
modelled — Kuromi and friends already exist as real rips under
assets/sanrio/cast/ and belong on top of this, not baked into it.
"""

import argparse, json, math, os, struct
from collections import OrderedDict
from random import Random

# --------------------------------------------------------------- palette
#
# Sampled off the reference render. glTF wants baseColorFactor in linear space,
# so these stay readable as sRGB hex here and are converted on the way out —
# dumping sRGB straight into the factor is what makes this kind of model come
# out chalky.

PALETTE = {
    'base':       0x8d6e5b,   # the plinth's chocolate rim
    'base-edge':  0x7b5f4e,
    'grass':      0xa9c47f,
    'grass-side': 0x9bb772,
    'sand':       0xe9dfc8,   # raked courtyard
    'stone':      0xc9cbc5,   # path slabs
    'stone-dark': 0xb0b3ad,
    'wood':       0xcb9a68,   # shrine cladding
    'wood-dark':  0x966b40,   # posts and beams
    'wood-deep':  0x5a3f28,   # doorway, offering box
    'roof':       0x8d99a8,
    'roof-dark':  0x76828f,   # eave band, read as the tile edge
    'ridge':      0xb9c3cd,
    'torii':      0xd6473c,
    'torii-foot': 0x40383c,
    'trunk':      0x8e6b50,
    'leaf-a':     0x9ec97f,
    'leaf-b':     0x8cbb6d,
    'leaf-c':     0xb4d992,
    'petal-a':    0xf6c3d6,
    'petal-b':    0xeeafc7,
    'petal-c':    0xffdae7,
    'rock':       0xb8bcb8,
    'rock-dark':  0xa3a8a4,
    'gold':       0xf5d76a,   # stars
    'bow-red':    0xe2564a,
    'bow-pink':   0xf4a6c0,
    'white':      0xfdfbfa,
    'mint':       0xa8ded0,
}

# --------------------------------------------------------------- maths

def srgb_to_linear(hex_rgb):
    out = []
    for shift in (16, 8, 0):
        c = ((hex_rgb >> shift) & 0xff) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def xform(tris, t=(0.0, 0.0, 0.0), ry=0.0, rx=0.0, rz=0.0, s=1.0):
    """Scale, then Z, X, Y rotations, then translate. Applied per point because
    there is no matrix stack worth having at this size."""
    sx, sy, sz = (s, s, s) if isinstance(s, (int, float)) else s
    cy, ny = math.cos(ry), math.sin(ry)
    cx, nx = math.cos(rx), math.sin(rx)
    cz, nz = math.cos(rz), math.sin(rz)
    out = []
    for tri in tris:
        moved = []
        for (x, y, z) in tri:
            x, y, z = x * sx, y * sy, z * sz
            x, y = x * cz - y * nz, x * nz + y * cz
            y, z = y * cx - z * nx, y * nx + z * cx
            x, z = x * cy + z * ny, -x * ny + z * cy
            moved.append((x + t[0], y + t[1], z + t[2]))
        out.append(tuple(moved))
    return out


def signed_area(pts):
    a = 0.0
    for i, (x, z) in enumerate(pts):
        x2, z2 = pts[(i + 1) % len(pts)]
        a += x * z2 - x2 * z
    return a / 2.0

# --------------------------------------------------------------- primitives
#
# Everything solid is a `tube`: two parallel rings, sides plus caps. Rings run
# anticlockwise seen from below, which is what fixes the winding for every shape
# derived from them — box, frustum, cylinder, cone, prism. Rings that collapse to
# a point produce degenerate triangles, and those get dropped at emit time, so a
# pyramid is just a frustum with a zero-size top.

def quad(a, b, c, d):
    return [(a, b, c), (a, c, d)]


def ring(n, r, y, phase=0.0, sx=1.0, sz=1.0):
    return [(math.cos(phase + 2 * math.pi * i / n) * r * sx, y,
             math.sin(phase + 2 * math.pi * i / n) * r * sz) for i in range(n)]


def sq_ring(w, d, y):
    x, z = w / 2.0, d / 2.0
    return [(x, y, z), (-x, y, z), (-x, y, -z), (x, y, -z)]


def poly_ring(pts, y):
    p = pts if signed_area(pts) > 0 else pts[::-1]
    return [(x, y, z) for (x, z) in p]


def tube(bot, top, cap_bot=True, cap_top=True):
    n = len(bot)
    t = []
    for i in range(n):
        j = (i + 1) % n
        t += quad(bot[j], bot[i], top[i], top[j])
    if cap_bot:
        t += [(bot[0], bot[i], bot[i + 1]) for i in range(1, n - 1)]
    if cap_top:
        t += [(top[0], top[i + 1], top[i]) for i in range(1, n - 1)]
    return t


def box(w, h, d, y0=0.0):
    return tube(sq_ring(w, d, y0), sq_ring(w, d, y0 + h))


def frustum(w0, d0, w1, d1, h, y0=0.0):
    return tube(sq_ring(w0, d0, y0), sq_ring(w1, d1, y0 + h))


def cyl(r0, r1, h, n=12, y0=0.0, phase=0.0):
    return tube(ring(n, r0, y0, phase), ring(n, r1, y0 + h, phase))


def prism(pts, h, y0=0.0):
    return tube(poly_ring(pts, y0), poly_ring(pts, y0 + h))


def flat(pts, y):
    """A ground decal: one upward-facing fan, no sides. Convex only."""
    r = poly_ring(pts, y)
    return [(r[0], r[i + 1], r[i]) for i in range(1, len(r) - 1)]


def wedge(hw, hy, z0, z1, y0=0.0):
    """Gable block: a triangle in XY, extruded along Z. Apex centred."""
    f = [(-hw, y0, z1), (hw, y0, z1), (0.0, y0 + hy, z1)]
    b = [(-hw, y0, z0), (hw, y0, z0), (0.0, y0 + hy, z0)]
    t = [tuple(f), (b[0], b[2], b[1])]
    t += quad(f[1], b[1], b[2], f[2])       # right slope
    t += quad(b[0], f[0], f[2], b[2])       # left slope
    t += quad(b[0], b[1], f[1], f[0])       # underside
    return t


def round_rect(x0, z0, x1, z1, r, n=5):
    pts = []
    corners = [(x1 - r, z1 - r, 0.0), (x0 + r, z1 - r, math.pi / 2),
               (x0 + r, z0 + r, math.pi), (x1 - r, z0 + r, 3 * math.pi / 2)]
    for cx, cz, a0 in corners:
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            pts.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
    return pts


_T = (1 + 5 ** 0.5) / 2
ICO_V = [(-1, _T, 0), (1, _T, 0), (-1, -_T, 0), (1, -_T, 0),
         (0, -1, _T), (0, 1, _T), (0, -1, -_T), (0, 1, -_T),
         (_T, 0, -1), (_T, 0, 1), (-_T, 0, -1), (-_T, 0, 1)]
ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
         (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
         (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]


def blob(r=1.0, subdiv=1, jitter=0.0, rng=None, scale=(1.0, 1.0, 1.0), squash_y=1.0):
    """Icosphere with per-vertex radial noise — the lumpy faceted foliage rock.
    Vertices are shared before jittering so the surface stays closed."""
    verts = [list(v) for v in ICO_V]
    for v in verts:
        L = math.sqrt(sum(c * c for c in v))
        v[:] = [c / L for c in v]
    faces = [list(f) for f in ICO_F]
    for _ in range(subdiv):
        mid, out = {}, []
        def middle(a, b):
            key = (min(a, b), max(a, b))
            if key not in mid:
                m = [(verts[a][i] + verts[b][i]) / 2 for i in range(3)]
                L = math.sqrt(sum(c * c for c in m))
                verts.append([c / L for c in m])
                mid[key] = len(verts) - 1
            return mid[key]
        for a, b, c in faces:
            ab, bc, ca = middle(a, b), middle(b, c), middle(c, a)
            out += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        faces = out
    pts = []
    for v in verts:
        k = r * (1 + (rng.uniform(-jitter, jitter) if (rng and jitter) else 0))
        pts.append((v[0] * k * scale[0], v[1] * k * scale[1] * squash_y, v[2] * k * scale[2]))
    return [(pts[a], pts[b], pts[c]) for a, b, c in faces]


def star(r_out, r_in, h, points=5, y0=0.0):
    pts = []
    for i in range(points * 2):
        a = math.pi / 2 + i * math.pi / points
        r = r_out if i % 2 == 0 else r_in
        pts.append((math.cos(a) * r, math.sin(a) * r))
    return prism(pts, h, y0)


def strip(centre, width, y):
    """A flat ribbon along a centreline — the side path that curls off the
    courtyard. Each segment is squared off; at this width nobody reads the seam."""
    t = []
    for i in range(len(centre) - 1):
        (x0, z0), (x1, z1) = centre[i], centre[i + 1]
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / L * width / 2, dx / L * width / 2
        t += flat([(x0 + nx, z0 + nz), (x1 + nx, z1 + nz),
                   (x1 - nx, z1 - nz), (x0 - nx, z0 - nz)], y)
    return t

# --------------------------------------------------------------- scene

class Scene:
    """Triangles bucketed by node, then by material. One node per thing you
    might later want to hide, move or recolour on its own."""

    def __init__(self):
        self.parts = OrderedDict()

    def add(self, part, mat, tris, **tf):
        if tf:
            tris = xform(tris, **tf)
        self.parts.setdefault(part, OrderedDict()).setdefault(mat, []).extend(tris)


# Ground plane of the diorama: the top of the grass. Everything stands on it.
GRASS_Y = 0.145
SHRINE_Z = -0.26          # the building sits back, courtyard in front of it
DECK_Y = GRASS_Y + 0.065  # veranda floor
WALL_TOP = DECK_Y + 0.20


def build_base(S):
    """Plinth and lawn. The brown tray is a touch wider than the grass, which is
    what gives the reference its visible ledge all the way round."""
    S.add('base', 'base', cyl(0.985, 1.0, 0.105, n=64))
    S.add('base', 'base-edge', cyl(1.002, 1.002, 0.012, n=64, y0=0.093))
    S.add('base', 'grass-side', tube(ring(64, 0.965, 0.10), ring(64, 0.965, GRASS_Y),
                                     cap_bot=False, cap_top=False))
    S.add('base', 'grass', flat([(math.cos(2 * math.pi * i / 64) * 0.965,
                                  math.sin(2 * math.pi * i / 64) * 0.965) for i in range(64)], GRASS_Y))


def build_grounds(S, rng):
    """Sand courtyard, the slab path through the torii, and the side path."""
    y = GRASS_Y + 0.003
    S.add('ground', 'sand', flat(round_rect(-0.46, -0.14, 0.46, 0.66, 0.18), y))
    S.add('ground', 'sand', strip([(-0.36, 0.50), (-0.56, 0.44), (-0.71, 0.28),
                                   (-0.79, 0.06), (-0.78, -0.18)], 0.14, y))
    # slabs up the middle, each sitting proud of the sand with a pebble kerb
    z = -0.02
    while z < 0.66:
        S.add('path', 'stone', box(0.21, 0.012, 0.145, y0=y), t=(0.0, 0.0, z))
        for sx in (-1, 1):
            S.add('path', 'stone-dark', box(0.05, 0.009, 0.05, y0=y),
                  t=(sx * 0.145, 0.0, z + rng.uniform(-0.02, 0.02)))
        z += 0.165


def build_shrine(S):
    """Raised deck, boarded walls, wide hipped roof with a gable over the door."""
    W, D = 0.56, 0.38                       # the enclosed room
    z = SHRINE_Z

    S.add('shrine', 'stone-dark', box(0.76, 0.045, 0.54, y0=GRASS_Y), t=(0, 0, z))
    S.add('shrine', 'wood-dark', box(0.80, 0.022, 0.58, y0=GRASS_Y + 0.045), t=(0, 0, z))
    S.add('shrine', 'wood', box(0.78, 0.012, 0.56, y0=DECK_Y - 0.012), t=(0, 0, z))

    # steps down to the courtyard
    S.add('shrine', 'stone', box(0.30, 0.034, 0.055, y0=GRASS_Y + 0.034), t=(0, 0, z + 0.30))
    S.add('shrine', 'stone', box(0.34, 0.034, 0.06, y0=GRASS_Y), t=(0, 0, z + 0.35))

    S.add('shrine', 'wood', box(W, 0.225, D, y0=DECK_Y), t=(0, 0, z))
    # doorway: a recess, then the dark of the interior behind it
    S.add('shrine', 'wood-deep', box(0.20, 0.16, 0.022, y0=DECK_Y + 0.005), t=(0, 0, z + D / 2 - 0.006))
    for sx in (-1, 1):
        S.add('shrine', 'wood-dark', box(0.026, 0.185, 0.024, y0=DECK_Y),
              t=(sx * 0.113, 0, z + D / 2 - 0.005))
        S.add('shrine', 'wood', box(0.145, 0.185, 0.022, y0=DECK_Y),
              t=(sx * 0.203, 0, z + D / 2 - 0.004))
        for k in (-1, 1):                       # boarding on the side panels
            S.add('shrine', 'wood-dark', box(0.012, 0.185, 0.026, y0=DECK_Y),
                  t=(sx * 0.203 + k * 0.048, 0, z + D / 2 - 0.005))
    S.add('shrine', 'wood-dark', box(W - 0.02, 0.026, 0.028, y0=DECK_Y + 0.185),
          t=(0, 0, z + D / 2 - 0.006))
    # corner posts and the beam they carry
    for sx in (-1, 1):
        for sz in (-1, 1):
            S.add('shrine', 'wood-dark', cyl(0.016, 0.014, WALL_TOP - DECK_Y, n=8, y0=DECK_Y),
                  t=(sx * (W / 2 - 0.01), 0, z + sz * (D / 2 - 0.01)))
    S.add('shrine', 'wood-dark', box(W + 0.05, 0.025, D + 0.05, y0=WALL_TOP - 0.025), t=(0, 0, z))

    # veranda rail: posts on three sides with a top rail
    for sx in (-1, 1):
        S.add('shrine', 'wood-dark', box(0.02, 0.055, 0.52, y0=DECK_Y + 0.052), t=(sx * 0.37, 0, z))
        for k in range(4):
            S.add('shrine', 'wood-dark', box(0.016, 0.055, 0.016, y0=DECK_Y),
                  t=(sx * 0.37, 0, z - 0.23 + k * 0.153))
    for sx in (-1, 1):
        S.add('shrine', 'wood-dark', box(0.21, 0.05, 0.018, y0=DECK_Y + 0.052), t=(sx * 0.275, 0, z + 0.27))
        S.add('shrine', 'wood-dark', box(0.016, 0.055, 0.016, y0=DECK_Y), t=(sx * 0.36, 0, z + 0.27))
        S.add('shrine', 'wood-dark', box(0.016, 0.055, 0.016, y0=DECK_Y), t=(sx * 0.19, 0, z + 0.27))

    # roof: eave band, the hip itself, the ridge along the top
    S.add('shrine', 'roof-dark', frustum(0.88, 0.66, 0.84, 0.62, 0.026, y0=WALL_TOP - 0.012), t=(0, 0, z))
    S.add('shrine', 'roof', frustum(0.84, 0.62, 0.26, 0.07, 0.165, y0=WALL_TOP + 0.014), t=(0, 0, z))
    S.add('shrine', 'ridge', box(0.32, 0.028, 0.072, y0=WALL_TOP + 0.177), t=(0, 0, z))
    for sx in (-1, 1):
        S.add('shrine', 'ridge', box(0.03, 0.048, 0.086, y0=WALL_TOP + 0.17), t=(sx * 0.148, 0, z))

    # gable over the entrance, and the little roof that caps it
    gz1 = D / 2 + 0.22
    S.add('shrine', 'roof', wedge(0.17, 0.105, z + 0.02, z + gz1 - 0.016, y0=WALL_TOP + 0.028))
    S.add('shrine', 'roof-dark', wedge(0.175, 0.108, z + gz1 - 0.028, z + gz1 - 0.014, y0=WALL_TOP + 0.026))
    S.add('shrine', 'wood', wedge(0.122, 0.072, z + gz1 - 0.018, z + gz1, y0=WALL_TOP + 0.046))

    # offering box on the deck, under the door
    S.add('shrine', 'wood-deep', box(0.15, 0.055, 0.085, y0=DECK_Y), t=(0, 0, z + 0.20))
    S.add('shrine', 'wood-dark', box(0.16, 0.012, 0.095, y0=DECK_Y + 0.055), t=(0, 0, z + 0.20))


def add_bow(S, part, pos, size, ry=0.0, loop='bow-red', knot=None):
    """A ribbon bow, unit-sized then scaled: two flared loops, a knot, two tails.
    It shows up at every scale here — roof corners, lawn charms, the big one the
    courtyard is built around."""
    knot = knot or loop
    for sx in (-1, 1):
        S.add(part, loop, frustum(0.07, 0.10, 0.40, 0.20, 0.42),
              t=(pos[0] + sx * 0.05 * size * math.cos(ry), pos[1], pos[2] - sx * 0.05 * size * math.sin(ry)),
              ry=ry, rz=sx * math.radians(-74), s=size)
        S.add(part, loop, frustum(0.07, 0.06, 0.15, 0.08, 0.34),
              t=(pos[0] + sx * 0.02 * size * math.cos(ry), pos[1], pos[2] - sx * 0.02 * size * math.sin(ry)),
              ry=ry, rz=math.radians(180 - sx * 18), s=size)
    S.add(part, knot, box(0.15, 0.15, 0.14, y0=-0.06), t=pos, ry=ry, s=size)


def build_torii(S):
    """Two posts, the crossbeam that curves up at the ends, the nuki below it.
    It stands well forward of the shrine and comes up to about the eave line —
    any taller and it fences the building off instead of framing it."""
    y, zt = GRASS_Y, 0.50
    h = 0.23
    for sx in (-1, 1):
        S.add('torii', 'torii-foot', cyl(0.028, 0.024, 0.018, n=10, y0=y), t=(sx * 0.155, 0, zt))
        S.add('torii', 'torii', cyl(0.020, 0.017, h, n=10, y0=y + 0.016), t=(sx * 0.155, 0, zt))
    S.add('torii', 'torii', box(0.33, 0.018, 0.042, y0=y + 0.178), t=(0, 0, zt))         # nuki
    S.add('torii', 'torii', box(0.05, 0.028, 0.038, y0=y + 0.196), t=(0, 0, zt))         # gakuzuka
    S.add('torii', 'torii', box(0.38, 0.018, 0.046, y0=y + 0.224), t=(0, 0, zt))         # shimaki
    S.add('torii', 'torii', frustum(0.41, 0.058, 0.38, 0.05, 0.022, y0=y + 0.242), t=(0, 0, zt))
    for sx in (-1, 1):                                                                   # upswept ends
        S.add('torii', 'torii', frustum(0.05, 0.052, 0.042, 0.042, 0.026),
              t=(sx * 0.195, y + 0.252, zt), rz=sx * math.radians(-18))
    add_bow(S, 'torii', (0.0, y + 0.216, zt + 0.032), 0.10, loop='bow-pink', knot='white')


def add_broadleaf(S, part, pos, h, rng):
    """Trunk plus two or three lumps. The reference's greens are one cluster read
    as one canopy, not a stack of spheres, so the lumps sit close and overlap."""
    S.add(part, 'trunk', cyl(0.032, 0.022, h * 0.55, n=7), t=(pos[0], GRASS_Y - 0.01, pos[1]))
    r = h * 0.27
    greens = ['leaf-a', 'leaf-b', 'leaf-c']
    lumps = [(0.0, h * 0.62, 0.0, 1.0), (r * 0.62, h * 0.50, r * 0.30, 0.74),
             (-r * 0.55, h * 0.52, -r * 0.35, 0.80), (r * 0.05, h * 0.80, -r * 0.18, 0.66)]
    for i, (dx, dy, dz, k) in enumerate(lumps):
        S.add(part, greens[i % 3],
              blob(r * k, subdiv=1, jitter=0.17, rng=rng, squash_y=0.88),
              t=(pos[0] + dx, GRASS_Y + dy, pos[1] + dz), ry=rng.uniform(0, 3.1))


def add_cherry(S, part, pos, scale, rng):
    """Blossom: a flatter, wider cloud in three pinks, on a leaning trunk."""
    lean = rng.uniform(-0.10, 0.10)
    S.add(part, 'trunk', cyl(0.030, 0.019, 0.27 * scale, n=7),
          t=(pos[0], GRASS_Y - 0.01, pos[1]), rz=lean)
    pinks = ['petal-a', 'petal-b', 'petal-c']
    r = 0.17 * scale
    for i in range(7):
        a = 2 * math.pi * i / 7 + rng.uniform(-0.3, 0.3)
        d = r * (0.0 if i == 0 else rng.uniform(0.55, 0.95))
        S.add(part, pinks[i % 3],
              blob(r * rng.uniform(0.55, 0.82), subdiv=1, jitter=0.18, rng=rng, squash_y=0.76),
              t=(pos[0] + math.cos(a) * d, GRASS_Y + 0.27 * scale + rng.uniform(-0.02, 0.05) * scale,
                 pos[1] + math.sin(a) * d))


def add_lantern(S, part, pos, s=1.0):
    x, z = pos
    y = GRASS_Y
    S.add(part, 'stone-dark', cyl(0.042 * s, 0.034 * s, 0.022 * s, n=6, y0=y), t=(x, 0, z))
    S.add(part, 'stone', cyl(0.016 * s, 0.014 * s, 0.085 * s, n=6, y0=y + 0.022 * s), t=(x, 0, z))
    S.add(part, 'stone', cyl(0.036 * s, 0.032 * s, 0.014 * s, n=6, y0=y + 0.107 * s), t=(x, 0, z))
    S.add(part, 'white', cyl(0.034 * s, 0.034 * s, 0.042 * s, n=6, y0=y + 0.121 * s), t=(x, 0, z))
    S.add(part, 'stone', cyl(0.056 * s, 0.020 * s, 0.034 * s, n=6, y0=y + 0.163 * s), t=(x, 0, z))
    S.add(part, 'stone-dark', blob(0.014 * s, subdiv=0), t=(x, y + 0.202 * s, z))


def build_planting(S, rng):
    for (x, z, h) in [(-0.82, -0.38, 0.62), (-0.52, -0.78, 0.50), (0.04, -0.88, 0.58),
                      (0.58, -0.74, 0.64), (0.86, -0.30, 0.48), (-0.90, 0.06, 0.54),
                      (0.88, 0.24, 0.44)]:
        add_broadleaf(S, 'trees', (x, z), h, rng)
    add_cherry(S, 'cherry', (-0.60, 0.22), 1.06, rng)
    add_cherry(S, 'cherry', (0.62, 0.08), 0.96, rng)


def build_scatter(S, rng):
    """Rocks, charms and fallen petals on the lawn. Seeded, so the diorama is the
    same diorama every time this is run."""
    def clear_of_court(x, z):
        return not (-0.58 < x < 0.58 and -0.20 < z < 0.72)

    for _ in range(220):
        if len(S.parts.get('rocks', {}).get('rock', [])) > 900:
            break
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.45, 0.93)
        x, z = math.cos(a) * d, math.sin(a) * d
        if not clear_of_court(x, z):
            continue
        r = rng.uniform(0.022, 0.055)
        S.add('rocks', 'rock' if rng.random() < 0.6 else 'rock-dark',
              blob(r, subdiv=0, jitter=0.3, rng=rng, squash_y=0.62),
              t=(x, GRASS_Y + r * 0.24, z), ry=rng.uniform(0, 3.1))
        if len(S.parts.get('rocks', {}).get('rock', [])) > 700:
            break

    for i in range(26):
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.40, 0.92)
        x, z = math.cos(a) * d, math.sin(a) * d
        if not clear_of_court(x, z):
            continue
        pick = i % 3
        if pick == 0:
            S.add('props', 'gold' if rng.random() < 0.6 else 'petal-b',
                  star(0.042, 0.018, 0.014),
                  t=(x, GRASS_Y + 0.004, z), rx=math.radians(-90), ry=rng.uniform(0, 3.1))
        elif pick == 1:
            add_bow(S, 'props', (x, GRASS_Y + 0.016, z), 0.075,
                    ry=rng.uniform(0, 6.2),
                    loop='bow-red' if rng.random() < 0.5 else 'bow-pink', knot='white')
        else:
            S.add('props', 'mint' if rng.random() < 0.4 else 'white',
                  cyl(0.020, 0.020, 0.016, n=8, y0=GRASS_Y), t=(x, 0, z))

    for _ in range(70):                       # fallen blossom near the cherries
        base = (-0.60, 0.22) if rng.random() < 0.5 else (0.62, 0.08)
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.12, 0.40)
        x, z = base[0] + math.cos(a) * d, base[1] + math.sin(a) * d
        if x * x + z * z > 0.93 ** 2:
            continue
        r = rng.uniform(0.009, 0.016)
        S.add('props', 'petal-c' if rng.random() < 0.5 else 'petal-a',
              flat([(-r, -r), (r, -r * 0.7), (r * 0.8, r), (-r * 0.9, r * 0.8)], 0.0),
              t=(x, GRASS_Y + 0.004, z), ry=rng.uniform(0, 3.1))


def build_basin(S, pos):
    """Chozuya: a stone trough to rinse your hands at, and the ladle rest over it."""
    x, z = pos
    S.add('lanterns', 'stone-dark', cyl(0.055, 0.050, 0.030, n=6, y0=GRASS_Y), t=(x, 0, z))
    S.add('lanterns', 'stone', cyl(0.048, 0.046, 0.026, n=6, y0=GRASS_Y + 0.030), t=(x, 0, z))
    S.add('lanterns', 'mint', cyl(0.038, 0.038, 0.004, n=6, y0=GRASS_Y + 0.052), t=(x, 0, z))
    S.add('lanterns', 'wood-dark', box(0.09, 0.010, 0.012, y0=GRASS_Y + 0.060), t=(x, 0, z))


def build_courtyard_pieces(S, rng):
    add_lantern(S, 'lanterns', (-0.32, 0.30))
    add_lantern(S, 'lanterns', (0.32, 0.30))
    build_basin(S, (-0.36, 0.10))
    # the big ribbon the courtyard is arranged around
    add_bow(S, 'props', (0.0, GRASS_Y + 0.05, SHRINE_Z + 0.40), 0.20, loop='bow-red', knot='white')
    for sx in (-1, 1):                        # roof-corner ribbons
        for sz in (-1, 1):
            add_bow(S, 'shrine', (sx * 0.41, WALL_TOP + 0.014, SHRINE_Z + sz * 0.30), 0.07,
                    ry=math.radians(45 * sx * sz), loop='white', knot='bow-pink')
    for sx in (-1, 1):                        # ridge ends
        add_bow(S, 'shrine', (sx * 0.155, WALL_TOP + 0.205, SHRINE_Z), 0.08,
                ry=math.pi / 2, loop='white', knot='bow-pink')


def build():
    rng = Random(7)
    S = Scene()
    build_base(S)
    build_grounds(S, rng)
    build_shrine(S)
    build_torii(S)
    build_planting(S, rng)
    build_courtyard_pieces(S, rng)
    build_scatter(S, rng)
    return S

# --------------------------------------------------------------- glb writing

class Bin:
    """Accumulates the binary chunk and hands back bufferView indices."""

    def __init__(self):
        self.buf = bytearray()
        self.views = []

    def add(self, raw, target=None, stride=None):
        while len(self.buf) % 4:
            self.buf.append(0)
        off = len(self.buf)
        self.buf.extend(raw)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        self.views.append(v)
        return len(self.views) - 1


def flat_shade(tris):
    """One normal per triangle, vertices unshared. Degenerate triangles — the
    collapsed top ring of every cone — drop out here."""
    pos, nor = [], []
    for (a, b, c) in tris:
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        L = math.sqrt(nx * nx + ny * ny + nz * nz)
        if L < 1e-12:
            continue
        nx, ny, nz = nx / L, ny / L, nz / L
        for p in (a, b, c):
            pos.extend(p)
            nor.extend((nx, ny, nz))
    return pos, nor


def build_glb(scene, name):
    used = []
    for mats in scene.parts.values():
        for m in mats:
            if m not in used:
                used.append(m)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'shrine.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': name, 'children': []}],
        'meshes': [], 'accessors': [], 'bufferViews': [],
        'materials': [{
            'name': m,
            'pbrMetallicRoughness': {
                'baseColorFactor': srgb_to_linear(PALETTE[m]) + [1.0],
                'metallicFactor': 0.0, 'roughnessFactor': 0.92,
            },
        } for m in used],
    }
    b = Bin()

    def accessor(view, ctype, count, atype, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': ctype, 'count': count, 'type': atype}
        if mn is not None:
            a['min'], a['max'] = mn, mx
        gltf['accessors'].append(a)
        return len(gltf['accessors']) - 1

    faces = 0
    for part, mats in scene.parts.items():
        prims = []
        for mat, tris in mats.items():
            pos, nor = flat_shade(tris)
            if not pos:
                continue
            faces += len(pos) // 9
            n = len(pos) // 3
            idx = list(range(n))
            big = n > 65535
            vpos = b.add(struct.pack('<%df' % len(pos), *pos), target=34962, stride=12)
            vnor = b.add(struct.pack('<%df' % len(nor), *nor), target=34962, stride=12)
            vidx = b.add(struct.pack('<%d%s' % (n, 'I' if big else 'H'), *idx), target=34963)
            mn = [min(pos[i::3]) for i in range(3)]
            mx = [max(pos[i::3]) for i in range(3)]
            prims.append({
                'attributes': {'POSITION': accessor(vpos, 5126, n, 'VEC3', mn, mx),
                               'NORMAL': accessor(vnor, 5126, n, 'VEC3')},
                'indices': accessor(vidx, 5125 if big else 5123, n, 'SCALAR'),
                'material': used.index(mat),
            })
        if not prims:
            continue
        gltf['meshes'].append({'name': part, 'primitives': prims})
        gltf['nodes'].append({'name': part, 'mesh': len(gltf['meshes']) - 1})
        gltf['nodes'][0]['children'].append(len(gltf['nodes']) - 1)

    gltf['bufferViews'] = b.views
    gltf['buffers'] = [{'byteLength': len(b.buf)}]

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    bn = bytes(b.buf) + b'\x00' * ((4 - len(b.buf) % 4) % 4)
    out = bytearray()
    out += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(bn), 0x004E4942) + bn
    return bytes(out), faces


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', nargs='?', default='assets/sanrio/shrine.glb')
    # not 'shrine' — a part node already carries that name, and a collision makes
    # getObjectByName() ambiguous for anything downstream
    ap.add_argument('--name', default='shrine-diorama')
    args = ap.parse_args()

    scene = build()
    glb, faces = build_glb(scene, args.name)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'wb') as f:
        f.write(glb)

    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mats in scene.parts.values():
        for tris in mats.values():
            for tri in tris:
                for p in tri:
                    for i in range(3):
                        lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
    print('%s  %d nodes  %d tris  %.0f KB' % (args.out, len(scene.parts), faces, len(glb) / 1024))
    print('  bounds  %s' % '  '.join('%s %+.3f..%+.3f' % (ax, lo[i], hi[i])
                                     for i, ax in enumerate('xyz')))


if __name__ == '__main__':
    main()
