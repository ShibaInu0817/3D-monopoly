// Miniature-diorama board: geometry, canvas-textured tiles, tokens, buildings.
// Everything visual is driven by a THEME so the look can be swapped live.
import * as THREE from 'three';
import { TILES, GROUPS, BOARD, CURRENCY } from './data.js';

export const HALF = 0.64;
export const THICK = 0.032;
export const TOP = THICK;
export const CORNER = 0.19;
export const BAND = 0.19;
export const TW = (HALF * 2 - CORNER * 2) / 9;

export const THEMES = {
  clay: {
    label: 'Clay', hint: 'soft toy blocks',
    paper: 0xfff4e6, frame: 0xe9a45f, land: 0x9ad588, sand: 0xffe4b0, water: 0x7fd2e6,
    ink: 0x5a463c, white: 0xfffdf7, red: 0xf4715c, roof: 0xf4715c, wall: 0xfffaf1,
    brass: 0xffd07a, trunk: 0xc08a5a, leaf: 0x74c987, leafDark: 0x53ad6b,
    table: 0xf6dcb6, bg: 0xffeacb, fog: [3.4, 8],
    hemi: 1.05, key: 1.65, fill: 0.5, rough: 0.95, metal: 0,
    tileBg: '#fff6ea', tileTop: '#fffaf2', tileBot: '#f7e6d2', tileInk: '#4a3830',
    tileSub: 'rgba(90,70,60,0.62)', tileEdge: 'rgba(120,86,60,0.3)', accentInk: '#e2603f',
    edgeW: 7, round: 26, pastel: 0.06, grain: 0.09,
    glow: 0, chunk: 1.06,
  },
  paper: {
    label: 'Paper', hint: 'pressed card & linen',
    paper: 0xf6f0e3, frame: 0x9b6b41, land: 0x8fb583, sand: 0xe7d6ae, water: 0x7fb5c4,
    ink: 0x2a2521, white: 0xfaf6ee, red: 0xc9503f, roof: 0xb8443a, wall: 0xf6f1e6,
    brass: 0xdcae5c, trunk: 0x7a5638, leaf: 0x4f8a55, leafDark: 0x3f7147,
    table: 0xbdc9c2, bg: 0xdfe7e4, fog: [3.2, 7.5],
    hemi: 0.8, key: 2.0, fill: 0.5, rough: 0.85, metal: 0.04,
    tileBg: '#f4eddf', tileTop: '#faf5ea', tileBot: '#e9dfcb', tileInk: '#2a2521',
    tileSub: 'rgba(42,37,33,0.62)', tileEdge: 'rgba(42,37,33,0.42)', accentInk: '#c9503f',
    edgeW: 5, round: 10, pastel: 0, grain: 0.14,
    glow: 0, chunk: 1,
  },
  arcane: {
    label: 'Arcane', hint: 'twilight, gold leaf and gemlight',
    paper: 0x2a2748, frame: 0x6a5a9c, land: 0x3c6f5e, sand: 0x6b6193, water: 0x5f8fd4,
    ink: 0xf2e7c8, white: 0xf6efdc, red: 0xd9634f, roof: 0xd9634f, wall: 0x3a3560,
    brass: 0xe8c477, trunk: 0x5b4a72, leaf: 0x63b58a, leafDark: 0x4a9270,
    table: 0x14122a, bg: 0x171436, fog: [3.1, 8.6],
    hemi: 0.62, key: 1.35, fill: 0.45, rough: 0.62, metal: 0.16,
    tileBg: '#2f2b52', tileTop: '#3a3564', tileBot: '#262247', tileInk: '#f4ead0',
    tileSub: 'rgba(244,234,208,0.62)', tileEdge: 'rgba(232,196,119,0.6)', accentInk: '#e8c477',
    edgeW: 6, round: 20, pastel: 0, grain: 0.08,
    glow: 1, chunk: 1.04,
  },
  neon: {
    label: 'Neon', hint: 'arcade night',
    paper: 0x1b2233, frame: 0x2b3550, land: 0x1f5f5a, sand: 0x2a4a63, water: 0x14e0c8,
    ink: 0xdff3ff, white: 0xeef7ff, red: 0xff5c8a, roof: 0xff5c8a, wall: 0x243050,
    brass: 0xffd36e, trunk: 0x3a4a63, leaf: 0x2fe08a, leafDark: 0x1fae74,
    table: 0x0b0f19, bg: 0x0a0e18, fog: [3.0, 8.5],
    hemi: 0.45, key: 1.15, fill: 0.35, rough: 0.5, metal: 0.18,
    tileBg: '#161d2e', tileTop: '#1d2740', tileBot: '#101728', tileInk: '#eaf6ff',
    tileSub: 'rgba(220,240,255,0.66)', tileEdge: 'rgba(120,210,255,0.5)', accentInk: '#ff5c8a',
    edgeW: 6, round: 16, pastel: 0, grain: 0.07,
    glow: 1, chunk: 1.04,
  },
};

export let theme = THEMES.clay;

const mkMat = (name, keyName, o = {}) => new THREE.MeshStandardMaterial({ name, color: theme[keyName], ...o });

export const MATS = {
  frame: mkMat('frame', 'frame'), paper: mkMat('paper', 'paper'), land: mkMat('land', 'land'),
  sand: mkMat('sand', 'sand'), water: mkMat('water', 'water'), ink: mkMat('ink', 'ink'),
  white: mkMat('white', 'white'), red: mkMat('red', 'red'), roof: mkMat('roof', 'roof'),
  wall: mkMat('wall', 'wall'), brass: mkMat('brass', 'brass'), trunk: mkMat('trunk', 'trunk'),
  leaf: mkMat('leaf', 'leaf'), leafDark: mkMat('leafDark', 'leafDark'),
  table: new THREE.MeshStandardMaterial({ name: 'table', color: theme.table, roughness: 0.95 }),
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
function paperTex() {
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4200; i++) {
      const v = 200 + Math.random() * 55;
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
    }
  }, [2, 2]);
}
const MAPPED = { frame: woodTex, table: feltTex, land: grassTex, water: waveTex };

const GLOWY = ['water', 'red', 'roof', 'brass', 'leaf'];

export function applyMaterialTheme() {
  Object.keys(MATS).forEach(k => {
    const m = MATS[k];
    if (theme[k] !== undefined) m.color.setHex(theme[k]);
    m.roughness = k === 'water' ? Math.max(0.15, theme.rough - 0.5) : theme.rough;
    m.metalness = k === 'brass' ? theme.metal + 0.2 : theme.metal;
    if (theme.glow && GLOWY.includes(k)) {
      m.emissive.setHex(theme[k]);
      m.emissiveIntensity = k === 'water' ? 0.55 : 0.35;
    } else {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }
    m.needsUpdate = true;
  });
  MATS.table.roughness = 0.95;
  MATS.table.metalness = 0;
  Object.keys(MAPPED).forEach(k => {
    const m = MATS[k];
    if (m.map) m.map.dispose();
    m.map = MAPPED[k](theme[k]);
    m.needsUpdate = true;
  });
}
applyMaterialTheme();

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
  const R = theme.round || 10;
  const E = theme.edgeW || 4;

  // card body with a soft top-lit gradient
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, theme.tileTop || theme.tileBg);
  grad.addColorStop(1, theme.tileBot || theme.tileBg);
  g.fillStyle = grad;
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.fill();

  g.save();
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.clip();
  noise(g, w, h, theme.grain ?? 0.1);

  if (t.kind === 'property') {
    const bandH = h * 0.27;
    const gc = GROUPS[t.group].color;
    const bg = g.createLinearGradient(0, 0, 0, bandH);
    bg.addColorStop(0, pastel(gc, (theme.pastel ?? 0) + 0.16));
    bg.addColorStop(1, pastel(gc, theme.pastel ?? 0));
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
  vg.addColorStop(1, theme.glow ? 'rgba(0,0,0,0.34)' : 'rgba(0,0,0,0.13)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.restore();

  g.strokeStyle = theme.tileEdge; g.lineWidth = E;
  rr(g, E / 2, E / 2, w - E, h - E, R);
  g.stroke();

  g.textAlign = 'center';
  g.fillStyle = theme.tileInk;
  const F = '"Baloo 2", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif';

  if (tr.corner) {
    g.font = '800 60px ' + F;
    const lines = wrap(g, t.name, w * 0.78);
    lines.forEach((l, n) => g.fillText(l, w / 2, h * 0.48 + (n - (lines.length - 1) / 2) * 68));
    g.font = '600 38px ' + F;
    g.fillStyle = theme.tileSub;
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

  if (GLYPH[t.kind]) {
    const col = t.kind === 'chance' ? (theme.glow ? '#ff5c8a' : theme.accentInk || '#d8503f') : theme.tileSub;
    g.font = '800 138px ' + F;
    g.fillStyle = col;
    if (theme.glow) { g.shadowColor = col; g.shadowBlur = 24; }
    else { g.shadowColor = 'rgba(0,0,0,0.16)'; g.shadowBlur = 0; g.shadowOffsetY = 5; }
    g.fillText(GLYPH[t.kind], w / 2, h * 0.7);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  }
  const uu = (BOARD.labels && BOARD.labels.ui) || {};
  const foot = t.price ? CURRENCY + t.price
    : t.amount ? (uu.tilePay || 'pay ') + CURRENCY + t.amount : '';
  if (foot) {
    g.font = '700 40px ' + F;
    g.fillStyle = theme.tileSub;
    g.fillText(foot, w / 2, h * 0.93);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------- pieces ---------- */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/* Kenney Mini Characters (CC0). Skinned, and the pack ships 33 clips —
   idle, walk, jump, sit, emote-yes/no, die — so each piece keeps its rig. */
const PIECE_URLS = ['./assets/pieces/piece-1.glb', './assets/pieces/piece-2.glb',
                    './assets/pieces/piece-3.glb', './assets/pieces/piece-4.glb'];
const pieceProtos = [];

export async function loadPieces() {
  if (pieceProtos.length) return pieceProtos;
  const loader = new GLTFLoader();
  const gltfs = await Promise.all(PIECE_URLS.map(u => loader.loadAsync(u)));
  gltfs.forEach((g, i) => {
    g.scene.name = 'piece_proto_' + i;
    pieceProtos.push({ scene: g.scene, clips: g.animations });
  });
  return pieceProtos;
}

const CLIP_LOOP = { idle: true, walk: true, sprint: true, sit: false, crouch: false, die: false };

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

  const proto = pieceProtos[index % pieceProtos.length];
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

  let current = null;
  function play(clipName, { fade = 0.16, then = null } = {}) {
    const next = actions[clipName];
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
  const s = 0.086 / (size.y || 1);
  model.scale.setScalar(s);
  model.position.set(-((box.min.x + box.max.x) / 2) * s, 0.008 - box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  g.add(model);

  play('idle', { fade: 0 });

  g.userData.material = plinthMat;
  g.userData.model = model;
  g.userData.mixer = mixer;
  g.userData.play = play;
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

function makeHouse(name) {
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

    const centre = BOARD.centre === 'tower' ? makeTower('centre_tower')
      : BOARD.centre === 'crystal' ? makeCrystal('centre_crystal')
      : makeLighthouse('centre_lighthouse');
    centre.scale.setScalar(BOARD.centre === 'lighthouse' ? 1.7 : 1.5);
    centre.position.set(-0.03, TOP + 0.016, -0.02);
    G.add(centre);
    this.beacon = centre;

    [[0.12, 0.08, 1.0, false], [0.17, 0.02, 0.8, true], [0.06, 0.15, 0.9, true],
     [-0.14, 0.12, 0.85, false], [-0.18, -0.09, 1.0, true], [0.02, -0.16, 0.9, false],
     [0.15, -0.12, 0.8, true], [-0.06, -0.05, 0.7, false]]
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

  setTheme(next) {
    theme = next;
    applyMaterialTheme();
    for (let i = 0; i < 40; i++) {
      const lm = this.labelMats[i];
      if (lm.map) lm.map.dispose();
      const tex = tileTexture(i);
      tex.colorSpace = THREE.SRGBColorSpace;
      lm.map = tex;
      lm.emissive.setHex(theme.glow ? 0x223044 : 0x000000);
      lm.emissiveIntensity = theme.glow ? 0.5 : 0;
      lm.emissiveMap = theme.glow ? tex : null;
      lm.needsUpdate = true;
    }
    this.buildings.forEach((layer, i) => {
      const n = layer.userData.n || 0;
      layer.userData.n = -1;
      this.setBuildings(i, n);
    });
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
    f.userData.cloth.material.emissive.setHex(theme.glow ? hex : 0x000000);
    f.userData.cloth.material.emissiveIntensity = theme.glow ? 0.4 : 0;
  }

  setBuildings(i, n) {
    const layer = this.buildings[i];
    if (layer.userData.n === n) return;
    layer.userData.n = n;
    while (layer.children.length) layer.remove(layer.children[0]);
    if (!n) return;
    const zRow = BAND / 2 - 0.03;
    if (n >= 5) {
      const lh = makeLighthouse('lighthouse_' + i);
      lh.position.set(0, 0.003, zRow);
      lh.scale.setScalar(theme.chunk);
      layer.add(lh);
      return;
    }
    const spread = TW - 0.032;
    for (let k = 0; k < n; k++) {
      const h = makeHouse(`house_${i}_${k}`);
      const x = n === 1 ? 0 : -spread / 2 + (spread / (n - 1)) * k;
      h.position.set(x, 0.003, zRow);
      h.scale.setScalar((n > 2 ? 0.78 : 1) * theme.chunk);
      layer.add(h);
    }
  }
}
