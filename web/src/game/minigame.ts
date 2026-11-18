import { G } from './ctx';
import { IC, type IconId } from './icons';
import { clamp } from '../core/util';

/**
 * Station mini-games (chain modes, farms 6 / 7): every craft step is a little hands-on game on the player's own screen
 * (like the lock-pick), its result goes to the host as an input `act` code. Kinds:
 *  crank    — circle the mouse to turn a handle at the right speed (too fast = it jams)            grinder, mill
 *  timing   — click when the swinging needle is in the gold zone, n times (3 misses = fail)         filter, lighter, oven
 *  hold     — hold LMB, the level rises faster and faster: let go in the band (past the top = over)  bong, tap
 *  sprinkle — hold LMB and sweep the mouse left / right so every part fills evenly (not too much)  joint paper
 *  swipe    — mouse up, down, up, down… in rhythm                                                    rolling, kneading
 *  stir     — circle the mouse to stir; the heat creeps up, stirring cools it: keep it in the band  butter, wort
 * Result: 0 failed, 1..3 how well, 4 overdone (burnt / coughing / overflowing).
 */
export type MiniKind = 'crank' | 'timing' | 'hold' | 'sprinkle' | 'swipe' | 'stir';
export interface MiniStep { kind: MiniKind; icon: IconId; n?: number; zone?: number; speed?: number; secs?: number; color?: string }

const W = 340, H = 210;
const INK = '#3b2412', CREAM = '#fff6e6', GOLD = '#ffd166', GREEN = '#8be04e', RED = '#ff6a4a';
const CSS = `
#mini { position:absolute; left:50%; top:54%; transform: translate(-50%,-50%); display:none; flex-direction:column; align-items:center;
  gap: 4px; padding: 10px 14px 10px; border-radius: 18px; background: var(--panel); z-index: 20; pointer-events:none; }
#mini.show { display:flex; }
#mini .mh { display:flex; align-items:center; gap: 8px; } #mini .mh .ic { width: 30px; height: 30px; }
#mini .dots { display:flex; gap: 5px; } #mini .dots i { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,246,230,.25); border: 1.5px solid ${INK}; }
#mini .dots i.ok { background: ${GREEN}; } #mini .dots i.now { background: ${GOLD}; }
#mini canvas { width: ${W}px; height: ${H}px; }
#mini .keys { display:flex; gap: 6px; align-items:center; font-family: Title; font-size: 18px; color: ${GOLD}; }
#mini.shake canvas { animation: pickShake .35s; }
`;

export class Minigame {
  isOpen = false;
  /** Act code waiting to be sent with the next input (game.ts), 0 = none. */
  out = 0;
  private el: HTMLElement; private cv!: HTMLCanvasElement; private g!: CanvasRenderingContext2D; private head!: HTMLElement; private keys!: HTMLElement;
  private steps: MiniStep[] = []; private si = 0; private q = 3; private code = 0;
  private s!: MiniStep;
  // per-step state
  private p = 0; private t = 0; private a = 0; private lastA = 0; private cx = 0; private cy = -60; private spin = 0; private hot = 0; private stall = 0;
  private needle = 0; private dir = 1; private zone0 = 0.4; private hits = 0; private miss = 0; private wait = 0;
  private level = 0; private vel = 0; private holding = false;
  private segs: number[] = []; private over = 0; private sx = 0.5;
  private sw = 0; private swDir = 0; private swAcc = 0; private swT = 0;
  private heat = 0.3; private shakeT = 0;

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'mini'; this.el.className = 'txt';
    this.el.innerHTML = `<div class="mh"></div><canvas width="${W * 2}" height="${H * 2}"></canvas><div class="keys"></div>`;
    document.getElementById('hud')!.appendChild(this.el);
    this.cv = this.el.querySelector('canvas')!; this.g = this.cv.getContext('2d')!; this.g.scale(2, 2);
    this.head = this.el.querySelector('.mh')!; this.keys = this.el.querySelector('.keys')!;
  }

  /** Start a station's steps; `code(q)` → the act code to send (station index + result). */
  open(steps: MiniStep[], code: number) {
    this.steps = steps; this.si = 0; this.q = 3; this.code = code; this.isOpen = true;
    this.el.classList.add('show');
    this.begin();
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.remove('show'); }
  private finish(r: number) {
    this.out = this.code + r;
    this.close();
    G.audio.play(r === 0 ? 'clunk' : r === 4 ? 'cough' : 'unlock', { vol: 0.5, pitch: r === 0 || r === 4 ? 1 : 1.6 });
  }
  private next(q: number) {
    this.q = Math.min(this.q, q);
    G.audio.play('unlock', { vol: 0.4, pitch: 1.2 + this.si * 0.15 });
    if (++this.si >= this.steps.length) this.finish(Math.max(1, this.q)); else this.begin();
  }
  private fail(over = false) { this.shake(); this.finish(over ? 4 : 0); }
  private shake() { this.el.classList.remove('shake'); void this.el.offsetWidth; this.el.classList.add('shake'); this.shakeT = 0.35; }

  private begin() {
    const s = this.s = this.steps[this.si];
    this.p = 0; this.t = 0; this.spin = 0; this.hot = 0; this.stall = 0; this.cx = 0; this.cy = -60; this.a = this.lastA = Math.atan2(this.cy, this.cx);
    this.needle = 0; this.dir = 1; this.hits = 0; this.miss = 0; this.wait = 0.3; this.zone0 = 0.15 + Math.random() * (0.7 - (s.zone ?? 0.16));
    this.level = 0; this.vel = 0; this.holding = false;
    this.segs = new Array(s.n ?? 8).fill(0); this.over = 0; this.sx = 0.5;
    this.sw = 0; this.swDir = 0; this.swAcc = 0; this.swT = 0;
    this.heat = 0.3;
    this.head.innerHTML = IC[s.icon] + `<div class="dots">${this.steps.map((_, i) => `<i class="${i < this.si ? 'ok' : i === this.si ? 'now' : ''}"></i>`).join('')}</div>`;
    const K: Record<MiniKind, string> = {
      crank: IC.mouse + '⟳', stir: IC.mouse + '⟳', timing: IC.lmb, hold: IC.lmb + '▮', sprinkle: IC.lmb + IC.mouse + '↔', swipe: IC.mouse + '↕',
    };
    this.keys.innerHTML = K[s.kind];
  }

  /** LMB / Space pressed (timing). */
  press() {
    if (!this.isOpen || this.s.kind !== 'timing' || this.wait > 0) return;
    const z = this.s.zone ?? 0.16;
    if (this.needle >= this.zone0 && this.needle <= this.zone0 + z) {
      this.hits++;
      const centre = Math.abs(this.needle - (this.zone0 + z / 2)) < z * 0.22;
      G.audio.play('unlock', { vol: 0.5, pitch: centre ? 1.9 : 1.4 });
      if (!centre) this.q = Math.min(this.q, 2);
      if (this.hits >= (this.s.n ?? 1)) { this.next(this.miss ? Math.max(1, 3 - this.miss) : 3); return; }
      this.zone0 = 0.12 + Math.random() * (0.76 - z); this.wait = 0.2;
    } else {
      this.miss++; this.shake(); G.audio.play('clunk', { vol: 0.5 });
      if (this.miss >= 3) { this.fail(); return; }
      this.wait = 0.35;
    }
  }

  /** Every frame while open: mouse movement (pixels), LMB held. */
  update(dt: number, mdx: number, mdy: number, lmb: boolean) {
    if (!this.isOpen) return;
    if (this.shakeT > 0 && (this.shakeT -= dt) <= 0) this.el.classList.remove('shake');
    this.t += dt;
    const s = this.s;
    if (this.wait > 0) this.wait -= dt;
    switch (s.kind) {
      case 'crank': case 'stir': {
        this.cx += mdx * 0.8; this.cy += mdy * 0.8;
        const r = Math.hypot(this.cx, this.cy), R = 64;
        if (r > R) { this.cx *= R / r; this.cy *= R / r; }
        let dA = 0;
        if (r > 22) { this.a = Math.atan2(this.cy, this.cx); dA = this.a - this.lastA; if (dA > Math.PI) dA -= Math.PI * 2; if (dA < -Math.PI) dA += Math.PI * 2; }
        this.lastA = this.a;
        this.spin += (Math.abs(dA) / Math.max(dt, 1e-3) - this.spin) * Math.min(1, dt * 5);
        if (s.kind === 'crank') {
          if (this.stall > 0) { this.stall -= dt; break; }
          const lo = 3, hi = s.speed ?? 10;
          if (this.spin > hi) { this.hot += dt; if (this.hot > 0.45) { this.hot = 0; this.stall = 0.9; this.p = Math.max(0, this.p - 0.12); this.q = Math.max(1, this.q - 1); this.shake(); G.audio.play('metal', { vol: 0.7, pitch: 0.6 }); } }
          else this.hot = Math.max(0, this.hot - dt);
          this.p += (Math.abs(dA) / (Math.PI * 2 * (s.n ?? 4))) * (this.spin < lo ? 0.35 : 1);
          if (Math.abs(dA) > 0.3 && Math.random() < 0.25) G.audio.play('wood', { vol: 0.15, pitch: 1.5 + Math.random() * 0.4, minGap: 0.08 });
          if (this.p >= 1) this.next(this.q);
        } else {
          // stirring cools the pot; heat creeps up on its own (and wanders)
          this.heat += (0.16 + Math.sin(this.t * 1.7) * 0.08 - this.spin * 0.024) * dt;
          this.heat = Math.max(0, this.heat);
          const ok = this.heat > 0.32 && this.heat < 0.72;
          if (ok) this.p += dt / (s.secs ?? 6);
          if (this.heat >= 1) { this.fail(true); break; }
          if (this.heat > 0.85) this.q = Math.min(this.q, 2);
          if (this.p >= 1) this.next(this.q);
        }
        break;
      }
      case 'timing': {
        if (this.wait > 0) break;
        const v = (s.speed ?? 1.2) * (1 + this.hits * 0.15);
        this.needle += this.dir * v * dt;
        if (this.needle >= 1) { this.needle = 1; this.dir = -1; } if (this.needle <= 0) { this.needle = 0; this.dir = 1; }
        break;
      }
      case 'hold': {
        if (lmb) {
          this.holding = true;
          this.vel += (s.speed ?? 0.7) * dt; this.level += this.vel * dt;
          if (this.level >= 1) { this.level = 1; this.fail(true); }
        } else if (this.holding) {
          const b0 = 1 - (s.zone ?? 0.25) - 0.06, b1 = 0.94;
          if (this.level < 0.25) { this.holding = false; this.level = 0; this.vel = 0; break; }   // a little tap: try again
          this.next(this.level >= b0 && this.level <= b1 ? (Math.abs(this.level - (b0 + b1) / 2) < (b1 - b0) * 0.25 ? 3 : 2) : 1);
        }
        break;
      }
      case 'sprinkle': {
        this.sx = clamp(this.sx + mdx / 420, 0, 0.999);
        if (lmb) {
          const i = Math.floor(this.sx * this.segs.length);
          this.segs[i] += dt * 1.6;
          if (this.segs[i] > 1.25) { this.segs[i] = 0.85; this.over++; this.q = Math.max(1, this.q - 1); this.shake(); G.audio.play('squish', { vol: 0.4, pitch: 1.6 }); }
        }
        if (this.segs.every((x) => x >= 0.6)) this.next(this.q);
        break;
      }
      case 'swipe': {
        this.swT += dt;
        const d = Math.sign(mdy);
        if (d && d === this.swDir) this.swAcc += Math.abs(mdy);
        else if (d) { this.swDir = d; this.swAcc = Math.abs(mdy); }
        if (this.swAcc > 55 && this.swDir !== this.sw) {
          if (this.sw !== 0) {
            this.p += 1 / (s.n ?? 8);
            G.audio.play('whoosh', { vol: 0.2, pitch: 1.6 + Math.random() * 0.3, minGap: 0.05 });
            if (this.swT < 0.09) { this.q = Math.max(1, this.q - 1); this.shake(); }   // too wild: it tears a bit
            this.swT = 0;
          }
          this.sw = this.swDir;
        }
        if (this.p >= 1) this.next(this.q);
        break;
      }
    }
    if (this.isOpen) this.draw();
  }

  // ------------------------------------------------------------------ drawing (canvas, cartoon: fat shapes + ink)
  private draw() {
    const g = this.g, s = this.s;
    g.clearRect(0, 0, W, H);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const ink = (w = 4) => { g.strokeStyle = INK; g.lineWidth = w; g.stroke(); };
    const fill = (c: string) => { g.fillStyle = c; g.fill(); };
    const bar = (x: number, y: number, w: number, h: number, k: number, c = GREEN) => {
      g.beginPath(); g.roundRect(x, y, w, h, h / 2); fill('rgba(0,0,0,.35)');
      g.beginPath(); g.roundRect(x, y, Math.max(h, w * clamp(k, 0, 1)), h, h / 2); fill(c); g.beginPath(); g.roundRect(x, y, w, h, h / 2); ink(3);
    };
    switch (s.kind) {
      case 'crank': case 'stir': {
        const cx = 130, cy = 100, R = 70;
        if (s.kind === 'crank') {
          // the machine's wheel: spokes turn with the handle
          g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); fill('#b9925a'); ink(5);
          g.beginPath(); g.arc(cx, cy, R - 14, 0, Math.PI * 2); fill('#d8b07a'); ink(3);
          for (let k = 0; k < 6; k++) { const a = this.a + k * Math.PI / 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); ink(5); }
          g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); fill('#8a6a3a'); ink(3);
        } else {
          // pot from above: the brew swirls
          g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); fill('#5c5f66'); ink(5);
          g.beginPath(); g.arc(cx, cy, R - 10, 0, Math.PI * 2); fill(s.color ?? '#e9c46a'); ink(2);
          for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(cx, cy, 16 + k * 16, this.a + k, this.a + k + 2.2); g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 4; g.stroke(); }
        }
        const hx = cx + Math.cos(this.a) * (R - 6), hy = cy + Math.sin(this.a) * (R - 6);
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(hx, hy); ink(7); g.strokeStyle = s.kind === 'crank' ? '#cfd6de' : '#c98a4a'; g.lineWidth = 4; g.stroke();
        g.beginPath(); g.arc(hx, hy, 11, 0, Math.PI * 2); fill(GOLD); ink(3);
        if (s.kind === 'crank') {
          // speed gauge: green band, red when too fast
          const gx = 262, gy = 112, gr = 52, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, sp = clamp(this.spin / 14, 0, 1);
          const lo = 3 / 14, hi = (s.speed ?? 10) / 14;
          g.beginPath(); g.arc(gx, gy, gr, a0, a1); g.lineWidth = 16; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
          g.beginPath(); g.arc(gx, gy, gr, a0 + (a1 - a0) * lo, a0 + (a1 - a0) * hi); g.strokeStyle = GREEN; g.stroke();
          g.beginPath(); g.arc(gx, gy, gr, a0 + (a1 - a0) * hi, a1); g.strokeStyle = RED; g.stroke();
          const na = a0 + (a1 - a0) * sp; g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + Math.cos(na) * (gr + 4), gy + Math.sin(na) * (gr + 4)); ink(5);
          g.beginPath(); g.arc(gx, gy, 7, 0, Math.PI * 2); fill(CREAM); ink(3);
          if (this.stall > 0) { g.font = '28px Title'; g.fillStyle = RED; g.fillText('!!', gx - 12, gy - 12); }
        } else {
          // thermometer
          const tx = 268, ty = 20, th = 150;
          g.beginPath(); g.roundRect(tx, ty, 26, th, 13); fill(CREAM); ink(4);
          g.fillStyle = 'rgba(139,224,78,.6)'; g.fillRect(tx + 3, ty + th * (1 - 0.72), 20, th * 0.4);
          const hh = clamp(this.heat, 0, 1);
          g.beginPath(); g.roundRect(tx + 7, ty + th * (1 - hh), 12, th * hh, 6); fill(hh > 0.72 ? RED : '#ff9a5a');
          g.beginPath(); g.arc(tx + 13, ty + th + 10, 16, 0, Math.PI * 2); fill(hh > 0.72 ? RED : '#ff9a5a'); ink(4);
        }
        bar(30, 188, 220, 14, this.p);
        break;
      }
      case 'timing': {
        const x0 = 24, x1 = 316, y = 96, z = s.zone ?? 0.16;
        g.beginPath(); g.roundRect(x0, y - 26, x1 - x0, 52, 26); fill('#6b4a2a'); ink(5);
        g.beginPath(); g.roundRect(x0 + (x1 - x0) * this.zone0, y - 22, (x1 - x0) * z, 44, 12); fill(GOLD);
        g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x0 + (x1 - x0) * (this.zone0 + z / 2) - 2, y - 22, 4, 44);
        const nx = x0 + (x1 - x0) * this.needle;
        g.beginPath(); g.moveTo(nx, y - 40); g.lineTo(nx - 10, y - 56); g.lineTo(nx + 10, y - 56); g.closePath(); fill(CREAM); ink(3);
        g.beginPath(); g.moveTo(nx, y - 38); g.lineTo(nx, y + 38); ink(6); g.strokeStyle = CREAM; g.lineWidth = 3; g.stroke();
        for (let i = 0; i < (s.n ?? 1); i++) { g.beginPath(); g.arc(170 - ((s.n ?? 1) - 1) * 12 + i * 24, 170, 9, 0, Math.PI * 2); fill(i < this.hits ? GREEN : 'rgba(255,246,230,.25)'); ink(3); }
        for (let i = 0; i < this.miss; i++) { g.font = '22px Title'; g.fillStyle = RED; g.fillText('✘', 24 + i * 22, 30); }
        break;
      }
      case 'hold': {
        const tx = 120, ty = 18, tw = 100, th = 176, b0 = 1 - (s.zone ?? 0.25) - 0.06, b1 = 0.94;
        g.beginPath(); g.roundRect(tx, ty, tw, th, 22); fill('rgba(220,240,255,.25)'); ink(5);
        g.fillStyle = 'rgba(139,224,78,.45)'; g.fillRect(tx + 4, ty + th * (1 - b1), tw - 8, th * (b1 - b0));
        const lv = clamp(this.level, 0, 1);
        g.save(); g.beginPath(); g.roundRect(tx + 4, ty + 4, tw - 8, th - 8, 18); g.clip();
        g.fillStyle = s.color ?? '#e8eef2'; g.fillRect(tx, ty + th * (1 - lv), tw, th * lv);
        for (let i = 0; i < 6; i++) { const bx = tx + 14 + ((i * 37 + this.t * 40) % (tw - 28)), by = ty + th - ((this.t * 60 + i * 29) % (th * Math.max(lv, 0.05))); g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill(); }
        g.restore();
        g.beginPath(); g.roundRect(tx, ty, tw, th, 22); ink(5);
        g.beginPath(); g.moveTo(tx - 12, ty + th * (1 - b1)); g.lineTo(tx + tw + 12, ty + th * (1 - b1)); g.strokeStyle = GOLD; g.lineWidth = 3; g.stroke();
        g.beginPath(); g.moveTo(tx - 12, ty + th * (1 - b0)); g.lineTo(tx + tw + 12, ty + th * (1 - b0)); g.stroke();
        break;
      }
      case 'sprinkle': {
        const x0 = 30, x1 = 310, y = 110, n = this.segs.length, sw = (x1 - x0) / n;
        g.beginPath(); g.roundRect(x0 - 6, y - 30, x1 - x0 + 12, 60, 8); fill(CREAM); ink(4);
        this.segs.forEach((v, i) => {
          const h = 44 * clamp(v, 0, 1.25) / 1.25;
          g.beginPath(); g.roundRect(x0 + i * sw + 3, y + 22 - h, sw - 6, h, 6); fill(v > 1 ? RED : v >= 0.6 ? s.color ?? '#5e9c3a' : '#a8c88a');
        });
        g.strokeStyle = 'rgba(59,36,18,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y - 22 + 44 * (1 - 0.6 / 1.25)); g.lineTo(x1, y - 22 + 44 * (1 - 0.6 / 1.25)); g.stroke();
        const hx = x0 + (x1 - x0) * this.sx;
        g.beginPath(); g.ellipse(hx, y - 52, 16, 12, 0, 0, Math.PI * 2); fill('#ffb3c8'); ink(3);
        g.beginPath(); g.moveTo(hx - 5, y - 42); g.lineTo(hx, y - 34); g.lineTo(hx + 5, y - 42); ink(3);
        break;
      }
      case 'swipe': {
        const k = clamp(this.p, 0, 1), cx = 170, cy = 110;
        g.beginPath(); g.roundRect(40, cy - 12 + k * 20, 260, 60 * (1 - k) + 22, 10); fill(CREAM); ink(4);
        g.beginPath(); g.roundRect(40, cy - 22 + k * 10, 260, 22 + k * 10, 14); fill(s.color ?? '#f1e3c6'); ink(4);
        g.font = '40px Title'; g.fillStyle = this.sw < 0 ? GOLD : 'rgba(255,246,230,.35)'; g.fillText('▲', cx - 14, 46);
        g.fillStyle = this.sw > 0 ? GOLD : 'rgba(255,246,230,.35)'; g.fillText('▼', cx - 14, 204);
        bar(60, 6, 220, 10, k);
        break;
      }
    }
  }
}
