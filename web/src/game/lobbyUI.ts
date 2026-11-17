import { t, onLang, type Key } from '../i18n';
import { SETTINGS, saveSettings } from './settings';
import { walletHtml } from './wardrobe';
import { level } from './shop';
import { IC, kc } from './icons';
import { ICONS, SVG } from './hud';
import { fullIcon, toggleFull, onFull } from './fullscreen';
import { farmId, FARM_IDS, reloadOnFarm, type FarmId } from '../world/farms';
import { profile } from '../net/auth';
import { PLAYER_COLORS } from './game';

/** Little farm icons for the farm card: a red barn, an apple, a cheese wedge, a pumpkin, a snowman, a die. */
export const FARM_ICON: Record<string, string> = {
  farm1: '<svg viewBox="0 0 20 20"><path d="M2 9 10 3l8 6v9H2z" fill="#c8402e"/><path d="M7 18v-6h6v6" fill="#fff4e0"/><path d="M7 12l6 6M13 12l-6 6" stroke="#c8402e" stroke-width="1.4"/></svg>',
  farm2: '<svg viewBox="0 0 20 20"><circle cx="7.5" cy="12" r="5.5" fill="#e0302c"/><circle cx="12.5" cy="12" r="5.5" fill="#e0302c"/><path d="M10 7c0-2 1-4 2-5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><ellipse cx="13.5" cy="4.5" rx="3" ry="1.4" fill="#4fa636" transform="rotate(-25 13.5 4.5)"/></svg>',
  farm3: '<svg viewBox="0 0 20 20"><path d="M2 15 17 6v9z" fill="#ffd34d"/><path d="M2 15 17 6l-3-2z" fill="#ffe98a"/><circle cx="8" cy="13" r="1.3" fill="#d9a62c"/><circle cx="13" cy="11.5" r="1.6" fill="#d9a62c"/><circle cx="14.5" cy="14" r="0.9" fill="#d9a62c"/></svg>',
  farm4: '<svg viewBox="0 0 20 20"><ellipse cx="10" cy="11.5" rx="8" ry="6.5" fill="#f08a24"/><path d="M10 5c0-2 1-3 2-3.5" stroke="#5a3a1e" stroke-width="1.6" fill="none"/><path d="M5.5 9.5l2 1.6-2.2.4zM14.5 9.5l-2 1.6 2.2.4zM5.5 13.5l2 1 1.2-1 1.3 1 1.3-1 1.2 1 2-1-1.3 2.5h-6.4z" fill="#ffd34d"/></svg>',
  farm5: '<svg viewBox="0 0 20 20"><circle cx="10" cy="14" r="5.2" fill="#f4f8ff"/><circle cx="10" cy="7" r="3.6" fill="#f4f8ff"/><path d="M6.6 4.6h6.8v-.9H11.7V1h-3.4v2.7H6.6z" fill="#26232a"/><path d="M10 7.2l3.2.8-3.2.6z" fill="#ff7a1f"/><circle cx="8.8" cy="6.2" r=".55" fill="#26232a"/><circle cx="11" cy="6.2" r=".55" fill="#26232a"/><path d="M6.8 10h6.4" stroke="#d8342c" stroke-width="1.6"/></svg>',
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
      if (this.h.party() !== null) return;   // in a room: the room plays the host's farm
      if (!f) { this.farmPick = !this.farmPick; this.render(); return; }
      SETTINGS.farm = f; saveSettings();
      if (f === 'random') { const q = new URLSearchParams(location.search); q.delete('farm'); location.href = location.pathname + (q.size ? '?' + q : ''); }
      else if (f !== farmId()) reloadOnFarm(f);
      else { this.farmPick = false; this.render(); }
    });
    onFull(() => this.icons());
    onLang(() => this.render());
    this.render();
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
    const cur = SETTINGS.farm === 'random' ? 'random' : farmId(), inRoom = this.h.party() !== null;
    if (inRoom) this.farmPick = false;
    document.getElementById('lFarm')!.classList.toggle('locked', inRoom);
    document.getElementById('lFarm')!.innerHTML = `<div class="fcur">${FARM_ICON[farmId()]}<span><small>${t('title.farm')}</small><b>${t(('farm.' + farmId()) as Key)}</b></span><i>${this.farmPick ? '▾' : '▸'}</i></div>` +
      (this.farmPick ? `<div class="fpick">${[...FARM_IDS, 'random' as const].map((k) => `<button data-f="${k}" class="${k === cur ? 'on' : ''}">${FARM_ICON[k]}${t(('farm.' + k) as Key)}</button>`).join('')}</div>` : '');
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
      P(kc('Q'), ICONS.fart) + P(kc(t('key.space')), '<b class="kj">↑</b>') + P(kc('E'), ICONS.stand);
  }
}
