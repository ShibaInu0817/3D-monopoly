import * as THREE from 'three';
import { BoardView, makeToken, makeDie, TOP } from './game/board3d.js';
import { PLAYER_COLORS } from './game/data.js';

const stage = document.querySelector('three-d-stage');
await stage.ready;

const board = new BoardView();
const g = new THREE.Group();
g.name = 'isla_verde_set';
g.add(board.group);

board.setOwner(1, PLAYER_COLORS[0].hex);
board.setOwner(3, PLAYER_COLORS[0].hex);
board.setBuildings(1, 3);
board.setBuildings(3, 5);
board.setOwner(6, PLAYER_COLORS[1].hex);
board.setBuildings(6, 1);
board.setOwner(16, PLAYER_COLORS[2].hex);
board.setBuildings(16, 4);

PLAYER_COLORS.forEach((c, i) => {
  const t = makeToken(c.hex, 'token_' + c.name.toLowerCase());
  t.position.copy(board.tokenSpot([0, 7, 23, 34][i], i));
  g.add(t);
});
const d1 = makeDie('die_a'), d2 = makeDie('die_b');
d1.position.set(-0.08, TOP + 0.026, 0.2);
d2.position.set(0.02, TOP + 0.026, 0.26);
g.add(d1, d2);

stage.setObject(g);
