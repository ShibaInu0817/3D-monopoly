// PeerJS transport. Knows nothing about the game: it moves ordered inputs
// between browsers. The host is the only orderer — every input, including the
// host's own, goes out as a numbered message so all clients replay the same
// list in the same order and stay in lockstep.
//
// Messages
//   host → guest : welcome | lobby | begin | input | bye
//   guest → host : hello | intent

const PEERJS = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'ipohmono-';

export const net = {
  mode: 'off',          // off | host | guest
  seat: 0,
  code: '',
  seats: [],            // [{seat, nick, ready}]
  onLobby: null,
  onBegin: null,        // ({choice, state}) on a guest
  onInput: null,        // (input) on every client, in host order
  onStatus: null,       // (text) connection chatter for the lobby
};

let peer = null, conns = [], hostConn = null, seq = 0;

function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PEERJS;
    s.onload = res;
    s.onerror = () => rej(new Error('PeerJS unavailable'));
    document.head.appendChild(s);
  });
}

const status = t => net.onStatus && net.onStatus(t);
const shortCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();

/* ---------------- host ---------------- */
export async function createRoom(nick, maxPlayers) {
  await loadPeer();
  if (!window.RTCPeerConnection) throw new Error('This browser or frame has WebRTC disabled.');
  if (window.self !== window.top) {
    throw new Error('Open the game in its own browser tab — peer-to-peer is blocked inside an embedded preview frame.');
  }
  const code = shortCode();
  if (location.protocol === 'file:') {
    throw new Error('Peer-to-peer needs a web address: serve the folder over http(s) instead of opening the file directly.');
  }
  peer = new window.Peer(PREFIX + code, { debug: 1 });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('The connection broker did not respond.')), 15000);
      peer.on('open', () => { clearTimeout(t); res(); });
      peer.on('error', e => {
        if (e.type === 'peer-unavailable') return;   // a guest left; the room is fine
        clearTimeout(t); rej(new Error(explain(e)));
      });
    });
  } catch (err) {
    leave();                       // never leave the page in a half-connected mode
    throw err;
  }
  net.mode = 'host';
  net.seat = 0;
  net.code = code;
  net.seats = [{ seat: 0, nick: nick || 'Host' }];
  peer.on('connection', c => {
    if (net.seats.length >= maxPlayers) { c.on('open', () => { c.send({ t: 'full' }); c.close(); }); return; }
    const seat = net.seats.length;
    net.seats.push({ seat, nick: 'Player ' + (seat + 1) });
    conns.push(c);
    c.on('data', m => {
      if (m.t === 'hello') {
        const s = net.seats.find(x => x.seat === seat);
        if (s) s.nick = String(m.nick || s.nick).slice(0, 14);
        c.send({ t: 'welcome', seat, seats: net.seats });
        broadcast({ t: 'lobby', seats: net.seats });
        net.onLobby && net.onLobby(net.seats);
        status(s.nick + ' joined');
      }
      // a guest asks; the host stamps the order and echoes to everyone
      if (m.t === 'intent') submit(m.input);
    });
    c.on('close', () => {
      conns = conns.filter(x => x !== c);
      net.seats = net.seats.filter(x => x.seat !== seat);
      broadcast({ t: 'lobby', seats: net.seats });
      net.onLobby && net.onLobby(net.seats);
      status('a player left');
    });
  });
  net.onLobby && net.onLobby(net.seats);
  return code;
}

/* ---------------- guest ---------------- */
const REASON = {
  'peer-unavailable': 'No room with that code — check it and that the host still has the page open.',
  'unavailable-id': 'That room code is already in use. Create a new room.',
  'browser-incompatible': 'This browser cannot do peer-to-peer connections.',
  'network': 'Cannot reach the connection broker. Check the internet connection.',
  'server-error': 'The connection broker is down. Try again shortly.',
  'ssl-unavailable': 'Peer-to-peer needs https — open the game over http(s), not as a local file.',
  'webrtc': 'WebRTC is blocked in this browser or by an extension.',
};
const explain = e => REASON[e && e.type] || (e && e.message) || 'Connection failed';

export async function joinRoom(code, nick) {
  await loadPeer();
  if (!window.RTCPeerConnection) throw new Error('This browser or frame has WebRTC disabled.');
  if (window.self !== window.top) {
    throw new Error('Open the game in its own browser tab — peer-to-peer is blocked inside an embedded preview frame.');
  }
  if (location.protocol === 'file:') {
    throw new Error('Peer-to-peer needs a web address: serve the folder over http(s) instead of opening the file directly.');
  }
  peer = new window.Peer({ debug: 1 });
  let peerErr = null;
  peer.on('error', e => { peerErr = e; status(explain(e)); });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('The connection broker did not respond.')), 15000);
      peer.on('open', () => { clearTimeout(t); res(); });
      peer.on('error', e => { if (e.type !== 'peer-unavailable') { clearTimeout(t); rej(new Error(explain(e))); } });
    });
  } catch (err) { leave(); throw err; }

  // a room registered a moment ago may not be resolvable yet: retry before giving up
  const target = PREFIX + String(code).trim().toUpperCase();
  let c = null;
  for (let attempt = 0; attempt < 4 && !c; attempt++) {
    peerErr = null;
    const tryConn = peer.connect(target, { reliable: true });
    const ok = await new Promise(res => {
      const t = setTimeout(() => res(false), 4000);
      tryConn.on('open', () => { clearTimeout(t); res(true); });
      tryConn.on('error', () => { clearTimeout(t); res(false); });
      const poll = setInterval(() => {
        if (peerErr && peerErr.type === 'peer-unavailable') { clearInterval(poll); clearTimeout(t); res(false); }
      }, 120);
      setTimeout(() => clearInterval(poll), 4200);
    });
    if (ok) c = tryConn;
    else { try { tryConn.close(); } catch (e) { /* never opened */ }
      status('Retrying… (' + (attempt + 1) + '/4)');
      await new Promise(r => setTimeout(r, 900)); }
  }
  if (!c) {
    leave();
    // the broker answered (we got an id) but the room never did
    throw new Error(peerErr ? explain(peerErr)
      : 'Reached the connection broker but not room ' + String(code).toUpperCase() +
        '. Check the code, that the host still has their page open, and that both pages are ' +
        'real browser tabs — an embedded preview frame usually blocks peer-to-peer.');
  }
  hostConn = c;
  net.mode = 'guest';
  c.send({ t: 'hello', nick });
  c.on('data', m => {
    if (m.t === 'full') { status('That room is full'); return; }
    if (m.t === 'welcome') { net.seat = m.seat; net.seats = m.seats; net.onLobby && net.onLobby(m.seats); }
    if (m.t === 'lobby') { net.seats = m.seats; net.onLobby && net.onLobby(m.seats); }
    if (m.t === 'begin') net.onBegin && net.onBegin(m);
    if (m.t === 'input') net.onInput && net.onInput(m.input);
    if (m.t === 'bye') status('The host closed the room');
  });
  c.on('close', () => status('Disconnected from the host'));
  return net.seat;
}

/* ---------------- shared ---------------- */
export function broadcast(msg) {
  conns.forEach(c => { try { c.send(msg); } catch (e) { /* dropped peer */ } });
}

/** Any client's input goes through here. Host applies + fans out; guest asks the host. */
export function submit(input) {
  if (net.mode === 'off') { net.onInput && net.onInput(input); return; }
  if (net.mode === 'host') {
    const stamped = { ...input, seq: seq++ };
    broadcast({ t: 'input', input: stamped });
    net.onInput && net.onInput(stamped);
  } else if (hostConn) {
    hostConn.send({ t: 'intent', input });
  }
}

export function beginGame(choice, state) {
  broadcast({ t: 'begin', choice, state });
}

export function isMySeat(turn) {
  return net.mode === 'off' || turn === net.seat;
}

export function leave() {
  if (net.mode === 'host' && conns.length) broadcast({ t: 'bye' });
  try { peer && peer.destroy(); } catch (e) { /* already gone */ }
  peer = null; conns = []; hostConn = null; seq = 0;
  net.mode = 'off'; net.seat = 0; net.code = ''; net.seats = [];
}
