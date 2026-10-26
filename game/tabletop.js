// The home screen's live table: the chosen board, built up, turning slowly while
// four pieces hop around it (the "Tabletop lobby" home screen).
// It owns its own WebGL renderer and gives it back before the game opens its own.

import * as THREE from 'three';
import * as D from './data.js';
import { BoardView, makeCharacterToken, loadPieces, loadBuildings, applyLook, LOOK, MATS } from './board3d.js';

// lots that get houses and an owner on the demo table: [tile, buildings]
const DEMO = [[1, 2], [3, 3], [6, 1], [8, 2], [9, 4], [11, 5], [13, 2], [16, 3], [18, 1], [21, 5], [23, 2],
  [26, 3], [27, 4], [31, 2], [34, 1], [37, 5], [39, 5]];
const SEATS = [4, 12, 22, 33];         // where the four pieces start
const CREW = [2, 5, 8, 11];            // which characters stand in for them

let renderer = null, canvas = null, raf = 0, last = 0, clock = 0;
let current = null, showing = '';      // the table on screen and the board id it was built for
const built = new Map();               // board id -> table, each board built once
let chain = Promise.resolve();         // builds run one at a time: board3d keeps one live look

/** board3d's materials follow data.js's current board, so select it before building or drawing it. */
function useLook(id) { if (D.BOARD.id !== id) D.setBoard(id); applyLook(); }

function lights(scene) {
  const hemi = new THREE.HemisphereLight(0xd9ecff, 0x9a8b74, LOOK.hemi);
  const key = new THREE.DirectionalLight(0xfff2dd, LOOK.key);
  key.position.set(1.4, 2.2, 1.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 0.1, far: 8 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.002;
  const fill = new THREE.DirectionalLight(0xcfe2ff, LOOK.fill);
  fill.position.set(-1.6, 1.2, -1.1);
  scene.add(hemi, key, fill);
}

async function build(id) {
  useLook(id);
  await Promise.all([loadPieces().catch(e => console.warn(e)), loadBuildings().catch(e => console.warn(e))]);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 30);
  const board = new BoardView();
  const table = new THREE.Mesh(new THREE.CircleGeometry(5, 64), MATS.table);
  table.rotation.x = -Math.PI / 2; table.position.y = -0.001; table.receiveShadow = true;
  DEMO.forEach(([i, n], k) => { board.setBuildings(i, n); board.setOwner(i, D.PLAYER_COLORS[k % 4].hex); });
  scene.add(table, board.group);
  scene.fog = new THREE.Fog(LOOK.bg, 3.2, 7.5);
  lights(scene);
  const walk = CREW.map((c, k) => {
    const tok = makeCharacterToken(D.PLAYER_COLORS[k].hex, 'tb_' + k, c);
    tok.position.copy(board.tokenSpot(SEATS[k], k)); tok.scale.setScalar(LOOK.chunk); scene.add(tok);
    return { tok, at: SEATS[k], t: Math.random() * 3, moving: null };
  });
  return { id, scene, camera, board, walk, bg: '#' + new THREE.Color(LOOK.bg).getHexString() };
}

const A = new THREE.Vector3(), B = new THREE.Vector3();
function step(tb, dt, t, w, h) {
  // every few seconds someone hops a few tiles on
  tb.walk.forEach((wk, k) => {
    wk.t -= dt;
    if (wk.t <= 0 && !wk.moving) { wk.moving = { from: wk.at, to: (wk.at + 1 + (Math.random() * 3 | 0)) % 40, p: 0 }; wk.tok.userData.play('walk'); }
    if (wk.moving) {
      const m = wk.moving; m.p += dt * 1.6;
      const i = Math.floor(m.p), f = m.p - i, a = (m.from + i) % 40, b = (a + 1) % 40;
      A.copy(tb.board.tokenSpot(a, k)); B.copy(tb.board.tokenSpot(b, k));
      wk.tok.position.lerpVectors(A, B, f); wk.tok.position.y += Math.sin(f * Math.PI) * 0.02;
      wk.tok.rotation.y = Math.atan2(B.x - A.x, B.z - A.z);
      if (((m.from + i + 1) % 40 === m.to && f > 0.98) || i >= 40) {
        wk.at = m.to; wk.moving = null; wk.t = 2 + Math.random() * 4; wk.tok.userData.play('idle');
        wk.tok.position.copy(tb.board.tokenSpot(wk.at, k));
      }
    }
    wk.tok.userData.tick(dt);
  });
  // a slow orbit; the board sits right of the sheet on wide screens, above it on tall ones
  const a = t * 0.07 + 0.6, portrait = h > w, r = portrait ? 2.25 : 1.75;
  tb.camera.position.set(Math.sin(a) * r, portrait ? 1.7 : 1.05, Math.cos(a) * r);
  tb.camera.lookAt(0, 0, 0);
  tb.camera.aspect = w / h;
  if (portrait) tb.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
  else tb.camera.setViewOffset(w, h, -w * 0.2, h * 0.02, w, h);
  tb.camera.updateProjectionMatrix();
}

let galleryWasOpen = false;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  // the gallery draws over the menu with its own renderer and may switch the live look
  const gallery = document.getElementById('gallery');
  const galleryOpen = gallery && !gallery.hidden;
  if (galleryOpen || document.hidden || !current) { galleryWasOpen = galleryWasOpen || galleryOpen; return; }
  if (galleryWasOpen) { galleryWasOpen = false; useLook(current.id); }
  clock += dt;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  try { step(current, dt, clock, w, h); renderer.render(current.scene, current.camera); }
  catch (e) { console.warn('tabletop frame', e); }
}

/** Put a board on the table. Each board is built once; switching back is instant. */
export function showBoard(id) {
  showing = id;
  chain = chain.then(async () => {
    if (!built.has(id)) built.set(id, await build(id));
    if (showing !== id || !renderer) return;          // switched again (or the game started) while building
    current = built.get(id); useLook(id);
    canvas.parentElement.style.background = current.bg;
  }).catch(e => console.error('tabletop', e));
  return chain;
}

export function startTabletop(el, id) {
  canvas = el;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { console.warn('no WebGL for the table', e); return; }   // the menu still works without it
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // same as the game
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  raf = requestAnimationFrame(frame);
  showBoard(id);
}

/** Give the WebGL context back before the character select and the game open theirs. */
export function stopTabletop(id) {
  cancelAnimationFrame(raf); raf = 0;
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
  current = null; built.clear();
  useLook(id);                         // the game starts on the board the player chose
}
