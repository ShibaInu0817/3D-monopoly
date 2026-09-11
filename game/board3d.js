// Miniature-diorama board: geometry, canvas-textured tiles, tokens, buildings.
// Every colour, light and paper knob comes from LOOK below. BASE_LOOK is the
// default record; a board may override any subset of it through `board.look`.
import * as THREE from 'three';
import { TILES, GROUPS, BOARD, CURRENCY, CAST } from './data.js';

export const HALF = 0.64;
export const THICK = 0.032;
export const TOP = THICK;
export const CORNER = 0.19;
export const BAND = 0.19;
export const TW = (HALF * 2 - CORNER * 2) / 9;

/* The default look. `glow` and `tileBg` are gone with the other three records:
   glow was 0 here so every branch it guarded was dead, and tileBg only ever
   served as a fallback for tileTop/tileBot, which are always present. */
const BASE_LOOK = Object.freeze({
  paper: 0xfff4e6, frame: 0xe9a45f, land: 0x9ad588, sand: 0xffe4b0, water: 0x7fd2e6,
  ink: 0x5a463c, white: 0xfffdf7, red: 0xf4715c, roof: 0xf4715c, wall: 0xfffaf1,
  brass: 0xffd07a, trunk: 0xc08a5a, leaf: 0x74c987, leafDark: 0x53ad6b,
  table: 0xf6dcb6, bg: 0xffeacb, fog: [3.4, 8],
  hemi: 1.05, key: 1.65, fill: 0.5, rough: 0.95, metal: 0,
  tileTop: '#fffaf2', tileBot: '#f7e6d2', tileInk: '#4a3830',
  tileSub: 'rgba(90,70,60,0.62)', tileEdge: 'rgba(120,86,60,0.3)', accentInk: '#e2603f',
  edgeW: 7, round: 26, pastel: 0.06, grain: 0.09,
  chunk: 1.06,
});

/* Live and deliberately mutable: materials, lights, fog and the tile canvases all
   read through this one object, so switching boards is a merge plus a repaint
   rather than a rebuild. Mutated in place — never reassign it, or every module
   that imported it keeps pointing at the old record. */
export const LOOK = { ...BASE_LOOK };

/** Fold the current board's overrides over the defaults and repaint everything
 *  derived from them. `BOARD` is a live binding, so this reads whichever board
 *  `setBoard` last selected. Call it after setBoard and before the scene is
 *  built; `BoardView.rebuildTextures()` covers the case where a board changes
 *  while a board view already exists. */
export function applyLook() {
  for (const k of Object.keys(LOOK)) delete LOOK[k];
  Object.assign(LOOK, BASE_LOOK, BOARD.look || {});
  paintMaterials();
}

const mkMat = (name, keyName, o = {}) => new THREE.MeshStandardMaterial({ name, color: LOOK[keyName], ...o });

export const MATS = {
  frame: mkMat('frame', 'frame'), paper: mkMat('paper', 'paper'), land: mkMat('land', 'land'),
  sand: mkMat('sand', 'sand'), water: mkMat('water', 'water'), ink: mkMat('ink', 'ink'),
  white: mkMat('white', 'white'), red: mkMat('red', 'red'), roof: mkMat('roof', 'roof'),
  wall: mkMat('wall', 'wall'), brass: mkMat('brass', 'brass'), trunk: mkMat('trunk', 'trunk'),
  leaf: mkMat('leaf', 'leaf'), leafDark: mkMat('leafDark', 'leafDark'),
  table: new THREE.MeshStandardMaterial({ name: 'table', color: LOOK.table, roughness: 0.95 }),
};


/* ---------- procedural maps ---------- */
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(amt > 0 ? 0xffffff : 0x000000), Math.abs(amt));
  return '#' + c.getHexString();
}
function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
function woodTex(hex) {
  return canvasTex(512, (g, S) => {
    g.fillStyle = '#' + new THREE.Color(hex).getHexString();
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * S;
      g.strokeStyle = shade(hex, (Math.random() - 0.55) * 0.22);
      g.lineWidth = 0.6 + Math.random() * 3.4;
      g.globalAlpha = 0.28 + Math.random() * 0.3;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.33, y + (Math.random() - 0.5) * 26, S * 0.66, y + (Math.random() - 0.5) * 26, S, y + (Math.random() - 0.5) * 12);
      g.stroke();
    }
    g.globalAlpha = 1;
  }, [3, 3]);
}
function feltTex(hex) {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#' + new THREE.Color(hex).getHexString();
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = shade(hex, (Math.random() - 0.5) * 0.3);
      g.globalAlpha = 0.22;
      g.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    g.globalAlpha = 1;
  }, [10, 10]);
}
function grassTex(hex) {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#' + new THREE.Color(hex).getHexString();
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      g.strokeStyle = shade(hex, (Math.random() - 0.45) * 0.3);
      g.globalAlpha = 0.35;
      g.lineWidth = 1.4;
      const x = Math.random() * S, y = Math.random() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 5, y - 4 - Math.random() * 5); g.stroke();
    }
    g.globalAlpha = 1;
  }, [4, 4]);
}
function waveTex(hex) {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#' + new THREE.Color(hex).getHexString();
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = shade(hex, 0.3);
      g.globalAlpha = 0.16;
      g.lineWidth = 2.4;
      const y = (i / 26) * S + Math.random() * 4;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin(x / 26 + i) * 3.2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }, [3, 3]);
}
const MAPPED = { frame: woodTex, table: feltTex, land: grassTex, water: waveTex };

function paintMaterials() {
  Object.keys(MATS).forEach(k => {
    const m = MATS[k];
    if (LOOK[k] !== undefined) m.color.setHex(LOOK[k]);
    m.roughness = k === 'water' ? Math.max(0.15, LOOK.rough - 0.5) : LOOK.rough;
    m.metalness = k === 'brass' ? LOOK.metal + 0.2 : LOOK.metal;
    m.needsUpdate = true;
  });
  MATS.table.roughness = 0.95;
  MATS.table.metalness = 0;
  Object.keys(MAPPED).forEach(k => {
    const m = MATS[k];
    if (m.map) m.map.dispose();
    m.map = MAPPED[k](LOOK[k]);
    m.needsUpdate = true;
  });
}
paintMaterials();

export function tileTransform(i) {
  if (i === 0)  return { x:  HALF - CORNER / 2, z:  HALF - CORNER / 2, rot: Math.PI, corner: true };
  if (i === 10) return { x: -HALF + CORNER / 2, z:  HALF - CORNER / 2, rot: Math.PI / 2, corner: true };
  if (i === 20) return { x: -HALF + CORNER / 2, z: -HALF + CORNER / 2, rot: 0, corner: true };
  if (i === 30) return { x:  HALF - CORNER / 2, z: -HALF + CORNER / 2, rot: -Math.PI / 2, corner: true };
  const side = Math.floor(i / 10), k = i % 10;
  const off = HALF - CORNER - (k - 0.5) * TW;
  if (side === 0) return { x: off, z: HALF - BAND / 2, rot: Math.PI, corner: false };
  if (side === 1) return { x: -HALF + BAND / 2, z: off, rot: Math.PI / 2, corner: false };
  if (side === 2) return { x: -off, z: -HALF + BAND / 2, rot: 0, corner: false };
  return { x: HALF - BAND / 2, z: -off, rot: -Math.PI / 2, corner: false };
}

/* ---------- tile face textures ---------- */
function wrap(ctx, text, maxW) {
  // CJK has no spaces: break per glyph so Chinese tile names still wrap
  const words = /[\u3400-\u9fff]/.test(text) && !text.includes(' ')
    ? text.split('') : text.split(' ');
  const glue = words.length && words[0].length === 1 && /[\u3400-\u9fff]/.test(words[0]) ? '' : ' ';
  const lines = [];
  let line = '';
  words.forEach(w => {
    const t = line ? line + glue + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  });
  if (line) lines.push(line);
  return lines;
}

const GLYPH = { chance: '?', ledger: '$', tax: '!', pier: '⚓', works: '✳' };
/* An anchor on a flower garden reads oddly, so a board may swap any of these. */
const glyphFor = kind => (BOARD.glyph && BOARD.glyph[kind]) || GLYPH[kind];

function noise(g, w, h, alpha) {
  const n = document.createElement('canvas');
  n.width = n.height = 96;
  const ng = n.getContext('2d');
  const d = ng.createImageData(96, 96);
  for (let k = 0; k < d.data.length; k += 4) {
    const v = 128 + (Math.random() - 0.5) * 190;
    d.data[k] = d.data[k + 1] = d.data[k + 2] = v;
    d.data[k + 3] = 255;
  }
  ng.putImageData(d, 0, 0);
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = 'overlay';
  const p = g.createPattern(n, 'repeat');
  g.fillStyle = p;
  g.fillRect(0, 0, w, h);
  g.restore();
}

function rr(g, x, y, w, h, r) {
  if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  else { g.beginPath(); g.rect(x, y, w, h); }
}

function pastel(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return '#' + c.getHexString();
}

function tileTexture(i) {
  const t = TILES[i], tr = tileTransform(i);
  const S = 512;
  const w = tr.corner ? S : Math.round(S * TW / BAND);
  const h = S;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const R = LOOK.round;
  const E = LOOK.edgeW;

  // card body with a soft top-lit gradient
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, LOOK.tileTop);
  grad.addColorStop(1, LOOK.tileBot);
  g.fillStyle = grad;
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.fill();

  g.save();
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.clip();
  noise(g, w, h, LOOK.grain);

  if (t.kind === 'property') {
    const bandH = h * 0.27;
    const gc = GROUPS[t.group].color;
    const bg = g.createLinearGradient(0, 0, 0, bandH);
    bg.addColorStop(0, pastel(gc, LOOK.pastel + 0.16));
    bg.addColorStop(1, pastel(gc, LOOK.pastel));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, bandH);
    // drop shadow beneath the band
    const sh = g.createLinearGradient(0, bandH, 0, bandH + 34);
    sh.addColorStop(0, 'rgba(0,0,0,0.22)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(0, bandH, w, 34);
    // sheen across the band
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, bandH * 0.42); g.lineTo(0, bandH * 0.62);
    g.closePath(); g.fill();
  }

  // inner vignette so the card reads as a physical piece
  const vg = g.createRadialGradient(w / 2, h * 0.44, w * 0.18, w / 2, h * 0.5, w * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.13)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.restore();

  g.strokeStyle = LOOK.tileEdge; g.lineWidth = E;
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.stroke();

  g.textAlign = 'center';
  g.fillStyle = LOOK.tileInk;
  const F = '"Baloo 2", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif';

  if (tr.corner) {
    g.font = '800 60px ' + F;
    const lines = wrap(g, t.name, w * 0.78);
    lines.forEach((l, n) => g.fillText(l, w / 2, h * 0.48 + (n - (lines.length - 1) / 2) * 68));
    g.font = '600 38px ' + F;
    g.fillStyle = LOOK.tileSub;
    const L = BOARD.labels;
    const u = (BOARD.labels && BOARD.labels.ui) || {};
    const sub = {
      start: u.tileStart || 'collect ' + CURRENCY + '200',
      jail: u.tileJail || 'just visiting',
      rest: u.tileRest || 'free rest',
      gotojail: u.tileGoJail || 'go straight there',
    }[t.kind] || '';
    g.fillText(sub, w / 2, h * 0.74);
    return new THREE.CanvasTexture(c);
  }

  g.font = '800 44px ' + F;
  const top = t.kind === 'property' ? h * 0.4 : h * 0.24;
  wrap(g, t.name, w * 0.84).forEach((l, n) => g.fillText(l, w / 2, top + n * 50));

  if (glyphFor(t.kind)) {
    const col = t.kind === 'chance' ? LOOK.accentInk : LOOK.tileSub;
    g.font = '800 138px ' + F;
    g.fillStyle = col;
    g.shadowColor = 'rgba(0,0,0,0.16)'; g.shadowBlur = 0; g.shadowOffsetY = 5;
    g.fillText(glyphFor(t.kind), w / 2, h * 0.7);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  }
  const uu = (BOARD.labels && BOARD.labels.ui) || {};
  const foot = t.price ? CURRENCY + t.price
    : t.amount ? (uu.tilePay || 'pay ') + CURRENCY + t.amount : '';
  if (foot) {
    g.font = '700 40px ' + F;
    g.fillStyle = LOOK.tileSub;
    g.fillText(foot, w / 2, h * 0.93);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------- pieces ---------- */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/* The playable crew. Which crew depends on the board — CAST is a live binding
   that setBoard swaps — so nothing here may capture it at module load.

   Every pack these models come from (Mini Characters, Mini Dungeon/Arena/Forest/
   Skate/Arcade/Market, Graveyard Kit) is CC0 and, importantly, shares one rig
   and one set of clip names: idle, walk, jump, sit, die, emote-yes,
   attack-kick-right and the rest. That is what lets a board mix them freely. */
export { CAST as CHARACTERS } from './data.js';

let pieceProtos = [];
let pieceJobs = [];
let pieceLoader = null;
let castKey = null;

/** Drop the cache when the board's crew changes. Without this a cache keyed by
 *  index alone would hand out the previous board's models under the new names. */
function castCheck() {
  const key = CAST.map(c => c.url).join('|');
  if (key === castKey) return;
  castKey = key;
  pieceProtos = [];
  pieceJobs = [];
}

// `wrap` is taken by the text layout helper above
const castIndex = i => ((i % CAST.length) + CAST.length) % CAST.length;

/** One character, on demand. The select shows the first the moment it lands
 *  instead of waiting on the whole cast. */
export function loadPiece(i) {
  castCheck();
  const k = castIndex(i);
  if (pieceProtos[k]) return Promise.resolve(pieceProtos[k]);
  if (!pieceJobs[k]) {
    pieceLoader = pieceLoader || new GLTFLoader();
    const mine = castKey;                        // a board switch mid-load wins
    pieceJobs[k] = pieceLoader.loadAsync(CAST[k].url).then(g => {
      if (mine !== castKey) return { scene: g.scene, clips: g.animations };
      g.scene.name = 'piece_proto_' + k;
      pieceProtos[k] = { scene: g.scene, clips: g.animations };
      return pieceProtos[k];
    });
  }
  return pieceJobs[k];
}

/** Warm the rest in the background; callers do not wait on it. */
export function prefetchPieces() { castCheck(); CAST.forEach((_, i) => loadPiece(i)); }

export function pieceReady(i) {
  castCheck();
  return !!pieceProtos[castIndex(i)];
}

export async function loadPieces() {
  castCheck();
  await Promise.all(CAST.map((_, i) => loadPiece(i)));
  return pieceProtos;
}

/* Kenney City Kit (CC0) by default; a board may bring its own kit through
   `build`, the way it brings its own crew. Normalised so a tile's row of them
   still fits whatever the source models measure. */
const CITY_BUILD = {
  houses: ['./assets/buildings/house-a.glb', './assets/buildings/house-b.glb',
           './assets/buildings/house-c.glb'],
  towers: ['./assets/buildings/tower-a.glb', './assets/buildings/tower-b.glb',
           './assets/buildings/tower-c.glb', './assets/buildings/tower-d.glb'],
};
let houseProtos = [], towerProtos = [];
let buildKey = null;
// extra scenery a centrepiece may want, loaded alongside the building kit
const sceneProps = new Map();

/** Sit a kit model on y=0 at a target height, shrinking further if its
 *  footprint would then overhang the tile. Height-first keeps a row of
 *  different houses reading as one street. */
function normalise(src, height, maxFoot) {
  const g = new THREE.Group();
  const model = src.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  let s = height / Math.max(size.y, 0.0001);
  const foot = Math.max(size.x, size.z) * s;
  if (maxFoot && foot > maxFoot) s *= maxFoot / foot;
  model.scale.setScalar(s);
  model.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(model);
  return g;
}

export async function loadBuildings() {
  const kit = BOARD.build || CITY_BUILD;
  if (kit.kind === 'stars') {                   // built from geometry, nothing to fetch
    buildKey = 'stars';
    houseProtos = []; towerProtos = [];
    sceneProps.clear();
    return;
  }
  const key = kit.houses.concat(kit.towers).join('|');
  if (key === buildKey) return;                 // already holding this board's kit
  buildKey = key;
  houseProtos = []; towerProtos = [];
  const loader = new GLTFLoader();
  const [houses, towers] = await Promise.all([
    Promise.all(kit.houses.map(u => loader.loadAsync(u))),
    Promise.all(kit.towers.map(u => loader.loadAsync(u))),
  ]);
  if (key !== buildKey) return;                 // a board switch overtook us
  houses.forEach(g => houseProtos.push(g.scene));
  towers.forEach(g => towerProtos.push(g.scene));

  sceneProps.clear();
  const extra = kit.props || [];
  const loaded = await Promise.all(extra.map(u => loader.loadAsync(u).catch(() => null)));
  loaded.forEach((g, i) => { if (g) sceneProps.set(extra[i].split('/').pop().replace('.glb', ''), g.scene); });
}

/* ---------------- puppet: motion for models with no skeleton ----------------

   The Sanrio pieces are game rips: one static mesh, no bones, no clips. But the
   mesh falls apart into islands that line up with anatomy, and `tools/obj2glb.py`
   writes those out as named, parented nodes. That is enough to animate — rotate
   the parts rather than deform them, the way a puppet moves.

   Offsets are fractions of the model's own height so a taller character does not
   bob further, and the clip names match the ones FLAVOURS and board3d already
   ask for, so nothing upstream needs to know which kind of piece it has. */

const PUPPET_PARTS = ['body', 'head', 'ear-l', 'ear-r', 'arm-l', 'arm-r', 'foot-l', 'foot-r'];

/* One-shot clips and how long they run. Anything not listed loops. */
const PUPPET_ONCE = {
  jump: 0.85, sit: 0.7, 'pick-up': 0.9, die: 1.2,
  'emote-yes': 0.9, 'emote-no': 0.9,
  'attack-melee-right': 0.65, 'attack-melee-left': 0.65,
  'attack-kick-right': 0.65, 'attack-kick-left': 0.65,
};
const PUPPET_CLIPS = ['idle', 'walk', 'sprint'].concat(Object.keys(PUPPET_ONCE));

/** Critically-damped-ish spring step. Ears lag whatever the head is doing, and
 *  that lag is most of what makes a rigid model look alive. */
function springStep(x, v, target, k, c, dt) {
  v += ((target - x) * k - v * c) * dt;
  return [x + v * dt, v];
}

function makePuppet(model, height) {
  const P = {};
  PUPPET_PARTS.forEach(n => { const o = model.getObjectByName(n); if (o) P[n] = o; });
  if (!P.body) return null;                 // not one of ours; leave it static

  const H = height || 1;
  const rest = {};
  Object.keys(P).forEach(n => { rest[n] = P[n].position.clone(); });

  /* The head is a child of the body, so its own y is how far it sits above the
     hinge the body rotates around — and the same tilt swings a high head much
     further than a low one. Cinnamoroll's head sits at 42% of his height and
     Kuromi's at 31%, which is enough to make one fixed angle overshoot for him
     and fall short for her. Solve for the angle instead: head travel is roughly
     2·A·lift, and the Kenney rig's idle moves its head 3.7% of token height. */
  // Pompompurin has no head node at all — he is one fused trunk with a beret —
  // so stand in half his height, which is about where a head would have been.
  const lift = P.head && Math.abs(rest.head.y) > 1e-4 ? Math.abs(rest.head.y) : 0.5 * H;
  const idleSway = THREE.MathUtils.clamp(0.040 * H / (2 * lift), 0.02, 0.14);

  let clip = 'idle', t = 0, ends = 0, then = null;
  let earX = [0, 0], earVX = [0, 0], earZ = [0, 0], earVZ = [0, 0], prevY = 0;

  function has(name) { return PUPPET_CLIPS.indexOf(name) >= 0; }

  function play(name, opts = {}) {
    if (!has(name) || name === clip) return;
    clip = name; t = 0;
    ends = PUPPET_ONCE[name] || 0;
    then = opts.then || null;
  }

  function update(dt) {
    t += dt;
    const b = P.body, h = P.head;

    // every clip writes from a clean slate, so they never accumulate
    Object.keys(P).forEach(n => { P[n].position.copy(rest[n]); P[n].rotation.set(0, 0, 0); });

    const swingArms = a => {
      if (P['arm-l']) P['arm-l'].rotation.x = a;
      if (P['arm-r']) P['arm-r'].rotation.x = -a;
    };
    const stepFeet = (dz, lift) => {
      if (P['foot-l']) { P['foot-l'].position.z += dz; P['foot-l'].position.y += Math.max(0, lift); }
      if (P['foot-r']) { P['foot-r'].position.z -= dz; P['foot-r'].position.y += Math.max(0, -lift); }
    };

    if (clip === 'walk' || clip === 'sprint') {
      const fast = clip === 'sprint';
      const f = t * (fast ? 9.5 : 5.4);
      const bob = (fast ? 0.034 : 0.019) * H;
      const lean = fast ? 0.30 : 0.12;
      const step = (fast ? 0.090 : 0.050) * H;
      b.position.y += Math.abs(Math.sin(f)) * bob;
      b.rotation.x = lean;
      b.rotation.z = Math.sin(f) * (fast ? 0.09 : 0.05);
      if (h) h.rotation.x = -lean * 0.75 + Math.sin(f * 2) * 0.02;
      swingArms(Math.sin(f) * (fast ? 0.95 : 0.55));
      stepFeet(Math.sin(f) * step, Math.sin(f) * step * 0.45);

    } else if (clip === 'jump') {
      const j = Math.min(1, t / PUPPET_ONCE.jump);
      const crouch = j < 0.22 ? Math.sin(j / 0.22 * Math.PI) * 0.045 * H : 0;
      const air = j >= 0.22 ? Math.sin((j - 0.22) / 0.78 * Math.PI) : 0;
      b.position.y += air * 0.25 * H - crouch;
      b.rotation.x = -air * 0.16;
      swingArms(0);
      if (P['arm-l']) P['arm-l'].rotation.x = -air * 1.5;
      if (P['arm-r']) P['arm-r'].rotation.x = -air * 1.5;
      if (h) h.rotation.x = air * 0.12;

    } else if (clip === 'sit') {
      const k = Math.min(1, t / PUPPET_ONCE.sit);
      b.position.y -= k * 0.10 * H;
      b.rotation.x = k * 0.12;
      swingArms(k * 0.3);

    } else if (clip === 'die') {
      const k = Math.min(1, t / PUPPET_ONCE.die);
      b.rotation.x = k * 1.45;                 // straight over backwards
      b.position.y += Math.sin(k * Math.PI) * 0.05 * H;
      swingArms(-k * 0.8);

    } else if (clip === 'emote-yes') {
      if (h) h.rotation.x = Math.sin(t * 11) * 0.30;
      b.position.y += Math.abs(Math.sin(t * 11)) * 0.012 * H;

    } else if (clip === 'emote-no') {
      if (h) h.rotation.y = Math.sin(t * 10) * 0.38;

    } else if (clip === 'pick-up') {
      const k = Math.min(1, t / PUPPET_ONCE['pick-up']);
      const dip = Math.sin(k * Math.PI);
      b.rotation.x = dip * 0.55;
      b.position.y -= dip * 0.06 * H;
      swingArms(dip * 0.9);

    } else if (clip.indexOf('attack') === 0) {
      const k = Math.min(1, t / PUPPET_ONCE[clip]);
      const hit = Math.sin(k * Math.PI);
      const right = clip.slice(-5) === 'right';
      const side = right ? 1 : -1;
      b.rotation.y = hit * 0.35 * side;
      if (clip.indexOf('kick') >= 0) {
        const foot = P[right ? 'foot-r' : 'foot-l'];
        if (foot) { foot.position.z += hit * 0.14 * H; foot.position.y += hit * 0.07 * H; }
        b.rotation.x = -hit * 0.2;
      } else {
        const arm = P[right ? 'arm-r' : 'arm-l'];
        if (arm) arm.rotation.x = -hit * 1.5;
        b.rotation.x = hit * 0.18;
      }

    } else {                                   // idle
      /* Matched against the Kenney rig's own idle, measured at the head node:
         it travels 3.7% of token height forward and back, 0.6% vertically, on a
         1.33s cycle. The first version of this bobbed 1.65% vertically, swayed
         not at all and ran a 4s cycle, which is why it read as dead rather than
         as quiet. The sway is the motion that carries it; the bob only supports. */
      const f = t * 4.72;                      // 2π / 1.33s
      b.rotation.x = Math.sin(f) * idleSway;   // the breath
      /* Deliberately small. The head sits forward of the hinge, so the tilt
         above already arcs it up and down — most of the vertical travel is that,
         not this. What this is for is the ear spring, which reads body vertical
         velocity and would have nothing to chew on in idle without it. */
      b.position.y += (1 - Math.cos(f)) * 0.0007 * H;
      b.rotation.z = Math.sin(t * 1.9) * 0.016;
      if (h) {
        // the head lags the chest a little, so the two do not move as one block
        h.rotation.x = Math.sin(f - 0.6) * -0.022;
        h.rotation.z = Math.sin(t * 1.5) * 0.055;
      }
      swingArms(Math.sin(f - 0.35) * 0.09);
    }

    /* Ears trail the body's vertical velocity, so they flick a beat late on
       every step. Cheapest possible secondary motion, and the thing that stops
       a rigid mesh reading as a slid-around statue. */
    const vy = (b.position.y - prevY) / Math.max(dt, 1e-4);
    prevY = b.position.y;
    ['ear-l', 'ear-r'].forEach((n, i) => {
      const ear = P[n];
      if (!ear) return;
      const side = i === 0 ? -1 : 1;
      const hx = h ? h.rotation.x : 0, hz = h ? h.rotation.z : 0;
      const tx = THREE.MathUtils.clamp(-vy / H * 0.55, -0.75, 0.75) - hx * 0.6;
      const tz = (-hz * 0.9 + THREE.MathUtils.clamp(-vy / H * 0.12, -0.2, 0.2)) * side;
      [earX[i], earVX[i]] = springStep(earX[i], earVX[i], tx, 150, 13, dt);
      [earZ[i], earVZ[i]] = springStep(earZ[i], earVZ[i], tz, 110, 12, dt);
      ear.rotation.x = earX[i];
      ear.rotation.z = earZ[i];
    });

    if (ends && t >= ends) {
      const nxt = then || 'idle';
      then = null; ends = 0;
      clip = null;                             // so play() does not bail on ===
      play(nxt);
    }
  }

  return { play, update, clips: PUPPET_CLIPS, has };
}

const CLIP_LOOP = { idle: true, walk: true, sprint: true, sit: false, crouch: false, die: false };

/* How wide a piece may be, relative to its height, before it starts being scaled
   down for it. The widest Kenney mini is 1.16; this sits just above that so the
   existing crew is untouched. */
const MAX_FOOT = 1.22;

/** character piece on a coloured plinth, rigged and normalised to a fixed height */
export function makeCharacterToken(hex, name, index) {
  const g = new THREE.Group();
  g.name = name;

  const plinthMat = new THREE.MeshStandardMaterial({ name: 'plinth_' + name, color: hex, roughness: 0.5, metalness: 0.08 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.031, 0.008, 28), plinthMat);
  plinth.name = name + '_plinth';
  plinth.position.y = 0.004;
  plinth.castShadow = plinth.receiveShadow = true;
  g.add(plinth);

  // pieceProtos is sparse while a cast is still loading, so its length is not
  // the cast size — index against the cast and let a gap fall through to null
  const proto = pieceProtos[castIndex(index)];
  if (!proto) return makeToken(hex, name);      // model not in yet: plain pawn
  // SkeletonUtils.clone deep-clones the bones and rebinds each SkinnedMesh —
  // Object3D.clone would leave every piece skinned to the original's rig.
  const model = cloneSkinned(proto.scene);
  model.name = name + '_model';
  model.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;          // skinned bounds are the bind pose, not the animated one
    o.material = o.material.clone();
    o.material.name = name + '_' + (o.material.name || 'mat');
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  proto.clips.forEach(clip => {
    const a = mixer.clipAction(clip);
    if (CLIP_LOOP[clip.name] === false) { a.loop = THREE.LoopOnce; a.clampWhenFinished = true; }
    else if (CLIP_LOOP[clip.name] !== true) { a.loop = THREE.LoopOnce; a.clampWhenFinished = true; }
    actions[clip.name] = a;
  });

  let puppet = null;                  // set below, once the model is measured
  let current = null;
  function play(clipName, { fade = 0.16, then = null } = {}) {
    const next = actions[clipName];
    // a rigless piece has no actions at all, so the puppet answers instead
    if (!next && puppet) return puppet.play(clipName, { then });
    if (!next || next === current) return;
    if (current) current.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    current = next;
    if (then && next.loop === THREE.LoopOnce) {
      const onEnd = e => {
        if (e.action !== next) return;
        mixer.removeEventListener('finished', onEnd);
        play(then, { fade: 0.18 });
      };
      mixer.addEventListener('finished', onEnd);
    }
  }

  // measure the bind pose before any clip runs, then fit to a consistent height
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  /* Height alone is not size. The Kenney crew all sit between 0.97 and 1.16 as
     wide as they are tall; Cinnamoroll is 2.05, because he is mostly ears, and
     matched on height he read as roughly twice the piece everyone else is.
     So fit the height, then back off if the footprint is unusually wide — the
     same two-step `normalise` already does for kit buildings.
     The square root matters: a hard cap shrank him until his silhouette was
     *smaller* than the crew's, which is the same complaint upside down. This
     lands his area inside the crew's range while letting the ears still overhang,
     and leaves every piece under the limit — the minis, Kuromi, Pompompurin —
     scaled exactly as before. */
  const fit = 0.086 / (size.y || 1);
  const over = (Math.max(size.x, size.z) * fit) / (0.086 * MAX_FOOT);
  const s = over > 1 ? fit / Math.sqrt(over) : fit;
  model.scale.setScalar(s);
  model.position.set(-((box.min.x + box.max.x) / 2) * s, 0.008 - box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  g.add(model);

  // a model with no clips is a game rip, not a broken import — drive its named
  // parts directly. size.y is in the model's own units, which is what the
  // puppet scales its offsets against.
  if (!proto.clips.length) puppet = makePuppet(model, size.y);

  play('idle', { fade: 0 });

  g.userData.material = plinthMat;
  g.userData.model = model;
  g.userData.mixer = mixer;
  g.userData.puppet = puppet;
  g.userData.clips = puppet ? puppet.clips : proto.clips.map(c => c.name);
  g.userData.play = play;
  /** Advance whichever kind of animation this piece has. */
  g.userData.tick = dt => { mixer.update(dt); if (puppet) puppet.update(dt); };
  g.userData.pieceHeight = size.y * s;
  return g;
}

export function makeToken(hex, name) {
  const g = new THREE.Group();
  g.name = name;
  const m = new THREE.MeshStandardMaterial({ name: 'token_' + name, color: hex, roughness: 0.45, metalness: 0.08 });
  const prof = [[0, 0], [0.028, 0], [0.028, 0.006], [0.019, 0.012], [0.015, 0.03],
                [0.02, 0.046], [0.014, 0.059], [0.01, 0.064], [0.017, 0.071],
                [0.017, 0.08], [0.008, 0.087], [0, 0.089]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 44), m);
  body.name = name + '_body';
  body.castShadow = true;
  g.add(body);
  g.userData.material = m;
  return g;
}

const PIP = [[], [[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]], [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]];

export function makeDie(name) {
  const g = new THREE.Group();
  g.name = name;
  const s = 0.052;
  const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s, 4, 4, 4), MATS.white);
  body.name = name + '_body';
  body.castShadow = true;
  g.add(body);
  const pipGeo = new THREE.SphereGeometry(s * 0.088, 14, 10);
  const u = s * 0.26, h = s / 2 - s * 0.02;
  const place = {
    1: (a, b) => [a * u, h, b * u], 6: (a, b) => [a * u, -h, b * u],
    2: (a, b) => [a * u, b * u, h], 5: (a, b) => [a * u, b * u, -h],
    3: (a, b) => [h, a * u, b * u], 4: (a, b) => [-h, a * u, b * u],
  };
  for (let f = 1; f <= 6; f++) PIP[f].forEach(([a, b], n) => {
    const p = new THREE.Mesh(pipGeo, MATS.ink);
    p.name = `${name}_pip_${f}_${n}`;
    const v = place[f](a, b);
    p.position.set(v[0], v[1], v[2]);
    g.add(p);
  });
  return g;
}

export const DIE_UP = {
  1: [0, 0, 0], 2: [-Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2], 5: [Math.PI / 2, 0, 0], 6: [Math.PI, 0, 0],
};

/* ---------------- stars and certificates ----------------
   A board may build literal stars instead of loading a kit. Sanrio Friends does,
   because the real edition calls its houses Stars and its hotels 5-Star
   Certificates — so the building ladder already had a shape, and a star is
   unmistakable at tile size in a way a small cottage is not. */

function starShape(outer, inner, points = 5) {
  const sh = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? sh.lineTo(x, y) : sh.moveTo(x, y);
  }
  sh.closePath();
  return sh;
}

function starMesh(name, outer, depth, mat) {
  const geo = new THREE.ExtrudeGeometry(starShape(outer, outer * 0.42), {
    depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: outer * 0.06,
    bevelSegments: 2, curveSegments: 1,
  });
  geo.center();
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  return m;
}

/** One star on a little post — the `house` of this ladder. */
function makeStar(name, variant) {
  const g = new THREE.Group();
  g.name = name;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, 0.014, 12), MATS.white);
  post.name = name + '_post'; post.position.y = 0.007;
  post.castShadow = true; post.receiveShadow = true;
  const star = starMesh(name + '_star', 0.0125, 0.004, MATS.brass);
  star.position.y = 0.026;
  // a shelf of identical stars looks stamped, so lean each one differently
  star.rotation.set(0, 0, ((variant % 3) - 1) * 0.18);
  g.add(post, star);
  return g;
}

/** Five stars over a ribboned plaque — the top of the ladder. */
function makeCertificate(name) {
  const g = new THREE.Group();
  g.name = name;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.008, 20), MATS.white);
  base.name = name + '_base'; base.position.y = 0.004;
  base.castShadow = true; base.receiveShadow = true;
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.046, 0.006), MATS.wall);
  plaque.name = name + '_plaque'; plaque.position.y = 0.031; plaque.castShadow = true;
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.0075), MATS.red);
  ribbon.name = name + '_ribbon'; ribbon.position.y = 0.019; ribbon.castShadow = true;
  g.add(base, plaque, ribbon);

  // the five stars it is named for: four in a row, one raised above
  for (let k = 0; k < 4; k++) {
    const s = starMesh(name + '_s' + k, 0.0052, 0.002, MATS.brass);
    s.position.set(-0.0117 + k * 0.0078, 0.036, 0.0045);
    g.add(s);
  }
  const crown = starMesh(name + '_crown', 0.0105, 0.0035, MATS.brass);
  crown.position.set(0, 0.062, 0.002);
  g.add(crown);
  return g;
}

function makeHouse(name, variant) {
  if (BOARD.build && BOARD.build.kind === 'stars') return makeStar(name, variant);
  if (houseProtos.length) {
    const g = normalise(houseProtos[variant % houseProtos.length], 0.032, 0.040);
    g.name = name;
    return g;
  }
  const g = new THREE.Group();
  g.name = name;
  const w = 0.032, hh = 0.026, d = 0.028;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), MATS.wall);
  walls.name = name + '_walls'; walls.position.y = hh / 2; walls.castShadow = true;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.0001, d * 0.82, w * 1.08, 4, 1), MATS.roof);
  roof.name = name + '_roof';
  roof.rotation.set(0, Math.PI / 4, Math.PI / 2);
  roof.position.y = hh + d * 0.3;
  roof.castShadow = true;
  g.add(walls, roof);
  return g;
}

function makeLighthouse(name) {
  const g = new THREE.Group();
  g.name = name;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.026, 0.088, 28), MATS.white);
  tower.name = name + '_tower'; tower.position.y = 0.044; tower.castShadow = true;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0222, 0.0243, 0.019, 28), MATS.red);
  stripe.name = name + '_stripe'; stripe.position.y = 0.031;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.015, 20), MATS.brass);
  lamp.name = name + '_lamp'; lamp.position.y = 0.095;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.017, 20), MATS.red);
  cap.name = name + '_cap'; cap.position.y = 0.111; cap.castShadow = true;
  g.add(tower, stripe, lamp, cap);
  return g;
}

function makeTower(name) {
  const g = new THREE.Group();
  g.name = name;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.02, 0.1, 20), MATS.white);
  shaft.name = name + '_shaft'; shaft.position.y = 0.05; shaft.castShadow = true;
  const pod = new THREE.Mesh(new THREE.SphereGeometry(0.019, 24, 16), MATS.brass);
  pod.name = name + '_pod'; pod.position.y = 0.088; pod.scale.set(1, 0.72, 1); pod.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0035, 12, 28), MATS.red);
  ring.name = name + '_ring'; ring.position.y = 0.088; ring.rotation.x = Math.PI / 2;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.05, 14), MATS.red);
  spire.name = name + '_spire'; spire.position.y = 0.128; spire.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 24), MATS.wall);
  base.name = name + '_base'; base.position.y = 0.006; base.castShadow = true;
  g.add(base, shaft, pod, ring, spire);
  return g;
}

/** Three tiers, piped cream and too many strawberries. Procedural like the
 *  lighthouse and the tower — the Food Kit would do it too, but a cake is a
 *  stack of cylinders and this way the board needs no extra download. */
function makeCake(name) {
  const g = new THREE.Group();
  g.name = name;

  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.049, 0.005, 40), MATS.white);
  plate.name = name + '_plate'; plate.position.y = 0.0025;
  plate.castShadow = true; plate.receiveShadow = true;
  g.add(plate);

  // [radius, height, base y] — each tier sits on the icing of the one below
  const tiers = [[0.037, 0.030, 0.005], [0.027, 0.026, 0.043], [0.018, 0.022, 0.076]];
  tiers.forEach(([r, h, y], i) => {
    const sponge = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), MATS.wall);
    sponge.name = name + '_tier' + i; sponge.position.y = y + h / 2; sponge.castShadow = true;
    const icing = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.0015, r + 0.0015, 0.008, 32), MATS.roof);
    icing.name = name + '_icing' + i; icing.position.y = y + h; icing.castShadow = true;
    g.add(sponge, icing);

    // strawberries round the rim, and a dot of cream between each pair
    const n = 8 - i * 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i * 0.4;
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 10), MATS.red);
      berry.name = name + '_berry' + i + '_' + k;
      berry.position.set(Math.cos(a) * r, y + h + 0.006, Math.sin(a) * r);
      berry.scale.set(1, 1.25, 1);
      berry.castShadow = true;
      const cream = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), MATS.white);
      const b = a + Math.PI / n;
      cream.name = name + '_cream' + i + '_' + k;
      cream.position.set(Math.cos(b) * r, y + h + 0.005, Math.sin(b) * r);
      g.add(berry, cream);
    }
  });

  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.022, 12), MATS.red);
  candle.name = name + '_candle'; candle.position.y = 0.109; candle.castShadow = true;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.011, 10), MATS.brass);
  flame.name = name + '_flame'; flame.position.y = 0.1255;
  g.add(candle, flame);
  return g;
}

/** A little town on the island: kit towers ringed by houses. Falls back to the
 *  procedural tower until the city kit has loaded. */
function makeSkyline(name) {
  const g = new THREE.Group();
  g.name = name;
  if (!towerProtos.length) return makeTower(name);
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.008, 48), MATS.sand);
  plaza.name = name + '_plaza'; plaza.position.y = 0.004; plaza.receiveShadow = true;
  g.add(plaza);

  // three towers of different heights, off-centre so the skyline reads at an angle
  [[0.0, 0.0, 0.155, 0], [-0.06, 0.045, 0.115, 1], [0.055, 0.05, 0.095, 2]]
    .forEach(([x, z, h, v], k) => {
      const t = normalise(towerProtos[v % towerProtos.length], h, 0.075);
      t.name = name + '_tower_' + k;
      t.position.set(x, 0.008, z);
      t.rotation.y = k * 0.7;
      g.add(t);
    });
  // low houses around the base for scale
  [[-0.105, -0.03], [-0.045, -0.075], [0.04, -0.062], [0.105, 0.01], [0.085, 0.085], [-0.11, 0.075]]
    .forEach(([x, z], k) => {
      const hs = normalise(houseProtos[k % houseProtos.length], 0.042, 0.052);
      hs.name = name + '_house_' + k;
      hs.position.set(x, 0.008, z);
      hs.rotation.y = (k % 4) * Math.PI / 2;
      g.add(hs);
    });
  return g;
}

/** A hulk half-buried in the sand, rocks and palms around it. The board's
 *  centre is the one place a pirate island can put a wreck. */
function makeWreck(name) {
  const g = new THREE.Group();
  g.name = name;
  const hull = sceneProps.get('ship-wreck') || sceneProps.get('ship-ghost');
  if (!hull) return makeTower(name);            // kit missing: fall back to a mast-ish tower

  const sand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.168, 0.008, 48), MATS.sand);
  sand.name = name + '_bar'; sand.position.y = 0.004; sand.receiveShadow = true;
  g.add(sand);

  const wreck = normalise(hull, 0.2, 0.34);
  wreck.name = name + '_hull';
  wreck.position.set(0.01, 0.006, 0);
  wreck.rotation.set(0.1, -0.7, 0.13);           // listing, as a wreck should
  g.add(wreck);

  // rocks and palms break the silhouette so the hull does not read as a prop
  const dressing = [
    ['rocks-sand-a', -0.13, 0.08, 0.055, 0.4],
    ['rocks-sand-b', 0.125, -0.1, 0.05, 2.1],
    ['palm-detailed-straight', -0.05, -0.14, 0.13, 0.9],
    ['palm-detailed-bend', 0.14, 0.09, 0.12, 3.4],
    ['barrel', -0.15, -0.04, 0.022, 1.2],
    ['chest', 0.09, 0.14, 0.024, 2.6],
  ];
  dressing.forEach(([key, x, z, h, rot], k) => {
    const src = sceneProps.get(key);
    if (!src) return;
    const n = normalise(src, h, 0.1);
    n.name = name + '_' + key + '_' + k;
    n.position.set(x, 0.006, z);
    n.rotation.y = rot;
    g.add(n);
  });
  return g;
}

function makeCrystal(name) {
  const g = new THREE.Group();
  g.name = name;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.014, 6), MATS.wall);
  base.name = name + '_plinth'; base.position.y = 0.007; base.castShadow = true;
  g.add(base);
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.034, 0), MATS.brass);
  shard.name = name + '_shard';
  shard.position.y = 0.062; shard.scale.set(0.72, 1.5, 0.72); shard.castShadow = true;
  g.add(shard);
  [[0.028, 0.3, 0.6], [-0.03, -0.2, 0.5], [0.006, -0.032, 0.45]].forEach(([x, z, s], i) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.02, 0), MATS.red);
    m.name = name + '_shard_' + i;
    m.position.set(x, 0.03, z);
    m.scale.set(0.6 * s, 1.5 * s, 0.6 * s);
    m.rotation.z = (i - 1) * 0.28;
    m.castShadow = true;
    g.add(m);
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0035, 10, 36), MATS.brass);
  ring.name = name + '_ring'; ring.position.y = 0.05; ring.rotation.x = Math.PI / 2.3;
  g.add(ring);
  return g;
}

function tree(x, z, scale, dark) {
  const g = new THREE.Group();
  g.name = 'tree';
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.03, 10), MATS.trunk);
  tr.position.y = 0.015; tr.castShadow = true;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.072, 14), dark ? MATS.leafDark : MATS.leaf);
  top.position.y = 0.064; top.castShadow = true;
  g.add(tr, top);
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  return g;
}

/* ---------- the board ---------- */
export class BoardView {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'isla_verde_board';
    this.tileGroups = [];
    this.labelMats = [];
    this.markers = [];
    this.buildings = [];
    this._build();
  }

  _build() {
    const G = this.group;
    const body = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, THICK, HALF * 2), MATS.frame);
    body.name = 'board_body'; body.position.y = THICK / 2;
    body.castShadow = true; body.receiveShadow = true;
    G.add(body);

    const face = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 - 0.016, 0.002, HALF * 2 - 0.016), MATS.paper);
    face.name = 'board_face'; face.position.y = TOP + 0.001; face.receiveShadow = true;
    G.add(face);

    const inner = HALF - BAND;
    const water = new THREE.Mesh(new THREE.BoxGeometry(inner * 2 - 0.01, 0.003, inner * 2 - 0.01), MATS.water);
    water.name = 'lagoon'; water.position.y = TOP + 0.0025; water.receiveShadow = true;
    G.add(water);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.78, inner * 0.8, 0.006, 64), MATS.sand);
    sand.name = 'shore'; sand.position.y = TOP + 0.005; sand.receiveShadow = true; sand.castShadow = true;
    G.add(sand);
    const land = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.66, inner * 0.72, 0.012, 64), MATS.land);
    land.name = 'island'; land.position.y = TOP + 0.01; land.receiveShadow = true; land.castShadow = true;
    G.add(land);

    const centre = BOARD.centre === 'skyline' ? makeSkyline('centre_skyline')
      : BOARD.centre === 'wreck' ? makeWreck('centre_wreck')
      : BOARD.centre === 'tower' ? makeTower('centre_tower')
      : BOARD.centre === 'crystal' ? makeCrystal('centre_crystal')
      : BOARD.centre === 'cake' ? makeCake('centre_cake')
      : makeLighthouse('centre_lighthouse');
    // a town and a wreck both fill the middle: centred, and they must not turn
    const wide = BOARD.centre === 'skyline' || BOARD.centre === 'wreck';
    // a cake is round, so it sits centred like those two but still turns — a
    // slowly revolving cake is the whole point of putting one there
    const centred = wide || BOARD.centre === 'cake';
    centre.scale.setScalar(BOARD.centre === 'skyline' ? 1.7
      : BOARD.centre === 'wreck' ? 1.45
      : BOARD.centre === 'lighthouse' ? 1.7 : 1.5);
    centre.position.set(centred ? 0 : -0.03, TOP + 0.016, centred ? 0 : -0.02);
    G.add(centre);
    // the render loop slowly spins the beacon; a town or a beached hull must not
    // spin, so it gets an empty stand-in instead
    if (wide) { const idle = new THREE.Group(); idle.name = 'beacon_idle'; G.add(idle); this.beacon = idle; }
    else this.beacon = centre;

    // trees ring the centre rather than growing through it
    (wide
      ? [[0.30, 0.06, 0.9, false], [0.24, 0.19, 0.8, true], [0.07, 0.31, 1.0, true],
         [-0.17, 0.26, 0.85, false], [-0.31, 0.05, 0.95, true], [-0.24, -0.19, 0.8, false],
         [-0.03, -0.31, 1.0, true], [0.22, -0.22, 0.85, false]]
      : [[0.12, 0.08, 1.0, false], [0.17, 0.02, 0.8, true], [0.06, 0.15, 0.9, true],
         [-0.14, 0.12, 0.85, false], [-0.18, -0.09, 1.0, true], [0.02, -0.16, 0.9, false],
         [0.15, -0.12, 0.8, true], [-0.06, -0.05, 0.7, false]])
      .forEach(([x, z, s, dk]) => {
        const t = tree(x, z, s, dk);
        t.position.y = TOP + 0.016;
        G.add(t);
      });

    for (let i = 0; i < 40; i++) {
      const tr = tileTransform(i);
      const g = new THREE.Group();
      g.name = 'tile_' + String(i).padStart(2, '0');
      g.position.set(tr.x, TOP + 0.0015, tr.z);
      g.rotation.y = tr.rot;

      const w = tr.corner ? CORNER : TW, d = tr.corner ? CORNER : BAND;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w - 0.002, 0.003, d - 0.002), MATS.paper);
      plate.name = g.name + '_plate'; plate.position.y = 0.0015;
      plate.receiveShadow = true;
      g.add(plate);

      const tex = tileTexture(i);
      tex.colorSpace = THREE.SRGBColorSpace;
      const lm = new THREE.MeshStandardMaterial({ name: 'tile_face_' + i, map: tex, roughness: 0.85 });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.002, d - 0.002), lm);
      label.name = g.name + '_face';
      label.rotation.x = -Math.PI / 2;
      label.rotation.z = Math.PI;
      label.position.y = 0.0032;
      label.receiveShadow = true;
      g.add(label);
      this.labelMats[i] = lm;

      const flag = new THREE.Group();
      flag.name = g.name + '_flag';
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, 0.038, 8), MATS.ink);
      pole.position.y = 0.019;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.015, 0.0026),
        new THREE.MeshStandardMaterial({ name: 'flag_' + i, color: 0xffffff, roughness: 0.5 }));
      cloth.position.set(0.013, 0.03, 0);
      cloth.castShadow = true;
      flag.add(pole, cloth);
      flag.position.set(w / 2 - 0.013, 0.003, -d / 2 + 0.015);
      flag.visible = false;
      flag.userData.cloth = cloth;
      g.add(flag);
      this.markers[i] = flag;

      const layer = new THREE.Group();
      layer.name = g.name + '_buildings';
      g.add(layer);
      this.buildings[i] = layer;

      this.tileGroups[i] = g;
      G.add(g);
    }
  }

  /** A restored WebGL context has lost every GPU copy. The canvases and the
   *  procedural maps live on the JS side, so regenerating them puts the board
   *  back. Also the repaint path when `applyLook` runs against a live board. */
  rebuildTextures() {
    paintMaterials();
    for (let i = 0; i < 40; i++) {
      const lm = this.labelMats[i];
      if (lm.map) lm.map.dispose();
      const tex = tileTexture(i);
      tex.colorSpace = THREE.SRGBColorSpace;
      lm.map = tex;
      lm.needsUpdate = true;
    }
  }

  tokenSpot(i, slot) {
    const g = this.tileGroups[i];
    const tr = tileTransform(i);
    const sx = tr.corner ? 0.042 : 0.024, sz = tr.corner ? 0.042 : 0.045;
    const dx = (slot % 2 ? 1 : -1) * sx;
    const dz = (slot < 2 ? 1 : -1) * sz - (tr.corner ? 0 : 0.012);
    const v = new THREE.Vector3(dx, 0.004, dz);
    g.localToWorld(v);
    return v;
  }

  tileCentre(i) {
    const v = new THREE.Vector3(0, 0.004, 0);
    this.tileGroups[i].localToWorld(v);
    return v;
  }

  setOwner(i, hex) {
    const f = this.markers[i];
    if (!f) return;
    if (hex === null || hex === undefined) { f.visible = false; return; }
    f.visible = true;
    f.userData.cloth.material.color.setHex(hex);
  }

  setBuildings(i, n) {
    const layer = this.buildings[i];
    if (layer.userData.n === n) return;
    layer.userData.n = n;
    while (layer.children.length) layer.remove(layer.children[0]);
    if (!n) return;
    const zRow = BAND / 2 - 0.03;
    if (n >= 5) {
      // the top upgrade is a tower, one of four so a built-out board has a skyline
      const tw = (BOARD.build && BOARD.build.kind === 'stars')
        ? makeCertificate('cert_' + i)
        : towerProtos.length
        ? (() => { const t = normalise(towerProtos[i % towerProtos.length], 0.105, 0.048); t.name = 'tower_' + i; return t; })()
        : makeLighthouse('lighthouse_' + i);
      tw.position.set(0, 0.003, zRow);
      tw.scale.setScalar(LOOK.chunk);
      tw.rotation.y = ((i * 7) % 4) * Math.PI / 2;
      layer.add(tw);
      return;
    }
    // a tile is 0.10 wide but 0.19 deep, so 3-4 houses make a 2x2 block
    // instead of a cramped single line
    const SLOTS = {
      1: [[0, 0.062]],
      2: [[-0.024, 0.062], [0.024, 0.062]],
      3: [[-0.024, 0.070], [0.024, 0.070], [0, 0.028]],
      4: [[-0.024, 0.070], [0.024, 0.070], [-0.024, 0.028], [0.024, 0.028]],
    }[n] || [[0, zRow]];
    SLOTS.forEach(([x, z], k) => {
      const h = makeHouse(`house_${i}_${k}`, i + k);
      h.position.set(x, 0.003, z);
      h.scale.setScalar(0.92 * LOOK.chunk);
      h.rotation.y = Math.PI;                       // face the street
      layer.add(h);
    });
  }
}
