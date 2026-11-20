// Smoke test: two clients, create / list / join / relay / leave. Run: npm test (starts its own server on :8099).
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const PORT = 8099;
async function startServer() {
  const p = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), GRACE_MS: '1500', SWITCH_MS: '1500' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => p.stdout.once('data', r));
  return p;
}
let srv = await startServer();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** A connected + greeted client with a tab id. */
async function hello(name, tab) { const c = client(); await c.open; c.send({ op: 'hello', v: 1, name, tab }); await c.next('welcome'); return c; }

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d, bin) => {
    const m = bin ? { op: 'bin', data: d } : JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.op === m.op);
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else inbox.push(m);
  });
  const next = (op) => {
    const i = inbox.findIndex((m) => m.op === op);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((res, rej) => { waiters.push({ op, res }); setTimeout(() => rej(new Error('timeout ' + op)), 3000); });
  };
  const send = (m) => ws.send(JSON.stringify(m));
  return { ws, next, send, open: new Promise((r) => ws.on('open', r)) };
}

try {
  const a = client(), b = client();
  await Promise.all([a.open, b.open]);
  a.send({ op: 'hello', v: 1, name: 'Alice<script>' }); b.send({ op: 'hello', v: 1, name: 'Bob', token: 'bad' });
  const wa = await a.next('welcome'), wb = await b.next('welcome');
  assert.equal(wa.you.name, 'Alicescript'); assert.equal(wb.you.google, false);
  a.send({ op: 'create', name: 'Test farm', public: true });
  const ja = await a.next('joined');
  assert.equal(ja.you, 1); assert.equal(ja.host, 1); assert.equal(ja.peers[0].slot, 0);
  b.send({ op: 'list' });
  const list = await b.next('rooms');
  assert.equal(list.rooms.length, 1); assert.equal(list.rooms[0].code, ja.room.code);
  b.send({ op: 'join', code: ja.room.code.toLowerCase() });
  const jb = await b.next('joined');
  assert.equal(jb.you, 2); assert.equal(jb.peers.find((p) => p.id === 2).slot, 1);
  const pj = await a.next('peer_join'); assert.equal(pj.peer.name, 'Bob');
  // binary relay: b → host (1)
  b.ws.send(Buffer.from([1, 42, 43]));
  const bin = await a.next('bin'); assert.deepEqual([...bin.data], [2, 42, 43]);
  // broadcast from host
  a.ws.send(Buffer.from([0, 7]));
  const bin2 = await b.next('bin'); assert.deepEqual([...bin2.data], [1, 7]);
  a.send({ op: 'chat', text: 'hi' }); assert.equal((await b.next('chat')).text, 'hi');
  a.send({ op: 'room', state: 'playing' }); assert.equal((await b.next('room')).room.state, 'playing');
  a.send({ op: 'room', save: '💾 2 · ★★☆☆☆<b>' }); assert.equal((await b.next('room')).room.save, '💾 2 · ★★☆☆☆b');   // the host's story save, shown to the players
  b.send({ op: 'join', code: 'ZZZZ' }); assert.equal((await b.next('error')).code, 'notfound');
  // host leaves (says goodbye) → room closes
  a.send({ op: 'leave' }); a.ws.close();
  assert.equal((await b.next('closed')).reason, 'host_left');
  b.send({ op: 'list' }); assert.equal((await b.next('rooms')).rooms.length, 0);
  // quick play creates a room when none is open
  b.send({ op: 'quick' }); assert.equal((await b.next('joined')).you, 1);
  b.ws.close();
  // a tab that reloads (same tab id) replaces its lingering old connection: no clone, same seat
  const h = client(), p1 = client();
  await Promise.all([h.open, p1.open]);
  h.send({ op: 'hello', v: 1, name: 'Host', tab: 'tabH' }); p1.send({ op: 'hello', v: 1, name: 'Pl', tab: 'tabP' });
  await h.next('welcome'); await p1.next('welcome');
  h.send({ op: 'create', name: 'R', public: false, farm: 'farm1' });
  const jh = await h.next('joined');
  p1.send({ op: 'join', code: jh.room.code }); assert.equal((await p1.next('joined')).peers.length, 2);
  const p2 = client(); await p2.open;   // the same tab after a reload (p1 still open = the ghost)
  p2.send({ op: 'hello', v: 1, name: 'Pl', tab: 'tabP' }); await p2.next('welcome');
  p2.send({ op: 'join', code: jh.room.code });
  const j2 = await p2.next('joined');
  assert.equal(j2.peers.length, 2, 'the ghost is gone'); assert.equal(j2.peers.find((x) => x.id === j2.you).slot, 1, 'same seat');
  // the host switches farms: its page reloads, the room waits, it comes back as host in seat 0
  h.send({ op: 'room', farm: 'farm3' });
  assert.equal((await p2.next('room')).room.farm, 'farm3');
  h.ws.close();
  await new Promise((r) => setTimeout(r, 200));
  const h2 = client(); await h2.open;
  h2.send({ op: 'hello', v: 1, name: 'Host', tab: 'tabH' }); await h2.next('welcome');
  h2.send({ op: 'join', code: jh.room.code });
  const jh2 = await h2.next('joined');
  assert.equal(jh2.host, jh2.you, 'host again'); assert.equal(jh2.peers.find((x) => x.id === jh2.you).slot, 0);
  assert.equal((await p2.next('host')).id, jh2.you);
  // the game is over: the host regroups the room — every page reloads, the room waits, all back in its lobby together
  h2.send({ op: 'room', state: 'playing' }); await p2.next('room');
  h2.send({ op: 'room', regroup: true });
  let rg = await p2.next('room'); for (let k = 0; k < 4 && !rg.regroup; k++) rg = await p2.next('room');
  assert.equal(rg.regroup, true); assert.equal(rg.room.state, 'lobby');
  h2.ws.close(); p2.ws.close();
  await new Promise((r) => setTimeout(r, 200));
  const p3 = client(), h3 = client(); await Promise.all([p3.open, h3.open]);
  p3.send({ op: 'hello', v: 1, name: 'Pl', tab: 'tabP' }); await p3.next('welcome');
  p3.send({ op: 'join', code: jh.room.code }); assert.equal((await p3.next('joined')).room.state, 'lobby', 'the player is back in the room first');
  h3.send({ op: 'hello', v: 1, name: 'Host', tab: 'tabH' }); await h3.next('welcome');
  h3.send({ op: 'join', code: jh.room.code });
  const jh3 = await h3.next('joined'); assert.equal(jh3.host, jh3.you, 'host again after the regroup');
  // only the owner may give coins
  p3.send({ op: 'users' }); p3.send({ op: 'gift', to: 1, coins: 100 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h3.ws.readyState, 1);
  h3.ws.close(); p3.ws.close(); p1.ws.close();
  // ---- two regroups / farm switches in a row (within the wait): the first one's timer must not close the room
  {
    const H = await hello('Host', 'sH'), A = await hello('A', 'sA');
    H.send({ op: 'create', name: 'Twice', public: false, farm: 'farm1' });
    const code = (await H.next('joined')).room.code;
    A.send({ op: 'join', code }); await A.next('joined');
    H.send({ op: 'room', regroup: true }); H.send({ op: 'leave' }); H.ws.close();
    await wait(300);
    const H2 = await hello('Host', 'sH'); H2.send({ op: 'join', code }); assert.equal((await H2.next('joined')).host, 1);
    await wait(500);
    H2.send({ op: 'room', farm: 'farm2' }); H2.send({ op: 'leave' }); H2.ws.close();
    await wait(1200);   // the first wait ends here (1.5 s after the first regroup) — the host is away again
    const H3 = await hello('Host', 'sH'); H3.send({ op: 'join', code });
    const j3 = await H3.next('joined'); assert.equal(j3.room.code, code, 'the room survived'); assert.equal(j3.host, j3.you);
    for (const c of [H3, A]) { c.send({ op: 'leave' }); c.ws.close(); }
  }
  // ---- reconnects: a dropped connection keeps its seat (GRACE_MS 1.5 s here), the same tab takes it back
  {
    const H = await hello('Host', 'tH'), A = await hello('A', 'tA'), B = await hello('B', 'tB'), C = await hello('C', 'tC');
    H.send({ op: 'create', name: 'Four', public: true, farm: 'farm2' });
    const jH = await H.next('joined'), code = jH.room.code;
    for (const c of [A, B, C]) { c.send({ op: 'join', code }); await c.next('joined'); }
    H.send({ op: 'room', state: 'playing' }); await A.next('room');
    const D = await hello('D', 'tD'); D.send({ op: 'join', code }); assert.equal((await D.next('error')).code, 'full', '5th player: full');
    // B's Wi-Fi drops: everyone hears it's away, its seat stays
    B.ws.terminate();
    const pa = await H.next('peer_away'); assert.equal(pa.host, false);
    D.send({ op: 'join', code }); assert.equal((await D.next('error')).code, 'full', 'the dropped seat is held');
    const B2 = await hello('B', 'tB'); B2.send({ op: 'rejoin', code, pid: pa.id, slot: 2 });
    const jb2 = await B2.next('joined');
    assert.equal(jb2.you, pa.id, 'same id'); assert.equal(jb2.back, true); assert.equal(jb2.room.state, 'playing');
    const pb = await H.next('peer_back'); assert.equal(pb.peer.id, pa.id); assert.equal(pb.fresh, false);
    await A.next('peer_away'); await A.next('peer_back');
    // relay still works to the seat it took back
    H.ws.send(Buffer.from([pa.id, 9])); assert.deepEqual([...(await B2.next('bin')).data], [1, 9]);
    // the HOST drops: the room waits, the host's tab comes back as host
    H.ws.terminate();
    assert.equal((await A.next('peer_away')).host, true);
    const H2 = await hello('Host', 'tH'); H2.send({ op: 'rejoin', code, pid: 1, slot: 0, host: true, farm: 'farm2', state: 'playing' });
    const jh2 = await H2.next('joined'); assert.equal(jh2.you, 1); assert.equal(jh2.host, 1, 'still the host');
    assert.equal((await A.next('peer_back')).peer.id, 1);
    // C never comes back: after the grace its seat frees up
    C.ws.terminate(); await H2.next('peer_away');
    assert.equal((await H2.next('peer_leave')).reason, 'lost');
    // the server restarts (a deploy, a crash): the host brings its room back with the same code, players their seats
    srv.kill(); await wait(300); srv = await startServer();
    const H3 = await hello('Host', 'tH');
    const A2 = await hello('A', 'tA'); A2.send({ op: 'rejoin', code, pid: 2, slot: 1 });
    assert.equal((await A2.next('error')).code, 'notfound', 'a player first: not there yet (it retries)');
    H3.send({ op: 'rejoin', code, pid: 1, slot: 0, host: true, farm: 'farm2', state: 'playing', name: 'Four', public: true });
    const jh3 = await H3.next('joined'); assert.equal(jh3.room.code, code); assert.equal(jh3.room.state, 'playing'); assert.equal(jh3.room.farm, 'farm2'); assert.equal(jh3.you, 1);
    A2.send({ op: 'rejoin', code, pid: 2, slot: 1 });
    const ja2 = await A2.next('joined'); assert.equal(ja2.you, 2); assert.equal(ja2.host, 1); assert.equal(ja2.peers.find((x) => x.id === 2).slot, 1);
    // a player can't grab the host's seat or make a room by "rejoining"
    const E = await hello('E', 'tE'); E.send({ op: 'rejoin', code: 'QQQQ', pid: 1, slot: 0 }); assert.equal((await E.next('error')).code, 'notfound');
    E.send({ op: 'rejoin', code, pid: 1, slot: 0 }); const je = await E.next('joined'); assert.notEqual(je.you, 1); assert.notEqual(je.peers.find((x) => x.id === je.you).slot, 0);
    for (const c of [H3, A2, E, D, A, B2, H2]) c.ws.close();
  }
  console.log('server test: OK');
} catch (e) {
  console.error('server test FAILED', e); process.exitCode = 1;
} finally { srv.kill(); }
