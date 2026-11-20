import { online, type Peer, type RoomInfo } from './online';
import { ui } from '../game/uiIcons';
import { profile, onProfile, googleEnabled, renderGoogleButton, refreshToken, setGuestName, signOut } from './auth';
import { serverUrl } from './config';
import { t, lang, onLang, type Key } from '../i18n';
import { G } from '../game/ctx';
import { SETTINGS, saveSettings } from '../game/settings';
import type { Game } from '../game/game';
import { asFarm, farmId, reloadOnFarm, onBeforeReload } from '../world/farms';
import { receiveGift, ownerPerks } from '../game/shop';
import { setAdminGrant } from './auth';
import { PLAYER_COLORS } from '../game/game';

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
type View = 'connecting' | 'error' | 'browse' | 'room' | 'joining' | 'switching';

/**
 * Online lobby (title screen → "Play online"): who you are (Google or guest name), quick play, public room list,
 * create a room (public / private), join with a 4-letter code or an invite link (?room=CODE), then the room:
 * players + pig colours, chat, host starts the game. Players can also join a game already running.
 */
export class Lobby {
  private el: HTMLElement;
  private view: View = 'connecting';
  private err = '';
  private chat: { name: string; text: string; sys?: boolean }[] = [];
  private listTimer = 0;
  private inGame = false;
  private pendingCode = '';
  isOpen = false;

  /** In a room that hasn't started: the party plays on the lobby stage (the game is already online). */
  private preGame = false;
  get inRoom() { return !!online.room && this.preGame && !this.inGame; }

  constructor(private game: Game, private opts: { start: () => void; wardrobe: () => void; outfit: () => string; onRoom: () => void }) {
    this.el = document.getElementById('lobby')!;
    online.on('*', (m) => this.onMsg(m));
    // leaving this page (a reload onto the room's farm): out of the room first, so the server doesn't seat a clone
    onBeforeReload(() => online.bye());
    addEventListener('pagehide', () => online.bye());
    onProfile(() => this.onProfileChange());
    onLang(() => { if (this.isOpen) this.render(); });
  }

  open(code = '') {
    if (this.inRoom) { this.opts.onRoom(); return; }   // in a room: the party panel on the lobby screen is the room
    this.isOpen = true;
    this.pendingCode = code.toUpperCase();
    this.el.classList.add('show');
    this.connect();
  }
  /** Esc: back to the title (not while in a room: leaving it takes the Back button). */
  escape() { if (!online.room) this.action('back'); }
  close() { this.isOpen = false; this.el.classList.remove('show'); clearInterval(this.listTimer); }

  private async connect() {
    if (!serverUrl()) { this.view = 'error'; this.err = 'noserver'; this.render(); return; }
    if (online.connected && online.me) { this.afterConnect(); return; }
    this.view = 'connecting'; this.render();
    if (profile.google) await refreshToken();
    try {
      await online.connect(this.opts.outfit());
      this.afterConnect();
    } catch (e) {
      this.view = 'error'; this.err = (e as Error).message; this.render();
    }
  }
  private afterConnect() {
    if (this.pendingCode) { online.join(this.pendingCode); this.pendingCode = ''; this.view = 'joining'; this.render(); return; }
    if (online.room) { this.view = 'room'; this.render(); return; }
    this.browse();
  }
  private browse() {
    this.view = 'browse'; online.list(); this.render();
    clearInterval(this.listTimer);
    this.listTimer = window.setInterval(() => { if (this.view === 'browse' && this.isOpen) online.list(); }, 4000);
  }

  private async onProfileChange() {
    if (!this.isOpen) { if (online.room) online.setName(profile.name); return; }
    // signed in / out: say hello again with the new identity (only outside a room)
    if (online.connected && !online.room) { online.close(); await new Promise((r) => setTimeout(r, 100)); this.connect(); }
    else { if (online.room) online.setName(profile.name); this.render(); }
  }

  // ---------------------------------------------------------------- server messages
  private onMsg(m: any) {
    const g = this.game;
    switch (m.op) {
      case 'rooms': if (this.view === 'browse') this.renderRooms(); break;
      case 'joined': {
        if (m.rejoined) { if (this.inGame || this.preGame) { g.hud.toast(t('net.reconnected'), 1.6); g.holdSeats(m.missing ?? [], 30); if (online.isHost && g.net && 'needKey' in g.net) for (const id of online.peers.keys()) if (id !== online.myId) g.net.needKey.add(id); g.syncPeers(); } if (this.inRoom) this.opts.onRoom(); if (m.room.state !== 'playing' || this.inGame) break; }
        else this.chat = [];
        // the room plays another farm than the one this page built: reload on it, straight back into the room
        const rf = asFarm(m.room.farm);
        if (rf && rf !== farmId()) { this.view = 'switching'; this.render(); setTimeout(() => reloadOnFarm(rf, { room: m.room.code }), 300); break; }
        if (m.room.state === 'playing') this.enterGame();   // late join: straight into the running game
        else this.enterRoom();
        break;
      }
      case 'room': {
        // the host ended the game: every page (the host's too) reloads straight back into the room's lobby, together
        if (m.regroup && online.room && (this.inGame || this.preGame)) { g.hud.toast(t('net.regroup'), 3); const code = online.room.code; setTimeout(() => reloadOnFarm(farmId(), { room: code }), 700); break; }
        // the host picked another farm: every page (the host's too) reloads onto it, straight back into the room
        const rf = asFarm(online.room?.farm ?? '');
        if (rf && rf !== farmId() && (this.preGame || this.inGame)) { g.hud.toast(t('net.switching'), 3); setTimeout(() => reloadOnFarm(rf, { room: online.room!.code }), 600); break; }
        if (online.room?.state === 'playing' && !this.inGame && !online.isHost) this.enterGame();
        else if (this.inRoom) this.opts.onRoom();
        break;
      }
      case 'welcome': if (m.you?.owner && ownerPerks()) this.opts.onRoom(); break;
      case 'gift': {   // the owner gave me coins / levels
        receiveGift(Number(m.coins) || 0, Number(m.levels) || 0);
        g.hud.toast(`🎁 ${esc(String(m.from ?? ''))}: +${Number(m.coins) || 0} <i class="coin"></i>${m.levels ? ` · +${m.levels} ⭐` : ''}`, 4);
        this.opts.onRoom();
        break;
      }
      case 'grant': setAdminGrant(!!m.admin); g.hud.toast(`${m.admin ? '🛠️' : '🚫'} ${esc(String(m.from ?? ''))}`, 3); break;
      case 'granted': g.hud.toast(`${m.admin ? '🛠️' : '🚫'} → ${esc(String(m.name ?? ''))}`, 2.5); break;
      case 'gifted': g.hud.toast(`🎁 → ${esc(String(m.name ?? ''))}: +${m.coins} <i class="coin"></i>${m.levels ? ` · +${m.levels} ⭐` : ''}`, 2.5); break;
      case 'host': if (online.isHost && this.preGame && g.net && 'needKey' in g.net) for (const id of online.peers.keys()) if (id !== online.myId) (g.net as { needKey: Set<number> }).needKey.add(id); break;
      case 'peer_join':
        if (this.inGame || this.preGame) { g.syncPeers(); if (online.isHost && g.net && 'needKey' in g.net) g.net.needKey.add(m.peer.id); }
        if (this.inGame) g.hud.toast(t('net.joined', { name: esc(m.peer.name) }), 1.6);
        else { this.chat.push({ name: '', text: t('net.joined', { name: m.peer.name }), sys: true }); this.opts.onRoom(); }
        break;
      case 'peer_leave': {
        if (this.inGame || this.preGame) g.peerLeft(m.id);
        if (this.inGame) g.hud.toast(t('net.left'), 1.4); else this.opts.onRoom();
        break;
      }
      case 'peer_update': if (this.inGame || this.preGame) g.syncPeers(); if (!this.inGame) this.opts.onRoom(); break;
      // connection blips (the seat is held ~40 s): who dropped, who's back, my own link
      case 'reconnecting': if (this.inGame || this.preGame) g.hud.toast(t('net.reconnecting'), 50); break;
      case 'peer_away': {
        const p = online.peers.get(m.id);
        if (this.inGame) g.hud.toast(m.host ? t('net.hostAway') : t('net.peerAway', { name: esc(p?.name ?? '') }), m.host ? 6 : 2.5);
        else if (this.preGame) this.opts.onRoom();
        break;
      }
      case 'peer_back':
        if (this.inGame || this.preGame) {
          // the same seat again: a reloaded page starts its inputs over (fresh), a reconnect just needs a full snapshot
          if (online.isHost && g.net && 'needKey' in g.net) { if (m.fresh) g.peerLeft(m.peer.id); g.net.needKey.add(m.peer.id); }
          g.syncPeers();
          if (this.inGame) g.hud.toast(t('net.peerBack', { name: esc(m.peer.name) }), 1.6); else this.opts.onRoom();
        }
        break;
      case 'chat':
        this.chat.push({ name: m.name, text: m.text });
        if (this.chat.length > 60) this.chat.shift();
        if (this.inGame) g.hud.toast('', 3, `<b>${esc(m.name)}:</b> ${esc(m.text)}`);
        else this.renderChat();
        break;
      case 'error':
        if (this.view === 'joining') this.view = 'browse';
        this.err = m.code; this.render();
        setTimeout(() => { this.err = ''; if (this.view === 'browse') this.render(); }, 4000);
        break;
      case 'closed': case 'kicked': case 'disconnected': case 'replaced':
        if (this.preGame && !this.inGame) { g.hud.toast(t(m.op === 'kicked' ? 'net.kicked' : m.op === 'replaced' ? 'net.replaced' : 'net.closed'), 3); setTimeout(() => { location.href = location.pathname; }, 1500); break; }
        if (this.inGame) { g.hud.toast(t(m.op === 'kicked' ? 'net.kicked' : m.op === 'replaced' ? 'net.replaced' : 'net.closed'), 3); setTimeout(() => backToLobby(), 2500); }
        else if (m.op === 'disconnected') { this.view = 'error'; this.err = 'unreachable'; if (this.isOpen) this.render(); }
        else { this.err = m.op === 'kicked' ? 'kicked' : 'closed'; this.browse(); }
        break;
      case 'direct': if (this.view === 'room') this.render(); break;
    }
  }

  /** Host pressed Start / player joins a running game. */
  private startAsHost() {
    online.setRoom({ state: 'playing' });
    this.enterGame();
  }
  /** Joined a room that hasn't started: online right away, the party on the lobby stage, the menu closes. */
  /** The room's code in the address bar: a reload (F5) — the host's too — comes straight back into the room. */
  private markUrl() {
    try {
      const u = new URL(location.href);
      if (online.room && (u.searchParams.get('room') !== online.room.code || u.searchParams.get('farm') !== farmId())) {
        u.searchParams.set('room', online.room.code); u.searchParams.set('farm', farmId()); u.searchParams.delete('lobby');
        history.replaceState(null, '', u.toString());
      }
    } catch { /* */ }
  }
  private enterRoom() {
    this.markUrl();
    if (!this.preGame) {
      this.preGame = true;
      this.game.goOnline(online.isHost ? 'host' : 'client');
      this.game.enterLobby();
    }
    this.view = 'room'; this.close();
    this.opts.onRoom();
  }
  private enterGame() {
    this.markUrl();
    if (this.inGame) return;
    this.inGame = true;
    if (this.preGame) { this.close(); this.opts.start(); return; }   // already online on the lobby stage
    this.isOpen = true; this.el.classList.add('show');
    this.view = 'joining'; this.render();
    this.game.goOnline(online.isHost ? 'host' : 'client');
    const go = () => { this.close(); this.opts.start(); };
    if (online.isHost) go();
    else {
      const net = this.game.net as { onFirstFrame?: () => void; started?: boolean };
      if (net.started) go(); else net.onFirstFrame = go;
    }
  }

  // ---------------------------------------------------------------- views
  private render() {
    if (!this.isOpen) return;
    let body = '';
    const back = `<button class="chip icn" data-a="back">${ui('back', 22)}${t('net.back')}</button>`;
    if (this.view === 'connecting') {
      body = `<h2>${t('net.title')}</h2><p class="lw">${t('net.connecting')}</p><p class="lw small">${t('net.wakeup')}</p><div class="btns">${back}</div>`;
    } else if (this.view === 'joining') {
      body = `<h2>${t('net.title')}</h2><p class="lw">${t('net.joining')}</p>`;
    } else if (this.view === 'switching') {
      body = `<h2>${t('net.title')}</h2><p class="lw">${t('net.farmSwitch')}</p>`;
    } else if (this.view === 'error') {
      const msg = this.err === 'noserver' ? t('net.noServer') : this.err === 'version' ? t('net.version') : t('net.unreachable');
      body = `<h2>${t('net.title')}</h2><p class="lw">${msg}</p>
        <div class="field"><span>${t('net.serverAddr')}</span><input class="tin" id="lServer" placeholder="wss://….onrender.com" value="${esc(SETTINGS.server)}"></div>
        <div class="btns"><button class="chip icn" data-a="retry">${ui('retry', 22)}${t('net.retry')}</button>${back}</div>`;
    } else if (this.view === 'browse') {
      body = `<h2>${t('net.title')}</h2>${this.profileHtml()}
        ${this.err ? `<div class="lerr">${t('net.err.' + this.err)}</div>` : ''}
        <div class="lcols"><div class="lcol">
          <button class="chip big" data-a="quick">⚡ ${t('net.quick')}</button>
          <div class="lbox"><b>${t('net.create')}</b>
            <input class="tin" id="lName" maxlength="28" placeholder="${esc(t('net.roomName', { name: profile.name }))}">
            <label class="lchk"><input type="checkbox" id="lPublic" checked> ${t('net.public')}</label>
            <button class="chip icn" data-a="create">${ui('plus', 22)}${t('net.createBtn')}</button></div>
          <div class="lbox"><b>${t('net.joinCode')}</b>
            <div class="lrow"><input class="tin code" id="lCode" maxlength="4" placeholder="ABCD"><button class="chip icn" data-a="join">${ui('enter', 22)}${t('net.joinBtn')}</button></div></div>
        </div><div class="lcol wide"><div class="lhead"><b>${t('net.rooms')}</b><button class="chip small" data-a="refresh">↻</button></div><div id="lRooms"></div></div></div>
        <div class="btns">${back}</div>`;
    } else if (this.view === 'room' && online.room) {
      const r = online.room, host = online.isHost;
      const slots = [0, 1, 2, 3].map((i) => {
        const p = [...online.peers.values()].find((x) => x.slot === i);
        return `<div class="lslot ${p ? '' : 'empty'}"><i class="dot" style="background:${hex(PLAYER_COLORS[i])}"></i>${p ? this.peerHtml(p, host) : `<span class="dim">${t('net.freeSlot')}</span>`}</div>`;
      }).join('');
      body = `<h2>${esc(r.name)}</h2><div class="dim">${t('lobby.farm', { name: t(('farm.' + (asFarm(r.farm) ?? farmId())) as Key) })}</div>
        <div class="lcode">${t('net.code')} <b>${r.code}</b> <button class="chip small icn" data-a="invite">${ui('link', 20)}${t('net.copyInvite')}</button>
          ${host ? `<label class="lchk"><input type="checkbox" id="lPub" ${r.public ? 'checked' : ''}> ${t('net.public')}</label>` : `<span class="dim">${r.public ? t('net.public') : t('net.private')}</span>`}</div>
        <div class="lcols"><div class="lcol">${slots}</div>
        <div class="lcol wide"><div id="lChat"></div><div class="lrow"><input class="tin" id="lMsg" maxlength="160" placeholder="${esc(t('net.say'))}"><button class="chip" data-a="say">↵</button></div></div></div>
        <div class="btns">${host ? `<button class="chip big go2 icn" data-a="start">${ui('play', 28)}${t('net.start')}</button>` : `<span class="lw">${t('net.waitHost')}</span>`}
          <button class="chip icn" data-a="wardrobe">${ui('shirt', 22)}${t('title.wardrobe')}</button><button class="chip icn" data-a="leave">${ui('exit', 22)}${t('net.leave')}</button></div>`;
    }
    this.el.innerHTML = `<div class="panel txt lpanel">${body}</div>`;
    if (this.view === 'browse') { this.renderRooms(); this.mountGoogle(); }
    if (this.view === 'room') this.renderChat();
    this.wire();
  }

  private profileHtml() {
    const avatar = profile.picture && profile.google
      ? `<img class="lav" src="${esc(profile.picture)}" referrerpolicy="no-referrer" alt="">`
      : `<span class="lav pig">🐷</span>`;
    const verified = profile.google && online.me?.google;
    return `<div class="lprof">${avatar}
      <div class="lpname"><input class="tin" id="lMe" maxlength="16" value="${esc(profile.name)}" title="${esc(t('net.yourName'))}">
      <span class="dim small">${verified ? '✔ ' + t('net.google') : profile.google ? t('net.googleOffline') : t('net.guest')}</span></div>
      ${googleEnabled() ? (profile.google ? `<button class="chip small icn" data-a="signout">${ui('exit', 18)}${t('net.signOut')}</button>` : `<div id="lGoogle"></div>`) : ''}
      </div>`;
  }
  private peerHtml(p: Peer, host: boolean) {
    const me = p.id === online.myId, isHost = p.id === online.hostId;
    const av = p.picture ? `<img class="lav s" src="${esc(p.picture)}" referrerpolicy="no-referrer" alt="">` : '';
    const link = !me && host ? (online.direct(p.id) ? ' <span class="dim small" title="P2P">⚡</span>' : ' <span class="dim small">☁</span>') : '';
    return `${av}<span>${esc(p.name)}${isHost ? ' 👑' : ''}${p.google ? ' <span class="dim small">✔</span>' : ''}${me ? ` <span class="dim">(${t('net.you')})</span>` : ''}${link}${p.away ? ' 📡' : ''}</span>
      ${host && !me ? `<button class="chip small kick" data-kick="${p.id}">✕</button>` : ''}`;
  }
  private renderRooms() {
    const box = this.el.querySelector('#lRooms'); if (!box) return;
    const rooms = online.rooms;
    box.innerHTML = rooms.length ? rooms.map((r: RoomInfo) => `<div class="lroom"><div><b>${esc(r.name)}</b><br><span class="dim small">${esc(r.host)} · ${r.players}/${r.max} · ${r.state === 'playing' ? t('net.playing') : t('net.waiting')} · ${t(('farm.' + (asFarm(r.farm) ?? 'farm1')) as Key)}</span></div>
      <button class="chip small" data-join="${r.code}">${t('net.joinBtn')}</button></div>`).join('') : `<div class="dim">${t('net.noRooms')}</div>`;
    box.querySelectorAll<HTMLElement>('[data-join]').forEach((b) => b.addEventListener('click', () => { online.join(b.dataset.join!); this.view = 'joining'; this.render(); }));
  }
  /** The party panel on the lobby screen while in a room: code + invite, the 4 seats, chat, leave. */
  partyHtml() {
    const r = online.room!, host = online.isHost;
    const slots = [0, 1, 2, 3].map((i) => {
      const p = [...online.peers.values()].find((x) => x.slot === i);
      return `<div class="pslot ${p ? (p.id === online.myId ? 'me' : '') : 'add'}"><i class="dot" style="background:${hex(PLAYER_COLORS[i])}"></i>${p ? this.peerHtml(p, host) : `<span class="dim">+</span>`}</div>`;
    }).join('');
    return `<div class="ptitle">${t('lobby.room')} <b>${r.code}</b><button class="chip small icn" data-a="invite" title="${esc(t('net.copyInvite'))}">${ui('link', 20)}</button></div>${slots}` +
      `<div id="lChat" class="pchat"></div><div class="prow"><input class="tin" id="lMsg" maxlength="160" placeholder="${esc(t('net.say'))}"><button class="chip small" data-a="say">↵</button></div>` +
      (host ? `<label class="lchk"><input type="checkbox" id="lPub" ${r.public ? 'checked' : ''}> ${t('net.public')}</label>` : '') +
      `<button class="chip small icn" data-a="leave">${ui('exit', 18)}${t('lobby.leave')}</button>`;
  }
  wireParty(el: HTMLElement) {
    const val = (id: string) => (el.querySelector<HTMLInputElement>('#' + id)?.value ?? '').trim();
    el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = b.dataset.a!;
      if (a === 'say') { const m = val('lMsg'); if (m) { online.chat(m); (el.querySelector('#lMsg') as HTMLInputElement).value = ''; } return; }
      if (a === 'leave') { online.leave(); location.href = location.pathname; return; }
      if (a === 'invite') { const link = inviteLink(); navigator.clipboard?.writeText(link).then(() => { b.textContent = t('net.copied'); setTimeout(() => (b.textContent = t('net.copyInvite')), 1500); }, () => prompt(t('net.copyInvite'), link)); return; }
    }));
    el.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); online.kick(+b.dataset.kick!); }));
    el.querySelector<HTMLInputElement>('#lPub')?.addEventListener('change', (e) => online.setRoom({ public: (e.target as HTMLInputElement).checked }));
    const msg = el.querySelector<HTMLInputElement>('#lMsg');
    msg?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const m = msg.value.trim(); if (m) { online.chat(m); msg.value = ''; } } });
    msg?.addEventListener('keyup', (e) => e.stopPropagation());
    this.renderChat();
  }
  private renderChat() {
    const box = document.getElementById('lChat'); if (!box) return;
    box.innerHTML = this.chat.map((c) => c.sys ? `<div class="dim">${esc(c.text)}</div>` : `<div><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`).join('') || `<div class="dim">${t('net.chatHint')}</div>`;
    box.scrollTop = box.scrollHeight;
  }
  private async mountGoogle() {
    const el = this.el.querySelector<HTMLElement>('#lGoogle'); if (!el) return;
    await renderGoogleButton(el, lang());
  }

  private wire() {
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s);
    this.el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.a!)));
    this.el.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => b.addEventListener('click', () => online.kick(+b.dataset.kick!)));
    q<HTMLInputElement>('#lMe')?.addEventListener('change', (e) => setGuestName((e.target as HTMLInputElement).value));
    q<HTMLInputElement>('#lCode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('join'); });
    q<HTMLInputElement>('#lMsg')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.action('say'); });
    q<HTMLInputElement>('#lPub')?.addEventListener('change', (e) => online.setRoom({ public: (e.target as HTMLInputElement).checked }));
    // typing in the lobby must not move the pig / trigger hotkeys
    this.el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  }

  action(a: string) {
    const val = (id: string) => (this.el.querySelector<HTMLInputElement>('#' + id)?.value ?? '').trim();
    switch (a) {
      case 'back':
        if (online.room) online.leave();
        clearInterval(this.listTimer); this.close(); break;
      case 'retry': SETTINGS.server = val('lServer'); saveSettings(); this.connect(); break;
      case 'quick': online.quick(); this.view = 'joining'; this.render(); break;
      case 'create': online.create(val('lName') || t('net.roomName', { name: profile.name }), !!this.el.querySelector<HTMLInputElement>('#lPublic')?.checked); break;
      case 'join': { const c = val('lCode').toUpperCase(); if (c.length === 4) { online.join(c); this.view = 'joining'; this.render(); } break; }
      case 'refresh': online.list(); break;
      case 'signout': signOut(); break;
      case 'leave': online.leave(); this.browse(); break;
      case 'start': this.startAsHost(); break;
      case 'say': { const m = val('lMsg'); if (m) { online.chat(m); (this.el.querySelector('#lMsg') as HTMLInputElement).value = ''; } break; }
      case 'wardrobe': this.opts.wardrobe(); break;
      case 'invite': {
        const link = inviteLink();
        navigator.clipboard?.writeText(link).then(() => this.flash(t('net.copied')), () => prompt(t('net.copyInvite'), link));
        break;
      }
    }
  }
  private flash(text: string) {
    const b = this.el.querySelector('[data-a="invite"]'); if (!b) return;
    const old = b.innerHTML; b.innerHTML = ui('check', 20) + text; setTimeout(() => (b.innerHTML = old), 1500);
  }
}

export const inviteLink = () => `${location.origin}${location.pathname}?room=${online.room?.code ?? ''}`;

/** Leave the online game: reload into the lobby (the world is rebuilt fresh). */
export function backToLobby() {
  online.leave();
  const u = new URL(location.href);
  u.searchParams.delete('room'); u.searchParams.set('lobby', '1');
  location.href = u.toString();
}
void G;
