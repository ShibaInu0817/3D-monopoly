// Cinematic character select. Runs its own small three.js stage and hands back
// character indices. Nothing here touches game state.
//
// Two modes share the whole screen:
//   hotseat — one device, one human seat after another (pickCharacters)
//   room    — one device, one seat, on a clock, with everyone else's picks
//             arriving live from the host (pickInRoom + castUpdate)
import * as THREE from 'three';
import { loadPiece, prefetchPieces, pieceReady, makeCharacterToken, CHARACTERS, THEMES, applyMaterialTheme } from './board3d.js';
import { PLAYER_COLORS } from './data.js';

const $ = id => document.getElementById(id);

let renderer, scene, camera, stage, disc, glowMat, seatLight, piece, last = 0;
let idx = 0, seat = 0, total = 2, taken = [], picks = [];
let running = false, resolveAll = null, spin = 0, entered = 0, gen = 0, dir = 1;
let frameDist = 0.7, frameY = 0.08, sizeW = 0, sizeH = 0;

// hotseat only: which seats this device actually picks for. Bots are not in it —
// they take what is left once the people are done.
let mySeats = [];
// room mode
let inRoom = false;      // one seat, on a clock, others arriving over the wire
let locked = false;      // I have confirmed and am waiting on everyone else
let endsAt = 0, tick = null, onClaim = null, bumpNote = '', myClaim = -1;

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
  // a lost race leaves a note that has to outlive this repaint: show() calls
  // straight back into here, which would otherwise wipe it before it was read
  $('csTaken').hidden = !dup && !bumpNote;
  if (dup) $('csTaken').textContent = '玩家 ' + (owner + 1) + ' 已经选了';
  else if (bumpNote) $('csTaken').textContent = bumpNote;
  // once locked in, the button stays a status line rather than an action
  $('csConfirm').disabled = dup || (inRoom && locked);

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

  if (inRoom) {
    // there is no previous seat to go back to, and the step counter is a clock
    $('csBack').hidden = true;
    paintClock();
    $('csConfirm').textContent = locked ? '已选好' : '确定';
    $('csConfirm').disabled = locked || takenByOther(idx);
    return;
  }
  $('csBack').hidden = false;
  $('csOf').textContent = (mySeats.indexOf(seat) + 1) + ' / ' + mySeats.length;
  $('csBack').disabled = mySeats.indexOf(seat) === 0;
  $('csConfirm').textContent = seat === mySeats[mySeats.length - 1] ? '开始游戏' : '确定';
}

/** True when someone else holds this character. My own pick never blocks me. */
const takenByOther = i => { const o = taken.indexOf(i); return o >= 0 && o !== seat; };

function paintClock() {
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  $('csOf').textContent = locked ? '等其他人…' : left + 's';
  $('charSelect').classList.toggle('csHurry', !locked && left <= 5);
}

function confirm() {
  if ($('csConfirm').disabled) return;
  if (piece && piece.userData.play) piece.userData.play('jump', 0.06);
  flourish($('csFlash'), [{ opacity: 0.7 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' });

  if (inRoom) {
    // Claim it and wait. Nothing is marked taken locally — the host says who got
    // there first, and a lost race must not leave a pick showing that never was.
    locked = true;
    myClaim = idx;
    bumpNote = '';
    $('csTaken').hidden = true;
    seatHeader();
    onClaim && onClaim(idx);
    return;
  }

  picks[seat] = idx;
  taken[seat] = idx;
  seatHeader();
  setTimeout(() => {
    const next = mySeats[mySeats.indexOf(seat) + 1];
    if (next === undefined) { finish(); return; }
    seat = next;
    seatHeader();
    renderRoster();
    let free = 0;
    while (taken.includes(free) && free < CHARACTERS.length - 1) free++;
    dir = 1;
    show(free);
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
    const at = mySeats.indexOf(seat);
    if (inRoom || at <= 0) return;
    seat = mySeats[at - 1];
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

/** Give every listed seat a character nobody else holds. Twelve to choose from
 *  against at most four seats, so the pool never runs dry. Callers fill people
 *  before computers by calling it twice. */
export function fillRandom(chars, seats) {
  const used = new Set(chars.filter(c => c >= 0));
  for (const s of seats) {
    if (chars[s] >= 0) continue;
    const free = CHARACTERS.map((_, i) => i).filter(i => !used.has(i));
    const pool = free.length ? free : CHARACTERS.map((_, i) => i);
    const c = pool[Math.floor(Math.random() * pool.length)];
    used.add(c);
    chars[s] = c;
  }
  return chars;
}

/** Shared opening: the screen is complete and interactive before any model has
 *  downloaded, so nobody waits on the network to start choosing. */
function openScreen(look) {
  const el = $('charSelect');
  el.hidden = false;
  el.classList.add('on');
  el.style.opacity = '1';        // a frozen transition must not leave it invisible
  el.classList.remove('csHurry');
  wire();
  idx = 0; dir = 1; gen = 0;
  if (look && THEMES[look]) applyMaterialTheme();
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
}

/** One device, one seat after another. `seats` is the human seats only — bots
 *  take what is left afterwards rather than a slot in the queue. */
export async function pickCharacters(players, look, seats) {
  total = players;
  mySeats = (seats && seats.length ? seats : Array.from({ length: players }, (_, i) => i)).slice();
  inRoom = false; locked = false;
  seat = mySeats[0];
  taken = new Array(players).fill(-1);
  picks = new Array(players).fill(-1);
  openScreen(look);
  return new Promise(res => { resolveAll = res; });
}

/** One device, one seat, on a clock, with everyone else's picks arriving from
 *  the host. `onPick` fires on each confirm — a lost race lets it fire again. */
export async function pickInRoom({ seat: mySeat, total: players, look, onPick }) {
  total = players;
  mySeats = [mySeat];
  inRoom = true; locked = false; bumpNote = ''; myClaim = -1;
  onClaim = onPick;
  seat = mySeat;
  taken = new Array(players).fill(-1);
  picks = new Array(players).fill(-1);
  endsAt = Date.now() + 30000;   // replaced by the host's clock on the first cast
  clearInterval(tick);
  tick = setInterval(() => { if (inRoom && running) paintClock(); }, 250);
  openScreen(look);
}

/** The host's live board. Repaints who holds what, and if my claim lost the race
 *  it hands the seat back so the player can choose again. */
export function castUpdate(chars, until) {
  if (!inRoom || !running) return;
  if (until) endsAt = until;
  taken = Array.from({ length: total }, (_, i) => (chars && chars[i] >= 0 ? chars[i] : -1));

  // Only a board that hands my character to somebody else means I lost. A board
  // that simply does not have my claim yet is one that crossed it in flight —
  // common on a public broker — and bumping on that would eject me for nothing.
  if (locked && taken[seat] < 0 && takenByOther(myClaim)) {
    locked = false;
    myClaim = -1;
    bumpNote = '被人抢先了，再选一个';
    let free = 0;
    while (taken.includes(free) && free < CHARACTERS.length - 1) free++;
    show(free);
  }
  renderRoster();
  seatHeader();
  paintCard();
}

/** The game is starting: tear the screen down without resolving anything. */
export function castClose() {
  if (!running && !inRoom) return;
  clearInterval(tick); tick = null;
  inRoom = false; locked = false; onClaim = null;
  running = false;
  const el = $('charSelect');
  el.classList.remove('on', 'csHurry');
  el.style.opacity = '';
  setTimeout(() => {
    el.hidden = true;
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
    if (piece && stage) { stage.remove(piece); piece = null; }
  }, 320);
}
