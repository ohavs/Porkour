import { G } from './ctx';
import { t } from '../i18n';
import { clamp } from '../core/util';

export interface PickOpts {
  /** Pins to set. */
  pins: number;
  /** Half-height of the gold band (0..1 of the pin travel): bigger = easier. */
  zone: number;
  /** Pin travel speed (travels per second); every next pin is a bit faster. */
  speed: number;
}

const CSS = `
#pick { position:absolute; left:50%; top:52%; transform: translate(-50%,-50%); display:none; flex-direction:column; align-items:center;
  gap: 6px; padding: 14px 18px 12px; border-radius: 18px; background: var(--panel); z-index: 20; pointer-events:none; }
#pick.show { display:flex; }
#pick h3 { margin:0; font-family: Title; font-weight: normal; color: var(--gold); font-size: 24px; }
#pick .hint { font-size: 15px; opacity: .9; text-align:center; max-width: 340px; }
#pick .hint b { color: var(--gold); }
#pick .sub { font-size: 12px; opacity: .65; }
#pick svg { width: 340px; height: 200px; overflow: visible; }
#pick.shake svg { animation: pickShake .35s; }
@keyframes pickShake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-9px) rotate(-2deg) } 40% { transform: translateX(8px) rotate(2deg) } 60% { transform: translateX(-6px) } 80% { transform: translateX(4px) } }
`;

const NS = 'http://www.w3.org/2000/svg';
/** Lock face layout (svg units). */
const L = { x0: 30, x1: 310, top: 20, shear: 92, plugBot: 170, pinW: 22, travel: 46 };

/**
 * The cage padlock as a little pin-tumbler puzzle (Thief / Sea of Thieves flavour): the current pin bobs up and down
 * by itself, click (LMB / Space) when its top is in the gold band at the shear line → it stays up; set them all and the
 * lock pops. A miss drops the last pin back down with a loud clank Bob can hear. Runs on the player's own screen;
 * the result goes to the host as an input press (`pickP` / `pickFailP`).
 */
export class Lockpick {
  isOpen = false;
  /** Results waiting to be sent with the next input. */
  solved = false; slips = 0;
  private el: HTMLElement; private svg!: SVGSVGElement;
  private pins: { g: SVGGElement; key: SVGRectElement; glow: SVGRectElement }[] = [];
  private band!: SVGRectElement;
  private o: PickOpts = { pins: 4, zone: 0.16, speed: 1.4 };
  private set = 0; private h = 0; private dir = 1; private wait = 0; private speedK = 1;
  private shakeT = 0;

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'pick'; this.el.className = 'txt';
    document.getElementById('hud')!.appendChild(this.el);
  }

  open(o: PickOpts) {
    this.o = o; this.isOpen = true; this.set = 0; this.h = 0; this.dir = 1; this.wait = 0.35; this.solved = false;
    this.speedK = 0.9 + Math.random() * 0.2;
    this.build();
    this.el.classList.add('show');
    G.audio.play('unlock', { vol: 0.35, pitch: 1.8 });
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.remove('show'); }

  /** LMB / Space. */
  attempt() {
    if (!this.isOpen || this.wait > 0) return;
    const top = 1 - this.h;
    if (top <= this.o.zone * 2) {
      this.set++;
      G.audio.play('unlock', { vol: 0.5, pitch: 1.3 + this.set * 0.12 });
      if (this.set >= this.o.pins) { this.solved = true; this.close(); return; }
      this.h = 0; this.dir = 1; this.wait = 0.25; this.speedK = 0.9 + Math.random() * 0.25;
    } else {
      // slipped: the last pin falls back, loud clank (the host makes it a noise Bob hears)
      this.set = Math.max(0, this.set - 1);
      this.slips++;
      this.h = 0; this.dir = 1; this.wait = 0.45;
      this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake');
      this.shakeT = 0.35;
    }
    this.draw();
  }

  update(dt: number) {
    if (!this.isOpen) return;
    if (this.shakeT > 0 && (this.shakeT -= dt) <= 0) this.el.classList.remove('shake');
    if (this.wait > 0) this.wait -= dt;
    else {
      // triangle wave, a hair of easing at the ends so it reads as springy
      const v = this.o.speed * (1 + this.set * 0.14) * this.speedK;
      this.h += this.dir * v * dt * (0.55 + 0.45 * Math.sin(clamp(this.h, 0.02, 0.98) * Math.PI));
      if (this.h >= 1) { this.h = 1; this.dir = -1; }
      if (this.h <= 0) { this.h = 0; this.dir = 1; }
    }
    this.draw();
  }

  private build() {
    const n = this.o.pins, gap = (L.x1 - L.x0) / n;
    const zoneH = this.o.zone * 2 * L.travel;
    this.el.innerHTML = `<h3>${t('pick.title')}</h3><svg viewBox="0 0 340 200"></svg>` +
      `<div class="hint">${t('pick.hint', { lmb: `<b>${t('key.lmb')}</b>`, space: `<b>${t('key.space')}</b>` })}</div><div class="sub">${t('pick.sub')}</div>`;
    this.svg = this.el.querySelector('svg')!;
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, a: Record<string, string | number>, parent: Element = this.svg) => {
      const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, String(a[k])); parent.appendChild(e); return e;
    };
    // lock body (brass) + plug (the part that turns) + keyhole
    mk('rect', { x: 10, y: 4, width: 320, height: 186, rx: 26, fill: '#c9922e', stroke: '#5a3a12', 'stroke-width': 5 });
    mk('rect', { x: 18, y: 12, width: 304, height: 30, rx: 14, fill: '#e7b552', opacity: 0.55 });
    mk('rect', { x: L.x0 - 6, y: L.shear, width: L.x1 - L.x0 + 12, height: L.plugBot - L.shear, rx: 12, fill: '#a87420', stroke: '#5a3a12', 'stroke-width': 3 });
    // gold band at the shear line
    this.band = mk('rect', { x: L.x0 - 6, y: L.shear, width: L.x1 - L.x0 + 12, height: zoneH, fill: '#ffd166', opacity: 0.4 });
    mk('line', { x1: L.x0 - 8, x2: L.x1 + 8, y1: L.shear, y2: L.shear, stroke: '#ffe9a8', 'stroke-width': 2.5, 'stroke-dasharray': '6 5' });
    this.pins = [];
    for (let i = 0; i < n; i++) {
      const cx = L.x0 + gap * (i + 0.5);
      mk('rect', { x: cx - L.pinW / 2 - 4, y: L.top, width: L.pinW + 8, height: L.plugBot - 14 - L.top, rx: 6, fill: '#4a300f', opacity: 0.8 });
      const g = mk('g', {});
      // spring + driver pin (steel) on top, key pin (brass) under it: the gap between them must reach the shear line
      mk('path', { d: `M${cx} ${L.shear - 60} l-7 4 l14 5 l-14 5 l14 5 l-7 4`, fill: 'none', stroke: '#9aa3ad', 'stroke-width': 2.5 }, g);
      mk('rect', { x: cx - L.pinW / 2, y: L.shear - 33, width: L.pinW, height: 30, rx: 5, fill: '#cfd6de', stroke: '#47515c', 'stroke-width': 2.5 }, g);
      const glow = mk('rect', { x: cx - L.pinW / 2 - 3, y: L.shear - 4, width: L.pinW + 6, height: 6, rx: 3, fill: '#b6e36a', opacity: 0 }, g);
      const key = mk('rect', { x: cx - L.pinW / 2, y: L.shear, width: L.pinW, height: 30, rx: 6, fill: '#f0c25a', stroke: '#6b4512', 'stroke-width': 2.5 }, g);
      this.pins.push({ g, key, glow });
    }
    this.draw();
  }

  private draw() {
    this.pins.forEach((p, i) => {
      // pin rest = bottom; lift 0..1 brings the key pin's top up to the shear line
      const lift = i < this.set ? 1 : i === this.set ? this.h : 0;
      p.g.setAttribute('transform', `translate(0 ${(1 - lift) * L.travel})`);
      p.key.setAttribute('fill', i < this.set ? '#b6e36a' : i === this.set ? '#ffd166' : '#d9a441');
      p.glow.setAttribute('opacity', i < this.set ? '0.9' : '0');
    });
    const hot = this.set < this.pins.length && 1 - this.h <= this.o.zone * 2 && this.wait <= 0;
    this.band.setAttribute('opacity', hot ? '0.95' : '0.55');
  }
}
