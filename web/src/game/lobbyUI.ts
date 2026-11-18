import { t, onLang, type Key } from '../i18n';
import { SETTINGS, saveSettings } from './settings';
import { walletHtml } from './wardrobe';
import { level } from './shop';
import { IC, kc } from './icons';
import { ICONS, SVG } from './hud';
import { fullIcon, toggleFull, onFull } from './fullscreen';
import { farmId, FARM_IDS, reloadOnFarm, STORY, MODES, stageOf, type FarmId } from '../world/farms';
import { canAdmin } from '../net/auth';
import { saves, slot, storyWon, newGame, loadGame, deleteSave, saveLabel, SLOTS } from './saves';
/** A story stage is open once the one before is won in the save in use (the owner / admins: all). */
const unlocked = (f: FarmId) => canAdmin() || stageOf(f) <= storyWon() + 1;
import { online } from '../net/online';
/** "Random" in a room: one of the regular farms (not the chain modes). */
const RANDOM_FARMS = FARM_IDS.filter((f) => f !== 'farm6' && f !== 'farm7');
import { profile } from '../net/auth';
import { PLAYER_COLORS } from './game';

/** Little farm icons for the farm card: a red barn, an apple, a cheese wedge, a pumpkin, a snowman, a die. */
export const FARM_ICON: Record<string, string> = {
  farm1: '<svg viewBox="0 0 20 20"><path d="M2 9 10 3l8 6v9H2z" fill="#c8402e"/><path d="M7 18v-6h6v6" fill="#fff4e0"/><path d="M7 12l6 6M13 12l-6 6" stroke="#c8402e" stroke-width="1.4"/></svg>',
  farm2: '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="12" r="5.5" fill="#e0302c"/><circle cx="12.5" cy="12" r="5.5" fill="#e0302c"/><path d="M10 7c0-2 1-4 2-5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><ellipse cx="13.5" cy="4.5" rx="3" ry="1.4" fill="#4fa636" transform="rotate(-25 13.5 4.5)"/></svg>',
  farm3: '<svg viewBox="0 0 20 20"><path d="M2 15 17 6v9z" fill="#ffd34d"/><path d="M2 15 17 6l-3-2z" fill="#ffe98a"/><circle cx="8" cy="13" r="1.3" fill="#d9a62c"/><circle cx="13" cy="11.5" r="1.6" fill="#d9a62c"/><circle cx="14.5" cy="14" r="0.9" fill="#d9a62c"/></svg>',
  farm4: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="11.5" rx="8" ry="6.5" fill="#f08a24"/><path d="M10 5c0-2 1-3 2-3.5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><path d="M5.5 9.5l2 1.6-2.2.4zM14.5 9.5l-2 1.6 2.2.4zM5.5 13.5l2 1 1.2-1 1.3 1 1.3-1 1.2 1 2-1-1.3 2.5h-6.4z" fill="#ffd34d"/></svg>',
  farm5: '<svg viewBox="0 0 20 20"><circle cx="10" cy="14" r="5.2" fill="#f4f8ff"/><circle cx="10" cy="7" r="3.6" fill="#f4f8ff"/><path d="M6.6 4.6h6.8v-.9H11.7V1h-3.4v2.7H6.6z" fill="#26232a"/><path d="M10 7.2l3.2.8-3.2.6z" fill="#ff7a1f"/><circle cx="8.8" cy="6.2" r=".55" fill="#26232a"/><circle cx="11" cy="6.2" r=".55" fill="#26232a"/><path d="M6.8 10h6.4" stroke="#d8342c" stroke-width="1.6"/></svg>',
  farm6: '<svg viewBox="0 0 20 20"><g fill="#5cb83d" stroke="#2f6a22" stroke-width=".6"><path d="M10 11C9 7 9 4 10 1c1 3 1 6 0 10z"/><path d="M10 11C8 8.5 5.5 7 2.5 6.5c1.2 2.5 4 4 7.5 4.5z"/><path d="M10 11c2-2.5 4.5-4 7.5-4.5-1.2 2.5-4 4-7.5 4.5z"/><path d="M10 11.5c-2.5-.4-5 0-7.5 1.6 2.5.8 5 .3 7.5-1.6z"/><path d="M10 11.5c2.5-.4 5 0 7.5 1.6-2.5.8-5 .3-7.5-1.6z"/></g><path d="M10 11v8" stroke="#2f6a22" stroke-width="1.2"/></svg>',
  farm7: '<svg viewBox="0 0 20 20"><rect x="4" y="6" width="9" height="12" rx="1.6" fill="#ffc23a"/><path d="M13 8.5h1.8a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H13" fill="none" stroke="#fff4e0" stroke-width="1.6"/><path d="M3.5 7a2.2 2.2 0 0 1 2.6-3A2.6 2.6 0 0 1 11 3.5a2.2 2.2 0 0 1 2.6 3.5z" fill="#fffaf0"/></svg>',
  random: '<svg viewBox="0 0 20 20"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="#fff4e0"/><g fill="#3b2412"><circle cx="6.5" cy="6.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="6.5" cy="13.5" r="1.5"/></g></svg>',
};
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface LobbyHooks {
  play(): void; wardrobe(): void; shop(): void; online(): void; settings(): void; sound(): void; muted(): boolean;
  /** Online room: the party panel html + its wiring (null = not in a room); the big button ('start' | 'wait' | 'play'). */
  party(): string | null; wireParty(el: HTMLElement): void; playMode(): 'play' | 'start' | 'wait';
}

/**
 * The lobby screen around the stage (user: "Fortnite style"): a top bar (Play / Wardrobe / Shop / Online, wallet,
 * sound, full screen, settings), the party on the left, the controls as icons bottom-left, the farm card and a big
 * PLAY button bottom-right. The middle stays clear: your pig plays there.
 */
export class LobbyUI {
  el = document.getElementById('lobbyUI')!;
  private party = document.getElementById('lParty')!;
  private farmPick = false;
  /** In a room as its host, still in the lobby: I choose the room's farm. */
  private roomHost() { return online.isHost && online.room?.state === 'lobby'; }

  constructor(private h: LobbyHooks) {
    this.el.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = b.dataset.t;
      if (k === 'wardrobe') h.wardrobe(); if (k === 'shop') h.shop(); if (k === 'online') h.online();
    }));
    document.getElementById('lPlay')!.addEventListener('click', (e) => { e.stopPropagation(); if (h.playMode() !== 'wait') h.play(); });
    document.getElementById('lSet')!.addEventListener('click', (e) => { e.stopPropagation(); h.settings(); });
    document.getElementById('lSound')!.addEventListener('click', (e) => { e.stopPropagation(); h.sound(); this.icons(); });
    document.getElementById('lFull')!.addEventListener('click', (e) => { e.stopPropagation(); toggleFull(); });
    document.getElementById('lFarm')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')?.dataset.f as FarmId | 'random' | undefined;
      // in a room: the host picks the room's farm (every page reloads onto it, the room waits); players can't
      if (this.h.party() !== null) {
        if (!this.roomHost()) return;
        if (!f) { this.farmPick = !this.farmPick; this.render(); return; }
        const pick = f === 'random' ? RANDOM_FARMS[Math.floor(Math.random() * RANDOM_FARMS.length)] : f;
        this.farmPick = false;
        if (pick !== farmId()) online.setRoom({ farm: pick }); else this.render();
        return;
      }
      if (!f) { this.farmPick = !this.farmPick; this.render(); return; }
      if (f !== 'random' && !unlocked(f)) return;   // locked stage
      SETTINGS.farm = f; saveSettings();
      if (f === 'random') { const q = new URLSearchParams(location.search); q.delete('farm'); location.href = location.pathname + (q.size ? '?' + q : ''); }
      else if (f !== farmId()) reloadOnFarm(f);
      else { this.farmPick = false; this.render(); }
    });
    // story saves (💾 above the farm card): solo / the room's host load one or start a new game; players see the host's
    this.saveBtn.id = 'lSave'; this.saveBtn.className = 'saveChip';
    document.getElementById('lPlayBox')!.prepend(this.saveBtn);
    this.saveBtn.addEventListener('click', (e) => { e.stopPropagation(); if (this.h.party() === null || this.roomHost()) this.openSaves(); });
    this.savesEl.id = 'saves'; this.savesEl.className = 'overlay txt';
    document.body.appendChild(this.savesEl);
    this.savesEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!b) { if (e.target === this.savesEl) this.closeSaves(); return; }
      const [act, n] = [b.dataset.s!, Number(b.dataset.i)];
      if (act === 'close') return this.closeSaves();
      // overwriting / deleting a save: click twice
      if ((act === 'new' && saves()[n]) || act === 'del') { if (this.confirm !== act + n) { this.confirm = act + n; this.renderSaves(); return; } }
      this.confirm = '';
      if (act === 'del') { deleteSave(n); this.renderSaves(); this.render(); return; }
      if (act === 'new') newGame(n); else loadGame(n);
      this.goOn();
    });
    onFull(() => this.icons());
    onLang(() => { this.render(); if (this.savesOpen) this.renderSaves(); });
    this.render();
  }
  private saveBtn = document.createElement('button');
  private savesEl = document.createElement('div');
  private confirm = '';
  private sentSave: string | null = null;
  get savesOpen() { return this.savesEl.classList.contains('show'); }
  openSaves() { this.confirm = ''; this.renderSaves(); this.savesEl.classList.add('show'); }
  closeSaves() { this.savesEl.classList.remove('show'); }
  /** After loading / starting a save: on to its next story stage (in a room: the whole room goes there). */
  private goOn() {
    this.closeSaves();
    const next = STORY[Math.min(STORY.length, storyWon() + 1) - 1];
    if (this.h.party() !== null) {
      if (!this.roomHost()) return;
      this.sentSave = saveLabel();
      online.setRoom(next !== farmId() ? { save: this.sentSave, farm: next } : { save: this.sentSave });
      this.render();
      return;
    }
    SETTINGS.farm = next; saveSettings();
    if (next !== farmId()) reloadOnFarm(next); else this.render();
  }
  /** The saves card: 5 slots, each = its stages (won ones lit), who played, when; load / new / delete. */
  private renderSaves() {
    const cur = slot(), list = saves();
    const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const rows = Array.from({ length: SLOTS }, (_, i) => {
      const s = list[i];
      if (!s) return `<div class="sslot empty"><em>${i + 1}</em><div class="sinfo"><span class="dim">${t('save.empty')}</span></div>` +
        `<div class="sbtns"><button class="chip" data-s="new" data-i="${i}">＋ ${t('save.new')}</button></div></div>`;
      const pips = STORY.map((f, k) => `<i class="${k < s.stage ? 'won' : k === s.stage ? 'next' : ''}" title="${t('lobby.stage', { n: k + 1 })}">${FARM_ICON[f]}${k < s.stage ? '<u>★</u>' : ''}</i>`).join('');
      const stars = s.stars.reduce((a, b) => a + (b ?? 0), 0);
      const who = s.names.map((n, k) => `<span><i class="dot" style="background:${hex(PLAYER_COLORS[k % PLAYER_COLORS.length])}"></i>${esc(n)}</span>`).join('');
      const ask = (a: string) => this.confirm === a + i;
      return `<div class="sslot${i === cur ? ' on' : ''}"><em>${i + 1}</em><div class="sinfo"><div class="spips">${pips}</div>` +
        `<div class="smeta">${who}<span class="dim">${stars ? `⭐${stars} · ` : ''}${date(s.at)}</span></div></div><div class="sbtns">` +
        (i === cur ? `<span class="inuse" title="${t('save.inUse')}">✔</span>` : `<button class="chip go" data-s="load" data-i="${i}">▶ ${t('save.load')}</button>`) +
        `<button class="chip sm${ask('new') ? ' warn' : ''}" data-s="new" data-i="${i}" title="${t('save.restart')}">${ask('new') ? '?' : '↺'}</button>` +
        `<button class="chip sm${ask('del') ? ' warn' : ''}" data-s="del" data-i="${i}" title="${t('save.delete')}">${ask('del') ? '?' : '🗑'}</button></div></div>`;
    }).join('');
    this.savesEl.innerHTML = `<div class="panel savesCard"><div class="shead"><h2>💾 ${t('save.title')}</h2><button class="x" data-s="close">✕</button></div>${rows}</div>`;
  }

  show() { this.el.classList.add('show'); this.render(); }
  hide() { this.el.classList.remove('show'); }

  private icons() {
    const set = (id: string, svg: string) => { const b = document.getElementById(id)!; b.innerHTML = svg; };
    set('lSound', this.h.muted() ? SVG.soundOff : SVG.soundOn);
    set('lFull', fullIcon());
    set('lSet', SVG.menu);
  }

  /** Everything that can change: wallet, party, farm card, the big button. */
  render() {
    this.icons();
    document.getElementById('tWallet')!.innerHTML = walletHtml();
    // farm card (click: pick another farm)
    const cur = SETTINGS.farm === 'random' ? 'random' : farmId(), inRoom = this.h.party() !== null, locked = inRoom && !this.roomHost();
    if (locked) this.farmPick = false;
    document.getElementById('lFarm')!.classList.toggle('locked', locked);
    // story stages (numbered, locked until the one before is won) + the separate modes
    const st = stageOf(farmId());
    const pickBtn = (k: FarmId) => { const ok = unlocked(k), n = stageOf(k);
      return `<button data-f="${k}" class="${k === cur ? 'on' : ''}${ok ? '' : ' lock'}" title="${ok ? '' : t('lobby.locked')}">${n ? `<em>${n}</em>` : ''}${FARM_ICON[k]}<span>${t(('farm.' + k) as Key)}</span>${ok ? (n && n <= storyWon() ? '<u>★</u>' : '') : '<u>🔒</u>'}</button>`; };
    document.getElementById('lFarm')!.innerHTML = `<div class="fcur">${FARM_ICON[farmId()]}<span><small>${st ? t('lobby.stage', { n: st }) : t('lobby.modes')}</small><b>${t(('farm.' + farmId()) as Key)}</b></span><i>${this.farmPick ? '▾' : '▸'}</i></div>` +
      (this.farmPick ? `<div class="fpick"><div class="fgrp">📖 ${t('lobby.story')}</div>${STORY.map(pickBtn).join('')}` +
        `<button data-f="random" class="${cur === 'random' ? 'on' : ''}">${FARM_ICON.random}<span>${t('farm.random')}</span></button>` +
        `<div class="fgrp">🎮 ${t('lobby.modes')}</div>${MODES.map(pickBtn).join('')}</div>` : '');
    // the save chip: mine (solo / host: click = the saves card) or the host's (players: just shown)
    const roomSave = online.room?.save ?? '';
    if (inRoom && !this.roomHost()) { this.saveBtn.innerHTML = roomSave ? `<span>${esc(roomSave)}</span>` : ''; this.saveBtn.classList.add('ro'); this.saveBtn.style.display = roomSave ? '' : 'none'; }
    else {
      const lab = saveLabel();
      this.saveBtn.classList.remove('ro'); this.saveBtn.style.display = '';
      this.saveBtn.innerHTML = lab ? `<span>${esc(lab)}</span><i>▸</i>` : `<span>💾 ${t('save.title')}</span><i>▸</i>`;
      this.saveBtn.title = t('save.title');
      // the room shows the host's save to everyone
      if (this.roomHost() && roomSave !== lab && this.sentSave !== lab) { this.sentSave = lab; online.setRoom({ save: lab }); }
    }
    // the big button
    const mode = this.h.playMode(), btn = document.getElementById('lPlay')!;
    btn.textContent = t(mode === 'start' ? 'lobby.start' : mode === 'wait' ? 'lobby.wait' : 'lobby.play');
    btn.classList.toggle('wait', mode === 'wait');
    // the party: you + your friends (online room), or you + "invite" slots
    const room = this.h.party();
    if (room !== null) { this.party.innerHTML = room; this.h.wireParty(this.party); }
    else {
      this.party.innerHTML = `<div class="ptitle">${t('lobby.party')}</div>` +
        `<div class="pslot me"><i class="dot" style="background:${hex(PLAYER_COLORS[0])}"></i><b>${esc(profile.name)}</b><span class="lv">${t('shop.level', { n: level() })}</span></div>` +
        [1, 2, 3].map((i) => `<button class="pslot add" data-inv="1"><i class="dot" style="background:${hex(PLAYER_COLORS[i])}"></i>+</button>`).join('');
      this.party.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.h.online(); }));
    }
    // controls as icons (no sentences)
    const P = (...xs: string[]) => `<span class="pp">${xs.join('')}</span>`;
    document.getElementById('lKeys')!.innerHTML = P(kc('W'), kc('A'), kc('S'), kc('D'), IC.walk) + P(IC.rmb, IC.grab) + P(IC.lmb, IC.fist) + P(IC.lmb, IC.hold, IC.throw) +
      P(kc('Q'), ICONS.fart) + P(kc(t('key.space')), '<b class="kj">↑</b>') + P(kc('E'), ICONS.stand) + P(kc('V'), IC.eye);
  }
}
