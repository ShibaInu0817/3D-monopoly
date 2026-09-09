// Pure-ish game engine. All mutation happens through actions so a network
// transport can replay the same action list on every client later.
import { TILES, PIER_RENT, CHANCE, LEDGER, LABELS, CURRENCY, PLAYER_COLORS, START_CASH, PASS_START, JAIL_FEE, JAIL_TILE, cardFlavour } from './data.js';

const C = n => CURRENCY + n;

const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);

const U = () => (LABELS && LABELS.ui) || {};
const NT = (k, en, arg) => {
  const v = U()[k];
  if (v === undefined) return en;
  return typeof v === 'function' ? (Array.isArray(arg) ? v(...arg) : v(arg)) : v;
};

export function createGame(count = 4, opts = {}) {
  return {
    rapid: !!opts.rapid,
    players: Array.from({ length: count }, (_, i) => ({
      id: i, name: PLAYER_COLORS[i].name, cash: opts.cash > 0 ? opts.cash : START_CASH, pos: 0,
      jailTurns: 0, inJail: false, alive: true, piers: 0, works: 0, passes: 0,
    })),
    owner: new Array(40).fill(-1),
    houses: new Array(40).fill(0),   // 5 = lighthouse (hotel)
    turn: 0,
    dice: [1, 1],
    doubles: 0,
    phase: 'roll',                   // roll | resolve | end | over
    pending: null,
    chanceDeck: shuffle(CHANCE.map((c, i) => i)),
    ledgerDeck: shuffle(LEDGER.map((c, i) => i)),
    log: [],
    notices: [],
    winner: null,
  };
}

export const cur = s => s.players[s.turn];
export const tile = i => TILES[i];

export function notify(s, n) { s.notices.push(n); }

/** In rapid mode the salary decays by 50 on every lap, down to nothing. */
export function salaryFor(s, p) {
  if (!s.rapid) return PASS_START;
  return Math.max(0, PASS_START - p.passes * 50);
}

/** what the player would collect on their NEXT pass, for the HUD */
export function nextSalary(s, p) {
  if (!s.rapid) return PASS_START;
  return Math.max(0, PASS_START - p.passes * 50);
}

function say(s, text) {
  s.log.unshift({ text, turn: s.turn });
  if (s.log.length > 40) s.log.pop();
}

export function groupTiles(g) {
  return TILES.map((t, i) => [t, i]).filter(([t]) => t.kind === 'property' && t.group === g).map(([, i]) => i);
}

export function ownsGroup(s, playerId, g) {
  return groupTiles(g).every(i => s.owner[i] === playerId);
}

export function rentFor(s, i, roll) {
  const t = TILES[i], o = s.owner[i];
  if (o < 0) return 0;
  const owner = s.players[o];
  if (t.kind === 'pier') return PIER_RENT[Math.min(owner.piers, 4) - 1] || 0;
  if (t.kind === 'works') return roll * (owner.works >= 2 ? 10 : 4);
  const h = s.houses[i];
  let r = t.rent[h];
  if (h === 0 && ownsGroup(s, o, t.group)) r *= 2;
  return r;
}

/* ---------------- dice ---------------- */
/** `forced` lets a networked client replay the dice the acting player rolled. */
export function roll(s, forced) {
  const d1 = forced ? forced[0] : 1 + Math.floor(Math.random() * 6);
  const d2 = forced ? forced[1] : 1 + Math.floor(Math.random() * 6);
  s.dice = [d1, d2];
  const p = cur(s);
  const isDouble = d1 === d2;

  if (p.inJail) {
    if (isDouble) {
      p.inJail = false; p.jailTurns = 0;
      say(s, NT('logFreed', `${p.name} rolls doubles and is released.`, p.name));
      return { steps: d1 + d2, doubles: false, jailed: false };
    }
    p.jailTurns -= 1;
    if (p.jailTurns <= 0) {
      p.cash -= JAIL_FEE; p.inJail = false; p.jailTurns = 0;
      say(s, NT('logFee', `${p.name} pays the ${C(JAIL_FEE)} fee and is released next turn.`, [p.name, C(JAIL_FEE)]));
      checkBankrupt(s, p);
    } else {
      say(s, NT('logStays', `${p.name} stays at the ${LABELS.jail} (${p.jailTurns} turns left).`, [p.name, p.jailTurns]));
    }
    s.phase = 'end';
    return { steps: 0, doubles: false, jailed: true };
  }

  if (isDouble) {
    s.doubles += 1;
    if (s.doubles >= 3) {
      s.doubles = 0;
      sendToJail(s, p);
      return { steps: 0, doubles: false, jailed: true, teleport: JAIL_TILE };
    }
  } else s.doubles = 0;

  return { steps: d1 + d2, doubles: isDouble, jailed: false };
}

export function sendToJail(s, p) {
  p.pos = JAIL_TILE; p.inJail = true; p.jailTurns = 3;
  say(s, `${p.name} ${LABELS.jailLine}`);
  notify(s, { kind: 'alert', amount: 0, title: LABELS.jail, detail: LABELS.jailDetail, who: p.id });
  s.phase = 'end';
}

/* Returns the list of tile indices to hop through. */
export function pathFor(s, steps) {
  const p = cur(s), out = [];
  for (let k = 1; k <= steps; k++) out.push((p.pos + k) % 40);
  return out;
}

export function commitMove(s, target, { collectStart = true } = {}) {
  const p = cur(s);
  const passed = target < p.pos || (collectStart && target === 0 && p.pos !== 0);
  p.pos = target;
  if (passed && collectStart) {
    const wage = salaryFor(s, p);
    p.passes += 1;
    p.cash += wage;
    if (wage > 0) {
      say(s, NT('logPass', `${p.name} passes ${LABELS.start} and collects ${C(wage)}.`, [p.name, C(wage)]));
      notify(s, { kind: 'collect', amount: wage, title: NT('passing', 'Passing ' + LABELS.start, LABELS.start),
        detail: s.rapid ? 'Rapid mode — next lap pays ' + C(salaryFor(s, p)) + '.' : LABELS.startDetail, who: p.id });
    } else {
      say(s, NT('logDry', `${p.name} passes ${LABELS.start} — the payroll has run dry.`, p.name));
      notify(s, { kind: 'alert', amount: 0, title: NT('noPay', 'Payroll is empty'),
        detail: NT('noPayDetail', 'Rapid mode: no more salary from ' + LABELS.start + '.'), who: p.id });
    }
  }
}

/* ---------------- landing ---------------- */
export function resolveLanding(s) {
  const p = cur(s), i = p.pos, t = TILES[i];
  const rollSum = s.dice[0] + s.dice[1];
  s.pending = null;

  if (t.kind === 'property' || t.kind === 'pier' || t.kind === 'works') {
    const o = s.owner[i];
    if (o === -1) {
      if (p.cash >= t.price) {
        s.pending = { type: 'offer', tile: i };
        s.phase = 'resolve';
        notify(s, { kind: 'offer', amount: t.price, tile: i, title: t.name,
          detail: LABELS.buyDetail, who: p.id });
        return s.pending;
      }
      say(s, NT('logBroke', `${p.name} cannot afford ${t.name}.`, [p.name, t.name]));
    } else if (o !== p.id) {
      const amount = rentFor(s, i, rollSum);
      pay(s, p, s.players[o], amount);
      say(s, NT('logRent', `${p.name} pays ${C(amount)} to ${s.players[o].name} at ${t.name}.`, [p.name, C(amount), s.players[o].name, t.name]));
      notify(s, { kind: 'pay', amount, title: NT('rentAt', 'Rent due at ' + t.name, t.name), detail: NT('paidTo', 'Paid to ' + s.players[o].name, s.players[o].name), who: p.id, to: o });
    } else {
      say(s, NT('logOwn', `${p.name} rests on their own ${t.name}.`, [p.name, t.name]));
    }
  } else if (t.kind === 'tax') {
    p.cash -= t.amount;
    say(s, NT('logTax', `${t.name}: ${p.name} pays ${C(t.amount)}.`, [t.name, p.name, C(t.amount)]));
    notify(s, { kind: 'pay', amount: t.amount, title: t.name, detail: LABELS.taxDetail, who: p.id });
  } else if (t.kind === 'chance' || t.kind === 'ledger') {
    return drawCard(s, t.kind);
  } else if (t.kind === 'gotojail') {
    sendToJail(s, p);
    return { type: 'teleport', tile: JAIL_TILE };
  } else if (t.kind === 'start') {
    const wage = salaryFor(s, p);
    p.passes += 1;
    p.cash += wage;
    if (wage > 0) {
      say(s, NT('logLand', `${p.name} lands on ${LABELS.start} and collects ${C(wage)}.`, [p.name, C(wage)]));
      notify(s, { kind: 'collect', amount: wage, title: NT('landedOn', 'Landed on ' + LABELS.start, LABELS.start),
        detail: s.rapid ? 'Rapid mode — next lap pays ' + C(salaryFor(s, p)) + '.' : LABELS.startDetail, who: p.id });
    } else {
      say(s, NT('logLandDry', `${p.name} lands on ${LABELS.start} with nothing to collect.`, p.name));
      notify(s, { kind: 'alert', amount: 0, title: NT('noPay', 'Payroll is empty'),
        detail: NT('noPayDetail', 'Rapid mode: no more salary from ' + LABELS.start + '.'), who: p.id });
    }
  } else if (t.kind === 'rest') {
    say(s, `${p.name} ${LABELS.restLine}`);
  } else if (t.kind === 'jail') {
    say(s, `${p.name} ${LABELS.visitLine}`);
  }
  checkBankrupt(s, p);
  s.phase = s.phase === 'resolve' ? 'resolve' : 'end';
  return s.pending;
}

function drawCard(s, kind) {
  const deckKey = kind === 'chance' ? 'chanceDeck' : 'ledgerDeck';
  const list = kind === 'chance' ? CHANCE : LEDGER;
  const idx = s[deckKey].shift();
  s[deckKey].push(idx);
  const card = list[idx];
  const p = cur(s);
  const deckName = kind === 'chance' ? LABELS.chance : LABELS.ledger;
  say(s, `${deckName}: ${card.text}`);

  let delta = card.cash || 0;
  let assessed = null;
  if (card.cash) p.cash += card.cash;
  if (card.repairs) {
    // the bill is a sum over their whole portfolio, so carry which tiles paid it:
    // a total on its own never explains itself, and the board can ring them
    assessed = [];
    let owed = 0;
    s.owner.forEach((o, i) => {
      if (o !== p.id) return;
      const h = s.houses[i];
      if (!h) return;
      assessed.push(i);
      owed += h === 5 ? card.repairs[1] : h * card.repairs[0];
    });
    p.cash -= owed;
    delta -= owed;
  }
  const fl = cardFlavour(card);
  notify(s, { kind: delta > 0 ? 'collect' : delta < 0 ? 'pay' : 'alert', amount: Math.abs(delta),
    title: deckName, detail: card.text, who: p.id, card: true,
    deck: kind, flavour: fl.id, tone: fl.tone, tiles: assessed, act: card.act });
  checkBankrupt(s, p);
  s.phase = 'end';

  if (card.jail) { sendToJail(s, p); return { type: 'card', card, teleport: JAIL_TILE }; }
  if (card.move !== undefined) {
    const target = card.move;
    const passed = target <= p.pos;
    p.pos = target;
    if (passed) { p.cash += salaryFor(s, p); p.passes += 1; }
    return { type: 'card', card, teleport: target, thenResolve: true };
  }
  if (card.back) {
    p.pos = (p.pos - card.back + 40) % 40;
    return { type: 'card', card, teleport: p.pos, thenResolve: true };
  }
  return { type: 'card', card };
}

function pay(s, from, to, amount) {
  from.cash -= amount;
  if (to) to.cash += amount;
}

export function buy(s) {
  const p = cur(s), i = p.pos, t = TILES[i];
  p.cash -= t.price;
  s.owner[i] = p.id;
  if (t.kind === 'pier') p.piers += 1;
  if (t.kind === 'works') p.works += 1;
  say(s, NT('logBuys', `${p.name} buys ${t.name} for ${C(t.price)}.`, [p.name, t.name, C(t.price)]));
  s.pending = null;
  s.phase = 'end';
}

export function decline(s) {
  const p = cur(s);
  say(s, NT('logDeclines', `${p.name} passes on ${TILES[p.pos].name}.`, [p.name, TILES[p.pos].name]));
  s.pending = null;
  s.phase = 'end';
}

export function canBuild(s, i) {
  const t = TILES[i], p = cur(s);
  if (t.kind !== 'property' || s.owner[i] !== p.id) return false;
  if (!ownsGroup(s, p.id, t.group)) return false;
  if (s.houses[i] >= 5) return false;
  const g = groupTiles(t.group);
  const min = Math.min(...g.map(x => s.houses[x]));
  return s.houses[i] === min && p.cash >= t.houseCost;
}

export function build(s, i) {
  if (!canBuild(s, i)) return;
  const t = TILES[i], p = cur(s);
  p.cash -= t.houseCost;
  s.houses[i] += 1;
  say(s, NT('logBuilds', `${p.name} builds ${s.houses[i] === 5 ? LABELS.hotel : LABELS.house} on ${t.name}.`, [p.name, s.houses[i] === 5 ? LABELS.hotel : LABELS.house, t.name]));
}

export function canSell(s, i) {
  const t = TILES[i], p = cur(s);
  if (t.kind !== 'property' || s.owner[i] !== p.id || s.houses[i] === 0) return false;
  const g = groupTiles(t.group);
  return s.houses[i] === Math.max(...g.map(x => s.houses[x]));
}

export function sell(s, i) {
  if (!canSell(s, i)) return;
  const t = TILES[i], p = cur(s);
  s.houses[i] -= 1;
  p.cash += Math.round(t.houseCost / 2);
  say(s, NT('logSells', `${p.name} sells a building on ${t.name}.`, [p.name, t.name]));
}

function checkBankrupt(s, p) {
  if (p.cash >= 0 || !p.alive) return;
  // liquidate buildings automatically, then fold if still short
  let guard = 200;
  while (p.cash < 0 && guard-- > 0) {
    const withBuildings = s.owner.map((o, i) => i).filter(i => s.owner[i] === p.id && s.houses[i] > 0);
    if (!withBuildings.length) break;
    withBuildings.sort((a, b) => s.houses[b] - s.houses[a]);
    const i = withBuildings[0];
    s.houses[i] -= 1;
    p.cash += Math.round(TILES[i].houseCost / 2);
  }
  if (p.cash < 0) {
    notify(s, { kind: 'alert', amount: 0, title: NT('folded', p.name + ' has folded', p.name), detail: NT('foldedDetail', 'Every deed returns to the bank.'), who: p.id });
    p.alive = false;
    s.owner.forEach((o, i) => { if (o === p.id) { s.owner[i] = -1; s.houses[i] = 0; } });
    p.piers = 0; p.works = 0;
    say(s, NT('logOut', `${p.name} is out of the game.`, p.name));
  }
}

export function endTurn(s) {
  const p = cur(s);
  const again = s.doubles > 0 && !p.inJail && p.alive;
  const alive = s.players.filter(x => x.alive);
  if (alive.length === 1) { s.phase = 'over'; s.winner = alive[0]; return; }
  if (again) { s.phase = 'roll'; say(s, NT('logDoubles', `${p.name} rolled doubles — another turn.`, p.name)); return; }
  s.doubles = 0;
  let n = s.turn;
  do { n = (n + 1) % s.players.length; } while (!s.players[n].alive);
  s.turn = n;
  s.phase = 'roll';
}
