// Porkour online server: player identity (Google sign-in or guest), rooms (public list, private codes,
// quick play) and a data relay between the players of a room. The game itself runs in the host's
// browser (host-authoritative): this server never simulates anything, it only matches and forwards.
//
// Protocol (WebSocket, see README.md):
//   text frames   JSON control messages {op: ...}
//   binary frames [u8 target peer id (0 = everyone else)] + payload  →  delivered as [u8 sender id] + payload
//
// Env: PORT (8080), GOOGLE_CLIENT_ID (enables verified Google accounts), ALLOWED_ORIGINS (comma list, optional),
//      EARLY_ACCESS=0 (anyone may play online, no tester code needed).
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = Number(process.env.PORT || 8080);
// Public value (not a secret): the OAuth client id the game uses for "Sign in with Google" (web/src/net/config.ts).
const BUILT_IN_GOOGLE_CLIENT_ID = '186251969828-09ngofot9gbr3p951dmm2ad88oo9upum.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || BUILT_IN_GOOGLE_CLIENT_ID).trim();
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PLAYERS = 4;
const VERSION = 1;
// The owner account(s) (all coins / levels, can give coins to anyone): only the SHA-256 of the e-mail is kept here
// (this repo is public). More owners: OWNER_EMAIL_SHA256 (comma list of hex hashes of lower-case e-mails).
const OWNER_HASHES = new Set(['6b8626b254d97cb0dc01f56029abc7abdef3970048c91128372a16eb24910923',
  ...(process.env.OWNER_EMAIL_SHA256 || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)]);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Early access (user 2026-11-25): online play only with a tester code (or the owner's Google account). Same list as
// web/src/net/access.ts (only SHA-256 fingerprints: this repo is public; `npm test` checks both lists match).
// Take a code back = delete its line in both. EARLY_ACCESS=0 (Render env var) = open to everyone.
const EARLY_ACCESS = process.env.EARLY_ACCESS !== '0';
const ACCESS = new Map([
  ['758eb059da3a18befc77cf934c5442f7283188855975fb2de21597e12b182797', 1],
  ['045c05787c0f42f26c0b80f17234603211ee2ffcc8c48452836a38c10425edd3', 2],
  ['1bdb2ac98d442122e83c862f2cd57b2e9905c1f1fd44fad95af4d2f19ca605a1', 3],
  ['d05272cf4349f7ef094b5e725ab18cffa57137c5c9e461530f15afd4d4f87a46', 4],
  ['a0b3813afb8d15ab014b939213901433d4438283adee8a848e40452039526041', 5],
  ['9272aa07e89d84ecca3ed82055b961e441aaa9dbd7b5014bdf50e17876180a82', 6],
  ['f91209e0ee0b9bb94ff6d57f98db43a08ea408b2f111de445dd56a4db9e953f1', 7],
  ['c622a3ed9ae63d216f5b4454802d382e6aecbd2585191fda18bdda4e43080667', 8],
  ['08ee29b0b7da1ed213d0d0649353a2512ef8bc2d21c6260a83b2ce2956b49ca1', 9],
  ['ce5bc6bf5de4b1fbfc1b092a1b999da06a3e7e722eb15594df19e646ed934622', 10],
  ['ea16531352d6772005f76219d79ddfcc8384a86b2da0055f935319476c4b0910', 11],
  ['bb6b033b12273273b6f832101073ebe9fc29e9010ee4da132f25f9d764d85776', 12],
]);
/** The tester number of a code (0 = not a code). */
const testerOf = (code) => {
  const c = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  return c.length >= 8 ? ACCESS.get(sha256('porkour-early-access:' + c)) ?? 0 : 0;
};
/** A host switching farms reloads its page: the room waits this long (ms) for it to come back. */
const SWITCH_GRACE = Number(process.env.SWITCH_MS || 45000);
/** A connection that drops without saying goodbye (Wi-Fi blip, a laptop lid, a phone switching networks, this server
 *  restarting) keeps its seat this long: the same tab coming back takes it again (same id, same pig). The host too —
 *  the game lives in its browser, and players connected peer-to-peer keep playing meanwhile. */
const GRACE = Number(process.env.GRACE_MS || 40000);
/** A player whose connection can't keep up: relayed game data is dropped past this backlog (it asks for a fresh
 *  snapshot once it catches up) instead of piling up seconds of lag. */
const BACKLOG = 256 * 1024;

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
const peerInfo = (ws) => ({ id: ws.pid, uid: ws.user.uid, name: ws.user.name, picture: ws.user.picture, google: ws.user.google, slot: ws.slot, outfit: ws.outfit, away: !!ws.gone });
function roomInfo(r) {
  const host = r.peers.get(r.hostId);
  return { code: r.code, name: r.name, public: r.public, state: r.state, players: r.peers.size, max: r.max, host: host?.user.name ?? '?', farm: r.farm, save: r.save ?? '' };
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
      const email = typeof payload.email === 'string' && payload.email_verified !== false ? payload.email.toLowerCase() : '';
      return {
        uid: 'g:' + payload.sub, google: true, owner: !!email && OWNER_HASHES.has(sha256(email)),
        name: clean(m.name, 16) || clean(payload.given_name || payload.name, 16) || 'Pig',
        picture: typeof payload.picture === 'string' && payload.picture.startsWith('https://') ? payload.picture : '',
      };
    } catch (e) {
      return { uid: 'guest:' + crypto.randomUUID(), google: false, name: guestName, picture: '', error: 'auth' };
    }
  }
  return { uid: 'guest:' + crypto.randomUUID(), google: false, name: guestName, picture: '' };
}

function join(ws, r, want = {}, fresh = true) {
  // the same browser tab again: its connection dropped (it reconnects) or its page reloaded while the old connection
  // lingers — it takes its own seat back (same id, same slot, same pig; still the host if it was): no "clone"
  const old = ws.tab ? [...r.peers.values()].find((p) => p !== ws && p.tab === ws.tab) : null;
  if (old) {
    // (if that old connection is still alive — the same tab open twice — it's told so and doesn't fight back)
    clearTimeout(old.graceTimer); old.room = null; send(old, { op: 'replaced' });
    try { old.close(4001, 'replaced'); } catch { /* gone */ }
    setTimeout(() => { try { old.terminate(); } catch { /* gone */ } }, 2000);
    ws.pid = old.pid; ws.slot = old.slot; ws.room = r;
    r.peers.set(ws.pid, ws);
    send(ws, { op: 'joined', room: roomInfo(r), you: ws.pid, host: r.hostId, peers: [...r.peers.values()].map(peerInfo), back: true });
    broadcast(r, { op: 'peer_back', peer: peerInfo(ws), fresh }, ws);
    if (fresh && ws.pid === r.hostId) broadcast(r, { op: 'host', id: ws.pid }, ws);   // a new page: new direct connections
    broadcast(r, { op: 'room', room: roomInfo(r) }, ws);
    return;
  }
  // the host is away switching farms: its tab gets seat 0 back and becomes the host again; seat 0 waits for it
  const returning = !r.hostId && r.hostTab && ws.tab === r.hostTab;
  const used = new Set([...r.peers.values()].map((p) => p.slot));
  const wSlot = Number(want.slot), wPid = Number(want.pid);
  let slot = returning ? 0 : !r.hostId && r.hostTab ? 1 : 0; while (used.has(slot)) slot++;
  // (the room came back after a server restart: everyone asks for the seat they had)
  if (Number.isInteger(wSlot) && wSlot >= 0 && wSlot < r.max && !used.has(wSlot) && (wSlot !== 0 || !r.hostTab || returning || want.host)) slot = wSlot;
  let pid = 1; while (r.peers.has(pid)) pid++;
  if (Number.isInteger(wPid) && wPid > 0 && wPid < 250 && !r.peers.has(wPid)) pid = wPid;
  ws.pid = pid; ws.slot = slot; ws.room = r;
  r.peers.set(pid, ws);
  if (returning || (!r.hostId && !r.hostTab)) { r.hostId = pid; r.hostTab = ws.tab; r.switchUntil = 0; }
  send(ws, { op: 'joined', room: roomInfo(r), you: pid, host: r.hostId, peers: [...r.peers.values()].map(peerInfo) });
  broadcast(r, { op: 'peer_join', peer: peerInfo(ws) }, ws);
  if (returning) broadcast(r, { op: 'host', id: pid }, ws);
  broadcast(r, { op: 'room', room: roomInfo(r) }, ws);
}
/** The connection dropped without a goodbye: the seat waits GRACE for the same tab to come back. */
function away(ws) {
  const r = ws.room; if (!r || ws.gone) return;
  ws.gone = Date.now();
  broadcast(r, { op: 'peer_away', id: ws.pid, host: ws.pid === r.hostId }, ws);
  ws.graceTimer = setTimeout(() => { if (ws.room === r) leave(ws, 'lost'); }, GRACE);
}
function closeRoom(r, reason) {
  for (const p of r.peers.values()) { p.room = null; send(p, { op: 'closed', reason }); }
  rooms.delete(r.code);
}

function leave(ws, reason = 'left') {
  const r = ws.room; if (!r) return;
  ws.room = null; clearTimeout(ws.graceTimer);
  r.peers.delete(ws.pid);
  // the host is switching farms (its page reloads): the room waits for it
  if (r.switchUntil > Date.now() && (ws.pid === r.hostId || !r.hostId)) {
    if (ws.pid === r.hostId) {
      r.hostId = 0;
      // (only if the host is still away when THIS wait ends: an earlier switch's timer must not close the room during a
      // later one — two farm switches / regroups within 45 s closed the room on everyone)
      setTimeout(() => { if (!r.hostId && Date.now() >= r.switchUntil - 100 && rooms.get(r.code) === r) closeRoom(r, 'host_left'); }, r.switchUntil - Date.now());
    }
    broadcast(r, { op: 'peer_leave', id: ws.pid, reason });
    return;
  }
  if (ws.pid === r.hostId || r.peers.size === 0 || ![...r.peers.values()].some((p) => !p.gone)) {
    // the game lives in the host's browser: no host, no game
    closeRoom(r, 'host_left');
    return;
  }
  broadcast(r, { op: 'peer_leave', id: ws.pid, reason });
  broadcast(r, { op: 'room', room: roomInfo(r) });
}

function createRoom(ws, m, code = newCode(), want = {}) {
  const r = {
    code, name: clean(m.name, 28) || `${ws.user.name}'s farm`, public: m.public !== false,
    max: Math.min(MAX_PLAYERS, Math.max(1, Number(m.max) || MAX_PLAYERS)), state: m.state === 'playing' ? 'playing' : 'lobby', farm: clean(m.farm, 16) || 'farm1',
    peers: new Map(), hostId: 0, created: Date.now(), save: typeof m.save === 'string' ? clean(m.save, 40) : '',
  };
  rooms.set(r.code, r);
  join(ws, r, want, false);
}

// ------------------------------------------------------------------ control messages
async function control(ws, m) {
  if (m.op === 'ping') return send(ws, { op: 'pong', t: m.t });
  if (m.op === 'hello') {
    if (ws.user) return;
    if (m.v !== VERSION) return send(ws, { op: 'error', code: 'version' });
    ws.user = { pending: true };
    ws.outfit = typeof m.outfit === 'string' ? m.outfit.slice(0, 600) : '';
    ws.tab = clean(m.tab, 40);
    ws.user = await identify(m);
    ws.user.tester = testerOf(m.access);
    if (EARLY_ACCESS && !ws.user.owner && !ws.user.tester) {
      ws.user = null;
      send(ws, { op: 'error', code: 'access' });
      setTimeout(() => { try { ws.close(4003, 'access'); } catch { /* gone */ } }, 300);
      return;
    }
    send(ws, { op: 'welcome', you: { uid: ws.user.uid, name: ws.user.name, picture: ws.user.picture, google: ws.user.google, owner: !!ws.user.owner }, authError: ws.user.error, googleEnabled: !!GOOGLE_CLIENT_ID });
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
      const mine = ws.tab && [...room.peers.values()].some((p) => p.tab === ws.tab);   // (its own seat, held for it)
      if (!mine && room.peers.size >= room.max) return send(ws, { op: 'error', code: 'full' });
      if (r) leave(ws);
      return join(ws, room);
    }
    case 'quick': {
      if (r) leave(ws);
      const open = [...rooms.values()].filter((x) => x.public && x.peers.size < x.max)
        .sort((a, b) => (a.state === 'lobby' ? 0 : 1) - (b.state === 'lobby' ? 0 : 1) || b.peers.size - a.peers.size)[0];
      return open ? join(ws, open) : createRoom(ws, { public: true, farm: m.farm });
    }
    case 'rejoin': {   // the connection dropped and came back: the same seat (or the room itself, if this server restarted)
      const code = clean(m.code, 4).toUpperCase();
      let room = rooms.get(code);
      const want = { pid: m.pid, slot: m.slot, host: m.host === true };
      if (!room && m.host === true && /^[A-Z]{4}$/.test(code)) { if (r) leave(ws); return createRoom(ws, m, code, want); }
      if (!room) return send(ws, { op: 'error', code: 'notfound', rejoin: true });
      if (room === r) return;
      const mine = ws.tab && [...room.peers.values()].some((p) => p.tab === ws.tab);
      if (!mine && room.peers.size >= room.max) return send(ws, { op: 'error', code: 'full', rejoin: true });
      if (r) leave(ws);
      return join(ws, room, want, false);
    }
    case 'leave': return leave(ws);
    case 'room': {   // host changes the room (state lobby / playing, name, public, farm, story save label)
      if (!r || r.hostId !== ws.pid) return;
      if (m.state === 'lobby' || m.state === 'playing') r.state = m.state;
      // another farm: every page (the host's too) reloads onto it; the room waits for the host to come back
      if (typeof m.farm === 'string' && /^farm\d{1,2}$/.test(m.farm) && m.farm !== r.farm) { r.farm = m.farm; r.state = 'lobby'; r.hostTab = ws.tab; r.switchUntil = Date.now() + SWITCH_GRACE; }
      // the game is over: everyone back to the room's lobby together (every page reloads; the room waits for the host)
      if (m.regroup === true) { r.state = 'lobby'; r.hostTab = ws.tab; r.switchUntil = Date.now() + SWITCH_GRACE; }
      if (typeof m.public === 'boolean') r.public = m.public;
      if (m.name) r.name = clean(m.name, 28) || r.name;
      if (typeof m.save === 'string') r.save = clean(m.save, 40);   // the host's story save ("💾 2 · ★★☆☆☆"), shown to the players
      return broadcast(r, { op: 'room', room: roomInfo(r), regroup: m.regroup === true || undefined });
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
    // the owner: who's online, and coins / levels for anyone of them
    case 'users': {
      if (!ws.user.owner) return;
      const users = [...wss.clients].filter((c) => c.user && !c.user.pending).map((c) => ({ id: c.cid, name: c.user.name, google: c.user.google, tester: c.user.tester || 0, room: c.room?.code ?? '', me: c === ws }));
      return send(ws, { op: 'users', users });
    }
    case 'gift': {
      if (!ws.user.owner) return;
      const to = [...wss.clients].find((c) => c.cid === Number(m.to) && c.user && !c.user.pending);
      if (!to) return send(ws, { op: 'error', code: 'nouser' });
      const coins = Math.max(0, Math.min(1e7, Math.round(Number(m.coins) || 0))), levels = Math.max(0, Math.min(50, Math.round(Number(m.levels) || 0)));
      send(to, { op: 'gift', coins, levels, from: ws.user.name });
      return send(ws, { op: 'gifted', to: to.cid, name: to.user.name, coins, levels });
    }
    case 'grant': {   // the owner lets someone use the admin mode (or takes it back): their browser keeps it
      if (!ws.user.owner) return;
      const to = [...wss.clients].find((c) => c.cid === Number(m.to) && c.user && !c.user.pending);
      if (!to) return send(ws, { op: 'error', code: 'nouser' });
      send(to, { op: 'grant', admin: !!m.admin, from: ws.user.name });
      return send(ws, { op: 'granted', to: to.cid, name: to.user.name, admin: !!m.admin });
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
  res.end(JSON.stringify({ name: 'porkour-server', version: VERSION, rooms: rooms.size, players, google: !!GOOGLE_CLIENT_ID, access: EARLY_ACCESS, at: process.env.RENDER_SERVICE_NAME || '' }));
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
    const ok = (p) => p.readyState === p.OPEN && p.bufferedAmount < BACKLOG;
    if (to === 0) { for (const p of r.peers.values()) if (p !== ws && ok(p)) p.send(data, { binary: true }); }
    else { const p = r.peers.get(to); if (p && ok(p)) p.send(data, { binary: true }); }
  });
  ws.on('close', (code) => { if (DEBUG) console.log('close', ws.cid, code); away(ws); });
  ws.on('error', () => {});
});

// drop dead connections (closed laptops, lost Wi-Fi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000).unref();

server.listen(PORT, () => console.log(`porkour server on :${PORT} (google sign-in ${GOOGLE_CLIENT_ID ? 'on' : 'off'}, early access ${EARLY_ACCESS ? 'on' : 'off'})`));
