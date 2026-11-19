// Smoke test: two clients, create / list / join / relay / leave. Run: npm test (starts its own server on :8099).
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const PORT = 8099;
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

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
  // host leaves → room closes
  a.ws.close();
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
  console.log('server test: OK');
} catch (e) {
  console.error('server test FAILED', e); process.exitCode = 1;
} finally { srv.kill(); }
