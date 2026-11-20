import { G } from './ctx';
import { t } from '../i18n';
import { IC } from './icons';

export interface PickOpts {
  /** Pins to set (more = longer to open). */
  pins: number;
  /** Half-height of the old gold band (0..1): bigger = easier = quicker. */
  zone: number;
  /** (old pin speed; unused now) */
  speed: number;
}

const CSS = `
#pick { position:absolute; left:50%; top:56%; transform: translate(-50%,-50%); display:none; flex-direction:column; align-items:center;
  gap: 8px; padding: 12px 18px; border-radius: 18px; background: var(--panel); z-index: 20; pointer-events:none; }
#pick.show { display:flex; }
#pick .row { display:flex; align-items:center; gap: 10px; }
#pick .ic { width: 40px; height: 40px; }
#pick .bar { width: 220px; height: 16px; border-radius: 9px; background: rgba(0,0,0,.45); overflow:hidden; box-shadow: inset 0 0 0 2px #3b2412; }
#pick .bar i { display:block; height:100%; width:0; background: linear-gradient(90deg, #ffd166, #b6e36a); }
#pick .w { font-size: 17px; color: #fff6e6; }
#pick.go .lk { animation: pickRattle .25s infinite; }
@keyframes pickRattle { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-8deg) } 75% { transform: rotate(8deg) } }
`;

/**
 * Opening a padlock (the cage from inside / outside, a padlocked gate): HOLD a button at the latch and the bar fills
 * (user s29: the old pin-timing puzzle "isn't clickable, the animation just smears — make it simple"). Let go = it
 * slides back slowly. Runs on the player's own screen; the result goes to the host as an input press (`pickP`).
 */
export class Lockpick {
  isOpen = false;
  /** Results waiting to be sent with the next input. */
  solved = false; slips = 0;
  private el: HTMLElement; private bar!: HTMLElement;
  private o: PickOpts = { pins: 4, zone: 0.16, speed: 1.4 };
  private prog = 0; private tick = 0;

  constructor() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'pick'; this.el.className = 'txt';
    document.getElementById('hud')!.appendChild(this.el);
  }

  /** Seconds of holding it takes (6 pins from inside ≈ 4.5 s, a gate / outside ≈ 3 s; the skeleton key: quicker). */
  private dur() { return Math.max(1.2, this.o.pins * 0.75 * Math.min(1.5, Math.max(0.6, 0.16 / Math.max(0.05, this.o.zone)))); }

  open(o: PickOpts) {
    this.o = o; this.isOpen = true; this.prog = 0; this.tick = 0; this.solved = false;
    this.el.innerHTML = `<div class="row"><span class="lk">${IC.lock}</span><div class="bar"><i></i></div></div>`
      + `<div class="row">${IC.rmb}${IC.lmb}<span class="w">${t('pw.holdOpen')}</span></div>`;
    this.bar = this.el.querySelector('.bar i') as HTMLElement;
    this.el.classList.add('show');
    G.audio.play('unlock', { vol: 0.35, pitch: 1.8 });
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.remove('show', 'go'); }

  /** (a press: nothing extra — holding does the work) */
  attempt() { /* */ }

  /** Every frame while open: `holding` = RMB / LMB / Space (pad: the trigger / A) held. */
  update(dt: number, holding = false) {
    if (!this.isOpen) return;
    if (holding) {
      this.prog += dt / this.dur();
      if ((this.tick += dt) > 0.45) { this.tick = 0; G.audio.play('unlock', { vol: 0.3, pitch: 1.1 + this.prog * 0.6 }); }
      if (this.prog >= 1) { this.solved = true; G.audio.play('unlock', { vol: 0.6, pitch: 1.5 }); this.close(); return; }
    } else this.prog = Math.max(0, this.prog - dt * 0.25);
    this.el.classList.toggle('go', holding);
    this.bar.style.width = `${Math.round(this.prog * 100)}%`;
  }
}
