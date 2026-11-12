import { online, type Peer, type RoomInfo } from './online';
import { profile, onProfile, googleEnabled, renderGoogleButton, refreshToken, setGuestName, signOut } from './auth';
import { serverUrl } from './config';
import { t, lang, onLang } from '../i18n';
import { G } from '../game/ctx';
import { SETTINGS, saveSettings } from '../game/settings';
import type { Game } from '../game/game';
import { PLAYER_COLORS } from '../game/game';

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
type View = 'connecting' | 'error' | 'browse' | 'room' | 'joining';

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

  constructor(private game: Game, private opts: { start: () => void; wardrobe: () => void; outfit: () => string }) {
    this.el = document.getElementById('lobby')!;
    online.on('*', (m) => this.onMsg(m));
    onProfile(() => this.onProfileChange());
    onLang(() => { if (this.isOpen) this.render(); });
  }

  open(code = '') {
    this.isOpen = true;
    this.pendingCode = code.toUpperCase();
    this.el.classList.add('show');
    this.connect();
  }
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
      case 'joined':
        this.chat = [];
        if (m.room.state === 'playing') this.enterGame();   // late join: straight into the running game
        else { this.view = 'room'; this.render(); }
        break;
      case 'room':
        if (online.room?.state === 'playing' && !this.inGame && !online.isHost) this.enterGame();
        else if (this.view === 'room') this.render();
        break;
      case 'peer_join':
        if (this.inGame) { g.syncPeers(); g.hud.toast(t('net.joined', { name: esc(m.peer.name) }), 1.6); if (online.isHost && g.net && 'needKey' in g.net) g.net.needKey.add(m.peer.id); }
        else { this.chat.push({ name: '', text: t('net.joined', { name: m.peer.name }), sys: true }); this.render(); }
        break;
      case 'peer_leave': {
        if (this.inGame) { g.peerLeft(m.id); g.hud.toast(t('net.left'), 1.4); }
        else this.render();
        break;
      }
      case 'peer_update': if (this.inGame) g.syncPeers(); else this.render(); break;
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
      case 'closed': case 'kicked': case 'disconnected':
        if (this.inGame) { g.hud.toast(t(m.op === 'kicked' ? 'net.kicked' : 'net.closed'), 3); setTimeout(() => backToLobby(), 2500); }
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
  private enterGame() {
    if (this.inGame) return;
    this.inGame = true;
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
    const back = `<button class="chip" data-a="back">${t('net.back')}</button>`;
    if (this.view === 'connecting') {
      body = `<h2>${t('net.title')}</h2><p class="lw">${t('net.connecting')}</p><p class="lw small">${t('net.wakeup')}</p><div class="btns">${back}</div>`;
    } else if (this.view === 'joining') {
      body = `<h2>${t('net.title')}</h2><p class="lw">${t('net.joining')}</p>`;
    } else if (this.view === 'error') {
      const msg = this.err === 'noserver' ? t('net.noServer') : this.err === 'version' ? t('net.version') : t('net.unreachable');
      body = `<h2>${t('net.title')}</h2><p class="lw">${msg}</p>
        <div class="field"><span>${t('net.serverAddr')}</span><input class="tin" id="lServer" placeholder="wss://….onrender.com" value="${esc(SETTINGS.server)}"></div>
        <div class="btns"><button class="chip" data-a="retry">${t('net.retry')}</button>${back}</div>`;
    } else if (this.view === 'browse') {
      body = `<h2>${t('net.title')}</h2>${this.profileHtml()}
        ${this.err ? `<div class="lerr">${t('net.err.' + this.err)}</div>` : ''}
        <div class="lcols"><div class="lcol">
          <button class="chip big" data-a="quick">⚡ ${t('net.quick')}</button>
          <div class="lbox"><b>${t('net.create')}</b>
            <input class="tin" id="lName" maxlength="28" placeholder="${esc(t('net.roomName', { name: profile.name }))}">
            <label class="lchk"><input type="checkbox" id="lPublic" checked> ${t('net.public')}</label>
            <button class="chip" data-a="create">${t('net.createBtn')}</button></div>
          <div class="lbox"><b>${t('net.joinCode')}</b>
            <div class="lrow"><input class="tin code" id="lCode" maxlength="4" placeholder="ABCD"><button class="chip" data-a="join">${t('net.joinBtn')}</button></div></div>
        </div><div class="lcol wide"><div class="lhead"><b>${t('net.rooms')}</b><button class="chip small" data-a="refresh">↻</button></div><div id="lRooms"></div></div></div>
        <div class="btns">${back}</div>`;
    } else if (this.view === 'room' && online.room) {
      const r = online.room, host = online.isHost;
      const slots = [0, 1, 2, 3].map((i) => {
        const p = [...online.peers.values()].find((x) => x.slot === i);
        return `<div class="lslot ${p ? '' : 'empty'}"><i class="dot" style="background:${hex(PLAYER_COLORS[i])}"></i>${p ? this.peerHtml(p, host) : `<span class="dim">${t('net.freeSlot')}</span>`}</div>`;
      }).join('');
      body = `<h2>${esc(r.name)}</h2>
        <div class="lcode">${t('net.code')} <b>${r.code}</b> <button class="chip small" data-a="invite">${t('net.copyInvite')}</button>
          ${host ? `<label class="lchk"><input type="checkbox" id="lPub" ${r.public ? 'checked' : ''}> ${t('net.public')}</label>` : `<span class="dim">${r.public ? t('net.public') : t('net.private')}</span>`}</div>
        <div class="lcols"><div class="lcol">${slots}</div>
        <div class="lcol wide"><div id="lChat"></div><div class="lrow"><input class="tin" id="lMsg" maxlength="160" placeholder="${esc(t('net.say'))}"><button class="chip" data-a="say">↵</button></div></div></div>
        <div class="btns">${host ? `<button class="chip big go2" data-a="start">${t('net.start')}</button>` : `<span class="lw">${t('net.waitHost')}</span>`}
          <button class="chip" data-a="wardrobe">${t('title.wardrobe')}</button><button class="chip" data-a="leave">${t('net.leave')}</button></div>`;
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
      ${googleEnabled() ? (profile.google ? `<button class="chip small" data-a="signout">${t('net.signOut')}</button>` : `<div id="lGoogle"></div>`) : ''}
      </div>`;
  }
  private peerHtml(p: Peer, host: boolean) {
    const me = p.id === online.myId, isHost = p.id === online.hostId;
    const av = p.picture ? `<img class="lav s" src="${esc(p.picture)}" referrerpolicy="no-referrer" alt="">` : '';
    const link = !me && host ? (online.direct(p.id) ? ' <span class="dim small" title="P2P">⚡</span>' : ' <span class="dim small">☁</span>') : '';
    return `${av}<span>${esc(p.name)}${isHost ? ' 👑' : ''}${p.google ? ' <span class="dim small">✔</span>' : ''}${me ? ` <span class="dim">(${t('net.you')})</span>` : ''}${link}</span>
      ${host && !me ? `<button class="chip small kick" data-kick="${p.id}">✕</button>` : ''}`;
  }
  private renderRooms() {
    const box = this.el.querySelector('#lRooms'); if (!box) return;
    const rooms = online.rooms;
    box.innerHTML = rooms.length ? rooms.map((r: RoomInfo) => `<div class="lroom"><div><b>${esc(r.name)}</b><br><span class="dim small">${esc(r.host)} · ${r.players}/${r.max} · ${r.state === 'playing' ? t('net.playing') : t('net.waiting')}</span></div>
      <button class="chip small" data-join="${r.code}">${t('net.joinBtn')}</button></div>`).join('') : `<div class="dim">${t('net.noRooms')}</div>`;
    box.querySelectorAll<HTMLElement>('[data-join]').forEach((b) => b.addEventListener('click', () => { online.join(b.dataset.join!); this.view = 'joining'; this.render(); }));
  }
  private renderChat() {
    const box = this.el.querySelector('#lChat'); if (!box) return;
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

  private action(a: string) {
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
    const old = b.textContent; b.textContent = text; setTimeout(() => (b.textContent = old), 1500);
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
