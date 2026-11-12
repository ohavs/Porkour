// Porkour online server: player identity (Google sign-in or guest), rooms (public list, private codes,
// quick play) and a data relay between the players of a room. The game itself runs in the host's
// browser (host-authoritative): this server never simulates anything, it only matches and forwards.
//
// Protocol (WebSocket, see README.md):
//   text frames   JSON control messages {op: ...}
//   binary frames [u8 target peer id (0 = everyone else)] + payload  →  delivered as [u8 sender id] + payload
//
// Env: PORT (8080), GOOGLE_CLIENT_ID (enables verified Google accounts), ALLOWED_ORIGINS (comma list, optional).
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = Number(process.env.PORT || 8080);
// Public value (not a secret): the OAuth client id the game uses for "Sign in with Google" (web/src/net/config.ts).
const BUILT_IN_GOOGLE_CLIENT_ID = '';
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || BUILT_IN_GOOGLE_CLIENT_ID).trim();
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PLAYERS = 4;
const VERSION = 1;

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
/** code → room */
const rooms = new Map();
let nextConn = 1;

// ------------------------------------------------------------------ helpers
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (rooms.has(c));
  return c;
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
function send(ws, obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
const peerInfo = (ws) => ({ id: ws.pid, uid: ws.user.uid, name: ws.user.name, picture: ws.user.picture, google: ws.user.google, slot: ws.slot, outfit: ws.outfit });
function roomInfo(r) {
  const host = r.peers.get(r.hostId);
  return { code: r.code, name: r.name, public: r.public, state: r.state, players: r.peers.size, max: r.max, host: host?.user.name ?? '?', farm: r.farm };
}
function broadcast(r, obj, except) { for (const p of r.peers.values()) if (p !== except) send(p, obj); }
function publicRooms() {
  return [...rooms.values()].filter((r) => r.public && r.peers.size < r.max).map(roomInfo)
    .sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.players - a.players).slice(0, 50);
}

async function identify(m) {
  const guestName = clean(m.name, 16) || 'Pig';
  if (m.token && GOOGLE_CLIENT_ID) {
    try {
      const { payload } = await jwtVerify(String(m.token), googleKeys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: GOOGLE_CLIENT_ID,
      });
      return {
        uid: 'g:' + payload.sub, google: true,
        name: clean(m.name, 16) || clean(payload.given_name || payload.name, 16) || 'Pig',
        picture: typeof payload.picture === 'string' && payload.picture.startsWith('https://') ? payload.picture : '',
      };
    } catch (e) {
      return { uid: 'guest:' + crypto.randomUUID(), google: false, name: guestName, picture: '', error: 'auth' };
    }
  }
  return { uid: 'guest:' + crypto.randomUUID(), google: false, name: guestName, picture: '' };
}

function join(ws, r) {
  const used = new Set([...r.peers.values()].map((p) => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  let pid = 1; while (r.peers.has(pid)) pid++;
  ws.pid = pid; ws.slot = slot; ws.room = r;
  r.peers.set(pid, ws);
  if (!r.hostId) r.hostId = pid;
  send(ws, { op: 'joined', room: roomInfo(r), you: pid, host: r.hostId, peers: [...r.peers.values()].map(peerInfo) });
  broadcast(r, { op: 'peer_join', peer: peerInfo(ws) }, ws);
  broadcast(r, { op: 'room', room: roomInfo(r) }, ws);
}

function leave(ws, reason = 'left') {
  const r = ws.room; if (!r) return;
  ws.room = null;
  r.peers.delete(ws.pid);
  if (ws.pid === r.hostId || r.peers.size === 0) {
    // the game lives in the host's browser: no host, no game
    for (const p of r.peers.values()) { p.room = null; send(p, { op: 'closed', reason: 'host_left' }); }
    rooms.delete(r.code);
    return;
  }
  broadcast(r, { op: 'peer_leave', id: ws.pid, reason });
  broadcast(r, { op: 'room', room: roomInfo(r) });
}

function createRoom(ws, m) {
  const r = {
    code: newCode(), name: clean(m.name, 28) || `${ws.user.name}'s farm`, public: m.public !== false,
    max: Math.min(MAX_PLAYERS, Math.max(1, Number(m.max) || MAX_PLAYERS)), state: 'lobby', farm: clean(m.farm, 16) || 'farm1',
    peers: new Map(), hostId: 0, created: Date.now(),
  };
  rooms.set(r.code, r);
  join(ws, r);
}

// ------------------------------------------------------------------ control messages
async function control(ws, m) {
  if (m.op === 'ping') return send(ws, { op: 'pong', t: m.t });
  if (m.op === 'hello') {
    if (ws.user) return;
    if (m.v !== VERSION) return send(ws, { op: 'error', code: 'version' });
    ws.user = { pending: true };
    ws.outfit = typeof m.outfit === 'string' ? m.outfit.slice(0, 600) : '';
    ws.user = await identify(m);
    send(ws, { op: 'welcome', you: { uid: ws.user.uid, name: ws.user.name, picture: ws.user.picture, google: ws.user.google }, authError: ws.user.error, googleEnabled: !!GOOGLE_CLIENT_ID });
    return;
  }
  if (!ws.user || ws.user.pending) return send(ws, { op: 'error', code: 'hello' });
  const r = ws.room;
  switch (m.op) {
    case 'list': return send(ws, { op: 'rooms', rooms: publicRooms() });
    case 'create': if (r) leave(ws); return createRoom(ws, m);
    case 'join': {
      const room = rooms.get(clean(m.code, 4).toUpperCase());
      if (!room) return send(ws, { op: 'error', code: 'notfound' });
      if (room === r) return;
      if (room.peers.size >= room.max) return send(ws, { op: 'error', code: 'full' });
      if (r) leave(ws);
      return join(ws, room);
    }
    case 'quick': {
      if (r) leave(ws);
      const open = [...rooms.values()].filter((x) => x.public && x.peers.size < x.max)
        .sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.peers.size - a.peers.size)[0];
      return open ? join(ws, open) : createRoom(ws, { public: true });
    }
    case 'leave': return leave(ws);
    case 'room': {   // host changes the room (state lobby / playing, name, public)
      if (!r || r.hostId !== ws.pid) return;
      if (m.state === 'lobby' || m.state === 'playing') r.state = m.state;
      if (typeof m.public === 'boolean') r.public = m.public;
      if (m.name) r.name = clean(m.name, 28) || r.name;
      return broadcast(r, { op: 'room', room: roomInfo(r) });
    }
    case 'kick': {
      if (!r || r.hostId !== ws.pid) return;
      const p = r.peers.get(Number(m.id)); if (!p || p === ws) return;
      send(p, { op: 'kicked' }); leave(p, 'kicked');
      return;
    }
    case 'outfit': {
      ws.outfit = typeof m.outfit === 'string' ? m.outfit.slice(0, 600) : '';
      if (r) broadcast(r, { op: 'peer_update', peer: peerInfo(ws) });
      return;
    }
    case 'name': {
      ws.user.name = clean(m.name, 16) || ws.user.name;
      if (r) broadcast(r, { op: 'peer_update', peer: peerInfo(ws) });
      return;
    }
    case 'chat': {
      const text = clean(m.text, 160); if (!r || !text) return;
      return broadcast(r, { op: 'chat', from: ws.pid, name: ws.user.name, text });
    }
    // WebRTC signalling for the direct (peer-to-peer) connection: forwarded to one peer of the room
    case 'signal': {
      const p = r?.peers.get(Number(m.to)); if (!p) return;
      return send(p, { op: 'signal', from: ws.pid, data: m.data });
    }
  }
}

// ------------------------------------------------------------------ server
const server = http.createServer((req, res) => {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (req.url?.startsWith('/rooms')) { res.writeHead(200, headers); res.end(JSON.stringify(publicRooms())); return; }
  let players = 0; for (const r of rooms.values()) players += r.peers.size;
  res.writeHead(200, headers);
  res.end(JSON.stringify({ name: 'porkour-server', version: VERSION, rooms: rooms.size, players, google: !!GOOGLE_CLIENT_ID }));
});

const wss = new WebSocketServer({
  server, maxPayload: 256 * 1024,
  verifyClient: (info) => !ORIGINS.length || ORIGINS.includes(info.origin),
});

const DEBUG = !!process.env.DEBUG;
wss.on('connection', (ws, req) => {
  ws.cid = nextConn++;
  if (DEBUG) console.log('connect', ws.cid, req.headers.origin);
  ws.alive = true;
  ws.budget = 400; ws.budgetT = Date.now();
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (data, isBinary) => {
    // flood guard: ~400 messages per second
    const now = Date.now();
    ws.budget = Math.min(400, ws.budget + ((now - ws.budgetT) / 1000) * 400); ws.budgetT = now;
    if ((ws.budget -= 1) < 0) return;
    if (!isBinary) {
      if (data.length > 8192) return;
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (DEBUG && m?.op !== 'ping') console.log(ws.cid, m?.op);
      if (m && typeof m.op === 'string') control(ws, m).catch((e) => console.error('control', e));
      return;
    }
    const r = ws.room; if (!r || data.length < 2) return;
    const to = data[0];
    data[0] = ws.pid;
    if (to === 0) { for (const p of r.peers.values()) if (p !== ws && p.readyState === p.OPEN) p.send(data, { binary: true }); }
    else { const p = r.peers.get(to); if (p && p.readyState === p.OPEN) p.send(data, { binary: true }); }
  });
  ws.on('close', (code) => { if (DEBUG) console.log('close', ws.cid, code); leave(ws, 'left'); });
  ws.on('error', () => {});
});

// drop dead connections (closed laptops, lost Wi-Fi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000).unref();

server.listen(PORT, () => console.log(`porkour server on :${PORT} (google sign-in ${GOOGLE_CLIENT_ID ? 'on' : 'off'})`));
