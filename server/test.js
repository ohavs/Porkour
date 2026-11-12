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
  b.send({ op: 'join', code: 'ZZZZ' }); assert.equal((await b.next('error')).code, 'notfound');
  // host leaves → room closes
  a.ws.close();
  assert.equal((await b.next('closed')).reason, 'host_left');
  b.send({ op: 'list' }); assert.equal((await b.next('rooms')).rooms.length, 0);
  // quick play creates a room when none is open
  b.send({ op: 'quick' }); assert.equal((await b.next('joined')).you, 1);
  b.ws.close();
  console.log('server test: OK');
} catch (e) {
  console.error('server test FAILED', e); process.exitCode = 1;
} finally { srv.kill(); }
