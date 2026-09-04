// Cinematic character select. Runs its own small three.js stage, hands back one
// character index per player. Nothing here touches game state.
import * as THREE from 'three';
import { loadPiece, prefetchPieces, pieceReady, makeCharacterToken, CHARACTERS, THEMES, applyMaterialTheme } from './board3d.js';
import { PLAYER_COLORS } from './data.js';

const $ = id => document.getElementById(id);

let renderer, scene, camera, stage, disc, glowMat, seatLight, piece, last = 0;
let idx = 0, seat = 0, total = 2, taken = [], picks = [];
let running = false, resolveAll = null, spin = 0, entered = 0, gen = 0, dir = 1;
let frameDist = 0.7, frameY = 0.08, sizeW = 0, sizeH = 0;

const POSES = ['emote-yes', 'interact-right', 'holding-both', 'idle', 'walk'];

// rAF pauses in backgrounded tabs and does not resume mid-wait; race it against
// a timer so the reveal and the viewer loop never stall.
const nextFrame = cb => {
  let done = false;
  const fire = () => { if (done) return; done = true; cb(performance.now()); };
  requestAnimationFrame(fire);
  setTimeout(fire, 60);
};

/** Decoration only: skipped when the document is hidden, where the timeline is
 *  frozen at keyframe 0 and would leave the element stuck in its start state. */
const flourish = (el, frames, opts) => {
  if (!el || document.visibilityState !== 'visible') return;
  el.animate(frames, opts);
};

function buildStage() {
  const canvas = $('csCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(26, 1, 0.01, 8);

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x2a2320, 0.7));
  const key = new THREE.DirectionalLight(0xfff4e2, 2.2);
  key.position.set(0.18, 0.46, 0.24);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.2, right: 0.2, top: 0.2, bottom: -0.2, near: 0.05, far: 2 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fc4ff, 0.9);
  rim.position.set(-0.3, 0.2, -0.26);
  scene.add(rim);
  // this one takes the acting player's colour, so each seat gets its own light
  seatLight = new THREE.PointLight(0xffffff, 1.5, 1.1);
  seatLight.position.set(-0.02, 0.09, -0.16);
  scene.add(seatLight);

  stage = new THREE.Group();
  scene.add(stage);

  disc = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.005, 64),
    new THREE.MeshStandardMaterial({ color: 0x1b1614, roughness: 0.7, metalness: 0.2 }));
  plate.position.y = -0.004; plate.receiveShadow = true;
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.0022, 12, 72),
    new THREE.MeshStandardMaterial({ color: 0xffce8a, roughness: 0.35, metalness: 0.6 }));
  trim.rotation.x = Math.PI / 2; trim.position.y = 0.001;
  glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.048, 64), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.0012;
  disc.add(plate, trim, glow);
  stage.add(disc);
}

/** Size off the stage box, never the canvas — reading the canvas lets a stale
 *  buffer feed its own dimensions back in. Returns true when it changed. */
function fit() {
  if (!renderer) return false;
  const host = $('csCanvas').closest('.csStage');
  const r = host.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w === sizeW && h === sizeH) return false;
  sizeW = w; sizeH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  refit();
  return true;
}

/** Frame the figure so it fills a set share of the height, with the lower
 *  third of the canvas left clear for the name plate. */
function refit() {
  if (!piece || !camera) return;
  const box = new THREE.Box3().setFromObject(piece);
  const h = Math.max(box.max.y - box.min.y, 0.001);
  const fovY = camera.fov * Math.PI / 180;
  const share = window.innerWidth < 900 ? 0.42 : 0.48;
  frameDist = (h / share) / (2 * Math.tan(fovY / 2));
  // aiming below the figure lifts it into the upper frame, leaving the lower
  // third — where the name plate's scrim sits — as clear floor
  frameY = box.min.y + h * 0.28;
}

function frame(now) {
  if (!running) return;
  fit();
  const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
  last = now;
  entered = Math.min(1, entered + dt * 6);
  const e = 1 - Math.pow(1 - entered, 3);
  // the turn whips as a character lands, then settles to a slow show turn
  spin += dt * (0.5 + (1 - e) * 5.5);
  if (piece) {
    piece.rotation.y = spin;
    piece.scale.setScalar(1.75 * (0.86 + 0.16 * e - 0.02 * Math.sin(e * Math.PI)));
    piece.position.set((1 - e) * 0.05 * -dir, (1 - e) * 0.02, 0);
    if (piece.userData.mixer) piece.userData.mixer.update(dt);
  }
  disc.rotation.y = -spin * 0.2;
  if (glowMat) glowMat.opacity = 0.12 + 0.08 * Math.sin(now / 700);
  camera.position.set(Math.sin(spin * 0.06) * 0.03, frameY + frameDist * 0.22, frameDist);
  camera.lookAt(0, frameY, 0);
  renderer.render(scene, camera);
  nextFrame(frame);
}

/* ---------------- copy + chrome, which never waits on a model ---------------- */
function paintCard() {
  const c = CHARACTERS[idx];
  $('csNum').textContent = String(idx + 1).padStart(2, '0');
  $('csName').textContent = c.name;
  $('csRole').textContent = c.role;
  $('csLine').textContent = c.line;

  const owner = taken.indexOf(idx);
  const dup = owner >= 0 && owner !== seat;
  $('csTaken').hidden = !dup;
  if (dup) $('csTaken').textContent = '玩家 ' + (owner + 1) + ' 已经选了';
  $('csConfirm').disabled = dup;

  document.querySelectorAll('#csRoster button').forEach((b, k) => {
    b.setAttribute('aria-pressed', String(k === idx));
  });
  flourish($('csCard'),
    [{ opacity: 0, transform: `translate(calc(-50% + ${dir * 18}px), 10px)` },
     { opacity: 1, transform: 'translate(-50%, 0)' }],
    { duration: 240, easing: 'cubic-bezier(.2,1,.3,1)' });
  flourish($('csNum'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
}

/** Swaps the figure. Text updates at once; the model arrives when it arrives. */
function show(i, pose) {
  const nextIdx = (i + CHARACTERS.length) % CHARACTERS.length;
  dir = nextIdx === idx ? dir : (nextIdx > idx || (idx === CHARACTERS.length - 1 && nextIdx === 0)) ? 1 : -1;
  idx = nextIdx;
  paintCard();

  const mine = ++gen;
  const mount = proto => {
    if (mine !== gen || !running) return;      // a faster click already won
    if (piece) stage.remove(piece);
    piece = makeCharacterToken(PLAYER_COLORS[seat % PLAYER_COLORS.length].hex, 'cs_piece', idx);
    piece.scale.setScalar(1.75);        // settled size: refit must not measure the entrance scale
    stage.add(piece);
    entered = 0;
    if (piece.userData.play) piece.userData.play(pose || POSES[idx % POSES.length], 0.12);
    refit();
    $('csStatus').textContent = '';
  };

  if (pieceReady(idx)) mount();
  else {
    $('csStatus').textContent = '载入…';
    loadPiece(idx).then(mount).catch(() => { $('csStatus').textContent = ''; });
  }
}

function renderRoster() {
  $('csRoster').innerHTML = CHARACTERS.map((c, k) => {
    const owner = taken.indexOf(k);
    const dot = owner >= 0 ? `<i style="background:${PLAYER_COLORS[owner].css}"></i>` : '';
    return `<button data-i="${k}" aria-pressed="false"${owner >= 0 && owner !== seat ? ' data-taken="1"' : ''}>
      <span>${c.name}</span><em>${c.role}</em>${dot}</button>`;
  }).join('');
}

function seatHeader() {
  const col = PLAYER_COLORS[seat % PLAYER_COLORS.length];
  if (seatLight) seatLight.color.set(col.hex);
  if (glowMat) glowMat.color.set(col.hex);
  $('charSelect').style.setProperty('--csSeat', col.css);
  $('csSeatList').innerHTML = Array.from({ length: total }, (_, i) => {
    const c = PLAYER_COLORS[i % PLAYER_COLORS.length];
    const done = taken[i] >= 0;
    const label = done ? CHARACTERS[taken[i]].name : '玩家 ' + (i + 1);
    const flag = i === seat ? ' data-now="1"' : done ? ' data-done="1"' : '';
    return `<span${flag}><i style="background:${c.css}"></i>${label}</span>`;
  }).join('');
  $('csOf').textContent = seat + 1 + ' / ' + total;
  $('csBack').disabled = seat === 0;
  $('csConfirm').textContent = seat === total - 1 ? '开始游戏' : '确定';
}

function confirm() {
  if ($('csConfirm').disabled) return;
  if (piece && piece.userData.play) piece.userData.play('jump', 0.06);
  picks[seat] = idx;
  taken[seat] = idx;
  seatHeader();
  flourish($('csFlash'), [{ opacity: 0.7 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });
  setTimeout(() => {
    if (seat >= total - 1) { finish(); return; }
    seat++;
    seatHeader();
    renderRoster();
    let next = 0;
    while (taken.includes(next) && next < CHARACTERS.length - 1) next++;
    dir = 1;
    show(next);
  }, 300);
}

function finish() {
  running = false;
  const el = $('charSelect');
  el.classList.remove('on');
  el.style.opacity = '';
  setTimeout(() => {
    el.hidden = true;
    // browsers cap live WebGL contexts; hand this one back to the board
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
    if (piece && stage) { stage.remove(piece); piece = null; }
  }, 320);
  const out = picks.slice(0, total);
  const done = resolveAll; resolveAll = null;
  done && done(out);
}

function onKey(ev) {
  if (!running) return;
  if (ev.code === 'ArrowRight') { ev.preventDefault(); show(idx + 1); }
  if (ev.code === 'ArrowLeft') { ev.preventDefault(); show(idx - 1); }
  if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); confirm(); }
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  $('csPrev').addEventListener('click', () => show(idx - 1));
  $('csNext').addEventListener('click', () => show(idx + 1));
  $('csConfirm').addEventListener('click', confirm);
  $('csBack').addEventListener('click', () => {
    if (seat === 0) return;
    seat--;
    taken[seat] = -1;
    seatHeader(); renderRoster(); show(picks[seat] ?? 0);
  });
  $('csRoster').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) show(+b.dataset.i);
  });
  addEventListener('keydown', onKey);
  addEventListener('resize', () => { sizeW = sizeH = 0; if (running) fit(); });
}

/** Opens the select and resolves with one character index per player. */
export async function pickCharacters(players, look) {
  const el = $('charSelect');
  el.hidden = false;
  el.classList.add('on');
  el.style.opacity = '1';        // a frozen transition must not leave it invisible
  wire();

  total = players;
  seat = 0;
  taken = new Array(players).fill(-1);
  picks = new Array(players).fill(0);
  idx = 0; dir = 1; gen = 0;

  if (look && THEMES[look]) applyMaterialTheme();

  // the screen is complete and interactive before any model has downloaded
  buildStage();
  sizeW = sizeH = 0;
  fit();
  running = true;
  last = performance.now();
  nextFrame(frame);
  seatHeader();
  renderRoster();
  show(0);
  prefetchPieces();              // the rest warm up while the first is on screen

  return new Promise(res => { resolveAll = res; });
}
