import type { Game } from './game';
import { G, ADMIN } from './ctx';
import { SETTINGS, saveSettings } from './settings';
import { t, setLang, lang, LANGS, onLang, type Lang, type Key } from '../i18n';
import { SVG } from './hud';
import { online } from '../net/online';
import { inviteLink } from '../net/lobby';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Overlays: settings menu (Esc), admin panel (` key), top-right buttons (sound / controls / menu).
 * The wardrobe lives in wardrobe.ts.
 */
export class Menu {
  menuOpen = false;
  private menu = $('menu');
  private panel = $('menuPanel');
  private admin = $('admin');
  onWardrobe?: () => void;
  onLeave?: () => void;

  constructor(private game: Game) {
    $('bSound').addEventListener('click', () => this.toggleSound());
    $('bHelp').addEventListener('click', () => game.hud.toggleHelp());
    $('bMenu').addEventListener('click', () => this.open());
    this.soundIcon();
    onLang(() => { if (this.menuOpen) this.renderMenu(); if (ADMIN.open) this.renderAdmin(); });
    if (new URLSearchParams(location.search).has('admin')) setTimeout(() => this.toggleAdmin(), 50);
  }

  get blocking() { return this.menuOpen || ADMIN.open || $('wardrobe').classList.contains('show'); }

  toggleSound() {
    const m = this.game.audio.toggleMute();
    SETTINGS.muted = m; saveSettings();
    this.soundIcon();
    this.game.hud.toast(t(m ? 'toast.soundOff' : 'toast.soundOn'), 1.2);
  }
  private soundIcon() {
    const b = $('bSound');
    b.querySelector('svg')?.remove();
    b.insertAdjacentHTML('afterbegin', this.game.audio.muted ? SVG.soundOff : SVG.soundOn);
    b.classList.toggle('off', this.game.audio.muted);
  }

  toggleQuality() {
    SETTINGS.quality = SETTINGS.quality === 'high' ? 'low' : 'high'; saveSettings();
    this.game.gfx.setQuality(SETTINGS.quality);
    this.game.hud.toast(t(SETTINGS.quality === 'high' ? 'toast.qualityHigh' : 'toast.qualityLow'), 1.4);
    if (this.menuOpen) this.renderMenu();
  }

  // ---------------------------------------------------------------- settings menu
  open() {
    if (ADMIN.open) return;
    this.menuOpen = true;
    document.exitPointerLock?.();
    this.renderMenu();
    this.menu.classList.add('show');
  }
  close(lock = true) {
    this.menuOpen = false;
    this.menu.classList.remove('show');
    if (lock) this.game.input.lock();
  }

  private renderMenu() {
    const seg = (name: string, opts: [string, string][], cur: string) =>
      `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const slider = (name: string, v: number, max = 1, step = 0.05) => `<input type="range" data-s="${name}" min="0" max="${max}" step="${step}" value="${v}">`;
    const f = (label: Key, ctl: string) => `<div class="field"><span>${t(label)}</span>${ctl}</div>`;
    this.panel.innerHTML = `<h2>${t('menu.settings')}</h2>` +
      f('menu.language', seg('lang', Object.entries(LANGS), lang())) +
      f('menu.quality', seg('quality', [['high', t('menu.qualityHigh')], ['low', t('menu.qualityLow')]], SETTINGS.quality)) +
      f('menu.sfx', slider('sfx', SETTINGS.sfx)) + f('menu.music', slider('music', SETTINGS.music)) + f('menu.ambience', slider('ambience', SETTINGS.ambience)) +
      f('menu.sens', slider('sens', SETTINGS.sens, 3, 0.1)) +
      f('menu.invert', seg('invert', [['0', t('menu.off')], ['1', t('menu.on')]], SETTINGS.invertY ? '1' : '0')) +
      `<div class="btns"><button class="chip" data-b="resume">${t('menu.resume')}</button><button class="chip" data-b="wardrobe">${t('menu.wardrobe')}</button>` +
      `<button class="chip" data-b="admin">${t('menu.admin')}</button></div>` +
      (online.room ? `<div class="btns"><span class="lw">${t('net.code')} <b>${online.room.code}</b></span><button class="chip" data-b="invite">${t('net.copyInvite')}</button>` +
        `<button class="chip" data-b="leave">${t(online.isHost ? 'net.endGame' : 'net.leave')}</button></div>` : '') +
      `<div id="pausedHint">${t(G.net === 'solo' ? 'help.keys' : 'net.notPaused')}</div>`;
    this.panel.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => s.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).dataset.v; if (v === undefined) return;
      const name = s.dataset.seg;
      if (name === 'lang') setLang(v as Lang);
      if (name === 'quality' && v !== SETTINGS.quality) this.toggleQuality();
      if (name === 'invert') { SETTINGS.invertY = v === '1'; saveSettings(); this.game.applySettings(); }
      this.renderMenu();
    }));
    this.panel.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((el) => el.addEventListener('input', () => {
      (SETTINGS as any)[el.dataset.s!] = parseFloat(el.value); saveSettings(); this.game.applySettings();
    }));
    this.panel.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.b;
      if (k === 'resume') this.close();
      if (k === 'wardrobe') { this.close(false); this.onWardrobe?.(); }
      if (k === 'admin') { this.close(false); this.toggleAdmin(); }
      if (k === 'invite') navigator.clipboard?.writeText(inviteLink()).then(() => this.game.hud.toast(t('net.copied'), 1.2));
      if (k === 'leave') this.onLeave?.();
    }));
  }

  // ---------------------------------------------------------------- admin panel
  /** Online numbers in the admin panel (role, ping, direct / relay, traffic). */
  netStats() {
    const el = document.getElementById('aNet'); if (!el || !ADMIN.open) return;
    const g = this.game, n = g.net as any, o = online;
    const peers = [...o.peers.values()].filter((p) => p.id !== o.myId).map((p) => `${p.name}: ${o.direct(p.id) ? 'P2P' : 'relay'}`).join(', ');
    el.innerHTML = `${G.net} · ${o.room?.code ?? '-'} · server ${o.rtt | 0} ms` + (n?.rtt !== undefined ? ` · host ${n.rtt | 0} ms · delay ${(n.delay * 1000) | 0} ms` : '') +
      `<br>↑ ${o.stats.upRate.toFixed(1)} kB/s ↓ ${o.stats.downRate.toFixed(1)} kB/s` + (n?.lastSize ? ` · snap ${n.lastSize} B` : '') + (peers ? `<br>${peers}` : '');
  }

  toggleAdmin() {
    ADMIN.open = !ADMIN.open;
    this.admin.classList.toggle('show', ADMIN.open);
    if (ADMIN.open) { if (this.menuOpen) this.close(false); document.exitPointerLock?.(); this.renderAdmin(); }
  }

  private renderAdmin() {
    const g = this.game;
    const tog = (k: keyof typeof ADMIN, label: Key) =>
      `<div class="field"><span>${t(label)}</span><div class="seg" data-tog="${k}"><button data-v="1" class="${ADMIN[k] ? 'on' : ''}">${t('menu.on')}</button><button data-v="0" class="${!ADMIN[k] ? 'on' : ''}">${t('menu.off')}</button></div></div>`;
    const rng = (k: string, label: Key, v: number, min: number, max: number, step: number) =>
      `<div class="field"><span>${t(label)} <b data-val="${k}">${v}</b></span><input type="range" data-r="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
    const btn = (k: string, label: Key) => `<button data-a="${k}">${t(label)}</button>`;
    this.admin.innerHTML = `<h2>${t('a.title')}</h2><div class="hint">${t('a.hint')}</div>` +
      (G.net !== 'solo' ? `<div class="sec">${t('a.online')}</div><div id="aNet" class="hint"></div>` + rng('netLag', 'a.netLag', ADMIN.netLag, 0, 500, 25) : '') +
      tog('bob', 'a.bob') + tog('bobSees', 'a.bobSee') + tog('god', 'a.godMode') + tog('easyEscape', 'a.escape') + tog('noCooldowns', 'a.cooldowns') +
      rng('bbqTime', 'a.bbq', ADMIN.bbqTime, 5, 120, 5) +
      `<div class="grid">${btn('grill', 'a.grillNow')}${btn('free', 'a.freeAll')}${btn('catch', 'a.catchMe')}${btn('mud', 'a.mud')}` +
      `${btn('dance', 'a.bobDance')}${btn('slap', 'a.bobSlap')}${btn('mow', 'a.bobMow')}${btn('bed', 'a.bobSleep')}</div>` +
      `<div class="sec">${t('a.time')}</div>` +
      rng('hour', 'a.time', +G.hour.toFixed(1), 0, 23.9, 0.1) + rng('daySpeed', 'a.timeSpeed', ADMIN.daySpeed, 0, 20, 0.5) + tog('freezeTime', 'a.freeze') +
      `<div class="grid">${btn('day', 'a.toDay')}${btn('night', 'a.toNight')}${btn('wolves', 'a.wolves')}${btn('nowolves', 'a.noWolves')}</div>` +
      rng('gameSpeed', 'a.gameSpeed', ADMIN.gameSpeed, 0.25, 3, 0.25) +
      `<div class="field"><span>${t('a.fps')}</span><div class="seg" data-fps="1"><button data-v="1" class="${SETTINGS.fps ? 'on' : ''}">${t('menu.on')}</button><button data-v="0" class="${!SETTINGS.fps ? 'on' : ''}">${t('menu.off')}</button></div></div>` +
      `<div class="sec">${t('a.teleport')}</div><div class="tp">${(['sty', 'cage', 'house', 'barn', 'pasture'] as const).map((k) => `<button data-tp="${k}">${t(('a.' + k) as Key)}</button>`).join('')}</div>`;
    this.admin.querySelectorAll<HTMLElement>('[data-tog]').forEach((s) => s.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).dataset.v; if (v === undefined) return;
      const k = s.dataset.tog as keyof typeof ADMIN;
      (ADMIN as any)[k] = v === '1';
      if (k === 'bob') g.farmer?.setEnabled(ADMIN.bob);
      this.renderAdmin();
    }));
    this.admin.querySelector<HTMLElement>('[data-fps]')!.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).dataset.v; if (v === undefined) return;
      SETTINGS.fps = v === '1'; saveSettings(); this.renderAdmin();
    });
    this.admin.querySelectorAll<HTMLInputElement>('input[data-r]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.r!, v = parseFloat(el.value);
      if (k === 'hour') g.daynight.setHour(v); else (ADMIN as any)[k] = v;
      (this.admin.querySelector(`[data-val="${k}"]`) as HTMLElement).textContent = String(v);
    }));
    this.admin.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => g.adminAction(b.dataset.a!)));
    this.admin.querySelectorAll<HTMLElement>('[data-tp]').forEach((b) => b.addEventListener('click', () => g.adminAction('tp:' + b.dataset.tp)));
  }
}
