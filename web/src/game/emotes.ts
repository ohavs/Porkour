import { t, type Key } from '../i18n';

/**
 * The emote wheel (user: "a dance wheel like Fortnite, a few dances to start — few, but each one well made and funny").
 * Hold B (gamepad: D-pad left), move the mouse / right stick toward a dance, let go = dance. In the lobby the pointer
 * picks. A dance plays until you move or do anything (pig.ts `startDance`, the moves are in pigVisual.ts `danceStep`).
 */
const S = (body: string) => `<svg viewBox="0 0 48 48" width="46" height="46">${body}</svg>`;
const O = 'stroke="#3b2412" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
export const DANCES: { id: number; key: Key; icon: string }[] = [
  { id: 1, key: 'em.hula' as Key, icon: S(`<circle cx="24" cy="17" r="10" fill="#ffb3c7" ${O}/><circle cx="30" cy="9" r="4" fill="#ff6fa8" ${O}/><circle cx="30" cy="9" r="1.4" fill="#ffd166"/><path d="M12 28h24l-2 14H14z" fill="#7cc95a" ${O}/><path d="M17 29v12M22 29v13M27 29v13M32 29v12" stroke="#3f8a32" stroke-width="1.6"/><circle cx="21" cy="16" r="1.4" fill="#3b2412"/><circle cx="27" cy="16" r="1.4" fill="#3b2412"/>`) },
  { id: 2, key: 'em.robot' as Key, icon: S(`<rect x="12" y="13" width="24" height="20" rx="3" fill="#c9ced8" ${O}/><path d="M24 13V6" ${O}/><circle cx="24" cy="5" r="2.6" fill="#ff5a3c" ${O}/><rect x="16" y="18" width="6" height="5" rx="1" fill="#4fd8ff" ${O}/><rect x="26" y="18" width="6" height="5" rx="1" fill="#4fd8ff" ${O}/><path d="M18 28h12" ${O}/><path d="M18 28v2M22 28v2M26 28v2M30 28v2" stroke="#3b2412" stroke-width="1.4"/><path d="M9 38l5-5M39 38l-5-5" ${O}/>`) },
  { id: 3, key: 'em.disco' as Key, icon: S(`<circle cx="24" cy="26" r="13" fill="#c9ced8" ${O}/><path d="M11 26h26M24 13v26M14 19h20M14 33h20M18 15v22M30 15v22" stroke="#8a93a0" stroke-width="1.4"/><path d="M24 13V5" ${O}/><path d="M38 9l2-4M41 13l4-1M8 11l-3-3" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round"/><circle cx="19" cy="21" r="2.2" fill="#fff"/>`) },
  { id: 4, key: 'em.spin' as Key, icon: S(`<ellipse cx="24" cy="30" rx="11" ry="8" fill="#ffb3c7" ${O}/><path d="M16 24l-3-6M22 23l-1-7M27 23l2-7M32 25l4-5" ${O}/><path d="M8 34a17 9 0 0 0 32 0" fill="none" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round"/><path d="M40 34l1-5-5 2" fill="none" stroke="#ffd166" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: 5, key: 'em.chicken' as Key, icon: S(`<circle cx="22" cy="24" r="11" fill="#fff6e6" ${O}/><path d="M18 13c1-4 4-5 5-2 1-3 5-2 4 2" fill="#ff5a3c" ${O}/><path d="M33 23l7 2-7 3z" fill="#ffb13a" ${O}/><circle cx="26" cy="21" r="1.8" fill="#3b2412"/><path d="M28 30c0 3-2 4-3 4" fill="none" stroke="#ff5a3c" stroke-width="2.4" stroke-linecap="round"/><path d="M10 26c-3-2-4-6-2-8M12 31c-4 0-6-3-6-5" fill="none" ${O}/>`) },
  { id: 6, key: 'em.wiggle' as Key, icon: S(`<circle cx="24" cy="27" r="13" fill="#ffb3c7" ${O}/><path d="M24 15v24" stroke="#e8869f" stroke-width="1.6"/><path d="M33 16c4-2 7 1 5 4s-6 0-3-3" fill="none" stroke="#ff8fb0" stroke-width="2.6" stroke-linecap="round"/><path d="M6 22l3 3M42 30l3 2M5 31l4 0" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/>`) },
];

const CSS = `
#emoteWheel { position: fixed; left: 50%; top: 50%; width: 360px; height: 360px; margin: -180px 0 0 -180px; border-radius: 50%; z-index: 30; display: none;
  background: radial-gradient(circle, rgba(74,42,18,.55) 0 30%, rgba(92,56,28,.92) 31% 99%); box-shadow: 0 0 0 4px #3b2412, inset 0 0 0 4px #ffd166, 0 10px 30px rgba(0,0,0,.45); pointer-events: auto; }
#emoteWheel.show { display: block; animation: ewIn .14s ease-out; }
@keyframes ewIn { from { transform: scale(.7); opacity: 0; } }
#emoteWheel .ew { position: absolute; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: linear-gradient(#fff6e6, #f0dcb8); box-shadow: 0 0 0 3px #3b2412, 0 4px 0 #3b2412; cursor: pointer; transition: transform .08s; font: 13px Title, sans-serif; color: #3b2412; }
#emoteWheel .ew.on { background: linear-gradient(#ffe7a3, #ffc94a); transform: scale(1.16); box-shadow: 0 0 0 3px #3b2412, 0 4px 0 #3b2412, 0 0 18px rgba(255,209,102,.9); }
#emoteWheel .mid { position: absolute; left: 50%; top: 50%; width: 120px; margin-left: -60px; transform: translateY(-50%); text-align: center; font: 18px Title, sans-serif; color: #ffd166; text-shadow: 0 2px 0 #3b2412; pointer-events: none; }
#emoteWheel .mid small { display: block; font-size: 12px; color: #fff6e6; opacity: .8; }
`;

export class EmoteWheel {
  isOpen = false;
  private el: HTMLDivElement;
  private tiles: HTMLDivElement[] = [];
  private mid: HTMLDivElement;
  private ax = 0; private ay = 0; private sel = -1;
  /** A tile was clicked (lobby / free pointer): this dance, picked at once. */
  onPick?: (id: number) => void;

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'emoteWheel';
    DANCES.forEach((d, i) => {
      const a = (i / DANCES.length) * Math.PI * 2, el = document.createElement('div');
      el.className = 'ew'; el.style.left = `${180 + Math.sin(a) * 122}px`; el.style.top = `${180 - Math.cos(a) * 122}px`;
      el.innerHTML = d.icon;
      el.addEventListener('mouseenter', () => this.select(i));
      el.addEventListener('mousedown', (e) => { e.stopPropagation(); this.select(i); this.onPick?.(this.close()); });
      this.el.appendChild(el); this.tiles.push(el);
    });
    this.mid = document.createElement('div'); this.mid.className = 'mid'; this.el.appendChild(this.mid);
    document.body.appendChild(this.el);
  }
  open() {
    if (this.isOpen) return;
    this.isOpen = true; this.ax = this.ay = 0; this.select(-1);
    this.el.classList.add('show');
  }
  /** Closes it; returns the dance picked (0 = none). */
  close() {
    if (!this.isOpen) return 0;
    this.isOpen = false; this.el.classList.remove('show');
    const id = this.sel >= 0 ? DANCES[this.sel].id : 0;
    this.select(-1);
    return id;
  }
  /** Mouse (locked) / stick movement while it's open: steer toward a tile. dx, dy in "screens" (≈ 0.3 = a clear flick). */
  feed(dx: number, dy: number) {
    this.ax += dx; this.ay += dy;
    const l = Math.hypot(this.ax, this.ay);
    if (l > 1) { this.ax /= l; this.ay /= l; }
    if (l > 0.3) this.pickAngle(this.ax, this.ay);
  }
  /** Gamepad stick: the direction it's held in. */
  stick(x: number, y: number) { if (Math.hypot(x, y) > 0.5) this.pickAngle(x, y); }
  private pickAngle(x: number, y: number) {
    const a = Math.atan2(x, -y), n = DANCES.length;
    this.select(((Math.round(a / ((Math.PI * 2) / n)) % n) + n) % n);
  }
  private select(i: number) {
    this.sel = i;
    this.tiles.forEach((el, k) => el.classList.toggle('on', k === i));
    this.mid.innerHTML = i >= 0 ? `${t(DANCES[i].key)}<small>B</small>` : `<small>B</small>`;
  }
}
