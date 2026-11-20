import { farmId } from '../world/farms';
import { ICE_SERVERS, serverUrl } from './config';
import { profile } from './auth';
import { ADMIN } from '../game/ctx';

export interface Peer { id: number; uid: string; name: string; picture: string; google: boolean; slot: number; outfit: string; away?: boolean }
export interface RoomInfo { code: string; name: string; public: boolean; state: 'lobby' | 'playing'; players: number; max: number; host: string; farm: string; save?: string }

type Handler = (m: any) => void;

/**
 * This browser tab's id (survives a reload of the tab, not shared with other tabs): when the page reloads onto the
 * room's farm, the server swaps the tab's old connection out instead of seating a "clone" of the player.
 */
export function tabId() {
  try {
    let id = sessionStorage.getItem('porkour.tab');
    if (!id) { id = newTabId(); sessionStorage.setItem('porkour.tab', id); }
    return id;
  } catch { return ''; }
}
const newTabId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
// "Duplicate tab" copies sessionStorage, id included: two live tabs with one id would keep taking each other's seat.
// Each tab asks on load; a tab already using that id answers, and the newcomer picks a fresh one.
try {
  const bc = new BroadcastChannel('porkour.tab');
  bc.onmessage = (e) => {
    const id = sessionStorage.getItem('porkour.tab');
    if (e.data?.q && e.data.q === id) bc.postMessage({ taken: id });
    else if (e.data?.taken && e.data.taken === id && !online.room) sessionStorage.setItem('porkour.tab', newTabId());
  };
  const mine = sessionStorage.getItem('porkour.tab');
  if (mine) bc.postMessage({ q: mine });
} catch { /* no BroadcastChannel: fine */ }

/**
 * Connection to the Porkour server: identity, rooms, chat, and game data.
 * Game data goes peer-to-peer (WebRTC data channel, host ↔ each player) when the browsers can reach each other,
 * otherwise through the server (relay). Both paths are ordered + reliable, so the sync layer doesn't care which.
 */
export class Online {
  ws: WebSocket | null = null;
  me: { uid: string; name: string; picture: string; google: boolean; owner?: boolean } | null = null;
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
  private outfit = '';
  /** Said goodbye on purpose (leave / reload): a close is not a drop. */
  private leaving = false;
  /** The server link dropped while in a room and we're getting it back. */
  reconnecting = false;
  private retryTimer = 0; private retryUntil = 0; private retryN = 0;

  get isHost() { return !!this.room && this.myId === this.hostId; }
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  mySlot() { return this.peers.get(this.myId)?.slot ?? 0; }
  direct(peer: number) { return !!this.rtc.get(peer)?.open; }

  on(op: string, f: Handler) { if (!this.handlers.has(op)) this.handlers.set(op, new Set()); this.handlers.get(op)!.add(f); return () => this.handlers.get(op)!.delete(f); }
  private emit(op: string, m: any) { for (const f of this.handlers.get(op) ?? []) f(m); for (const f of this.handlers.get('*') ?? []) f(m); }

  /** Connect + say hello. Resolves with the welcome (or rejects: no server / unreachable / old version). */
  connect(outfit: string): Promise<void> {
    this.outfit = outfit;
    if (!serverUrl()) return Promise.reject(new Error('noserver'));
    if (this.connected && this.me) return Promise.resolve();
    this.leaving = false;
    return this.dial(75_000);   // free hosting wakes up slowly
  }

  /** Open the socket + hello; resolves on the welcome. A drop later while in a room = reconnect (seat kept). */
  private dial(timeoutMs: number): Promise<void> {
    const url = serverUrl();
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { reject(new Error('unreachable')); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let done = false;
      const fail = (e: string) => { if (done) return; done = true; clearTimeout(timer); reject(new Error(e)); };
      const timer = setTimeout(() => { fail('timeout'); ws.close(); }, timeoutMs);
      ws.onopen = () => {
        this.send({ op: 'hello', v: 1, name: profile.name, token: profile.google ? profile.token : undefined, outfit: this.outfit, tab: tabId() });
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        if (typeof ev.data !== 'string') {
          const u8 = new Uint8Array(ev.data as ArrayBuffer);
          this.stats.down += u8.length;
          this.onData?.(u8[0], u8.subarray(1));
          return;
        }
        let m: any; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.op === 'welcome') { done = true; clearTimeout(timer); this.me = m.you; this.googleOnServer = !!m.googleEnabled; resolve(); }
        if (m.op === 'error' && m.code === 'version') { fail('version'); }
        this.control(m);
      };
      ws.onerror = () => fail('unreachable');
      ws.onclose = (ev) => {
        fail('unreachable');
        if (this.ws !== ws) return;   // an older socket
        if (ev.code === 4001) this.leaving = true;   // (our seat was taken by this same tab open twice: no reconnect)
        this.ws = null; this.me = null;
        clearInterval(this.pingTimer);
        // in a room and we didn't say goodbye: keep the seat, the game and the direct connections — reconnect
        if (this.room && !this.leaving) { this.lost(); return; }
        this.dropAll();
      };
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ op: 'ping', t: performance.now() }), 3000);
    });
  }
  private dropAll() {
    const wasIn = !!this.room;
    this.reconnecting = false; clearTimeout(this.retryTimer);
    this.room = null; this.peers.clear(); this.closeAllRtc();
    this.emit('disconnected', { op: 'disconnected', wasIn });
  }

  /** The link to the server dropped mid-room: try again (the server holds the seat ~40 s; the host brings the room
   *  back itself if the server restarted). Players connected peer-to-peer keep playing meanwhile. */
  private lost() {
    if (!this.reconnecting) {
      this.reconnecting = true; this.retryUntil = performance.now() + 50_000; this.retryN = 0;
      this.emit('reconnecting', { op: 'reconnecting' });
    }
    clearTimeout(this.retryTimer);
    if (performance.now() > this.retryUntil) { this.dropAll(); return; }
    const wait = Math.min(3000, 400 * 2 ** this.retryN++);
    this.retryTimer = window.setTimeout(() => {
      if (!this.reconnecting) return;
      this.dial(8000).then(() => this.rejoin(), () => { if (!this.ws) this.lost(); });
    }, wait);
  }
  private rejoin() {
    const r = this.room; if (!r) return;
    this.send({ op: 'rejoin', code: r.code, pid: this.myId, slot: this.mySlot(), host: this.isHost, farm: r.farm, state: r.state, name: r.name, public: r.public, save: r.save });
  }

  send(m: object) { if (this.connected) this.ws!.send(JSON.stringify(m)); }

  private control(m: any) {
    switch (m.op) {
      case 'pong': this.rtt = performance.now() - m.t; break;
      case 'rooms': this.rooms = m.rooms; break;
      case 'joined': {
        const back = this.reconnecting && this.room?.code === m.room.code;
        const had = [...this.peers.values()].map((p) => p.slot);
        this.room = m.room; this.myId = m.you; this.hostId = m.host;
        this.peers.clear(); for (const p of m.peers) this.peers.set(p.id, p);
        if (back) {
          // the same room again after a drop: direct connections that still work stay (the game never stopped on them)
          // (an open link to a player not back in the list yet — this server restarted — stays too)
          for (const [id, e] of [...this.rtc]) if (!e.open) this.closeRtc(id);
          if (!this.isHost && this.hostId && !this.rtc.has(this.hostId)) this.startRtc(this.hostId);
          this.reconnecting = false; clearTimeout(this.retryTimer);
          m.rejoined = true;
          // seats not (yet) in the room again (the server restarted: they're on their way back too)
          m.missing = had.filter((s) => ![...this.peers.values()].some((p) => p.slot === s));
        } else {
          this.closeAllRtc();
          if (!this.isHost && this.hostId) this.startRtc(this.hostId);   // (0 = the host is reloading onto a new farm: wait for it)
        }
        break;
      }
      case 'error':
        // a rejoin the server can't place yet (it restarted and the host hasn't brought the room back): try again
        if (m.rejoin && this.reconnecting) { clearTimeout(this.retryTimer); this.retryTimer = window.setTimeout(() => { if (performance.now() > this.retryUntil) { const w = this.ws; this.ws = null; w?.close(); this.dropAll(); } else this.rejoin(); }, 2000); return; }
        break;
      case 'host':   // the host is back (it switched farms)
        this.hostId = m.id;
        if (!this.isHost) { this.closeRtc(m.id); this.startRtc(m.id); }
        break;
      case 'room': this.room = m.room; break;
      case 'peer_join': case 'peer_update': case 'peer_back': this.peers.set(m.peer.id, m.peer); break;
      case 'peer_away': { const p = this.peers.get(m.id); if (p) p.away = true; break; }
      case 'peer_leave': this.peers.delete(m.id); this.closeRtc(m.id); break;
      case 'closed': case 'kicked': this.room = null; this.peers.clear(); this.closeAllRtc(); break;
      // this tab's seat was taken by the same tab id elsewhere (the tab duplicated): stop here, no reconnect war
      case 'replaced': this.leaving = true; this.reconnecting = false; clearTimeout(this.retryTimer); this.room = null; this.peers.clear(); this.closeAllRtc(); break;
      case 'signal': this.onSignal(m.from, m.data); break;
    }
    this.emit(m.op, m);
  }

  // ---------------------------------------------------------------- rooms
  list() { this.send({ op: 'list' }); }
  create(name: string, isPublic: boolean) { this.send({ op: 'create', name, public: isPublic, farm: farmId() }); }
  join(code: string) { this.send({ op: 'join', code }); }
  quick() { this.send({ op: 'quick', farm: farmId() }); }
  leave() { this.send({ op: 'leave' }); this.room = null; this.peers.clear(); this.closeAllRtc(); this.reconnecting = false; clearTimeout(this.retryTimer); }
  setRoom(m: { state?: 'lobby' | 'playing'; public?: boolean; name?: string; farm?: string; save?: string }) { if (m.farm && m.farm !== this.room?.farm) this.switching = true; this.send({ op: 'room', ...m }); }
  /** Host: the game's over — the whole room back to its lobby together (s26, user: "keep us together"). */
  regroup() { this.switching = true; this.send({ op: 'room', regroup: true }); }
  /** The host already sent everyone to a reload (farm switch / regroup). */
  private switching = false;
  kick(id: number) { this.send({ op: 'kick', id }); }
  chat(text: string) { this.send({ op: 'chat', text }); }
  setOutfit(outfit: string) { this.send({ op: 'outfit', outfit }); }
  setName(name: string) { this.send({ op: 'name', name }); }
  close() { this.leaving = true; this.reconnecting = false; clearTimeout(this.retryTimer); this.ws?.close(); }
  /** Leaving this page (a reload onto another farm, closing the tab): out of the room at once, no lingering clone. */
  bye() {
    this.leaving = true;
    // the host's page goes (F5, the tab closed by mistake): the room isn't closed on everyone — it goes back to its
    // lobby together and waits ~45 s for the host's tab to come back
    if (this.room && this.isHost && !this.switching) this.send({ op: 'room', regroup: true });
    if (this.room) this.send({ op: 'leave' });
    this.ws?.close();
  }
  /** Owner: who's online / give coins + levels. */
  users() { this.send({ op: 'users' }); }
  gift(to: number, coins: number, levels = 0) { this.send({ op: 'gift', to, coins, levels }); }
  grant(to: number, admin: boolean) { this.send({ op: 'grant', to, admin }); }

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
  /** Bytes still queued for that peer (its direct channel, or the server link for the relay). */
  backlog(to: number) {
    const r = this.rtc.get(to);
    if (r?.open && r.dc && r.dc.readyState === 'open') return r.dc.bufferedAmount;
    return this.ws?.bufferedAmount ?? 0;
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
    if (was) {
      this.onDirect?.(peer, false);
      // a player's direct link to the host broke mid-game (a network switch): the relay carries on, try direct again
      if (!this.isHost && peer === this.hostId && this.room && this.rtcRetries++ < 4) {
        const room = this.room.code;
        setTimeout(() => { if (this.room?.code === room && !this.isHost && this.hostId === peer && !this.rtc.has(peer)) this.startRtc(peer); }, 4000);
      }
    }
  }
  private rtcRetries = 0;
  private closeAllRtc() { for (const id of [...this.rtc.keys()]) this.closeRtc(id); }
}

export const online = new Online();
