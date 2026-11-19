import type { Game } from './game';
import { G, ADMIN } from './ctx';
import { SETTINGS, saveSettings, setPreset } from './settings';
import { PRESETS, PRESET_ORDER, detectPreset, presetOf, setTuned, type GfxOpts, type PresetChoice } from '../render/quality';
import { t, setLang, lang, LANGS, onLang, type Lang, type Key } from '../i18n';
import { SVG, ICONS } from './hud';
import { online } from '../net/online';
import { inviteLink } from '../net/lobby';
import { level, xpForLevel, ownedOnly } from './shop';
import { isOwner, canAdmin } from '../net/auth';

/** Admin tiles: an icon per action / switch (by its key or its key's prefix). */
const AICON: Record<string, string> = {
  hurtMe: '🩹', killMe: '💀', 'mine:me': '💣', 'mine:bob': '💣', 'mines:new': '🎲', mines: '💣',
  fp: '👁️', fly: '🕊️', god: '👻', noCooldowns: '⚡', easyEscape: '🔓', respawn: '🏠', mud: '🟤', knock: '💫', predict: '📡', netLag: '🐢',
  'jail:others': '🔒', 'jail:free': '🔓', jailSecs: '⏱️', bob: '👨‍🌾', chill: '😎', showSight: '👀', bbqTime: '🔥', catch: '🫳', bobCarry: '🧺',
  slap: '👋', bobDown: '💥', bobHunt: '🔎', dance: '💃', danceNear: '🕺', mow: '🚜', bed: '🛏️', 'loo:go': '🚽', 'phone:ring': '☎️', 'nap:go': '💤', 'coffee:go': '☕', 'coffee:hot': '🌶️', 'coffee:mud': '💩', 'coffee:sauce': '🌶️', 'coffee:sip': '☕',
  grill: '🍖', free: '🔓', dogMe: '🐕', trapMe: '🪤', roosterMe: '🐓', turkeyMe: '🦃', hour: '🕐', daySpeed: '⏩', freezeTime: '⏸️', day: '☀️', night: '🌙',
  wolves: '🐺', nowolves: '🚫', gameSpeed: '🏃', 'mod:none': '🌤️', 'mod:rain': '🌧️', 'mod:fog': '🌫️', 'mod:grumpy': '😠', 'mod:market': '🛒', 'mod:random': '🎲',
  roundMins: '⏳', roundWin: '🏆', loot100: '💰', roundEnd: '🏁', roundNew: '🔄', pick: '🔐', smoke: '🚬', boosts: '💪', clock: '🕰️', snowcoat: '❄️',
  weed: '🌿', brew: '🍺', tree: '🍎', bees: '🐝', bull: '🐂', cow: '🐄', milk: '🥛', lantern: '🎃', lanterns: '🎃', catapult: '🏹', giant: '🎃', snowman: '⛄',
  'int:room': '🏚️', 'int:radio': '📻', 'int:tv': '📺', 'int:bake': '🥧', 'int:bath': '🛁', 'int:lure': '👨‍🌾', 'int:gramo': '🎶', 'int:disco': '🕺', 'int:sink': '🚰', 'int:fire': '🔥', 'int:tap': '👨‍🌾', 'fireball:me': '🔥', 'fireball:bob': '💥', 'tp:grill': '🍖',
  bigball: '⚪', gadget: '🎁', snack: '🥫', bring: '📦', gate: '🚪', gates: '🚪', loo: '🚽', phone: '☎️', nap: '🛌', tp: '📍', alert: '🚨',
};
function adminIcon(k: string) {
  if (AICON[k]) return AICON[k];
  const pre = k.split(':')[0];
  if (AICON[pre]) return AICON[pre];
  for (const [p, ic] of Object.entries(AICON)) if (k.startsWith(p)) return ic;
  return '✨';
}
/** A label in one breath: up to the first bracket / colon / dot, a few words. */
const short = (s: string) => {
  let w = s;
  const m = w.match(/^([^:]{1,10}):\s*(.+)$/);   // "Bob: catch me" → "catch me", "Teleport: shed" → "shed"
  if (m) w = m[2];
  w = w.split(/\s[(·—]|[(:]/)[0].trim();
  w = w.charAt(0).toUpperCase() + w.slice(1);
  return w.length > 22 ? w.slice(0, 20).trim() + '…' : w;
};
const PLAYER_ICON: Record<string, string> = { jail: '🔒', unjail: '🔓', freeze: '🧊', unfreeze: '🔥', launch: '🚀', knock: '💫', bring: '🧲', goto: '📍', ghost: '👻' };
const FARM_EMOJI: Record<string, string> = { farm1: '🏡', farm2: '🍎', farm3: '🐄', farm4: '🎃', farm5: '⛄', farm6: '🌿', farm7: '🍺' };
import { FARM_IDS, farmId, reloadOnFarm, type FarmId } from '../world/farms';
import { isFull, setFull, toggleFull, fullIcon, onFull } from './fullscreen';
import { FLAGS } from './flags';
import { ui, bars, type UiIcon } from './uiIcons';
import { IC, type IconId } from './icons';
import { PADDEV, pg, type PadG } from './padGlyph';

/** Settings rows: an icon + a short word + one control (simple rows big, "More" rows small). */
const row = (icon: string, label: string, ctl: string) => `<div class="field srow"><span class="sl">${icon}${label}</span>${ctl}</div>`;
const f = (icon: string, label: string, ctl: string) => `<div class="field"><span class="sl">${icon}${label}</span>${ctl}</div>`;
const seg = (name: string, opts: [string, string][], cur: string) =>
  `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
/** A segment row whose buttons carry an icon over the word (graphics presets: quality bars). */
const segI = (name: string, opts: [string, string, string][], cur: string) =>
  `<div class="seg segi" data-seg="${name}">${opts.map(([v, l, i]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${i}<span>${l}</span></button>`).join('')}</div>`;
const slider = (name: string, v: number, max = 1, step = 0.05) => `<input type="range" data-s="${name}" min="0" max="${max}" step="${step}" value="${v}">`;
/** An on / off switch (a pill with a knob: green = on). */
const sw = (name: string, on: boolean) => `<button class="sw${on ? ' on' : ''}" data-sw="${name}" role="switch" aria-checked="${on}"><i></i></button>`;
/** A pig jumping (an up arrow with a little hop line). */
const JUMP = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 3 5.5 10H9.6v6h4.8v-6h4.1z" fill="#fff6e6" stroke="#2a170b" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 20.5h14" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round"/></svg>';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Overlays: settings menu (Esc), admin panel (` key), top-right buttons (sound / controls / menu).
 * The wardrobe lives in wardrobe.ts.
 */
export class Menu {
  menuOpen = false;
  private advanced = false;
  private page: 'settings' | 'controls' | 'exit' = 'settings';
  private menu = $('menu');
  private panel = $('menuPanel');
  private admin = $('admin');
  onWardrobe?: () => void;
  /** Admin changed my coins / items (title wallet, online outfit message). */
  onShop?: () => void;
  /** The lobby screen's wallet / party needs a redraw. */
  onShopChanged?: () => void;
  onLeave?: () => void;

  constructor(private game: Game) {
    $('bSound').addEventListener('click', () => this.toggleSound());
    $('bHelp').addEventListener('click', () => game.hud.toggleHelp());
    $('bMenu').addEventListener('click', () => this.open());
    // first ↔ third person (V)
    const bView = $('bView');
    bView.insertAdjacentHTML('afterbegin', SVG.view);
    bView.addEventListener('click', () => { if (game.mode === 'play') game.toggleView(); });
    const bFull = $('bFull');
    const fullBtn = () => { bFull.querySelector('svg')?.remove(); bFull.insertAdjacentHTML('afterbegin', fullIcon()); };
    bFull.addEventListener('click', () => toggleFull()); fullBtn();
    onFull(() => { fullBtn(); if (this.menuOpen) this.renderMenu(); });
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

  /** P key: next preset (low → medium → high → ultra → low). */
  cyclePreset() {
    const cur = presetOf(SETTINGS.preset) ?? 'high';
    this.choosePreset(PRESET_ORDER[(PRESET_ORDER.indexOf(cur) + 1) % PRESET_ORDER.length]);
  }
  private choosePreset(c: PresetChoice) {
    setPreset(c); saveSettings();
    this.game.applyGfx();
    this.game.hud.toast(t('toast.preset', { p: this.presetName(c) }), 1.4);
    if (this.menuOpen) this.renderMenu();
  }
  private presetName(c: PresetChoice) { return c === 'auto' ? t('g.auto', { p: t(('g.' + (presetOf('auto') ?? detectPreset().preset)) as Key) }) : t(('g.' + c) as Key); }
  /** One advanced option changed: the preset becomes "custom" (or the preset it now matches). */
  private setGfx<K extends keyof GfxOpts>(k: K, v: GfxOpts[K]) {
    SETTINGS.gfx = { ...SETTINGS.gfx, [k]: v };
    const same = PRESET_ORDER.find((p) => (Object.keys(PRESETS[p]) as (keyof GfxOpts)[]).every((key) => PRESETS[p][key] === SETTINGS.gfx[key]));
    SETTINGS.preset = same && presetOf(SETTINGS.preset) === same ? SETTINGS.preset : same ?? 'custom';
    saveSettings(); this.game.applyGfx();
  }

  // ---------------------------------------------------------------- settings menu
  open() {
    if (ADMIN.open) return;
    this.menuOpen = true;
    if (this.page === 'exit') this.page = 'settings';
    document.exitPointerLock?.();
    document.getElementById('clickHint')?.classList.remove('show');
    this.renderMenu();
    this.menu.classList.add('show');
  }
  close(lock = true) {
    this.menuOpen = false;
    this.menu.classList.remove('show');
    if (lock && this.game.mode === 'play') this.game.input.lock();
  }

  /**
   * The pause menu (user 2026-11-19: "there's no exit to the main menu, only back to the game"; "universal, familiar
   * icons"): a rail of big icon tiles on the left — ▶ resume · ⚙ settings · 🎮 controls · 👕 wardrobe · 🔧 admin ·
   * 🔗 invite · 🏠 main menu (asks first) — and the chosen page on the right.
   */
  private renderMenu() {
    const play = this.game.mode === 'play', room = online.room;
    const exitKind: 'exit' | 'leave' | 'end' | null = room ? (online.isHost && play ? 'end' : 'leave') : play ? 'exit' : null;
    if (!exitKind && this.page === 'exit') this.page = 'settings';
    const tile = (b: string, icon: UiIcon, label: string, cls = '', tip = label) =>
      `<button class="ptile ${cls}" data-b="${b}" title="${tip.replace(/"/g, '&quot;')}">${ui(icon, 40)}<span>${label}</span></button>`;
    const pageTile = (p: typeof this.page, icon: UiIcon, label: Key) => tile('page:' + p, icon, t(label), this.page === p ? 'on' : '');
    const rail = `<nav class="prail">` +
      (play ? tile('resume', 'play', t('pm.resume'), 'go', t('menu.resume')) : tile('resume', 'close', t('pm.close'))) +
      pageTile('settings', 'gear', 'menu.settings') + pageTile('controls', 'pad', 'help.title') +
      tile('wardrobe', 'shirt', t('pm.wardrobe'), '', t('menu.wardrobe')) +
      (canAdmin() ? tile('admin', 'wrench', t('pm.admin'), '', t('menu.admin')) : '') +
      `<div class="pspace"></div>` +
      (room ? tile('invite', 'link', `${t('pm.invite')}<b>${room.code}</b>`, '', t('net.copyInvite')) : '') +
      (exitKind ? tile('page:exit', exitKind === 'exit' ? 'home' : 'exit', t(exitKind === 'exit' ? 'pm.exit' : exitKind === 'end' ? 'pm.end' : 'pm.leave'),
        'exit' + (this.page === 'exit' ? ' on' : ''), t(exitKind === 'exit' ? 'menu.toLobby' : exitKind === 'end' ? 'net.endGame' : 'net.leave')) : '') +
      `</nav>`;
    const body = this.page === 'controls' ? this.controlsPage() : this.page === 'exit' ? this.exitPage(exitKind!, play) : this.settingsPage();
    this.panel.classList.add('pause');
    this.panel.innerHTML = rail + `<section class="ppage">${body}</section>`;
    this.wireMenu();
  }

  /** Settings: one icon + one word + one control per row; everything else under "More". Switches, not On / Off words. */
  private settingsPage() {
    const G0 = SETTINGS.preset;
    const presets: [string, string, string][] = [['auto', t('g.autoS'), bars(0, 22)], ...PRESET_ORDER.map((p, i) => [p, t(('g.' + p) as Key), bars(i + 1, 28)] as [string, string, string])];
    if (G0 === 'custom') presets.push(['custom', t('g.custom'), ui('sliders', 18)]);
    const langs = `<div class="langPick">${Object.entries(LANGS).map(([k, v]) => `<button data-lang="${k}" class="${k === lang() ? 'on' : ''}">${FLAGS[k] ?? ''}${v}</button>`).join('')}</div>`;
    const muted = this.game.audio.muted;
    const muteBtn = `<button class="mute${muted ? ' off' : ''}" data-b="mute" title="${t(muted ? 'toast.soundOff' : 'toast.soundOn')}" role="switch" aria-checked="${!muted}">${ui(muted ? 'muted' : 'speaker', 26)}</button>`;
    const tuneName = G0 === 'auto' ? ` · ${t(('g.' + presetOf('auto')) as Key)}` : '';
    return `<h2>${t('menu.settings')}</h2>` +
      row(ui('globe', 26), t('menu.language'), langs) +
      row(ui('monitor', 26), t('menu.quality'), segI('preset', presets, G0)) +
      `<div class="field srow sub"><span></span><button class="chip small icn" data-b="tune" title="${t('g.tuneD').replace(/"/g, '&quot;')}">${ui('gauge', 20)}${t('g.tune')}${tuneName}</button></div>` +
      `<div class="field srow"><span class="sl">${muteBtn}${t('menu.sound')}</span>${slider('sound', muted ? 0 : SETTINGS.sfx)}</div>` +
      row(ui('music', 26), t('menu.musicS'), slider('music', SETTINGS.music)) +
      row(ui('mouse', 26), t('menu.mouse'), slider('sens', SETTINGS.sens, 3, 0.1)) +
      row(ui('full', 26), t('menu.full'), sw('full', isFull())) +
      `<div class="btns"><button class="chip small icn" data-b="advanced">${ui('sliders', 20)}${t('menu.more')} ${this.advanced ? '▾' : '▸'}</button></div>` +
      (this.advanced ? `<div class="adv">` +
        f(ui('speaker', 20), t('menu.sfx'), slider('sfx', SETTINGS.sfx)) + f(ui('tree', 20), t('menu.ambience'), slider('ambience', SETTINGS.ambience)) +
        f(ui('updown', 20), t('menu.invert'), sw('invert', SETTINGS.invertY)) +
        f(ui('rumble', 20), t('menu.rumble'), sw('rumble', SETTINGS.rumble !== false)) + this.graphics() + '</div>' : '');
  }

  /** Controls: a tile per action = its icon + the key / pad button, one word under it (the full sentence in the tooltip). */
  private controlsPage() {
    const pad = PADDEV.on;
    const cap = (k: string, g: PadG | PadG[]) => pad ? ([] as PadG[]).concat(g).map(pg).join('') : `<kbd class="kc">${k}</kbd>`;
    const A: [string, string, Key, string, PadG | PadG[], Key][] = [
      ['walk', '', 'cx.move', 'WASD', 'LS', 'help.move'], ['eye', '', 'cx.look', t('key.mouse'), 'RS', 'help.look'],
      ['', JUMP, 'cx.jump', t('key.space'), 'A', 'help.jump'], ['', ICONS.grab, 'ab.grab', t('key.rmb'), 'LT', 'help.grab'],
      ['fist', '', 'cx.hit', t('key.lmb'), 'RT', 'help.punch'], ['', ICONS.sprint, 'ab.sprint', t('key.shift'), 'LB', 'help.sprint'],
      ['', ICONS.fart, 'ab.fart', 'Q', 'B', 'help.fart'], ['', ICONS.wallow, 'ab.wallow', 'C', 'X', 'help.wallow'],
      ['', ICONS.stand, 'ab.stand', 'E', 'Y', 'help.stand'], ['note', '', 'cx.oink', 'F', 'R3', 'help.oink'],
      ['pour', '', 'cx.tilt', 'R', 'RB', 'help.tilt' as Key], ['reach', '', 'cx.reach', t('key.wheel' as Key), 'DUD', 'help.reach' as Key],
      ['', SVG.view, 'cx.view', 'V', 'VIEW', 'help.view' as Key], ['swirl', '', 'cx.dance', 'B', 'DL', 'key.emote' as Key],
      ['pass', '', 'cx.pass', 'G', 'DR', 'key.pass' as Key], ['', ui('gear', 30), 'menu.settings', 'Esc', 'MENU', 'menu.settings'],
    ];
    return `<h2>${t('help.title')}</h2><div class="ctiles">` + A.map(([ic, raw, lbl, key, g, tip]) =>
      `<div class="ctile" title="${t(tip).replace(/"/g, '&quot;')}"><div class="ci">${raw || IC[ic as IconId]}</div><div class="ck">${cap(key, g)}</div><span>${t(lbl)}</span></div>`).join('') +
      `</div><div class="btns"><button class="chip small icn" data-b="help">${ui('keys', 20)}${t('pm.onScreen')} <kbd class="kc">H</kbd></button></div>`;
  }

  /** "Main menu?" — a big icon, one line, ✔ / ✕. */
  private exitPage(kind: 'exit' | 'leave' | 'end', play: boolean) {
    const q = t(kind === 'exit' ? 'pm.exitQ' : kind === 'end' ? 'pm.endQ' : 'pm.leaveQ');
    return `<div class="pexit">${ui(kind === 'exit' ? 'home' : 'exit', 96)}<h2>${q}</h2>` + (play ? `<p>${t('pm.roundLost')}</p>` : '') +
      `<div class="btns"><button class="chip big warn icn" data-b="exitYes">${ui('yes', 30)}${t('pm.yes')}</button>` +
      `<button class="chip big plain icn" data-b="exitNo">${ui('close', 30)}${t('pm.no')}</button></div></div>`;
  }

  private wireMenu() {
    const P = this.panel;
    P.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => s.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest<HTMLElement>('[data-v]')?.dataset.v; if (v === undefined) return;
      const name = s.dataset.seg;
      if (name === 'preset' && v !== SETTINGS.preset) this.choosePreset(v as PresetChoice);
      if (name?.startsWith('g:')) this.setGfx(name.slice(2) as keyof GfxOpts, parseFloat(v) as never);
      this.renderMenu();
    }));
    P.querySelectorAll<HTMLElement>('[data-sw]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.sw!, on = !b.classList.contains('on');
      if (name.startsWith('g:')) this.setGfx(name.slice(2) as keyof GfxOpts, on as never);
      if (name === 'showFps') { SETTINGS.fps = on; saveSettings(); }
      if (name === 'rumble') { SETTINGS.rumble = on; saveSettings(); }
      if (name === 'invert') { SETTINGS.invertY = on; saveSettings(); this.game.applySettings(); }
      if (name === 'full') { setFull(on).then(() => this.renderMenu()); return; }
      this.renderMenu();
    }));
    P.querySelector('.langPick')?.addEventListener('click', (e) => {
      const l = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]')?.dataset.lang;
      if (l && l !== lang()) setLang(l as Lang);
    });
    P.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.s!, v = parseFloat(el.value);
      if (k === 'sound') {
        SETTINGS.sfx = v; SETTINGS.ambience = Math.min(1, v * 0.8);
        if (this.game.audio.muted && v > 0) { this.toggleSound(); P.querySelector('[data-b=mute]')?.replaceWith(...this.muteBtnNow()); }
      } else (SETTINGS as any)[k] = v;
      saveSettings(); this.game.applySettings();
    }));
    const res = P.querySelector<HTMLInputElement>('input[data-g=res]');
    res?.addEventListener('change', () => { this.setGfx('res', parseFloat(res.value)); this.renderMenu(); });
    res?.addEventListener('input', () => { (P.querySelector('[data-val=res]') as HTMLElement).textContent = `${Math.round(parseFloat(res.value) * 100)}%`; });
    P.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.b!;
      if (k.startsWith('page:')) { this.page = k.slice(5) as typeof this.page; this.renderMenu(); return; }
      if (k === 'resume') this.close();
      if (k === 'mute') { this.toggleSound(); this.renderMenu(); }
      if (k === 'help') { this.close(); this.game.hud.flashHelp(20); }
      if (k === 'advanced') { this.advanced = !this.advanced; this.renderMenu(); }
      if (k === 'tune') {   // measure again from the graphics card's guess (while playing)
        SETTINGS.tuned = null; setTuned(null); this.choosePreset('auto'); this.game.retune();
        this.game.hud.toast(t('toast.tuneStart'), 2.4, '', 'gear');
      }
      if (k === 'wardrobe') { this.close(false); this.onWardrobe?.(); }
      if (k === 'admin') { this.close(false); this.toggleAdmin(); }
      if (k === 'invite') navigator.clipboard?.writeText(inviteLink()).then(() => this.game.hud.toast(t('net.copied'), 1.2, '', 'check'));
      if (k === 'exitNo') { this.page = 'settings'; this.renderMenu(); }
      if (k === 'exitYes') {
        if (online.room && online.isHost && this.game.mode === 'play') { online.regroup(); this.close(false); }   // end the game: the room stays together
        else if (online.room) this.onLeave?.();
        else location.href = location.pathname;   // solo: back to the lobby (the world is rebuilt fresh)
      }
    }));
  }
  private muteBtnNow() {
    const d = document.createElement('div'); const m = this.game.audio.muted;
    d.innerHTML = `<button class="mute${m ? ' off' : ''}" data-b="mute" role="switch" aria-checked="${!m}">${ui(m ? 'muted' : 'speaker', 26)}</button>`;
    const b = d.firstElementChild as HTMLElement;
    b.addEventListener('click', () => { this.toggleSound(); this.renderMenu(); });
    return [b];
  }

  /** Graphics, every option on its own (under "More"): an icon per row, switches for on / off, bars for levels. */
  private graphics() {
    const G0 = SETTINGS.gfx;
    const lv = (k: keyof GfxOpts, labels: [number, Key | string][]) =>
      seg('g:' + k, labels.map(([v, l]) => [String(v), l.includes('.') ? t(l as Key) : l]), String(G0[k]));
    const gpu = detectPreset().gpu;
    return `<div><div class="hint">${t('g.hint')}${gpu ? '<br>' + t('g.gpu', { g: gpu.replace(/[<>&]/g, '') }) : ''}</div>` +
      f(ui('res', 20), t('g.res'), `<span class="rv"><b data-val="res">${Math.round(G0.res * 100)}%</b><input type="range" data-g="res" min="0.5" max="1" step="0.05" value="${G0.res}"></span>`) +
      f(ui('auto', 20), t('g.dynRes'), sw('g:dynRes', !!G0.dynRes)) +
      f(ui('shadow', 20), t('g.shadows'), lv('shadows', [[0, 'menu.off'], [1, 'g.low'], [2, 'g.medium'], [3, 'g.high'], [4, 'g.ultra']])) +
      f(ui('grass', 20), t('g.grass'), lv('grass', [[0, 'menu.off'], [1, 'g.low'], [2, 'g.medium'], [3, 'g.high']])) +
      f(ui('bulb', 20), t('g.lamps'), lv('lamps', [[0, '2'], [1, '4'], [2, '6'], [3, 'g.all']])) +
      f(ui('far', 20), t('g.detail'), lv('detail', [[0, 'g.near'], [1, 'g.medium'], [2, 'g.far'], [3, 'g.max']])) +
      f(ui('pencil', 20), t('g.outline'), sw('g:outline', !!G0.outline)) + f(ui('sparkle', 20), t('g.bloom'), sw('g:bloom', !!G0.bloom)) +
      f(ui('smooth', 20), t('g.aa'), lv('aa', [[0, 'menu.off'], [1, 'FXAA'], [2, 'SMAA']])) +
      f(ui('pixels', 20), t('g.dpr'), lv('dpr', [[1, '1×'], [1.5, '1.5×'], [2, '2×']])) +
      f(ui('gauge', 20), t('g.fpsCap'), lv('fpsCap', [[0, 'g.max'], [60, '60'], [30, '30']])) +
      f(ui('fps', 20), t('g.showFps'), sw('showFps', !!SETTINGS.fps)) + '</div>';
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
    if (!ADMIN.open && !canAdmin()) return;   // the owner + whoever the owner gave it to
    ADMIN.open = !ADMIN.open;
    this.admin.classList.toggle('show', ADMIN.open);
    if (ADMIN.open) { if (this.menuOpen) this.close(false); document.exitPointerLock?.(); this.renderAdmin(); }
  }

  /** Admin tab (user: "simplify the admin menu"): one short page at a time. */
  private jailSecs = 60;
  private aTab: 'me' | 'players' | 'bob' | 'world' | 'farm' | 'items' | 'owner' = 'me';
  /** Owner tab: who's online (from the server). */
  private users: { id: number; name: string; google: boolean; room: string; me: boolean }[] = [];
  private usersHooked = false;
  renderAdmin() {
    const g = this.game, f = g.farm;
    // (user: "a menu in the game's style, less text"): icon tiles with a word or two; the full sentence is the tooltip
    const tip = (label: Key) => t(label).replace(/"/g, '&quot;');
    const tog = (k: keyof typeof ADMIN, label: Key) =>
      `<button class="tile tg${ADMIN[k] ? ' on' : ''}" data-tg="${k}" title="${tip(label)}"><i></i><b>${adminIcon(k)}</b>${short(t(label))}</button>`;
    const rng = (k: string, label: Key, v: number, min: number, max: number, step: number) =>
      `<div class="field" title="${tip(label)}"><b class="fi">${adminIcon(k)}</b><span>${short(t(label))}</span><b data-val="${k}">${v}</b><input type="range" data-r="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
    const btn = (k: string, label: Key, on = false) => `<button data-a="${k}" class="tile${on ? ' on' : ''}" title="${tip(label)}"><b>${adminIcon(k)}</b>${short(t(label))}</button>`;
    const grid = (...b: string[]) => `<div class="tiles">${b.join('')}</div>`;
    const sec = (k: Key) => `<div class="sec">${short(t(k))}</div>`;
    const hasTp = (k: string) => f.places.tp.some((x) => x[0] === k);
    let crash = '';
    try { const c = JSON.parse(localStorage.getItem('porkour.crash') ?? 'null'); if (c) crash = `<div class="crash">⚠️ ${t('a.crash')}<br>${new Date(c.at).toLocaleString()} · ${c.mins} min · heap ${c.heap} MB · geo ${c.geo} · tex ${c.tex} · ${c.fps} fps · ${c.preset} · ${c.net}${c.lost ? ' · GL lost' : ''}</div>`; } catch { /* */ }
    const owner = isOwner() || !!online.me?.owner;
    const TABS: [typeof this.aTab, string, Key][] = [['me', '🐷', 'at.me'], ['players', '👥', 'at.players'], ['bob', '👨‍🌾', 'at.bob'], ['world', '🌦', 'at.world'], ['farm', '🏡', 'at.farm'], ['items', '🎁', 'at.items'],
      ...(owner ? [['owner', '👑', 'at.owner']] as [typeof this.aTab, string, Key][] : [])];
    if (this.aTab === 'owner' && !owner) this.aTab = 'me';
    let body = '';
    switch (this.aTab) {
      case 'me':
        body = grid(tog('fly', 'a.fly'), tog('god', 'a.ghost'), tog('fp', 'a.fp'), tog('noCooldowns', 'a.cooldowns'), tog('easyEscape', 'a.escape')) +
          grid(btn('respawn', 'a.respawn'), btn('mud', 'a.mud'), btn('knock', 'a.knockMe'), btn('hurtMe', 'a.hurtMe'), btn('killMe', 'a.killMe'), btn('tp:bush', 'a.tpBush'), hasTp('wheat') ? btn('tp:wheat', 'a.tpWheat') : '') +
          sec('a.teleport') + `<div class="tp">${f.places.tp.filter(([k]) => k !== 'wheat').map(([k]) => `<button data-tp="${k}" title="${tip(('a.' + k) as Key)}"><b>📍</b>${short(t(('a.' + k) as Key))}</button>`).join('')}</div>` +
          (G.net !== 'solo' ? sec('a.online') + `<div id="aNet" class="hint"></div>` + rng('netLag', 'a.netLag', ADMIN.netLag, 0, 500, 25) + grid(tog('predict', 'a.predict')) : '');
        break;
      case 'players': {
        const rows = g.pigs.map((p, i) => ({ p, i })).filter(({ p }) => !p.absent && p !== g.local).map(({ p, i }) =>
          `<div class="prow"><span><i style="background:#${p.color.toString(16).padStart(6, '0')}"></i>${p.label}${p.jailed ? ' 🔒' : ''}${p.frozen ? ' ❄' : ''}${p.pw.ghost ? ' 👻' : ''}</span>` +
          `<div class="grid g3">${[p.jailed ? ['unjail', 'a.unjail'] : ['jail', 'a.jail'], p.frozen ? ['unfreeze', 'a.unfreeze'] : ['freeze', 'a.freezeP'], ['launch', 'a.launch'], ['knock', 'a.knockP'], ['bring', 'a.bring'], ['goto', 'a.goto'], ['ghost', 'a.ghostP']]
            .map(([k, l]) => `<button data-p="${i}:${k}" class="${k === 'ghost' && p.pw.ghost ? 'on' : ''}" title="${tip(l as Key)}"><b>${PLAYER_ICON[k] ?? '✨'}</b>${short(t(l as Key))}</button>`).join('')}</div></div>`).join('');
        body = rows + rng('jailSecs', 'a.jailSecs', this.jailSecs, 10, 300, 10) + grid(btn('jail:others', 'a.jailOthers'), btn('jail:free', 'a.freeJail'));
        break;
      }
      case 'bob':
        body = grid(tog('bob', 'a.bob'), tog('chill', 'a.chill'), tog('showSight', 'a.showSight')) + rng('bbqTime', 'a.bbq', ADMIN.bbqTime, 5, 120, 5) +
          sec('a.alert') + `<div class="tiles" style="grid-template-columns:repeat(4,1fr)">${[0, 1, 2, 3].map((l) => `<button data-a="alert:${l}" class="tile${g.farmer?.level === l ? ' on' : ''}" title="${tip(('alert.' + l) as Key)}"><b>${['😴', '🤨', '😠', '🤬'][l]}</b>${l}</button>`).join('')}</div>` +
          grid(btn('catch', 'a.catchMe'), btn('bobCarry', 'a.bobCarry'), btn('slap', 'a.bobSlap'), btn('bobDown', 'a.bobDown'), btn('bobHunt', 'a.bobHunt'),
            btn('dance', 'a.bobDance'), btn('danceNear', 'a.bobDanceNear'), btn('mow', 'a.bobMow'), btn('bed', 'a.bobSleep'), g.farm.house?.bed ? btn('bedNow', 'a.bobBedNow') : '',
            g.loos.length ? btn('loo:go', 'a.looGo') : '', g.phones?.wall ? btn('phone:ring', 'a.phoneRing') : '', g.hammock ? btn('nap:go', 'a.napGo') : '', g.porch ? btn('coffee:go', 'a.coffeeGo') : '',
            btn('grill', 'a.grillNow'), btn('free', 'a.freeAll'), btn('dogMe', 'a.dogMe'), btn('trapMe', 'a.trapMe'), btn('roosterMe', 'a.roosterMe'), btn('turkeyMe', 'a.turkeyMe'));
        break;
      case 'world':
        body = rng('hour', 'a.time', +G.hour.toFixed(1), 0, 23.9, 0.1) + rng('daySpeed', 'a.timeSpeed', ADMIN.daySpeed, 0, 20, 0.5) +
          grid(tog('freezeTime', 'a.freeze'), btn('day', 'a.toDay'), btn('night', 'a.toNight'), btn('wolves', 'a.wolves'), btn('nowolves', 'a.noWolves')) +
          sec('a.fire') + grid(btn('fireball:me', 'a.fireballMe'), btn('fireball:bob', 'a.fireballBob'), btn('tp:grill', 'a.tpGrill')) +
          sec('a.mines') + grid(tog('mines', 'a.minesOn'), btn('mine:me', 'a.mineMe'), btn('mine:bob', 'a.mineBob'), btn('mines:new', 'a.minesNew'), g.gulag ? btn('tp:gulag', 'a.tpGulag') : '') +
          rng('gameSpeed', 'a.gameSpeed', ADMIN.gameSpeed, 0.25, 3, 0.25) +
          sec('a.mods') + grid(...(['none', 'rain', 'fog', 'grumpy', 'market'] as const).map((m) => `<button data-a="mod:${m}" class="tile${G.mod === m ? ' on' : ''}"><b>${adminIcon('mod:' + m)}</b>${m === 'none' ? t('menu.off') : short(t(('mod.' + m) as Key))}</button>`),
            `<button data-a="mod:random" class="tile${ADMIN.mod === 'random' ? ' on' : ''}" title="${tip('a.modRandom')}"><b>🎲</b>${short(t('a.modRandom'))}</button>`) +
          sec('a.round') + rng('roundMins', 'a.roundMins', ADMIN.roundMins, 1, 20, 1) +
          grid(btn('roundWin', 'a.roundWin'), btn('loot100', 'a.loot100'), btn('roundEnd', 'a.roundEnd'), btn('roundNew', 'a.roundNew')) +
          `<div class="field"><b class="fi">📈</b><span>${short(t('a.fps'))}</span><div class="seg" data-fps="1"><button data-v="1" class="${SETTINGS.fps ? 'on' : ''}">${t('menu.on')}</button><button data-v="0" class="${!SETTINGS.fps ? 'on' : ''}">${t('menu.off')}</button></div></div>`;
        break;
      case 'farm':
        body = (G.net === 'solo' ? grid(...FARM_IDS.map((x) => `<button data-farm="${x}" class="tile${farmId() === x ? ' on' : ''}"><b>${FARM_EMOJI[x] ?? '🏡'}</b>${short(t(('farm.' + x) as Key))}</button>`)) : '') +
          (f.chain ? sec('a.chain') + grid(...f.chain.adminButtons().map(([k, l]) => btn(k, l as Key))) : '') +
          sec('a.gates') + grid(btn('gates:lock', 'a.gatesLock'), btn('gates:shut', 'a.gatesShut'), btn('gates:open', 'a.gatesOpen'), btn('gate:smash', 'a.gateSmash'), btn('gate:bob', 'a.gateBob'), btn('tp:gate', 'a.tpGate')) +
          (g.loos.length ? sec('a.loo') + grid(btn('loo:in', 'a.looIn'), btn('loo:bolt', 'a.looBolt'), btn('loo:tip', 'a.looTip'), btn('tp:loo', 'a.tpLoo'), btn('tp:safe', 'a.tpSafe')) : '') +
          (g.phones ? sec('a.phone') + grid(btn('phone:prank', 'a.phonePrank'), btn('phone:plug', 'a.phonePlug'), btn('tp:phone', 'a.tpPhone'), btn('tp:pay', 'a.tpPay'), btn('clock:strike', 'a.clockStrike')) : '') +
          (g.hammock ? sec('a.nap') + grid(btn('nap:in', 'a.napIn'), btn('nap:swing', 'a.napSwing'), btn('nap:mud', 'a.napMud'), btn('tp:hammock', 'a.tpHammock')) : '') +
          (g.porch ? sec('a.coffee') + grid(btn('coffee:sip', 'a.coffeeSip'), btn('coffee:hot', 'a.coffeeHot'), btn('coffee:mud', 'a.coffeeMud'), btn('coffee:sauce', 'a.coffeeSauce'), btn('tp:porch', 'a.tpPorch')) : '') +
          (f.orchard ? sec('a.farm2') + grid(btn('tree:shake', 'a.treeShake'), btn('bees:me', 'a.beesMe'), btn('bringApples', 'a.bringApples')) : '') +
          (f.dairy ? sec('a.farm3') + grid(btn('bull:me', 'a.bullMe'), btn('bull:out', 'a.bullOut'), btn('bringRag', 'a.bringRag'), btn('cow:tip', 'a.cowTip'), btn('milk:spill', 'a.milkSpill'), btn('bringCheese', 'a.bringCheese')) : '') +
          (f.pumpkins ? sec('a.farm4') + grid(btn('lantern:out', 'a.lanternOut'), btn('lanterns:out', 'a.lanternsOut'), btn('lanterns:on', 'a.lanternsOn'), btn('bob:relight', 'a.bobRelight'), btn('catapult:me', 'a.catapultMe'), btn('catapult:fire', 'a.catapultFire'), btn('catapult:bob', 'a.catapultBob'), btn('bringPumpkin', 'a.bringPumpkin'), btn('giant:me', 'a.giantMe')) : '') +
          (f.winter ? sec('a.farm5') + grid(btn('snowman:down', 'a.snowmanDown'), btn('snowman:bob', 'a.snowmanBob'), btn('bringSnowball', 'a.bringSnowball'), btn('bigball:me', 'a.bigBall'), btn('bob:ice', 'a.bobIce'), btn('snowcoat', 'a.snowCoat')) : '') +
          (g.interiors?.rooms.length ? sec('a.interiors') + grid(btn('int:room', 'a.intRoom'), g.interiors.radios.length ? btn('int:radio', 'a.intRadio') : '', g.interiors.tvs.length ? btn('int:tv', 'a.intTv') : '',
            g.interiors.ovens.length ? btn('int:bake', 'a.intBake') : '', g.interiors.baths.length ? btn('int:bath', 'a.intBath') : '', btn('int:lure', 'a.intLure'),
            g.interiors.gramos.length ? btn('int:gramo', 'a.intGramo') : '', g.interiors.gramos.length ? btn('int:disco', 'a.intDisco') : '',
            g.interiors.sinks.length ? btn('int:sink', 'a.intSink') : '', g.interiors.sinks.length ? btn('int:tap', 'a.intTap') : '', g.interiors.hearths.length ? btn('int:fire', 'a.intFire') : '') : '') +
          sec('a.pranks') + grid(btn('pick', 'a.pick'), hasTp('garden') ? `<button data-tp="garden" class="tile"><b>📍</b>${short(t('a.tpGarden'))}</button>` : '');
        break;
      case 'owner': {
        // the owner (the user's account): coins / a level for anyone online (they get it in their own wallet)
        if (!this.usersHooked) { this.usersHooked = true; online.on('users', (m) => { this.users = m.users ?? []; if (ADMIN.open && this.aTab === 'owner') this.renderAdmin(); }); }
        const rows = this.users.filter((u) => !u.me).map((u) => `<div class="prow"><span>${u.google ? '🟢 ' : ''}${u.name.replace(/[<>&]/g, '')}${u.room ? ` · <b>${u.room}</b>` : ''}</span>` +
          `<div class="grid g3"><button data-gift="${u.id}:1000:0"><b>🪙</b>1K</button><button data-gift="${u.id}:10000:0"><b>💰</b>10K</button><button data-gift="${u.id}:100000:0"><b>🏦</b>100K</button><button data-gift="${u.id}:0:1"><b>⭐</b>+1</button><button data-gift="${u.id}:0:10"><b>🌟</b>+10</button>` +
          `<button data-grant="${u.id}:1" title="${tip('a.grant')}"><b>🛠️</b>✔</button><button data-grant="${u.id}:0" title="${tip('a.ungrant')}"><b>🛠️</b>✖</button></div></div>`).join('');
        body = `<div class="hint">👑 ${t('a.ownerHint')}</div>` + sec('a.users') + (online.connected ? rows || `<div class="hint">—</div>` : `<div class="hint">📡 ✖</div>`) +
          grid(`<button data-users="1" class="tile"><b>🔄</b>${short(t('a.refresh'))}</button>`);
        break;
      }
      case 'items':
        body = sec('a.shop') + `<div class="tiles"><button data-shop="coins" class="tile"><b>🪙</b>+1000</button><button data-shop="xp" class="tile"><b>⭐</b>+1</button><button data-shop="reset" class="tile" title="${tip('a.shopReset')}"><b>♻️</b>${short(t('a.shopReset'))}</button></div>` +
          grid(btn('gadget:cherryBomb', 'a.giveBomb'), btn('gadget:stinkBomb', 'a.giveStink'), btn('gadget:bone', 'a.giveBone')) +
          sec('a.snacks') + grid(btn('snack:canBeans', 'a.canBeans'), btn('snack:canSpinach', 'a.canSpinach'), btn('snack:canEnergy', 'a.canEnergy'), btn('snack:canDog', 'a.canDog'), btn('snack:cigPack', 'a.cigPack'), btn('smoke:me', 'a.smokeMe'), btn('boosts:all', 'a.allBoosts')) +
          sec('a.physics') + grid(btn('bringCrate', 'a.bringCrate'), btn('bringPig', 'a.bringPig'), btn('bringPot', 'a.bringPot'), btn('bringEgg', 'a.bringEgg'), btn('bringGnome', 'a.bringGnome'), btn('bringBone', 'a.bringBone'),
            btn('bringSafe', 'a.bringSafe'), btn('bring:tv', 'a.bringTv'), btn('bring:clock', 'a.bringClock'));
        break;
    }
    this.admin.innerHTML = `<div class="ahead"><b>🛠️</b>${t('a.title')}<button data-close="1">✕</button></div>` + crash +
      `<div class="atabs">${TABS.map(([k, ic, l]) => `<button data-tab="${k}" class="${this.aTab === k ? 'on' : ''}" title="${t(l)}"><b>${ic}</b>${t(l)}</button>`).join('')}</div>` + body;
    this.admin.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.aTab = b.dataset.tab as typeof this.aTab; this.renderAdmin(); }));
    this.admin.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const [i, k] = b.dataset.p!.split(':'); g.adminPig(Number(i), k, this.jailSecs); this.renderAdmin();
    }));
    this.admin.querySelectorAll<HTMLElement>('[data-tg]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tg as keyof typeof ADMIN;
      (ADMIN as any)[k] = !ADMIN[k];
      if (k === 'bob') g.farmer?.setEnabled(ADMIN.bob);
      if (k === 'fp') g.viewIcon();
      this.renderAdmin();
    }));
    this.admin.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => this.toggleAdmin());
    this.admin.querySelectorAll<HTMLElement>('[data-grant]').forEach((b) => b.addEventListener('click', () => { const [id, on] = b.dataset.grant!.split(':').map(Number); online.grant(id, on === 1); }));
    this.admin.querySelector<HTMLElement>('[data-fps]')?.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).dataset.v; if (v === undefined) return;
      SETTINGS.fps = v === '1'; saveSettings(); this.renderAdmin();
    });
    this.admin.querySelectorAll<HTMLInputElement>('input[data-r]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.r!, v = parseFloat(el.value);
      if (k === 'hour') g.daynight.setHour(v); else if (k === 'jailSecs') this.jailSecs = v; else (ADMIN as any)[k] = v;
      (this.admin.querySelector(`[data-val="${k}"]`) as HTMLElement).textContent = String(v);
    }));
    this.admin.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => {
      g.adminAction(b.dataset.a!);
      if (/^(mod:|alert:|jail:)/.test(b.dataset.a!)) this.renderAdmin();   // show what's on now
    }));
    this.admin.querySelectorAll<HTMLElement>('[data-tp]').forEach((b) => b.addEventListener('click', () => g.adminAction('tp:' + b.dataset.tp)));
    this.admin.querySelectorAll<HTMLElement>('[data-users]').forEach((b) => b.addEventListener('click', () => online.users()));
    this.admin.querySelectorAll<HTMLElement>('[data-gift]').forEach((b) => b.addEventListener('click', () => { const [id, c, l] = b.dataset.gift!.split(':').map(Number); online.gift(id, c, l); }));
    if (this.aTab === 'owner' && online.connected && !this.users.length) online.users();
    this.admin.querySelectorAll<HTMLElement>('[data-farm]').forEach((b) => b.addEventListener('click', () => {
      const f = b.dataset.farm as FarmId;
      if (f !== farmId()) { SETTINGS.farm = f; saveSettings(); reloadOnFarm(f, { admin: '1' }); }
    }));
    // shop test switches (my own coins / items: work for online players too)
    this.admin.querySelectorAll<HTMLElement>('[data-shop]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.shop;
      if (k === 'coins') SETTINGS.coins += 1000;
      if (k === 'xp') SETTINGS.xp = xpForLevel(level() + 1);
      if (k === 'reset') Object.assign(SETTINGS, { coins: 0, xp: 0, owned: [], gadgets: {}, loadout: '' });
      if (k === 'reset' && SETTINGS.outfit) SETTINGS.outfit = ownedOnly(SETTINGS.outfit);
      saveSettings();
      this.game.hud.toast(`${t('a.shop')}: ${SETTINGS.coins} · ${t('shop.level', { n: level() })}`, 1.4);
      this.onShop?.();
    }));
  }
}
