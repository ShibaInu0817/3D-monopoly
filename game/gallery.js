// Menu gallery: preview every piece, every animation clip, and every card reaction.
import * as THREE from 'three';
import { loadPieces, makeCharacterToken, MATS } from './board3d.js';
import { BOARDS, PLAYER_COLORS, cardFlavour } from './data.js';

const CLIP_GROUPS = [
  ['Locomotion', ['idle', 'walk', 'sprint', 'jump', 'fall', 'static']],
  ['Postures', ['crouch', 'sit', 'drive', 'die']],
  ['Actions & emotes', ['pick-up', 'emote-yes', 'emote-no', 'interact-right', 'interact-left']],
  ['Holding', ['holding-right', 'holding-left', 'holding-both',
               'holding-right-shoot', 'holding-left-shoot', 'holding-both-shoot']],
  ['Attacks', ['attack-melee-right', 'attack-melee-left', 'attack-kick-right', 'attack-kick-left']],
  ['Wheelchair', ['wheelchair-sit', 'wheelchair-look-left', 'wheelchair-look-right',
                  'wheelchair-move-forward', 'wheelchair-move-back',
                  'wheelchair-move-left', 'wheelchair-move-right']],
];

const HELD = new Set(['sit', 'crouch', 'drive', 'die', 'static', 'fall',
  'holding-right', 'holding-left', 'holding-both', 'wheelchair-sit']);

const $ = id => document.getElementById(id);

// rAF pauses in backgrounded tabs and does not resume mid-wait; race it against
// a timer so the reveal and the viewer loop never stall.
const nextFrame = cb => {
  let done = false;
  const fire = () => { if (done) return; done = true; cb(performance.now()); };
  requestAnimationFrame(fire);
  setTimeout(fire, 60);
};

let renderer, scene, camera, stage, piece, mixerClock;
let pieceIndex = 0, current = 'idle', boardId = Object.keys(BOARDS)[0];
let clipNames = [];
let spin = 0, drag = null, ready = false;

function buildStage() {
  const canvas = $('galCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 5);

  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x9a8b74, 1.1));
  const key = new THREE.DirectionalLight(0xfff4e2, 1.9);
  key.position.set(0.3, 0.6, 0.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -0.2, right: 0.2, top: 0.2, bottom: -0.2, near: 0.05, far: 2 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.55);
  rim.position.set(-0.5, 0.4, -0.4);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.22, 48), MATS.table.clone());
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  stage = new THREE.Group();
  scene.add(stage);
  mixerClock = performance.now();

  canvas.addEventListener('pointerdown', e => { drag = e.clientX; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => {
    if (drag === null) return;
    spin -= (e.clientX - drag) * 0.01;
    drag = e.clientX;
  });
}

function fit() {
  const canvas = $('galCanvas');
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function frame(now) {
  if (!$('gallery') || $('gallery').hidden) { mixerClock = now; nextFrame(frame); return; }
  const dt = Math.min(0.05, (now - mixerClock) / 1000);
  mixerClock = now;
  if (drag === null) spin += dt * 0.35;
  if (piece) {
    piece.rotation.y = spin;
    if (piece.userData.tick) piece.userData.tick(dt);
  }
  const r = 0.3;
  camera.position.set(Math.sin(0) * r, 0.13, r);
  camera.lookAt(0, 0.05, 0);
  renderer.render(scene, camera);
  nextFrame(frame);
}

function setPiece(i) {
  pieceIndex = i;
  if (piece) stage.remove(piece);
  piece = makeCharacterToken(PLAYER_COLORS[i % 4].hex, 'gallery_piece', i);
  piece.scale.setScalar(1.9);
  stage.add(piece);
  // a rigless piece reports the puppet's clip names instead of the mixer's
  clipNames = (piece.userData.clips || []).slice();
  play(current);
  document.querySelectorAll('#galPieces button').forEach((b, n) =>
    b.setAttribute('aria-pressed', String(n === i)));
}

function play(name) {
  if (!piece || !clipNames.includes(name)) return;
  current = name;
  piece.userData.play(name, HELD.has(name) ? {} : { then: 'idle' });
  document.querySelectorAll('#galClips button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.clip === name)));
  $('galNow').textContent = name;
}

function renderClips() {
  $('galClips').innerHTML = CLIP_GROUPS.map(([title, list]) => `
    <div class="galGroup">
      <span class="lbl">${title}</span>
      <div class="galRow">${list.map(c =>
        `<button data-clip="${c}" aria-pressed="${c === current}">${c}</button>`).join('')}</div>
    </div>`).join('');
}

function renderBoardTabs() {
  $('galBoards').innerHTML = Object.entries(BOARDS).map(([id, b]) =>
    `<button data-board="${id}" aria-pressed="${id === boardId}">${b.name}</button>`).join('');
}

function renderCards() {
  const b = BOARDS[boardId];
  const deck = (list, title) => `<div class="galGroup"><span class="lbl">${title} · ${list.length}</span>
    <div class="galCards">${list.map(c => {
      const f = cardFlavour(c);
      const amt = c.cash || 0;
      const gain = amt > 0, loss = amt < 0;
      // a money card leads with the figure; everything else leads with its motif,
      // which is the same drawing the popup will stamp on the card face
      const head = gain ? '+' + b.currency + amt
        : loss ? '−' + b.currency + Math.abs(amt) : '';
      return `<button class="galCard ${gain ? 'up' : loss ? 'down' : 'flat'}" data-clip="${f.clip}"
        data-text="${c.text.replace(/"/g, '&quot;')}" data-amt="${head || f.id}"
        data-flavour="${f.id}"
        data-kind="${gain ? 'collect' : loss ? 'pay' : 'alert'}"${f.authored ? ' data-authored="1"' : ''}>
        <b>${head ? head : `<svg class="galMotif" viewBox="0 0 64 64" aria-hidden="true"><use href="#mf-${f.id}"/></svg>`}</b>
        <span>${c.text}</span>
        <em>${f.id} · ${f.clip}${f.authored ? '' : ' · auto'}</em></button>`;
    }).join('')}</div></div>`;
  $('galCardList').innerHTML = deck(b.chance, b.labels.chance) + deck(b.ledger, b.labels.ledger);
  $('galCardCount').textContent = (b.chance.length + b.ledger.length) + ' cards';
}

export async function openGallery(board) {
  if (board && BOARDS[board]) boardId = board;
  const el = $('gallery');
  el.hidden = false;
  nextFrame(() => el.classList.add('on'));
  if (!ready) {
    $('galStatus').textContent = 'Loading pieces…';
    await loadPieces();
    buildStage();
    renderClips();
    renderBoardTabs();
    renderCards();
    setPiece(0);
    fit();
    nextFrame(frame);
    addEventListener('resize', fit);

    $('galClips').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) play(b.dataset.clip);
    });
    $('galCardList').addEventListener('click', e => {
      const b = e.target.closest('.galCard');
      if (!b) return;
      play(b.dataset.clip);
      const prev = $('galPreview');
      prev.className = 'galPreview ' + b.dataset.kind;
      $('galPreviewAmt').textContent = b.dataset.amt;
      $('galPreviewText').textContent = b.dataset.text;
      prev.hidden = false;
    });
    $('galBoards').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      boardId = b.dataset.board;
      renderBoardTabs();
      renderCards();
      $('galPreview').hidden = true;
    });
    $('galPieces').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setPiece(+b.dataset.piece);
    });
    $('galClose').addEventListener('click', closeGallery);
    addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('gallery').hidden) closeGallery();
    });
    ready = true;
    $('galStatus').textContent = 'Drag to spin · Esc to close';
  }
  renderBoardTabs();
  renderCards();
  fit();
}

function closeGallery() {
  const el = $('gallery');
  el.classList.remove('on');
  setTimeout(() => { el.hidden = true; }, 300);
}
