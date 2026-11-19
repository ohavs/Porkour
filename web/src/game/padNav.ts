/**
 * Gamepad in the menus (user: "full controller support"): whatever overlay is open (settings, admin, wardrobe & shop,
 * saves, the online lobby, results, the on-screen keyboard) gets a gold focus ring the D-pad / left stick moves to the
 * nearest button in that direction; A = press it, B = back (the same as Esc), Start = menu / resume, LB / RB = the
 * previous / next tab, right stick = scroll. Sliders: left / right change the value; text fields: A opens a pad
 * keyboard. The lobby is "soft": the pig still runs on the left stick — the D-pad shows the ring there (A presses
 * while it shows, moving the pig hides it), Start = PLAY.
 */
import type { Input } from '../core/input';
import { PADDEV } from './padGlyph';
import { t } from '../i18n';

export interface NavRoot {
  el: HTMLElement;
  /** The lobby: the pig keeps the pad, the ring only shows after a D-pad press. */
  soft?: boolean;
  /** B / Start (default: the same as an Esc press). */
  back?: () => void;
  /** Where the ring starts (a selector inside `el`). */
  def?: string;
}
export interface NavHooks {
  /** The topmost open menu the pad should drive (null = none: the pig has the pad). */
  root(): NavRoot | null;
  /** Start with no menu open (open the pause menu; the lobby: PLAY). */
  start(): void;
}

const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [data-pad], [data-a], [data-b], [data-s], [data-f], [data-g], [data-i], ' +
  '[data-v], [data-lang], [data-t], [data-tab], [data-inv], [data-join], [data-kick], .gd, [tabindex]:not([tabindex="-1"])';
const CSS = `
.padf { outline-style: solid !important; outline-width: 4px !important; outline-color: #fff6e6; outline-offset: 3px;
  box-shadow: 0 0 0 8px rgba(255,170,40,.85), 0 0 26px 6px rgba(255,209,102,.9) !important; animation: padPulse 0.9s ease-in-out infinite; }
@keyframes padPulse { 50% { outline-color: #ffb02e; } }
#padKeys { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(20,10,3,.5); z-index: 60; }
#padKeys.show { display: flex; }
#padKeys .panel { display: flex; flex-direction: column; gap: 8px; align-items: center; }
#padKeys .val { min-width: 300px; min-height: 34px; font-size: 22px; padding: 4px 12px; border-radius: 10px; background: rgba(0,0,0,.35); color: #fff6e6; text-align: center; letter-spacing: 2px; }
#padKeys .rows { display: grid; grid-template-columns: repeat(10, 40px); gap: 5px; }
#padKeys .rows button { height: 40px; font-size: 18px; padding: 0; }
#padKeys .wide { display: flex; gap: 8px; }
`;
const KEYS = '1234567890QWERTYUIOPASDFGHJKL-ZXCVBNM_.@';

export class PadNav {
  private cur: HTMLElement | null = null;
  private sig = '';
  private lastRect: DOMRect | null = null;
  private rootEl: HTMLElement | null = null;
  private prev: boolean[] = [];
  private rep = { dir: '', t: 0 };
  /** Lobby: the ring is showing (A / B go to the menu, not the pig). */
  private ring = false;
  private kb: { el: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement; val: HTMLElement; text: string } | null = null;
  private last = performance.now();

  constructor(private input: Input, private hooks: NavHooks) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    // the mouse / keyboard took over: no ring
    addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) this.hide(); });
    addEventListener('keydown', (e) => { if (e.isTrusted && e.code !== 'Escape') this.hide(); });
    const loop = () => { this.step(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  /** The ring is up (tests). */
  get focused() { return this.cur; }

  private hide() { this.ring = false; this.setCur(null); }

  private step() {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
    const root: NavRoot | null = this.kb ? { el: this.kb.el, back: () => this.closeKb(false), def: '[data-k="ok"]' } : this.hooks.root();
    const on = (i: number) => !!pad?.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
    const hit = (i: number) => on(i) && !this.prev[i];
    if (root?.el !== this.rootEl) { this.rootEl = root?.el ?? null; this.setCur(null); if (!root?.soft) this.ring = false; }
    // which pad buttons the game must not see
    this.input.padBlock = !!root && !root.soft;
    this.input.padSkip = root?.soft ? (0xf << 12) | (1 << 9) | (this.ring ? 3 : 0) : 0;
    if (!pad) { this.prev = []; if (root && !root.soft && this.cur && !this.cur.isConnected) this.restore(root); return; }
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    if (!root) {
      this.setCur(null);
      if (hit(9)) this.hooks.start();
    } else {
      const soft = !!root.soft;
      // direction: D-pad (always) or the left stick (not in the lobby: it walks the pig there)
      let dir = on(12) ? 'u' : on(13) ? 'd' : on(14) ? 'l' : on(15) ? 'r' : '';
      if (!dir && !soft) dir = Math.abs(ax) > 0.55 && Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'r' : 'l') : Math.abs(ay) > 0.55 ? (ay > 0 ? 'd' : 'u') : '';
      if (soft) {
        if (Math.hypot(ax, ay) > 0.5 || hit(2) || hit(3) || hit(6) || hit(7)) this.hide();   // playing with the pig again
        if (hit(9)) { this.hooks.start(); this.hide(); }
      }
      if (dir) {
        const first = dir !== this.rep.dir;
        this.rep.t = first ? 0.38 : this.rep.t - dt;
        if (first || this.rep.t <= 0) {
          if (!first) this.rep.t = 0.11;
          this.rep.dir = dir;
          if (soft && !this.ring) { this.ring = true; this.restore(root); }   // first press: just show where it is
          else if (!this.cur || !this.cur.isConnected) this.restore(root);
          else if (!this.adjust(dir)) this.move(root, dir);
        }
      } else this.rep.dir = '';
      if (!soft || this.ring) {
        if (!soft && (!this.cur || !this.cur.isConnected || !this.visible(this.cur) || !root.el.contains(this.cur))) this.restore(root);
        if (hit(0) && this.cur) this.activate(this.cur);
        else if (hit(1)) { if (soft) this.hide(); else (root.back ?? escape)(); }
        else if (hit(9) && !soft) (root.back ?? escape)();
        else if (hit(4) || hit(5)) this.tab(root, hit(5) ? 1 : -1);
        if (this.cur && !this.cur.isConnected) this.restore(root);
        // right stick: scroll the list the ring is in
        const ry = pad.axes[3] ?? 0;
        if (Math.abs(ry) > 0.2) (this.scroller(this.cur ?? root.el) ?? root.el).scrollBy(0, ry * 900 * dt);
      }
    }
    this.prev = pad.buttons.map((_, i) => on(i));
  }

  // ------------------------------------------------------------------ focus
  private setCur(el: HTMLElement | null) {
    if (el === this.cur) return;
    this.cur?.classList.remove('padf');
    this.cur = el;
    if (el) {
      el.classList.add('padf');
      this.sig = sigOf(el); this.lastRect = el.getBoundingClientRect();
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }
  private visible(el: HTMLElement) {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && !(el as HTMLButtonElement).disabled;
  }
  private items(root: HTMLElement) {
    const all = [...root.querySelectorAll<HTMLElement>(SEL)].filter((e) => this.visible(e));
    const set = new Set(all);
    // the outermost clickable thing (a tile, not the picture inside it)
    return all.filter((e) => { for (let p = e.parentElement; p && p !== root; p = p.parentElement) if (set.has(p) && !(p.tagName === 'LABEL')) return false; return true; });
  }
  /** Put the ring back: the same thing after a re-render, else the nearest to where it was, else the default. */
  private restore(root: NavRoot) {
    const list = this.items(root.el);
    if (!list.length) { this.setCur(null); return; }
    let pick = this.sig ? list.find((e) => sigOf(e) === this.sig) : undefined;
    if (!pick && this.cur && this.lastRect && root.el === this.rootEl && this.sig) {
      const c = center(this.lastRect);
      pick = list.reduce((a, b) => (dist(center(b.getBoundingClientRect()), c) < dist(center(a.getBoundingClientRect()), c) ? b : a));
    }
    if (!pick) {
      // the default: the first selector (in the order given) that names something visible
      for (const sel of root.def?.split(',') ?? []) {
        const d = root.el.querySelector<HTMLElement>(sel.trim());
        pick = d && this.visible(d) ? list.find((e) => e === d || e.contains(d)) : undefined;
        if (pick) break;
      }
      pick = pick
        ?? list.find((e) => e.matches('.chip.big, .playBtn, .go')) ?? list.find((e) => e.matches('.on')) ?? list[0];
    }
    this.cur = null;
    this.setCur(pick);
  }
  /** The nearest thing in that direction (in its row / column first). */
  private move(root: NavRoot, dir: string) {
    const from = this.cur!.getBoundingClientRect(), c = center(from);
    const h = dir === 'l' || dir === 'r', s = dir === 'r' || dir === 'd' ? 1 : -1;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const e of this.items(root.el)) {
      if (e === this.cur) continue;
      const r = e.getBoundingClientRect(), p = center(r);
      const along = ((h ? p.x - c.x : p.y - c.y) * s);
      const edge = h ? (s > 0 ? r.left - from.right : from.left - r.right) : (s > 0 ? r.top - from.bottom : from.top - r.bottom);
      if (along <= 2 || edge < -Math.min(h ? from.width : from.height, h ? r.width : r.height) * 0.5) continue;
      const gap = h ? Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom)) : Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
      const score = Math.max(0, edge) + along * 0.3 + gap * 3 + Math.abs(h ? p.y - c.y : p.x - c.x) * 0.15;
      if (score < bs) { bs = score; best = e; }
    }
    if (best) this.setCur(best);
  }
  /** Sliders / dropdowns: left / right change the value instead of moving away. */
  private adjust(dir: string) {
    const el = this.cur;
    if (!el || (dir !== 'l' && dir !== 'r')) return false;
    const d = dir === 'r' ? 1 : -1;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, step = +el.step || (max - min) / 20;
      const v = Math.min(max, Math.max(min, +el.value + d * Math.max(step, (max - min) / 20)));
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      el.selectedIndex = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + d));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  private activate(el: HTMLElement) {
    if ((el instanceof HTMLInputElement && /^(text|search|email|url|)$/.test(el.type) && !el.readOnly) || el instanceof HTMLTextAreaElement) { this.openKb(el); return; }
    if (el instanceof HTMLInputElement && el.type === 'range') return;
    if (el instanceof HTMLSelectElement) { this.adjust('r'); return; }
    el.click();
  }
  /** LB / RB: the tab row of this menu (admin tabs, wardrobe categories). */
  private tab(root: NavRoot, d: number) {
    const row = root.el.querySelector<HTMLElement>('.atabs, #wTabs');
    if (!row) return;
    const tabs = [...row.children].filter((e): e is HTMLElement => e instanceof HTMLElement && this.visible(e));
    const i = tabs.findIndex((e) => e.classList.contains('on'));
    const next = tabs[(Math.max(0, i) + d + tabs.length) % tabs.length];
    if (!next) return;
    const keep = this.cur && row.contains(this.cur);
    next.click();
    if (keep) { this.sig = sigOf(next); }
  }
  private scroller(el: HTMLElement) {
    for (let p: HTMLElement | null = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  }

  // ------------------------------------------------------------------ pad keyboard (room code, name, chat)
  private openKb(input: HTMLInputElement | HTMLTextAreaElement) {
    const el = document.createElement('div'); el.id = 'padKeys'; el.className = 'show txt';
    const k = (c: string) => `<button class="chip" data-k="${c}">${c}</button>`;
    el.innerHTML = `<div class="panel"><div class="val"></div><div class="rows">${[...KEYS].map(k).join('')}</div>` +
      `<div class="wide"><button class="chip" data-k="sp">␣</button><button class="chip" data-k="bs">⌫</button><button class="chip big" data-k="ok">✔ ${t('w.done')}</button></div></div>`;
    document.body.appendChild(el);
    const kb = { el, input, val: el.querySelector<HTMLElement>('.val')!, text: input.value };
    const max = input.maxLength > 0 ? input.maxLength : 64;
    const show = () => { kb.val.textContent = kb.text || '…'; };
    el.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k; if (!c) return;
      if (c === 'ok') { this.closeKb(true); return; }
      if (c === 'bs') kb.text = kb.text.slice(0, -1);
      else if (kb.text.length < max) kb.text += c === 'sp' ? ' ' : c;
      show();
    });
    this.kb = kb; show();
    this.sig = ''; this.setCur(null);
  }
  private closeKb(ok: boolean) {
    const kb = this.kb; if (!kb) return;
    this.kb = null; kb.el.remove();
    if (ok) {
      kb.input.value = kb.text;
      kb.input.dispatchEvent(new Event('input', { bubbles: true })); kb.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.sig = sigOf(kb.input); this.cur = null; this.rootEl = null;
  }
}

/** Esc, as if pressed on the keyboard (every overlay already closes on it). */
function escape() { dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); }
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Something that names a button across re-renders (menus rebuild their html on every click). */
function sigOf(el: HTMLElement) {
  let s = el.tagName + (el.id ? '#' + el.id : '');
  for (const a of [...el.attributes].sort((x, y) => (x.name < y.name ? -1 : 1))) if (a.name.startsWith('data-') && a.name !== 'data-i18n') s += `[${a.name}=${a.value}]`;
  if (s === el.tagName) s += ':' + (el.textContent ?? '').trim().slice(0, 24);
  return s;
}
export const padActive = () => PADDEV.on;
