// MQTT transport. Same contract as net.js: it moves ordered inputs between
// browsers and knows nothing about the game. The host is still the only orderer —
// every input, including the host's own, goes out numbered so all clients replay
// the same list in the same order and stay in lockstep.
//
// Messages
//   host  → guest : welcome | lobby | begin | input | bye | full
//   guest → host  : hello | intent | left
//
// Why a broker rather than peer-to-peer: WebRTC needs a TURN relay to cross NATs
// and every free one has been withdrawn, while the direct LAN path dies on any
// router that drops multicast DNS — which is what made this work between two tabs
// but not between two devices. Both devices can always open an outbound TLS
// connection, so that is what this uses. See net.js for the WebRTC transport,
// which becomes usable again if TURN credentials are ever added.

import mqttlib from 'mqtt';

// All three verified to accept anonymous connect + subscribe + publish over TLS.
// They are community brokers with no SLA, so we fail over rather than trust one.
const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
];
// Bumped whenever the wire format changes. Both pages are served from a CDN that
// caches for 10 minutes, so one device can easily be a version behind the other;
// without this the mismatch is silent and the join just never completes.
export const BUILD = 'mqtt-1';
const PREFIX = 'ipohmono/room/';
const JOIN_MS = 12000;      // how long a guest waits for the host to answer
const DIAL_MS = 7000;       // per-broker connect budget before trying the next

export const net = {
  mode: 'off',          // off | host | guest
  seat: 0,
  code: '',
  seats: [],            // [{seat, nick}]
  onLobby: null,
  onBegin: null,        // ({choice, state}) on a guest
  onInput: null,        // (input) on every client, in host order
  onStatus: null,       // (text) connection chatter for the lobby
};

let client = null, topic = '', seq = 0, me = '', maxSeats = 4;

const status = t => net.onStatus && net.onStatus(t);
const decode = buf => new TextDecoder().decode(buf);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const strip = seats => seats.map(({ seat, nick }) => ({ seat, nick }));

// Six characters, so a room topic cannot be walked by hand on a public broker.
function shortCode() {
  let s = '';
  while (s.length < 6) s += Math.random().toString(36).slice(2).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.slice(0, 6);
}

function pub(msg, retain) {
  if (!client) return;
  client.publish(topic, JSON.stringify({ ...msg, from: me }), { qos: 0, retain: !!retain });
}

// Try each broker in turn; the first that completes a CONNECT wins.
function dial(will) {
  return new Promise((res, rej) => {
    let i = 0;
    const next = () => {
      if (i >= BROKERS.length) {
        rej(new Error('Could not reach any message broker. Check the internet connection.'));
        return;
      }
      const url = BROKERS[i++];
      status('Connecting to ' + new URL(url).hostname + '…');
      let moved = false;
      const give = c => {                       // this attempt is over, one way or another
        if (moved) return;
        moved = true;
        try { c && c.end(true); } catch (e) { /* never opened */ }
        next();
      };
      let c;
      try {
        c = mqttlib.connect(url, {
          clientId: 'ipoh_' + me,
          clean: true,
          keepalive: 30,
          connectTimeout: DIAL_MS,
          reconnectPeriod: 2000,
          // stamped like pub() does: the host matches the sender id to a seat
          will: will ? { topic, payload: JSON.stringify({ ...will, from: me }), qos: 0, retain: false } : undefined,
        });
      } catch (e) { next(); return; }
      c.once('connect', () => { if (!moved) { moved = true; res(c); } });
      c.once('error', () => give(c));
      setTimeout(() => give(c), DIAL_MS);
    };
    next();
  });
}

const sub = () => new Promise((res, rej) => {
  client.subscribe(topic, { qos: 0 }, err => err ? rej(new Error('Could not subscribe to the room.')) : res());
});

/* ---------------- host ---------------- */
export async function createRoom(nick, maxPlayers) {
  me = uid();
  const code = shortCode();
  topic = PREFIX + code;                 // set before dial: the will needs it
  maxSeats = maxPlayers;
  client = await dial({ t: 'bye' });
  try { await sub(); } catch (err) { leave(); throw err; }
  net.mode = 'host';
  net.seat = 0;
  net.code = code;
  net.seats = [{ seat: 0, nick: nick || 'Host' }];
  client.on('message', onHostMsg);
  client.on('error', () => status('Broker connection lost — reconnecting…'));
  pubLobby();
  net.onLobby && net.onLobby(net.seats);
  return code;
}

// Retained, so a guest that subscribes later immediately sees the current seats.
const pubLobby = () => pub({ t: 'lobby', seats: strip(net.seats) }, true);

// The host tracks which client id owns which seat; guests never see the ids.
let owners = new Map();

function onHostMsg(_t, buf) {
  let m;
  try { m = JSON.parse(decode(buf)); } catch (e) { return; }
  if (!m || m.from === me) return;             // our own echo

  if (m.t === 'hello') {
    if (m.v !== BUILD) {                        // stale cached page on the other device
      pub({ t: 'badver', to: m.from, need: BUILD });
      status('A player is on an old version of the page');
      return;
    }
    let seat = owners.get(m.from);
    if (seat === undefined) {
      // lowest free seat, not seats.length — that collides once a middle seat is freed
      const taken = new Set(net.seats.map(x => x.seat));
      seat = 0;
      while (taken.has(seat)) seat++;
      if (seat >= maxSeats) { pub({ t: 'full', to: m.from }); return; }
      owners.set(m.from, seat);
      net.seats.push({ seat, nick: 'Player ' + (seat + 1) });
      net.seats.sort((a, b) => a.seat - b.seat);
    }
    const s = net.seats.find(x => x.seat === seat);
    if (s) s.nick = String(m.nick || s.nick).slice(0, 14);
    pub({ t: 'welcome', to: m.from, seat, seats: strip(net.seats) });
    pubLobby();
    net.onLobby && net.onLobby(net.seats);
    status((s ? s.nick : 'A player') + ' joined');
  }

  // a guest's Last Will fires when it drops without saying goodbye
  if (m.t === 'left') {
    const seat = owners.get(m.from);
    if (seat === undefined) return;
    owners.delete(m.from);
    net.seats = net.seats.filter(x => x.seat !== seat);
    pubLobby();
    net.onLobby && net.onLobby(net.seats);
    status('a player left');
  }

  // a guest asks; the host stamps the order and echoes to everyone
  if (m.t === 'intent') submit(m.input);
}

/* ---------------- guest ---------------- */
export async function joinRoom(code, nick) {
  me = uid();
  const shown = String(code).trim().toUpperCase();
  topic = PREFIX + shown;
  client = await dial({ t: 'left' });
  try { await sub(); } catch (err) { leave(); throw err; }
  net.mode = 'guest';
  net.code = shown;
  client.on('message', onGuestMsg);
  client.on('error', () => status('Broker connection lost — reconnecting…'));

  try {
    return await new Promise((res, rej) => {
      const t = setTimeout(() => {
        client.removeListener('message', probe);
        rej(new Error('No room ' + shown + '. Check the code, and that the host still has the page open.'));
      }, JOIN_MS);
      function probe(_t, buf) {
        let m;
        try { m = JSON.parse(decode(buf)); } catch (e) { return; }
        if (!m || m.from === me || (m.to && m.to !== me)) return;
        if (m.t === 'welcome') { clearTimeout(t); client.removeListener('message', probe); res(m.seat); }
        if (m.t === 'full') {
          clearTimeout(t); client.removeListener('message', probe);
          rej(new Error('That room is full.'));
        }
        if (m.t === 'badver') {
          clearTimeout(t); client.removeListener('message', probe);
          rej(new Error('This page is a different version from the host (' + BUILD +
            ' vs ' + m.need + '). Reload both devices, bypassing the cache.'));
        }
      }
      client.on('message', probe);
      // the host may still be settling its own subscription; say hello a few times
      pub({ t: 'hello', nick, v: BUILD });
      setTimeout(() => net.mode === 'guest' && pub({ t: 'hello', nick, v: BUILD }), 1200);
      setTimeout(() => net.mode === 'guest' && pub({ t: 'hello', nick, v: BUILD }), 4000);
    });
  } catch (err) { leave(); throw err; }
}

function onGuestMsg(_t, buf) {
  let m;
  try { m = JSON.parse(decode(buf)); } catch (e) { return; }
  if (!m || m.from === me || (m.to && m.to !== me)) return;
  if (m.t === 'full') { status('That room is full'); return; }
  if (m.t === 'welcome') { net.seat = m.seat; net.seats = m.seats; net.onLobby && net.onLobby(m.seats); }
  if (m.t === 'lobby') { net.seats = m.seats; net.onLobby && net.onLobby(m.seats); }
  if (m.t === 'begin') net.onBegin && net.onBegin(m);
  if (m.t === 'input') net.onInput && net.onInput(m.input);
  if (m.t === 'bye') status('The host closed the room');
}

/* ---------------- shared ---------------- */
export function broadcast(msg) { pub(msg); }

/** Any client's input goes through here. Host applies + fans out; guest asks the host. */
export function submit(input) {
  if (net.mode === 'off') { net.onInput && net.onInput(input); return; }
  if (net.mode === 'host') {
    const stamped = { ...input, seq: seq++ };
    pub({ t: 'input', input: stamped });
    net.onInput && net.onInput(stamped);       // our own echo is filtered, so apply here
  } else {
    pub({ t: 'intent', input });
  }
}

export function beginGame(choice, state) {
  pub({ t: 'begin', choice, state });
}

export function isMySeat(turn) {
  return net.mode === 'off' || turn === net.seat;
}

export function leave() {
  if (client) {
    if (net.mode === 'host') {
      pub({ t: 'bye' });
      try { client.publish(topic, '', { qos: 0, retain: true }); } catch (e) { /* going away anyway */ }
    } else if (net.mode === 'guest') {
      pub({ t: 'left' });
    }
  }
  try { client && client.end(true); } catch (e) { /* already gone */ }
  client = null; topic = ''; seq = 0; me = ''; owners = new Map();
  net.mode = 'off'; net.seat = 0; net.code = ''; net.seats = [];
}
