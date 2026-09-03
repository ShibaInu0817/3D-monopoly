import * as THREE from 'three';

const stage = document.querySelector('three-d-stage');
const { } = await stage.ready;

const M = {
  walnut:   new THREE.MeshStandardMaterial({ name: 'walnut',   color: 0x6b4429, roughness: 0.55, metalness: 0.05 }),
  board:    new THREE.MeshStandardMaterial({ name: 'board',    color: 0xf2ece0, roughness: 0.75, metalness: 0.0 }),
  felt:     new THREE.MeshStandardMaterial({ name: 'felt',     color: 0x1f3d34, roughness: 0.95, metalness: 0.0 }),
  brass:    new THREE.MeshStandardMaterial({ name: 'brass',    color: 0xd9ab5a, roughness: 0.3,  metalness: 0.4 }),
  ink:      new THREE.MeshStandardMaterial({ name: 'ink',      color: 0x2a2622, roughness: 0.6,  metalness: 0.0 }),
  card:     new THREE.MeshStandardMaterial({ name: 'card',     color: 0xe8dcc2, roughness: 0.85, metalness: 0.0 }),
  house:    new THREE.MeshStandardMaterial({ name: 'house',    color: 0xc9563f, roughness: 0.6,  metalness: 0.0 }),
  houseTop: new THREE.MeshStandardMaterial({ name: 'houseTop', color: 0x8d3626, roughness: 0.6,  metalness: 0.0 }),
  dice:     new THREE.MeshStandardMaterial({ name: 'dice',     color: 0xfbf7ef, roughness: 0.35, metalness: 0.0 }),
  tokenA:   new THREE.MeshStandardMaterial({ name: 'tokenA',   color: 0xc0392b, roughness: 0.4,  metalness: 0.15 }),
  tokenB:   new THREE.MeshStandardMaterial({ name: 'tokenB',   color: 0x2c6e9c, roughness: 0.4,  metalness: 0.15 }),
  tokenC:   new THREE.MeshStandardMaterial({ name: 'tokenC',   color: 0xd9a12a, roughness: 0.4,  metalness: 0.15 }),
  tokenD:   new THREE.MeshStandardMaterial({ name: 'tokenD',   color: 0x4e7a4a, roughness: 0.4,  metalness: 0.15 }),
};

// group colours for the eight property sets (original palette)
const GROUPS = [0x7d5ba6, 0x8fbcd4, 0xd98f4e, 0xc0563f, 0xd4b23f, 0x5f9e6a, 0x3f6ea8, 0x2f3f57]
  .map((c, i) => new THREE.MeshStandardMaterial({ name: 'group' + (i + 1), color: c, roughness: 0.5, metalness: 0.0 }));

const HALF = 0.22;          // board half-width (m)
const THICK = 0.014;        // board thickness
const TOP = THICK;          // top surface y
const CORNER = 0.072;       // corner tile size
const BAND = 0.072;         // radial depth of the tile ring
const TW = (HALF * 2 - CORNER * 2) / 9;   // side tile width
const LIFT = 0.0012;        // tile relief above the board face

const model = new THREE.Group();
model.name = 'property_board_set';

function mesh(geo, mat, name, pos, rotY) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rotY) m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  model.add(m);
  return m;
}

/* ---------- board body: walnut edge + cream playing face ---------- */
mesh(new THREE.BoxGeometry(HALF * 2, THICK, HALF * 2), M.walnut, 'board_body', [0, THICK / 2, 0]);
mesh(new THREE.BoxGeometry(HALF * 2 - 0.008, 0.001, HALF * 2 - 0.008), M.board, 'board_face', [0, TOP + 0.0005, 0]);

/* ---------- centre felt inset ---------- */
const inner = HALF - BAND;
mesh(new THREE.BoxGeometry(inner * 2 - 0.004, 0.0012, inner * 2 - 0.004), M.felt, 'centre_felt', [0, TOP + 0.0009, 0]);

/* ---------- 40 tiles ---------- */
// index 0 corner at (+x,+z), running counter-clockwise seen from above
function tileTransform(i) {
  const edgeStart = CORNER / 2;
  if (i === 0)  return { x:  HALF - CORNER / 2, z:  HALF - CORNER / 2, rot: 0, corner: true };
  if (i === 10) return { x: -HALF + CORNER / 2, z:  HALF - CORNER / 2, rot: 0, corner: true };
  if (i === 20) return { x: -HALF + CORNER / 2, z: -HALF + CORNER / 2, rot: 0, corner: true };
  if (i === 30) return { x:  HALF - CORNER / 2, z: -HALF + CORNER / 2, rot: 0, corner: true };
  const side = Math.floor(i / 10);
  const k = i % 10;                       // 1..9
  const off = HALF - CORNER - (k - 0.5) * TW;   // along-edge coordinate
  if (side === 0) return { x: off,  z:  HALF - BAND / 2, rot: 0,             corner: false };
  if (side === 1) return { x: -HALF + BAND / 2, z: off,  rot: Math.PI / 2,   corner: false };
  if (side === 2) return { x: -off, z: -HALF + BAND / 2, rot: 0,             corner: false };
  return           { x:  HALF - BAND / 2, z: -off, rot: Math.PI / 2,   corner: false };
}

// which tiles are properties, and their group (null = corner / utility / card tile)
const groupOf = new Array(40).fill(null);
[[1,0],[3,0],[6,1],[8,1],[9,1],[11,2],[13,2],[14,2],[16,3],[18,3],[19,3],
 [21,4],[23,4],[24,4],[26,5],[27,5],[29,5],[31,6],[32,6],[34,6],[37,7],[39,7]]
  .forEach(([i, g]) => { groupOf[i] = g; });

const sideTileGeo = new THREE.BoxGeometry(TW - 0.0015, LIFT, BAND - 0.0015);
const cornerGeo = new THREE.BoxGeometry(CORNER - 0.0015, LIFT, CORNER - 0.0015);
const bandGeo = new THREE.BoxGeometry(TW - 0.0015, LIFT * 1.6, BAND * 0.3);
const glyphGeo = new THREE.BoxGeometry(TW * 0.34, LIFT * 1.4, TW * 0.34);

const tiles = new THREE.Group();
tiles.name = 'tiles';
model.add(tiles);

for (let i = 0; i < 40; i++) {
  const t = tileTransform(i);
  const g = new THREE.Group();
  g.name = 'tile_' + String(i).padStart(2, '0');
  g.position.set(t.x, TOP + 0.001 + LIFT / 2, t.z);
  g.rotation.y = t.rot;

  const plate = new THREE.Mesh(t.corner ? cornerGeo : sideTileGeo, M.board);
  plate.name = g.name + '_plate';
  plate.castShadow = plate.receiveShadow = true;
  g.add(plate);

  if (t.corner) {
    const mk = new THREE.Mesh(new THREE.CylinderGeometry(CORNER * 0.2, CORNER * 0.2, LIFT * 1.6, 32), M.brass);
    mk.name = g.name + '_medallion';
    mk.position.y = LIFT * 0.6;
    mk.castShadow = mk.receiveShadow = true;
    g.add(mk);
  } else if (groupOf[i] !== null) {
    const b = new THREE.Mesh(bandGeo, GROUPS[groupOf[i]]);
    b.name = g.name + '_band';
    b.position.set(0, LIFT * 0.3, -BAND / 2 + BAND * 0.15 + 0.0008);
    if (t.rot !== 0) b.position.z = -b.position.z;
    b.position.z = (t.z > 0 ? -1 : 1) * 0;   // recomputed below
    b.castShadow = b.receiveShadow = true;
    g.add(b);
    // band sits on the edge facing the board centre
    const inward = -Math.sign(t.rot === 0 ? t.z : t.x);
    b.position.z = inward * (BAND / 2 - BAND * 0.15) * (t.rot === 0 ? 1 : 1);
    if (t.rot !== 0) b.position.z = -Math.sign(t.x) * (BAND / 2 - BAND * 0.15);
    else b.position.z = -Math.sign(t.z) * (BAND / 2 - BAND * 0.15);
  } else {
    const gl = new THREE.Mesh(glyphGeo, M.ink);
    gl.name = g.name + '_glyph';
    gl.rotation.y = Math.PI / 4;
    gl.position.y = LIFT * 0.4;
    gl.castShadow = gl.receiveShadow = true;
    g.add(gl);
  }
  tiles.add(g);
}

/* ---------- card decks on the felt ---------- */
function deck(name, x, z, rotY) {
  const d = new THREE.Group();
  d.name = name;
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0012, 0.034), i === 4 ? M.brass : M.card);
    c.name = name + '_card_' + i;
    c.position.set(0, 0.0012 * i, 0);
    c.rotation.y = (Math.random() - 0.5) * 0.05;
    c.castShadow = c.receiveShadow = true;
    d.add(c);
  }
  d.position.set(x, TOP + 0.0016, z);
  d.rotation.y = rotY;
  model.add(d);
}
deck('deck_chance', -0.062, -0.058, 0.5);
deck('deck_ledger', 0.062, 0.058, 0.5 + Math.PI);

/* ---------- centre emblem ---------- */
const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 24, 48), M.brass);
emblem.name = 'centre_emblem';
emblem.position.set(0, TOP + 0.0045, 0);
emblem.rotation.x = Math.PI / 2;
emblem.castShadow = emblem.receiveShadow = true;
model.add(emblem);

/* ---------- dice ---------- */
function die(name, x, z, rotY) {
  const g = new THREE.Group();
  g.name = name;
  const s = 0.016;
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s, 4, 4, 4), M.dice);
  body.name = name + '_body';
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const pipGeo = new THREE.SphereGeometry(s * 0.09, 16, 12);
  const p = s * 0.24, h = s / 2 - s * 0.03;
  const faces = {
    '1': [[0, 0]], '2': [[-p, -p], [p, p]], '3': [[-p, -p], [0, 0], [p, p]],
    '4': [[-p, -p], [p, -p], [-p, p], [p, p]],
    '5': [[-p, -p], [p, -p], [0, 0], [-p, p], [p, p]],
    '6': [[-p, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [p, p]],
  };
  const place = {
    '1': (a, b) => [a, h, b], '6': (a, b) => [a, -h, b],
    '2': (a, b) => [a, b, h], '5': (a, b) => [a, b, -h],
    '3': (a, b) => [h, a, b], '4': (a, b) => [-h, a, b],
  };
  Object.keys(faces).forEach(f => faces[f].forEach(([a, b], i) => {
    const pip = new THREE.Mesh(pipGeo, M.ink);
    pip.name = name + '_pip_' + f + '_' + i;
    const v = place[f](a, b);
    pip.position.set(v[0], v[1], v[2]);
    pip.castShadow = true;
    g.add(pip);
  }));
  g.position.set(x, TOP + s / 2 + 0.0016, z);
  g.rotation.set(0, rotY, 0);
  model.add(g);
}
die('die_left', -0.018, 0.052, 0.4);
die('die_right', 0.014, 0.072, -0.7);

/* ---------- player tokens ---------- */
function token(name, mat, x, z) {
  const pts = [];
  const prof = [[0, 0], [0.011, 0], [0.011, 0.002], [0.008, 0.004], [0.0055, 0.012],
                [0.0075, 0.019], [0.0055, 0.024], [0.0035, 0.026], [0.0062, 0.029],
                [0.0062, 0.033], [0.003, 0.036], [0, 0.037]];
  prof.forEach(([r, y]) => pts.push(new THREE.Vector2(r, y)));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
  m.name = name;
  m.position.set(x, TOP + 0.0016, z);
  m.castShadow = m.receiveShadow = true;
  model.add(m);
}
const t0 = tileTransform(0), t7 = tileTransform(7), t23 = tileTransform(23), t34 = tileTransform(34);
token('token_red', M.tokenA, t0.x - 0.012, t0.z + 0.01);
token('token_blue', M.tokenB, t7.x, t7.z);
token('token_gold', M.tokenC, t23.x, t23.z);
token('token_green', M.tokenD, t34.x, t34.z);

/* ---------- houses on two owned tiles ---------- */
function house(name, x, z, rotY) {
  const g = new THREE.Group();
  g.name = name;
  const w = 0.011, hh = 0.008, d = 0.009;
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), M.house);
  b.name = name + '_walls';
  b.position.y = hh / 2;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0001, d * 0.78, w, 4, 1), M.houseTop);
  roof.name = name + '_roof';
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 4;
  roof.position.y = hh + d * 0.28;
  [b, roof].forEach(m => { m.castShadow = m.receiveShadow = true; g.add(m); });
  g.position.set(x, TOP + 0.0016, z);
  g.rotation.y = rotY;
  model.add(g);
}
const t13 = tileTransform(13);
house('house_a', t13.x + 0.012, t13.z - 0.011, Math.PI / 2);
house('house_b', t13.x + 0.012, t13.z + 0.011, Math.PI / 2);
const t26 = tileTransform(26);
house('house_c', t26.x - 0.008, t26.z + 0.012, 0);
house('house_d', t26.x + 0.008, t26.z + 0.012, 0);

stage.setObject(model);
