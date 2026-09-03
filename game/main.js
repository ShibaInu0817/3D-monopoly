import * as THREE from 'three';
import { BoardView, makeToken, makeCharacterToken, loadPieces, makeDie, DIE_UP, THEMES, MATS, TOP } from './board3d.js';
import * as D from './data.js';
import * as NET from './net-mqtt.js';
import { PLAYER_COLORS } from './data.js';
import * as E from './engine.js';

const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
// rAF pauses in hidden/background frames and does not resume mid-wait, which
// would freeze a turn. Race it against a timer and take whichever fires first.
const nextFrame = cb => {
  let done = false;
  const fire = () => { if (done) return; done = true; cb(performance.now()); };
  requestAnimationFrame(fire);
  setTimeout(fire, 60);
};

/* ---------------- menu ---------------- */
const choice = { board: 'ipoh', style: 'clay', players: 4, rapid: false, bots: 0, cash: 300 };

/** A snapshot from a crashed or closed game turns into one button on the menu. */
function offerResume() {
  const save = readSave();
  const btn = $('btnResume');
  if (!save) { btn.hidden = true; return; }
  const b = D.BOARDS[save.choice.board];
  btn.hidden = false;
  $('resumeSub').textContent = (b ? b.name : save.choice.board) + ' · ' +
    save.state.players.filter(p => p.alive).length + ' players';
  btn.addEventListener('click', () => startGame(save));
}

function wireMenu() {
  document.querySelectorAll('#menu [data-pick]').forEach(el => {
    el.addEventListener('click', () => {
      const kind = el.dataset.pick, val = el.dataset.val;
      choice[kind] = kind === 'players' || kind === 'bots' || kind === 'cash' ? +val
        : kind === 'rapid' ? val === 'on' : val;
      if (kind === 'cash') { $('cashInput').value = ''; $('cashInput').classList.remove('on'); }
      document.querySelectorAll(`#menu [data-pick="${kind}"]`).forEach(sib =>
        sib.setAttribute('aria-pressed', String(sib === el)));
      if (kind === 'board') {
        $('menuBlurb').textContent = D.BOARDS[val].blurb;
        document.documentElement.dataset.board = val;
        // each board opens on the look it was drawn for
        const suggested = { hustle: 'paper', ipoh: 'paper' }[val] || 'clay';
        choice.style = suggested;
        document.documentElement.dataset.theme = suggested;
        document.querySelectorAll('#menu [data-pick="style"]').forEach(s =>
          s.setAttribute('aria-pressed', String(s.dataset.val === suggested)));
      }
      if (kind === 'style') document.documentElement.dataset.theme = val;
    });
  });
  document.querySelectorAll('#tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sheet;
      const wasOpen = document.body.classList.contains('sheet-' + key);
      ['road', 'log'].forEach(k => document.body.classList.remove('sheet-' + k));
      if (!wasOpen) document.body.classList.add('sheet-' + key);
      document.querySelectorAll('#tabs .tab').forEach(b =>
        b.setAttribute('aria-pressed', String(!wasOpen && b === btn)));
    });
  });
  // a popup or a new turn should never leave a sheet covering the board
  $('btnStart').addEventListener('click', () => startGame());
  // a typed budget wins over the preset pills
  $('cashInput').addEventListener('input', e => {
    const raw = parseInt(e.target.value, 10);
    const pills = document.querySelectorAll('#menu [data-pick="cash"]');
    if (!Number.isFinite(raw)) {
      // empty or nonsense: fall back to the default preset so the shown state
      // and choice.cash can never disagree
      e.target.classList.remove('on');
      choice.cash = 300;
      pills.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === '300')));
      return;
    }
    const v = Math.min(20000, Math.max(50, raw));
    if (v !== raw) e.target.value = v;      // show the clamped value they got
    choice.cash = v;
    e.target.classList.add('on');
    pills.forEach(b => b.setAttribute('aria-pressed', 'false'));
  });
  wireLobby();
  $('btnGallery').addEventListener('click', async () => {
    const { openGallery } = await import('./gallery.js');
    openGallery(choice.style, choice.board);
  });
}

/* ---------------- networked input ----------------
 * Every action any player takes is an input. Offline it is applied straight
 * away; online the host numbers it and echoes it to everyone, so all clients
 * apply the same list in the same order and never diverge. */
const inbox = [];
let pumping = false;

const until = (test, ms = 8000) => new Promise(res => {
  const t0 = performance.now();
  const tick = () => {
    if (test()) return res(true);
    if (performance.now() - t0 > ms) return res(false);
    setTimeout(tick, 60);
  };
  tick();
});

async function pump() {
  if (pumping) return;
  pumping = true;
  while (inbox.length) {
    const inp = inbox[0];
    // an input can arrive before this client has caught up: wait for its moment
    await until(() => !turnLock && !busy);
    inbox.shift();
    try { await applyInput(inp); }
    catch (err) { console.error('input failed', inp, err); }
  }
  pumping = false;
}

/** Decisions run outside the queue: the turn being pumped is blocked on one. */
function deliverDecision(inp) {
  if (momentClose) { momentClose(!!inp.yes); return; }
  until(() => !!momentClose, 12000).then(ok => { if (ok && momentClose) momentClose(!!inp.yes); });
}

function applyInput(inp) {
  switch (inp.type) {
    case 'roll': return takeTurn(inp.dice);
    case 'end': return endTurn(true);
    case 'build':
      E.build(state, inp.tile); tone([660, 880], 0.09, 'triangle', 0.035);
      refreshBoardVisuals(); syncHud(); return;
    case 'sell':
      E.sell(state, inp.tile); tone([440, 330], 0.09, 'triangle', 0.03);
      refreshBoardVisuals(); syncHud(); return;
    case 'unstick': return unstick(true);
  }
}

const d6 = () => 1 + Math.floor(Math.random() * 6);
/** only one machine may drive bots and recovery, or they fire on every client */
const isAuthority = () => NET.net.mode !== 'guest';
const myTurn = () => (state.players[state.turn].bot ? isAuthority() : NET.isMySeat(state.turn));

function requestRoll() {
  if (busy || state.phase !== 'roll' || !myTurn()) return;
  NET.submit({ type: 'roll', dice: [d6(), d6()] });
}
function requestEnd() {
  if (busy || state.phase !== 'end' || !myTurn()) return;
  clearTimeout(autoTimer);
  NET.submit({ type: 'end' });
}
function requestDecide(yes) { NET.submit({ type: 'decide', yes }); }

/* ---------------- scene (built once the board is chosen) ---------------- */
let renderer, scene, camera, hemi, key, fill, board, state, tokens, dice;
let mode = 'follow', orbit = 0, userDrag = null, busy = false, styleName = 'clay';
let zoom = 1, tapMoved = false;
let lastCash = [];
let started = false;
let piecesReady = false;

function buildScene() {
  const canvas = $('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
  camera.position.set(1.0, 0.9, 1.5);

  hemi = new THREE.HemisphereLight(0xd9ecff, 0x9a8b74, 1);
  scene.add(hemi);
  key = new THREE.DirectionalLight(0xfff2dd, 1.8);
  key.position.set(1.4, 2.2, 1.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const d = 1.3;
  Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 0.5, far: 6 });
  key.shadow.bias = -0.0006;
  scene.add(key);
  fill = new THREE.DirectionalLight(0xcfe2ff, 0.5);
  fill.position.set(-1.6, 1.2, -1.1);
  scene.add(fill);

  const table = new THREE.Mesh(new THREE.CircleGeometry(4.5, 64), MATS.table);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.001;
  table.receiveShadow = true;
  scene.add(table);

  board = new BoardView();
  scene.add(board.group);

  tokens = PLAYER_COLORS.slice(0, state.players.length).map((c, i) => {
    const t = piecesReady ? makeCharacterToken(c.hex, 'token_' + c.name.toLowerCase(), i)
                          : makeToken(c.hex, 'token_' + c.name.toLowerCase());
    t.position.copy(board.tokenSpot(0, i));
    scene.add(t);
    return t;
  });
  dice = [makeDie('die_a'), makeDie('die_b')];
  dice.forEach(dd => scene.add(dd));
  dice[0].position.set(-0.1, TOP + 0.05, 0.16);
  dice[1].position.set(-0.02, TOP + 0.05, 0.2);

  window.__probe = { scene, camera, tokens: () => tokens, board, THREE, state: () => state, busy: () => busy };
  addEventListener('resize', resize);
  resize();
  // a lost GL context would otherwise end the render loop for good
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    console.warn('GL context lost — waiting for restore');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('GL context restored');
    board.setTheme(THEMES[styleName]);
    refreshBoardVisuals();
  });
  let dragStart = null, dragged = false;
  canvas.addEventListener('pointerdown', e => { dragStart = e.clientX; userDrag = e.clientX; dragged = false; tapMoved = false; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom = Math.min(1.9, Math.max(0.55, zoom * (1 + Math.sign(e.deltaY) * 0.12)));
  }, { passive: false });
  // two-finger pinch to zoom
  const touches = new Map();
  let pinch0 = null;
  canvas.addEventListener('pointerdown', e => { touches.set(e.pointerId, e); });
  canvas.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, e);
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch0 === null) { pinch0 = dist; return; }
    zoom = Math.min(1.9, Math.max(0.55, zoom * (pinch0 / dist)));
    pinch0 = dist;
    tapMoved = true;
  });
  const clearTouch = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = null; };
  canvas.addEventListener('pointerup', clearTouch);
  canvas.addEventListener('pointercancel', clearTouch);
  addEventListener('pointerup', () => { dragStart = null; userDrag = null; });
  addEventListener('pointercancel', () => { dragStart = null; userDrag = null; });
  addEventListener('pointermove', e => {
    if (userDrag === null) return;
    // ignore a tap: only switch to overview once the finger really travels
    if (!dragged && Math.abs(e.clientX - dragStart) < 12) { userDrag = e.clientX; return; }
    if (!dragged) { dragged = true; tapMoved = true; if (state.phase !== 'over') mode = 'overview'; syncHud(); }
    orbit -= (e.clientX - userDrag) * 0.008;
    userDrag = e.clientX;
  });
  nextFrame(frame);
}

let fitK = 1;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  // a portrait phone sees far less board width, so pull the camera back
  fitK = camera.aspect < 1 ? Math.min(2.4, 1.06 / camera.aspect) : 1;
  camera.fov = camera.aspect < 1 ? 44 : 38;
  camera.updateProjectionMatrix();
}

/* ---------------- styles ---------------- */
function applyStyle(name) {
  styleName = name;
  const t = THEMES[name];
  board.setTheme(t);
  scene.background = new THREE.Color(t.bg);
  scene.fog = new THREE.Fog(t.bg, t.fog[0], t.fog[1]);
  hemi.intensity = t.hemi;
  key.intensity = t.key;
  fill.intensity = t.fill;
  MATS.table.color.setHex(t.table);
  tokens.forEach(tk => {
    tk.userData.baseScale = t.chunk;
    tk.scale.setScalar(t.chunk);
    const cm = tk.userData.material;
    const lit = name === 'neon' || name === 'arcane';
    cm.roughness = lit ? 0.35 : 0.55;
    cm.emissive.setHex(lit ? cm.color.getHex() : 0x000000);
    cm.emissiveIntensity = lit ? 0.4 : 0;
  });
  document.documentElement.dataset.theme = name;
  document.querySelectorAll('.sbtn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === name)));
}

/* ---------------- camera rig ---------------- */
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();

let victoryTimer = null;
let celebrating = false;

/** winner takes the middle of the table: camera orbits in close while the piece
 *  cycles a celebration; everyone else drops to a folded pose */
function celebrate() {
  if (celebrating || !state.winner) return;
  celebrating = true;
  clearSave();
  saveArmed = false;
  clearTimeout(botTimer);
  clearTimeout(autoTimer);
  clearInterval(watchdog);
  mode = 'victory';
  orbit = 0;

  const champ = tokens[state.winner.id];
  state.players.forEach(pl => {
    const tk = tokens[pl.id];
    if (!tk || !tk.userData.play) return;
    if (pl.id !== state.winner.id) tk.userData.play(pl.alive ? 'sit' : 'die', { fade: 0.3 });
  });

  const routine = ['jump', 'emote-yes', 'jump', 'emote-yes', 'interact-right'];
  let step = 0;
  const next = () => {
    if (!champ || !champ.userData.play) return;
    champ.userData.play(routine[step % routine.length], { then: 'idle' });
    step += 1;
    victoryTimer = setTimeout(next, 900);
  };
  next();
  $('camMode').textContent = T('victory', 'Victory');
  tone([523, 659, 784, 1047], 0.2, 'triangle', 0.05);
}

function desiredCamera() {
  if (mode === 'victory' && state.winner && tokens[state.winner.id]) {
    const t = tokens[state.winner.id].position;
    const r = 0.42 * fitK * zoom;
    // the piece centre sits ~0.05 above its base; bias the look-at DOWN by a
    // fraction of the orbit radius so the composition holds at every fitK
    const centre = t.y + 0.05;
    camPos.set(t.x + Math.sin(orbit) * r, 0.2 * fitK, t.z + Math.cos(orbit) * r);
    camTarget.set(t.x, centre - 0.06 * r, t.z);
    return;
  }
  if (mode === 'overview') {
    const oz = fitK * zoom;
    camPos.set(Math.sin(orbit) * 1.55 * oz, 1.75 * oz, Math.cos(orbit) * 1.55 * oz);
    camTarget.set(0, 0.05, 0);
    return;
  }
  const p = E.cur(state);
  const t = tokens[p.id].position;
  const out = new THREE.Vector3(t.x, 0, t.z);
  if (out.length() < 0.001) out.set(1, 0, 1);
  out.normalize();
  const side = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(0.24);
  const fz = fitK * zoom;
  const d = 0.92 * fz;
  camPos.set(t.x + out.x * d + side.x * fz, 0.78 * fz, t.z + out.z * d + side.z * fz);
  camTarget.set(t.x - out.x * 0.34 * fitK, 0.02, t.z - out.z * 0.34 * fitK);
}

function updateCamera(dt) {
  desiredCamera();
  const k = 1 - Math.pow(0.0015, dt);
  camera.position.lerp(camPos, k);
  lookAt.lerp(camTarget, k);
  camera.lookAt(lookAt);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
      if (mode === 'overview' && !userDrag) orbit += dt * 0.12;
    if (mode === 'victory') orbit += dt * 0.5;
    board.beacon.rotation.y += dt * 0.6;
    tokens.forEach(tk => { if (tk.userData.mixer) tk.userData.mixer.update(dt); });
    updateCamera(dt);
    renderer.render(scene, camera);
  } catch (err) {
    // a bad frame (or a lost GL context) must never kill the loop: every
    // animation promise in the turn flow is waiting on it
    console.warn('frame skipped', err);
  }
  nextFrame(frame);
}

/* ---------------- tweening ---------------- */
function tween(ms, fn, ease = t => t) {
  return new Promise(res => {
    const t0 = performance.now();
    let settled = false;
    const finish = () => { if (settled) return; settled = true; res(); };
    // hard wall-clock stop: if the frame source stalls, the turn still advances
    const guard = setTimeout(() => { try { fn(1, 1); } catch (e) {} finish(); }, ms + 400);
    const step = () => {
      if (settled) return;
      const t = Math.min(1, (performance.now() - t0) / ms);
      try { fn(ease(t), t); } catch (e) { console.warn('tween step failed', e); clearTimeout(guard); finish(); return; }
      if (t < 1) nextFrame(step);
      else { clearTimeout(guard); finish(); }
    };
    nextFrame(step);
  });
}
const easeOut = t => 1 - Math.pow(1 - t, 3);
// rapid mode runs the whole turn loop faster
const pace = () => (state && state.rapid ? 0.5 : 1);

const clip = (token, name, opts) => { if (token.userData.play) token.userData.play(name, opts); };

/** walk a character piece along a polyline at constant speed, feet on the board */
async function travel(token, spots, msPerStep) {
  const s = token.userData.baseScale || 1;
  const model = token.userData.model;
  const pts = [token.position.clone(), ...spots];
  const legs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].distanceTo(pts[i - 1]);
    legs.push(d);
    total += d;
  }
  const ms = msPerStep * spots.length;
  await tween(ms, (_, t) => {
    let want = t * total, i = 0;
    while (i < legs.length - 1 && want > legs[i]) { want -= legs[i]; i++; }
    const f = legs[i] ? Math.min(1, want / legs[i]) : 1;
    token.position.lerpVectors(pts[i], pts[i + 1], f);
    token.position.y = pts[i + 1].y;
    if (model) {
      const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
      if (dx || dz) model.rotation.y = Math.atan2(dx, dz);
    }
    const bob = Math.abs(Math.sin(t * Math.PI * spots.length * 2)) * 0.004;
    token.position.y += bob;
    token.scale.setScalar(s);
  });
  token.position.copy(pts[pts.length - 1]);
  token.scale.setScalar(s);
}

async function hop(token, to, height = 0.075, ms = 170) {
  const from = token.position.clone();
  const s = token.userData.baseScale || 1;
  await tween(ms, t => {
    token.position.lerpVectors(from, to, t);
    token.position.y = from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * height;
    const k = Math.sin(Math.PI * t);
    if (token.userData.model) {
      const dx = to.x - from.x, dz = to.z - from.z;
      if (dx || dz) token.userData.model.rotation.y = Math.atan2(dx, dz);
    } else token.rotation.y = t * Math.PI * 0.6;
    token.scale.set(s * (1 - 0.07 * k), s * (1 + 0.12 * k), s * (1 - 0.07 * k));
  });
  token.position.copy(to);
  token.scale.setScalar(s);
}

async function throwDice(values) {
  const p = E.cur(state);
  const t = tokens[p.id].position;
  const out = new THREE.Vector3(t.x, 0, t.z).normalize().multiplyScalar(-1);
  const base = new THREE.Vector3(t.x + out.x * 0.2, TOP + 0.028, t.z + out.z * 0.2);
  const spins = dice.map(() => new THREE.Vector3(
    (Math.random() * 8 + 6) * (Math.random() < 0.5 ? -1 : 1),
    (Math.random() * 8 + 6) * (Math.random() < 0.5 ? -1 : 1),
    (Math.random() * 8 + 6) * (Math.random() < 0.5 ? -1 : 1)));
  const starts = dice.map((dd, k) => new THREE.Vector3(base.x + (k ? 0.06 : -0.02), TOP + 0.26, base.z + (k ? 0.05 : -0.03)));
  const ends = dice.map((dd, k) => new THREE.Vector3(base.x + (k ? 0.075 : -0.035), TOP + 0.027, base.z + (k ? 0.06 : -0.04)));
  dice.forEach((dd, k) => dd.position.copy(starts[k]));

  await tween(620 * pace(), (e, t) => {
    dice.forEach((dd, k) => {
      dd.position.lerpVectors(starts[k], ends[k], e);
      dd.position.y = starts[k].y + (ends[k].y - starts[k].y) * e + Math.sin(Math.PI * e) * 0.05;
      dd.rotation.set(spins[k].x * t, spins[k].y * t, spins[k].z * t);
    });
  }, easeOut);

  const froms = dice.map(dd => dd.rotation.clone());
  const tos = values.map(v => DIE_UP[v]);
  await tween(280 * pace(), e => {
    dice.forEach((dd, k) => {
      dd.rotation.set(
        froms[k].x + (tos[k][0] - froms[k].x) * e,
        froms[k].y + (tos[k][1] - froms[k].y) * e,
        froms[k].z + (tos[k][2] - froms[k].z) * e);
      dd.position.y = ends[k].y + Math.sin(Math.PI * e) * 0.012;
    });
  }, easeOut);
  dice.forEach((dd, k) => { dd.rotation.set(...tos[k]); dd.position.copy(ends[k]); });
}

/* ---------------- sound ---------------- */
let actx = null;
function tone(freqs, dur = 0.14, type = 'triangle', gain = 0.05) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f;
      const t0 = actx.currentTime + i * dur * 0.7;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    });
  } catch (e) { /* audio is a nicety */ }
}
const SOUND = {
  pay: () => tone([392, 294, 220], 0.16, 'sawtooth', 0.035),
  collect: () => tone([523, 659, 784], 0.15, 'triangle', 0.05),
  alert: () => tone([196, 165], 0.22, 'square', 0.03),
  offer: () => tone([440, 587, 740], 0.13, 'triangle', 0.045),
  roll: () => tone([880], 0.06, 'triangle', 0.025),
};

/* ---------------- HUD ---------------- */
const money = n => D.CURRENCY + Math.round(n).toLocaleString('en-US');

function refreshBoardVisuals() {
  for (let i = 0; i < 40; i++) {
    board.setOwner(i, state.owner[i] < 0 ? null : PLAYER_COLORS[state.owner[i]].hex);
    board.setBuildings(i, state.houses[i]);
  }
}

const DIE_FACE = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};
function pipsSvg(v) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${DIE_FACE[v]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join('')}</svg>`;
}

function syncHud() {
  const p = E.cur(state);
  saveGame();
  $('players').innerHTML = state.players.map(pl => {
    const props = state.owner.filter(o => o === pl.id).length;
    const delta = pl.cash - (lastCash[pl.id] ?? pl.cash);
    const cls = delta > 0 ? ' flash-up' : delta < 0 ? ' flash-down' : '';
    const wage = state.rapid ? ` · <em>${money(E.nextSalary(state, pl))}</em>` : '';
    return `<div class="pcard${pl.id === state.turn ? ' active' : ''}${pl.alive ? '' : ' out'}">
      <span class="swatch" style="background:${PLAYER_COLORS[pl.id].css}"></span>
      <div class="pmeta"><b>${pl.name}${pl.bot ? '<span class="botTag">BOT</span>' : ''}</b><span>${Tn('deedCount', props + ' deed' + (props === 1 ? '' : 's'), props)}${pl.inJail ? ' · ' + T('inJail', 'held') : ''}${wage}</span></div>
      <div class="pcash${cls}">${money(pl.cash)}</div>
    </div>`;
  }).join('');
  lastCash = state.players.map(pl => pl.cash);

  $('turnName').textContent = p.name;
  $('turnDot').style.background = PLAYER_COLORS[p.id].css;
  $('tileRead').textContent = D.TILES[p.pos].name;
  $('log').innerHTML = state.log.slice(0, 8).map(l =>
    `<li><i style="background:${PLAYER_COLORS[l.turn].css}"></i>${l.text}</li>`).join('');

  const canRoll = !busy && state.phase === 'roll' && myTurn();
  const dieBtn = $('btnRoll');
  dieBtn.disabled = !canRoll || isBot();
  dieBtn.classList.toggle('ready', canRoll && !isBot());
  $('dieA').innerHTML = pipsSvg(state.dice[0]);
  $('dieB').innerHTML = pipsSvg(state.dice[1]);
  $('dieTotal').textContent = state.dice[0] + state.dice[1];
  $('rollLabel').textContent = isBot() ? T('bot', 'Bot') : canRoll ? T('roll', 'Roll')
    : busy ? T('rolling', 'Rolling') : T('rolled', 'Rolled');

  $('btnEnd').disabled = busy || state.phase !== 'end' || isBot();
  if (state.phase !== 'over') $('camMode').textContent = mode === 'follow' ? T('follow', 'Follow') : T('overview', 'Overview');
  botTick();
  renderBuild();
  renderRoad();
  document.body.classList.toggle('over', state.phase === 'over');
  $('over').hidden = state.phase !== 'over';
  if (state.phase === 'over' && state.winner) {
    celebrate();
    $('overName').textContent = state.winner.name;
    $('overName').style.color = PLAYER_COLORS[state.winner.id].css;
    $('overLine').textContent = D.LABELS.winLine;
    $('overSub').textContent = D.LABELS.winSub;
  }
}

/** board-localised UI string; boards without a ui map keep the English default */
function T(k, en) {
  const v = D.LABELS.ui && D.LABELS.ui[k];
  return v === undefined ? en : v;
}
function Tn(k, en, arg) {
  const v = D.LABELS.ui && D.LABELS.ui[k];
  return typeof v === 'function' ? v(arg) : en;
}

const HOUSE_LABEL = n => n === 5 ? D.LABELS.hotel : n === 1 ? D.LABELS.house : n + ' ' + D.LABELS.houses;

/** the ten tiles in front of the active player, with what they'd cost to land on */
function renderRoad() {
  const p = E.cur(state);
  $('roadFrom').textContent = Tn('roadFrom', 'from ' + D.TILES[p.pos].name, D.TILES[p.pos].name);
  const cells = [];
  for (let k = 1; k <= 10; k++) {
    const i = (p.pos + k) % 40;
    const t = D.TILES[i], o = state.owner[i];
    const band = t.kind === 'property'
      ? '#' + D.GROUPS[t.group].color.toString(16).padStart(6, '0')
      : 'var(--line)';
    let foot = '';
    if (o >= 0 && o !== p.id) foot = money(E.rentFor(state, i, 7));
    else if (o === p.id) foot = state.houses[i] ? HOUSE_LABEL(state.houses[i]) : 'yours';
    else if (t.price) foot = money(t.price);
    else if (t.amount) foot = '\u2212' + money(t.amount);
    const cls = o >= 0 && o !== p.id ? ' hot' : o === p.id ? ' mine' : '';
    const dot = o >= 0
      ? '<i style="background:' + PLAYER_COLORS[o].css + '"></i>'
      : '<i style="background:transparent"></i>';
    cells.push(
      '<button class="rtile' + cls + '" data-tile="' + i + '">' +
      '<span class="bar" style="background:' + band + '"></span>' +
      '<span class="step">+' + k + '</span>' +
      '<span class="n">' + t.name + '</span>' +
      '<span class="f">' + dot + '<span>' + foot + '</span></span>' +
      '</button>');
  }
  $('roadList').innerHTML = cells.join('');
  updateRoadNav();
}

/** paging affordance: the strip hides its scrollbar, so say how much is off-screen */
function updateRoadNav() {
  const list = $('roadList');
  const step = 88 + 6;
  const hidden = Math.max(0, list.scrollHeight && list.scrollWidth - list.clientWidth);
  const shown = Math.min(10, Math.max(1, Math.round(list.clientWidth / step)));
  $('roadCount').textContent = hidden > 4 ? Tn('roadCount', shown + ' of 10 shown', shown) : '';
  $('roadPrev').disabled = list.scrollLeft < 4;
  $('roadNext').disabled = list.scrollLeft >= hidden - 4;
  const show = hidden > 4;
  $('roadPrev').hidden = !show;
  $('roadNext').hidden = !show;
}

/** full deed card for any tile: owner, price, every rent tier */
function showDeed(i) {
  const t = D.TILES[i], o = state.owner[i];
  const isProp = t.kind === 'property';
  $('deedName').textContent = t.name;
  $('deedBand').style.background = isProp
    ? '#' + D.GROUPS[t.group].color.toString(16).padStart(6, '0')
    : 'var(--ink)';
  $('deedGroup').textContent = isProp ? D.GROUPS[t.group].name
    : t.kind === 'pier' ? T('transit', 'Transit') : t.kind === 'works' ? T('utility', 'Utility') : t.kind;
  $('deedOwner').textContent = o >= 0 ? Tn('heldBy', 'Held by ' + state.players[o].name, state.players[o].name)
    : t.price ? T('unclaimed', 'Unclaimed') : '';
  $('deedPrice').textContent = t.price ? money(t.price)
    : t.amount ? '\u2212' + money(t.amount) : '';

  const rows = [];
  const row = (label, val, on) =>
    '<li class="' + (on ? 'on' : '') + '"><span>' + label + '</span><span>' + val + '</span></li>';
  if (isProp) {
    const hs = state.houses[i];
    const set = o >= 0 && E.ownsGroup(state, o, t.group);
    t.rent.forEach((r, n) => {
      const label = n === 0 ? T('baseRent', 'Base rent') + (set && hs === 0 ? T('fullSet', ' (full set \u00d72)') : '')
        : n === 5 ? T('withHotel', 'With ' + D.LABELS.hotel)
        : Tn('withHouses', 'With ' + n + ' ' + (n === 1 ? D.LABELS.house : D.LABELS.houses), n);
      rows.push(row(label, money(n === 0 && set && hs === 0 ? r * 2 : r), n === hs));
    });
    rows.push(row(T('buildCost', 'Build cost'), money(t.houseCost)));
  } else if (t.kind === 'pier') {
    D.PIER_RENT.forEach((r, n) => rows.push(row(Tn('nHeld', (n + 1) + ' held', n + 1), money(r))));
  } else if (t.kind === 'works') {
    rows.push(row(T('oneHeld', 'One held'), '4 \u00d7 dice'));
    rows.push(row(T('bothHeld', 'Both held'), '10 \u00d7 dice'));
  }
  $('deedRents').innerHTML = rows.join('');
  $('deedNote').textContent = isProp && o < 0 ? T('landToBuy', 'Land here to buy it.')
    : t.kind === 'jail' ? D.LABELS.jailDetail
    : t.kind === 'tax' ? D.LABELS.taxDetail : '';
  $('deed').hidden = false;
}

function renderBuild() {
  const p = E.cur(state);
  const owned = [];
  for (let i = 0; i < 40; i++) {
    if (state.owner[i] !== p.id || D.TILES[i].kind !== 'property') continue;
    if (!E.ownsGroup(state, p.id, D.TILES[i].group)) continue;
    owned.push(i);
  }
  $('buildEmpty').hidden = owned.length > 0;
  $('buildList').innerHTML = owned.map(i => {
    const t = D.TILES[i], n = state.houses[i];
    const label = n === 5 ? D.LABELS.hotel : n ? `${n} ${n > 1 ? D.LABELS.houses : D.LABELS.house}` : T('empty', 'Empty');
    return `<li>
      <span class="chip" style="background:#${D.GROUPS[t.group].color.toString(16).padStart(6, '0')}"></span>
      <span class="bname">${t.name}<em>${label} · ${money(t.houseCost)}</em></span>
      <button data-sell="${i}" ${E.canSell(state, i) ? '' : 'disabled'}>−</button>
      <button data-build="${i}" ${E.canBuild(state, i) ? '' : 'disabled'}>+</button>
    </li>`;
  }).join('');
}

/* ---------------- popups ---------------- */
function coins(kind) {
  const card = $('mCard');
  const n = kind === 'collect' ? 16 : 12;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'coin';
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    c.style.setProperty('--dx', Math.cos(a) * (150 + Math.random() * 190) + 'px');
    c.style.setProperty('--dy', (kind === 'collect' ? -1 : 1) * (60 + Math.random() * 220) + 'px');
    c.style.left = '50%'; c.style.top = kind === 'collect' ? '62%' : '38%';
    c.style.animationDelay = (i * 0.028) + 's';
    card.appendChild(c);
    setTimeout(() => c.remove(), 1400);
  }
}

let momentGen = 0;
let activeMoment = null;   // resolver of the popup currently on screen
let momentClose = null;    // its teardown, so a networked decision closes it properly

/** one modal shape for rent, cards, alerts and the buy offer */
const isBot = () => !!(state && state.players[state.turn] && state.players[state.turn].bot);

/** bots roll on their own, and always take an unclaimed lot they can afford */
let botTimer = null;
let botPopup = null;
function botTick() {
  clearTimeout(botTimer);
  if (!isBot() || state.phase === 'over' || !isAuthority()) return;
  const delay = (busy || !$('moment').hidden ? 260 : 600) * pace();
  botTimer = setTimeout(() => {
    if (!isBot() || state.phase === 'over') return;
    // never drop the thread: if the turn is still animating, come back
    if (busy || !$('moment').hidden) { botTick(); return; }
    if (state.phase === 'roll') requestRoll();
    else if (state.phase === 'end') requestEnd();
    else botTick();                    // mid-resolve: check again shortly
  }, delay);
}

function showMoment(n) {
  const gen = ++momentGen;
  // a superseded popup must not leave its awaiter hanging forever
  if (activeMoment) { const stale = activeMoment; activeMoment = null; stale(false); }
  const el = $('moment');
  const p = state.players[n.who];
  const isOffer = n.kind === 'offer';
  el.hidden = false;
  el.className = n.kind;
  $('mWhoName').textContent = p.name;
  $('mWho').querySelector('i').style.background = PLAYER_COLORS[p.id].css;
  ['road', 'log'].forEach(k => document.body.classList.remove('sheet-' + k));
  document.querySelectorAll('#tabs .tab').forEach(b => b.setAttribute('aria-pressed', 'false'));
  $('mBadge').textContent = n.card ? n.title
    : isOffer ? T('forSale', 'For sale')
    : n.kind === 'pay' ? T('paymentDue', 'Payment due')
    : n.kind === 'collect' ? T('moneyIn', 'Money in') : T('headsUp', 'Heads up');
  // a drawn card reads as the card itself: deck name on the badge, its words as the headline
  $('mTitle').textContent = n.card ? (n.detail || n.title) : n.title;
  $('mDetail').textContent = n.card ? '' : (n.detail || '');
  if (n.card) {
    el.classList.add('drawn');
    el.classList.remove('turned');
    $('mBackName').textContent = n.title;
  }

  const swatch = $('mSwatch');
  const t = isOffer ? D.TILES[n.tile] : null;
  if (isOffer && t.kind === 'property') {
    swatch.hidden = false;
    swatch.style.background = '#' + D.GROUPS[t.group].color.toString(16).padStart(6, '0');
    swatch.textContent = D.GROUPS[t.group].name;
  } else swatch.hidden = true;

  const botTurn = !!state.players[state.turn].bot;
  const botYes = !isOffer || state.players[state.turn].cash >= n.amount;
  if (botTurn) {
    // a bot never asks the human to choose for it: one acknowledge button,
    // and the card says what the bot did
    $('mOk').textContent = T('understood', 'Understood');
    if (isOffer) $('mDetail').textContent = botYes
      ? Tn('botBuys', 'Bought for ' + money(n.amount), money(n.amount))
      : T('botPasses', 'Passed on it.');
  } else {
    $('mOk').textContent = isOffer ? Tn('buyFor', `Buy for ${money(n.amount)}`, money(n.amount))
      : n.kind === 'pay' ? Tn('pay', `Pay ${money(n.amount)}`, money(n.amount))
      : n.kind === 'collect' ? Tn('collect', `Collect ${money(n.amount)}`, money(n.amount))
      : T('understood', 'Understood');
  }
  const mine = myTurn();
  $('mOk').hidden = !mine;
  $('mNo').hidden = !isOffer || botTurn || !mine;
  $('mWait').hidden = mine;
  if (!mine) $('mWait').textContent = Tn('waitingFor', 'Waiting for ' + p.name + '…', p.name);
  $('mAmount').textContent = (n.kind === 'alert' || !Number.isFinite(n.amount))
    ? (n.card ? T('card', 'Card') : '!') : money(0);

  nextFrame(() => el.classList.add('on'));
  const lead = n.card ? 600 : 0;
  if (n.card) setTimeout(() => { if (gen === momentGen) el.classList.add('turned'); }, 1060);
  if (n.card) { tone([392, 523], 0.05, 'square', 0.02); setTimeout(() => tone([784, 1046], 0.07, 'triangle', 0.03), 560); }
  const reveal = () => {
    if (gen !== momentGen) return;
    SOUND[n.kind] && SOUND[n.kind]();
    if (n.kind === 'pay' || n.kind === 'collect') coins(n.kind);
    if (n.kind !== 'alert') {
      const sign = n.kind === 'pay' ? '−' : isOffer ? '' : '+';
      tween(560 * pace(), t2 => {
        if (gen !== momentGen) return;   // a newer popup owns the readout
        $('mAmount').textContent = sign + money(n.amount * t2);
      }, easeOut);
    }
  };
  if (lead) setTimeout(reveal, lead); else reveal();

  return new Promise(res => {
    activeMoment = res;
    const close = accepted => {
      if (momentClose === close) momentClose = null;
      if (activeMoment === res) activeMoment = null;
      if (botPopup) { clearInterval(botPopup); botPopup = null; }
      $('mOk').removeEventListener('click', yes);
      $('mNo').removeEventListener('click', no);
      removeEventListener('keydown', onKey);
      el.classList.remove('on');
      setTimeout(() => { el.hidden = true; el.className = ''; }, 320);
      tone(accepted ? [523, 784] : [440, 330], 0.08, 'triangle', 0.03);
      res(accepted);
    };
    // on a bot turn the single button confirms the bot's own decision
    // the decision travels to every client and comes back as an ordered input,
    // so all of them close the popup on the same answer
    const yes = () => requestDecide(botTurn ? botYes : true);
    const no = () => requestDecide(false);
    const onKey = ev => {
      if (!myTurn()) return;
      if (ev.code === 'Space' || ev.code === 'Enter') { ev.preventDefault(); yes(); }
      if (isOffer && !botTurn && ev.code === 'Escape') { ev.preventDefault(); no(); }
    };
    momentClose = close;
    $('mOk').addEventListener('click', yes);
    $('mNo').addEventListener('click', no);
    addEventListener('keydown', onKey);
    // a bot reads its own card, then acts: always buy what it can afford.
    // poll rather than fire once — a single timeout can land before the card
    // is even shown (throttled timers) and then never retry, deadlocking the turn.
    // outside rapid mode every card waits for a tap, bot turns included.
    // poll rather than fire once — a single timeout can land before the card
    // is even shown (throttled timers) and then never retry, deadlocking the turn.
    if (botTurn && choice.rapid && isAuthority()) {
      const wait0 = performance.now();
      botPopup = setInterval(() => {
        if (el.hidden) { clearInterval(botPopup); botPopup = null; return; }
        if (performance.now() - wait0 < (isOffer ? 1100 : 900) * pace()) return;
        clearInterval(botPopup);
        botPopup = null;
        yes();
      }, 120);
    }
  });
}

async function drainNotices() {
  while (state.notices.length) {
    const n = state.notices.shift();
    const actor = tokens[n.who];
    // hold the piece's reaction until the card is dismissed — the follow camera
    // centres the actor exactly where #mCard sits, so a pre-roll clip is unseen
    const reaction = !actor ? null
      : n.act ? { name: n.act, hold: 700 * pace() }
      : n.kind === 'collect' ? { name: 'emote-yes', hold: 700 * pace() }
      : n.kind === 'pay' ? { name: 'emote-no', hold: 700 * pace() }
      : n.kind === 'alert' ? { name: /folded/.test(n.title) ? 'die' : 'sit', hold: 500 * pace(), stay: true }
      : null;
    const accepted = await showMoment(n);
    if (reaction) {
      clip(actor, reaction.name, reaction.stay ? {} : { then: 'idle' });
      await wait(reaction.hold);
    }
    if (n.kind === 'offer') {
      if (accepted && E.cur(state).cash >= n.amount) { E.buy(state); clip(actor, 'emote-yes', { then: 'idle' }); }
      else { E.decline(state); clip(actor, 'emote-no', { then: 'idle' }); }
      await wait(650 * pace());
      refreshBoardVisuals();
    }
    syncHud();
  }
}

/* ---------------- turn flow ---------------- */
async function teleportTo(p, target) {
  const tk = tokens[p.id];
  clip(tk, 'jump', { then: 'idle' });
  await hop(tk, board.tokenSpot(target, p.id), 0.22, 460 * pace());
  clip(tk, 'idle');
}

let turnLock = false;

async function takeTurn(dice) {
  if (turnLock) return;            // set synchronously: two timers can fire together
  turnLock = true;
  try { await runTurn(dice); }
  catch (err) { console.error('turn failed', err); }
  finally { turnLock = false; busy = false; syncHud(); }
}

async function runTurn(dice) {
  if (busy || state.phase !== 'roll') return;
  busy = true; syncHud();
  SOUND.roll();
  const p = E.cur(state);
  const r = E.roll(state, dice);
  await throwDice(state.dice);
  syncHud();

  if (r.teleport !== undefined) {
    await teleportTo(p, r.teleport);
  } else if (r.steps > 0) {
    const path = E.pathFor(state, r.steps);
    E.commitMove(state, path[path.length - 1]);
    const long = path.length >= 5;
    const mover = tokens[p.id];
    clip(mover, long ? 'sprint' : 'walk');
    const spots = path.map(i => board.tokenSpot(i, p.id));
    const step = (long ? 230 : 330) * pace();
    if (mover.userData.model) await travel(mover, spots, step);
    else for (const sp of spots) await hop(mover, sp, long ? 0.055 : 0.075, step * 0.55);
    clip(mover, 'idle');
    const res = E.resolveLanding(state);
    if (res && res.teleport !== undefined) {
      await drainNotices();
      await teleportTo(p, res.teleport);
      if (res.thenResolve) {
        E.resolveLanding(state);
        refreshBoardVisuals();
        await drainNotices();          // the new tile can raise its own offer
      }
    } else if (res && res.type === 'teleport') {
      await teleportTo(p, res.tile);
    }
  }
  refreshBoardVisuals();
  await drainNotices();
  busy = false;
  syncHud();
  if (state.phase === 'end') maybeAutoEnd();
}

/* ---------------- crash insurance ----------------
 *  The whole game lives in one JSON-safe object, so a snapshot after every
 *  visible change makes a refresh a recovery rather than a restart. */
const SAVE_KEY = 'ipoh.save.v1';
let saveArmed = false;

function saveGame() {
  if (!saveArmed || !state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ choice, state, at: Date.now() }));
  } catch (err) { /* private mode or full: play on without a net */ }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.state || !s.choice || s.state.phase === 'over') return null;
    if (!Array.isArray(s.state.players) || !s.state.players.length) return null;
    return s;
  } catch (err) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
}

let autoTimer = null;
let watchdog = null;
let lastProgress = { at: 0, sig: '' };
let stallSig = '', stallSince = 0;

/** A turn should never outlast its animations. If the flow is still marked busy
 *  with no popup on screen and nothing has changed for seconds, release it so
 *  the game continues instead of freezing. */
function startWatchdog() {
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (state.phase === 'over') { $('btnUnstick').hidden = true; return; }
    const sig = state.turn + '/' + state.phase + '/' + state.log.length + '/' + busy;
    const now = performance.now();
    // the escape hatch appears only once the automatic recovery has had its go
    const waitingOnHuman = !$('moment').hidden && !isBot();
    if (sig !== stallSig) { stallSig = sig; stallSince = now; }
    $('btnUnstick').hidden = waitingOnHuman || now - stallSince < 9000;
    if (sig !== lastProgress.sig) { lastProgress = { at: now, sig }; return; }
    if (now - lastProgress.at < 5000) return;
    if (!$('moment').hidden) {
      // a bot never taps its own card: confirm it for them
      if (isBot()) { $('mOk').click(); lastProgress = { at: now, sig: '' }; return; }
      return;                                   // a human decision, not a stall
    }
    if (state.phase === 'roll' && isBot() && !busy) {
      console.warn('bot lost its thread — restarting', sig);
      botTick();
      lastProgress = { at: now, sig: '' };
      return;
    }
    if (busy) {
      console.warn('turn wedged — releasing', sig);
      busy = false;
      turnLock = false;
      syncHud();
      if (state.phase === 'end') endTurn();
    } else if (state.phase === 'resolve' && state.pending) {
      // an offer with no popup left: decline it and move on
      E.decline(state);
      syncHud();
    } else if (state.phase === 'end' && isBot()) {
      endTurn();
    }
    lastProgress = { at: now, sig: '' };
  }, 1500);
}

/** Last resort, on screen: the automatic release has already been tried and the
 *  game is still not moving. One tap rebuilds the turn from the saved state. */
function unstick(fromInput) {
  if (!fromInput) { NET.submit({ type: 'unstick' }); return; }
  clearTimeout(botTimer);
  clearTimeout(autoTimer);
  busy = false;
  turnLock = false;
  if (activeMoment) { const stale = activeMoment; activeMoment = null; momentClose = null; stale(false); }
  $('moment').hidden = true;
  state.notices.length = 0;
  if (state.phase === 'resolve' && state.pending) E.decline(state);
  if (state.phase === 'roll' && !E.cur(state).alive) E.endTurn(state);
  else if (state.phase === 'end') E.endTurn(state);
  state.phase = state.phase === 'over' ? 'over' : 'roll';
  E.notify(state, { kind: 'alert', who: state.turn, title: T('unstuckTitle', 'Turn reset'),
    detail: T('unstuckDetail', 'The board was stuck, so this turn starts again.') });
  refreshBoardVisuals();
  syncHud();
  drainNotices();
  if (isBot()) botTick();
}

function maybeAutoEnd() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { if (state.phase === 'end' && !busy && myTurn()) requestEnd(); }, 1600 * pace());
}

function endTurn(fromInput) {
  if (!fromInput) return requestEnd();
  if (state.phase !== 'end' || busy) return;
  E.endTurn(state);
  $('build').classList.remove('open');
  $('btnBuild').textContent = 'Build';
  state.players.forEach(pl => {
    const tk = tokens[pl.id];
    if (!tk || !tk.userData.play) return;
    if (!pl.alive) return;
    tk.userData.play(pl.inJail ? 'sit' : 'idle');
  });
  mode = 'follow';
  syncHud();
}

NET.net.onInput = inp => {
  if (inp.type === 'decide') { deliverDecision(inp); return; }
  inbox.push(inp);
  pump();
};
NET.net.onStatus = t => { $('lobbyStatus').textContent = t; };
NET.net.onLobby = seats => renderSeats(seats);
NET.net.onBegin = msg => {
  $('lobby').hidden = true;
  startGame({ choice: msg.choice, state: msg.state, net: true });
};

function renderSeats(seats) {
  const total = choice.players;
  const rows = [];
  for (let i = 0; i < total; i++) {
    const s = seats.find(x => x.seat === i);
    const you = i === NET.net.seat ? ' · you' : '';
    rows.push(`<div><i style="background:${D.PLAYER_COLORS[i].css}"></i>
      ${s ? s.nick : 'Bot'}<em>${s ? 'seat ' + (i + 1) + you : 'computer'}</em></div>`);
  }
  $('lobbySeats').innerHTML = rows.join('');
  $('btnLobbyStart').hidden = NET.net.mode !== 'host';
  $('lobbyHint').textContent = NET.net.mode === 'host'
    ? 'Share this code. Unclaimed seats play as bots.'
    : 'Waiting for the host to start.';
}

function wireLobby() {
  // opened straight off disk there is no origin for WebRTC to work with
  if (location.protocol === 'file:') {
    ['btnHost', 'btnJoin', 'joinCode'].forEach(id => { $(id).disabled = true; });
    $('btnHost').textContent = 'Online needs a web address';
  }
  $('btnHost').addEventListener('click', async () => {
    $('btnHost').textContent = 'Opening…';
    try {
      const code = await NET.createRoom('Host', choice.players);
      $('lobbyCode').textContent = code;
      $('lobby').hidden = false;
      renderSeats(NET.net.seats);
    } catch (err) {
      NET.leave();
      $('btnHost').textContent = 'Create room';
      alert('Could not open a room: ' + err.message);
    }
  });
  $('btnJoin').addEventListener('click', async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length < 6) { $('joinCode').focus(); return; }
    $('btnJoin').textContent = 'Joining…';
    try {
      await NET.joinRoom(code, 'Player');
      $('lobbyCode').textContent = code;
      $('lobby').hidden = false;
      renderSeats(NET.net.seats);
    } catch (err) {
      NET.leave();
      alert('Could not join: ' + err.message);
    } finally { $('btnJoin').textContent = 'Join'; }
  });
  $('btnLobbyStart').addEventListener('click', () => {
    if (NET.net.mode !== 'host') return;
    $('lobby').hidden = true;
    startGame();
  });
  $('btnLobbyLeave').addEventListener('click', () => {
    NET.leave();
    $('lobby').hidden = true;
    $('btnHost').textContent = 'Create room';
  });
}

/* ---------------- boot ---------------- */
async function startGame(resume) {
  if (started) return;
  started = true;
  const btn = $(resume && !resume.net ? 'btnResume' : 'btnStart');
  if (btn) btn.textContent = 'Setting up the table…';
  try { await loadPieces(); piecesReady = true; }
  catch (err) { console.warn('character pieces unavailable, using pawns', err); }
  if (resume) Object.assign(choice, resume.choice);
  const b = D.setBoard(choice.board);
  if (resume) {
    state = resume.state;
  } else {
    state = E.createGame(choice.players, { rapid: choice.rapid, cash: choice.cash });
    if (NET.net.mode === 'host') {
      NET.net.seats.forEach(s => { if (state.players[s.seat]) state.players[s.seat].name = s.nick; });
      for (let i = 0; i < choice.players; i++) {
        if (!NET.net.seats.some(s => s.seat === i)) state.players[i].bot = true;
      }
      NET.beginGame(choice, state);
    } else {
      const bots = Math.min(choice.bots, choice.players - 1);
      for (let i = choice.players - bots; i < choice.players; i++) state.players[i].bot = true;
    }
  }
  document.documentElement.dataset.board = choice.board;
  $('boardName').textContent = b.name;
  $('rapidChip').hidden = !choice.rapid;
  $('cashChip').textContent = Tn('startCash', 'start ' + money(choice.cash), money(choice.cash));
  $('newsTitle').textContent = b.labels.newsTitle;
  // board-localised chrome
  $('camLabel').textContent = T('camera', 'Camera:');
  $('totalLabel').textContent = T('total', 'total');
  $('tabRoad').textContent = T('tabRoad', 'Road');
  $('tabLog').textContent = T('tabLog', 'News');
  $('nowPlaying').textContent = T('nowPlaying', 'Now playing');
  $('onLabel').textContent = T('onTile', 'on');
  $('btnMenu').textContent = T('changeBoard', 'change board');
  $('buildTitle').textContent = T('buildTitle', 'Build — complete sets only');
  $('deedClose').textContent = T('close', 'Close');
  $('btnEnd').textContent = T('endTurn', 'End turn');
  $('btnBuild').textContent = T('build', 'Build');
  $('roadTitle').textContent = T('roadAhead', 'Road ahead');
  $('btnRestart').textContent = T('newGame', 'New game');
  $('mNo').textContent = T('no', 'No thanks');
  $('rapidChip').textContent = T('rapid', 'Rapid');
  $('buildEmpty').textContent = b.labels.buildHint;

  buildScene();
  applyStyle(choice.style);
  if (resume) {
    state.players.forEach(pl => {
      const tk = tokens[pl.id];
      if (!tk) return;
      const spot = board.tokenSpot(pl.pos, pl.id);
      tk.position.set(spot.x, spot.y, spot.z);
      if (tk.userData.play) tk.userData.play(!pl.alive ? 'die' : pl.inJail ? 'sit' : 'idle');
    });
  }
  refreshBoardVisuals();
  saveArmed = true;
  syncHud();
  startWatchdog();
  if (isBot()) botTick();

  const menu = $('menu');
  menu.classList.add('off');
  setTimeout(() => { menu.hidden = true; }, 480);
  document.body.classList.add('playing');

  $('btnUnstick').textContent = T('unstick', '卡住了？点这里');
  $('btnUnstick').addEventListener('click', () => { $('btnUnstick').hidden = true; unstick(); });
  $('styles').addEventListener('click', e => {
    const b2 = e.target.closest('.sbtn');
    if (b2) applyStyle(b2.dataset.style);
  });
  $('buildList').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || busy) return;
    if (!myTurn()) return;
    if (btn.dataset.build) NET.submit({ type: 'build', tile: +btn.dataset.build });
    if (btn.dataset.sell) NET.submit({ type: 'sell', tile: +btn.dataset.sell });
  });
  $('roadList').addEventListener('click', e => {
    const b = e.target.closest('.rtile');
    if (b) showDeed(+b.dataset.tile);
  });
  $('roadList').addEventListener('scroll', updateRoadNav);
  $('roadPrev').addEventListener('click', () => { $('roadList').scrollLeft -= 282; });
  $('roadNext').addEventListener('click', () => { $('roadList').scrollLeft += 282; });
  addEventListener('resize', updateRoadNav);
  $('deedClose').addEventListener('click', () => { $('deed').hidden = true; });
  $('deed').querySelector('.deedVeil').addEventListener('click', () => { $('deed').hidden = true; });

  // tapping a tile on the board opens its deed
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  $('scene').addEventListener('click', e => {
    if (tapMoved) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(board.group.children, true)[0];
    if (!hit) return;
    let n = hit.object;
    while (n && !/^tile_[0-9][0-9]$/.test(n.name)) n = n.parent;
    if (n) showDeed(parseInt(n.name.slice(5), 10));
  });
  $('btnRoll').addEventListener('click', () => requestRoll());
  $('btnEnd').addEventListener('click', () => requestEnd());
  $('btnCam').addEventListener('click', () => {
    if (state.phase === 'over') return;      // the victory shot owns the camera
    mode = mode === 'follow' ? 'overview' : 'follow';
    syncHud();
  });
  const buildSheet = $('build');
  $('btnBuild').addEventListener('click', () => {
    const open = buildSheet.classList.toggle('open');
    $('btnBuild').textContent = open ? 'Close build' : 'Build';
  });
  addEventListener('keydown', e => {
    if (!$('moment').hidden) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.phase === 'roll') requestRoll();
      else if (state.phase === 'end') requestEnd();
    }
    if (e.key === 'o' && state.phase !== 'over') { mode = mode === 'follow' ? 'overview' : 'follow'; syncHud(); }
  });
}

// a deliberate exit drops the snapshot; only a crash should leave one behind
$('btnRestart').addEventListener('click', () => { clearSave(); location.reload(); });
$('btnMenu').addEventListener('click', () => { clearSave(); location.reload(); });
window.addEventListener('pagehide', saveGame);
wireMenu();
offerResume();
