import { ICE_SERVERS, serverUrl } from './config';
import { profile } from './auth';
import { ADMIN } from '../game/ctx';

export interface Peer { id: number; uid: string; name: string; picture: string; google: boolean; slot: number; outfit: string }
export interface RoomInfo { code: string; name: string; public: boolean; state: 'lobby' | 'playing'; players: number; max: number; host: string; farm: string }

type Handler = (m: any) => void;

/**
 * Connection to the Porkour server: identity, rooms, chat, and game data.
 * Game data goes peer-to-peer (WebRTC data channel, host ↔ each player) when the browsers can reach each other,
 * otherwise through the server (relay). Both paths are ordered + reliable, so the sync layer doesn't care which.
 */
export class Online {
  ws: WebSocket | null = null;
  me: { uid: string; name: string; picture: string; google: boolean } | null = null;
  googleOnServer = false;
  room: RoomInfo | null = null;
  myId = 0; hostId = 0;
  peers = new Map<number, Peer>();
  rooms: RoomInfo[] = [];
  /** Round trip to the server (ms). */
  rtt = 0;
  private handlers = new Map<string, Set<Handler>>();
  private rtc = new Map<number, { pc: RTCPeerConnection; dc: RTCDataChannel | null; open: boolean }>();
  /** Game data from a peer (sync layer). */
  onData?: (from: number, data: Uint8Array) => void;
  /** A direct connection to this peer opened / closed. */
  onDirect?: (peer: number, open: boolean) => void;
  stats = { up: 0, down: 0, upRate: 0, downRate: 0, t: performance.now() };
  private pingTimer = 0;

  get isHost() { return !!this.room && this.myId === this.hostId; }
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  mySlot() { return this.peers.get(this.myId)?.slot ?? 0; }
  direct(peer: number) { return !!this.rtc.get(peer)?.open; }

  on(op: string, f: Handler) { if (!this.handlers.has(op)) this.handlers.set(op, new Set()); this.handlers.get(op)!.add(f); return () => this.handlers.get(op)!.delete(f); }
  private emit(op: string, m: any) { for (const f of this.handlers.get(op) ?? []) f(m); for (const f of this.handlers.get('*') ?? []) f(m); }

  /** Connect + say hello. Resolves with the welcome (or rejects: no server / unreachable / old version). */
  connect(outfit: string): Promise<void> {
    const url = serverUrl();
    if (!url) return Promise.reject(new Error('noserver'));
    if (this.connected && this.me) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { reject(new Error('unreachable')); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('timeout')); ws.close(); }, 75_000);   // free hosting wakes up slowly
      ws.onopen = () => {
        this.send({ op: 'hello', v: 1, name: profile.name, token: profile.google ? profile.token : undefined, outfit });
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') {
          const u8 = new Uint8Array(ev.data as ArrayBuffer);
          this.stats.down += u8.length;
          this.onData?.(u8[0], u8.subarray(1));
          return;
        }
        let m: any; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.op === 'welcome') { clearTimeout(timer); this.me = m.you; this.googleOnServer = !!m.googleEnabled; resolve(); }
        if (m.op === 'error' && m.code === 'version') { clearTimeout(timer); reject(new Error('version')); }
        this.control(m);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
      ws.onclose = () => {
        clearTimeout(timer);
        const wasIn = !!this.room;
        this.ws = null; this.me = null; this.room = null; this.peers.clear(); this.closeAllRtc();
        clearInterval(this.pingTimer);
        this.emit('disconnected', { op: 'disconnected', wasIn });
      };
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ op: 'ping', t: performance.now() }), 3000);
    });
  }

  send(m: object) { if (this.connected) this.ws!.send(JSON.stringify(m)); }

  private control(m: any) {
    switch (m.op) {
      case 'pong': this.rtt = performance.now() - m.t; break;
      case 'rooms': this.rooms = m.rooms; break;
      case 'joined':
        this.room = m.room; this.myId = m.you; this.hostId = m.host;
        this.peers.clear(); for (const p of m.peers) this.peers.set(p.id, p);
        this.closeAllRtc();
        if (!this.isHost) this.startRtc(this.hostId);
        break;
      case 'room': this.room = m.room; break;
      case 'peer_join': this.peers.set(m.peer.id, m.peer); break;
      case 'peer_update': this.peers.set(m.peer.id, m.peer); break;
      case 'peer_leave': this.peers.delete(m.id); this.closeRtc(m.id); break;
      case 'closed': case 'kicked': this.room = null; this.peers.clear(); this.closeAllRtc(); break;
      case 'signal': this.onSignal(m.from, m.data); break;
    }
    this.emit(m.op, m);
  }

  // ---------------------------------------------------------------- rooms
  list() { this.send({ op: 'list' }); }
  create(name: string, isPublic: boolean) { this.send({ op: 'create', name, public: isPublic }); }
  join(code: string) { this.send({ op: 'join', code }); }
  quick() { this.send({ op: 'quick' }); }
  leave() { this.send({ op: 'leave' }); this.room = null; this.peers.clear(); this.closeAllRtc(); }
  setRoom(m: { state?: 'lobby' | 'playing'; public?: boolean; name?: string }) { this.send({ op: 'room', ...m }); }
  kick(id: number) { this.send({ op: 'kick', id }); }
  chat(text: string) { this.send({ op: 'chat', text }); }
  setOutfit(outfit: string) { this.send({ op: 'outfit', outfit }); }
  setName(name: string) { this.send({ op: 'name', name }); }
  close() { this.ws?.close(); }

  // ---------------------------------------------------------------- game data
  /** Send to one peer (or 0 = everyone else). Direct when possible, else through the server. */
  sendData(to: number, payload: Uint8Array, now = false) {
    if (!now && ADMIN.netLag > 0) { setTimeout(() => this.sendData(to, payload, true), ADMIN.netLag); return; }
    if (to !== 0) {
      const r = this.rtc.get(to);
      if (r?.open && r.dc && r.dc.readyState === 'open') { r.dc.send(payload as Uint8Array<ArrayBuffer>); this.stats.up += payload.length; return; }
      this.relay(to, payload);
      return;
    }
    for (const id of this.peers.keys()) if (id !== this.myId) this.sendData(id, payload, true);
  }
  private relay(to: number, payload: Uint8Array) {
    if (!this.connected) return;
    const buf = new Uint8Array(payload.length + 1);
    buf[0] = to; buf.set(payload, 1);
    this.ws!.send(buf); this.stats.up += buf.length;
  }
  /** Updates the kB/s numbers (admin panel). */
  tickStats() {
    const now = performance.now(), dt = (now - this.stats.t) / 1000;
    if (dt < 1) return;
    this.stats.upRate = this.stats.up / dt / 1024; this.stats.downRate = this.stats.down / dt / 1024;
    this.stats.up = this.stats.down = 0; this.stats.t = now;
  }

  // ---------------------------------------------------------------- WebRTC (peer-to-peer) — players connect to the host
  private newPc(peer: number) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, dc: null as RTCDataChannel | null, open: false };
    this.rtc.set(peer, entry);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ op: 'signal', to: peer, data: { ice: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.closeRtc(peer); };
    setTimeout(() => { if (this.rtc.get(peer) === entry && !entry.open) this.closeRtc(peer); }, 12_000);   // no direct path: stay on the server
    return entry;
  }
  private wire(peer: number, entry: { pc: RTCPeerConnection; dc: RTCDataChannel | null; open: boolean }, dc: RTCDataChannel) {
    entry.dc = dc; dc.binaryType = 'arraybuffer';
    dc.onopen = () => { entry.open = true; this.onDirect?.(peer, true); this.emit('direct', { op: 'direct', peer, open: true }); };
    dc.onclose = () => { if (entry.open) { entry.open = false; this.onDirect?.(peer, false); } };
    dc.onmessage = (ev) => { const u8 = new Uint8Array(ev.data as ArrayBuffer); this.stats.down += u8.length; this.onData?.(peer, u8); };
  }
  private async startRtc(peer: number) {
    if (typeof RTCPeerConnection === 'undefined' || new URLSearchParams(location.search).get('p2p') === '0') return;
    const e = this.newPc(peer);
    this.wire(peer, e, e.pc.createDataChannel('game', { ordered: true }));
    try {
      await e.pc.setLocalDescription(await e.pc.createOffer());
      this.send({ op: 'signal', to: peer, data: { sdp: e.pc.localDescription } });
    } catch { this.closeRtc(peer); }
  }
  private async onSignal(from: number, data: any) {
    if (typeof RTCPeerConnection === 'undefined' || new URLSearchParams(location.search).get('p2p') === '0') return;
    try {
      if (data.sdp?.type === 'offer') {
        this.closeRtc(from);
        const e = this.newPc(from);
        e.pc.ondatachannel = (ev) => this.wire(from, e, ev.channel);
        await e.pc.setRemoteDescription(data.sdp);
        await e.pc.setLocalDescription(await e.pc.createAnswer());
        this.send({ op: 'signal', to: from, data: { sdp: e.pc.localDescription } });
      } else if (data.sdp?.type === 'answer') await this.rtc.get(from)?.pc.setRemoteDescription(data.sdp);
      else if (data.ice) await this.rtc.get(from)?.pc.addIceCandidate(data.ice);
    } catch { /* stays on the relay */ }
  }
  private closeRtc(peer: number) {
    const e = this.rtc.get(peer); if (!e) return;
    this.rtc.delete(peer);
    const was = e.open; e.open = false;
    try { e.dc?.close(); e.pc.close(); } catch { /* ignore */ }
    if (was) this.onDirect?.(peer, false);
  }
  private closeAllRtc() { for (const id of [...this.rtc.keys()]) this.closeRtc(id); }
}

export const online = new Online();
